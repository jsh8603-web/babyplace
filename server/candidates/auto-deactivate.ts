/**
 * Closure detection + auto-deactivation engine.
 *
 * Conditions for setting is_active = false (plan.md 10-4, Task #5 enhancements):
 *   ① Kakao API revalidation FAILS (place no longer in Kakao's database)
 *   ② No blog/café mentions for the past TTL (category-specific)
 *
 * Both conditions must be true. Either alone is insufficient to deactivate
 * (a place might just be temporarily missing from Kakao, or simply unpopular).
 *
 * Category-based TTL (Task #5):
 *   - 놀이 (play facilities): 3 months
 *   - 공원/놀이터 (parks): 6 months
 *   - 전시/체험 (exhibits/experiences): 6 months
 *   - 공연 (performances): 3 months (seasonal)
 *   - 동물/자연 (animals/nature): 6 months
 *   - 식당/카페 (restaurants/cafes): 4 months
 *   - 도서관 (libraries): 12 months (stable)
 *   - 수영/물놀이 (swimming/water): 6 months
 *   - 문화행사 (cultural events): 3 months (seasonal)
 *   - 편의시설 (facilities): 12 months (reference data)
 *
 * Runs daily at 05:00 KST.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { searchKakaoPlace } from '../lib/kakao-search'
import type { PlaceCategory } from '../../src/types/index'

/** Category-specific TTL in days (Task #5 enhancement) */
const CATEGORY_TTL_DAYS: Record<PlaceCategory, number> = {
  '놀이': 90,           // 3 months
  '공원/놀이터': 180,   // 6 months
  '전시/체험': 180,     // 6 months
  '공연': 90,           // 3 months (seasonal)
  '동물/자연': 180,     // 6 months
  '식당/카페': 120,     // 4 months
  '도서관': 365,        // 12 months (stable)
  '수영/물놀이': 180,   // 6 months
  '문화행사': 90,       // 3 months (seasonal)
  '편의시설': 365,      // 12 months (reference data)
}

/** Fallback silence period (used if category is unknown) */
const DEFAULT_SILENCE_DAYS = 180 // 6 months

/** Batch size: places to revalidate per run (budget-conscious). */
const REVALIDATE_BATCH = 1000

/** Minimum similarity score to consider a Kakao result a match. */
const MATCH_THRESHOLD = 0.75

// ─── Main export ──────────────────────────────────────────────────────────────

export interface AutoDeactivateResult {
  placesChecked: number
  deactivated: number
  stillActive: number
  errors: number
}

export async function runAutoDeactivate(): Promise<AutoDeactivateResult> {
  const result: AutoDeactivateResult = {
    placesChecked: 0,
    deactivated: 0,
    stillActive: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  // Select places that are:
  //   - currently active
  //   - last_mentioned_at is older than category-specific TTL (or null)
  // These are candidates for Kakao revalidation.
  // Note: We fetch a larger batch and filter by category-specific TTL client-side
  // because Supabase doesn't support complex conditional queries easily.
  const { data: allPlaces, error } = await supabaseAdmin
    .from('places')
    .select('id, name, category, kakao_place_id, address, lat, lng, last_mentioned_at')
    .eq('is_active', true)
    .order('last_mentioned_at', { ascending: true, nullsFirst: true })
    .limit(REVALIDATE_BATCH * 2)  // fetch 2x to account for filtering

  if (error) {
    console.error('[auto-deactivate] Failed to fetch places:', error)
    result.errors++
    return result
  }

  // Filter by category-specific TTL
  const places = (allPlaces || [])
    .filter((place) => {
      const ttl = CATEGORY_TTL_DAYS[place.category as PlaceCategory] ?? DEFAULT_SILENCE_DAYS
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - ttl)
      const lastMentioned = place.last_mentioned_at ? new Date(place.last_mentioned_at) : new Date(0)
      return lastMentioned < cutoffDate
    })
    .slice(0, REVALIDATE_BATCH)  // limit after filtering

  if (!places || places.length === 0) {
    console.log('[auto-deactivate] No places to check')
    return result
  }

  for (const place of places) {
    result.placesChecked++

    try {
      const kakaoAlive = await checkKakaoAlive(
        place.name,
        place.kakao_place_id,
        place.address
      )

      if (!kakaoAlive) {
        // Kakao revalidation failed + category-specific TTL silence → deactivate
        const ttl = CATEGORY_TTL_DAYS[place.category as PlaceCategory] ?? DEFAULT_SILENCE_DAYS
        const ttlMonths = Math.round(ttl / 30)

        await supabaseAdmin
          .from('places')
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', place.id)

        console.log(
          `[auto-deactivate] Deactivated: "${place.name}" (id=${place.id}, category=${place.category}) — Kakao not found + ${ttlMonths}mo silence`
        )
        result.deactivated++
      } else {
        result.stillActive++
      }
    } catch (err) {
      console.error(`[auto-deactivate] Error checking place ${place.id}:`, err)
      result.errors++
    }
  }

  // Log to collection_logs
  await logCollection({
    collector: 'auto-deactivate',
    startedAt,
    resultsCount: result.placesChecked,
    errors: result.errors,
  })

  return result
}

// ─── Kakao revalidation ───────────────────────────────────────────────────────

/**
 * Returns true if the place is still found in Kakao's database.
 *
 * Strategy:
 *   1. If kakao_place_id is stored, search by keyword and check if the same ID
 *      appears in results. This avoids a direct GET-by-ID API (not in the free tier).
 *   2. If no kakao_place_id, search by name + address prefix.
 *   3. Returns false if no result has similarity > MATCH_THRESHOLD.
 */
async function checkKakaoAlive(
  name: string,
  kakaoPlaceId: string | null,
  address: string | null
): Promise<boolean> {
  try {
    const match = await searchKakaoPlace(name, address, {
      threshold: MATCH_THRESHOLD,
      addressWords: 2,
      kakaoPlaceId,
    })

    // match found (either by ID or by similarity) → place is alive
    return match !== null
  } catch (err) {
    // Network/API error → be conservative and keep the place active
    console.error(`[auto-deactivate] Kakao check error for "${name}":`, err)
    return true
  }
}
