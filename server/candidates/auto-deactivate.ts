/**
 * Closure detection + auto-deactivation engine.
 *
 * Conditions for setting is_active = false (plan.md 10-4):
 *   ① Kakao API revalidation FAILS (place no longer in Kakao's database)
 *   ② No blog/café mentions for the past 6 months
 *
 * Both conditions must be true. Either alone is insufficient to deactivate
 * (a place might just be temporarily missing from Kakao, or simply unpopular).
 *
 * Runs daily at 05:00 KST.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { kakaoLimiter } from '../rate-limiter'
import { similarity } from '../matchers/similarity'

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword'

/** A place must have had no mentions for this many days to qualify. */
const SILENCE_DAYS = 180 // 6 months

/** Batch size: places to revalidate per run (budget-conscious). */
const REVALIDATE_BATCH = 200

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
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setDate(sixMonthsAgo.getDate() - SILENCE_DAYS)

  // Select places that are:
  //   - currently active
  //   - last_mentioned_at is older than 6 months (or null)
  // These are candidates for Kakao revalidation.
  const { data: places, error } = await supabaseAdmin
    .from('places')
    .select('id, name, kakao_place_id, address, lat, lng, last_mentioned_at')
    .eq('is_active', true)
    .or(
      `last_mentioned_at.lt.${sixMonthsAgo.toISOString()},last_mentioned_at.is.null`
    )
    .order('last_mentioned_at', { ascending: true, nullsFirst: true })
    .limit(REVALIDATE_BATCH)

  if (error || !places) {
    console.error('[auto-deactivate] Failed to fetch places:', error)
    result.errors++
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
        // Kakao revalidation failed + 6 months silence → deactivate
        await supabaseAdmin
          .from('places')
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', place.id)

        console.log(
          `[auto-deactivate] Deactivated: "${place.name}" (id=${place.id}) — Kakao not found + 6mo silence`
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
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'auto-deactivate',
    results_count: result.placesChecked,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
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
  const query = address
    ? `${name} ${address.split(/\s+/).slice(0, 2).join(' ')}`
    : name

  const params = new URLSearchParams({ query, size: '5' })

  try {
    const response = await kakaoLimiter.throttle(() =>
      fetch(`${KAKAO_KEYWORD_URL}?${params.toString()}`, {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
        },
      })
    )

    if (!response.ok) {
      // If the API call itself fails, be conservative — don't deactivate
      console.warn(`[auto-deactivate] Kakao API HTTP ${response.status} for "${name}"`)
      return true
    }

    const data = await response.json()
    const documents: Array<{ id: string; place_name: string }> =
      data.documents ?? []

    if (documents.length === 0) return false

    // If we have the original Kakao ID, check for direct ID match first
    if (kakaoPlaceId) {
      const idMatch = documents.some((doc) => doc.id === kakaoPlaceId)
      if (idMatch) return true
    }

    // Fallback: name similarity match
    for (const doc of documents) {
      const score = similarity(name, doc.place_name)
      if (score >= MATCH_THRESHOLD) return true
    }

    return false
  } catch (err) {
    // Network error → be conservative and keep the place active
    console.error(`[auto-deactivate] Kakao check error for "${name}":`, err)
    return true
  }
}
