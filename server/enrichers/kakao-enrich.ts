/**
 * Kakao enrichment pass — Fill missing phone/road_address for existing places.
 *
 * Uses spare Kakao Local API quota (~95K/day unused) to improve data_completeness,
 * which feeds into popularity scoring (15% weight in scoring.ts).
 *
 * Strategy:
 *   1. Select active places with NULL phone OR NULL road_address (batch of 1000)
 *   2. For each, search Kakao keyword API by name + address prefix
 *   3. If similarity > 0.75, update missing fields (phone, road_address, sub_category)
 *   4. Mark place as enriched (kakao_place_id set) to avoid re-processing
 *
 * Runs daily as part of SCORING_SCHEDULE (05:00 KST), before scoring.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { prefetchIds } from '../lib/prefetch'
import { searchKakaoPlace, searchKakaoPlaceDetailed } from '../lib/kakao-search'
import { kakaoLimiter } from '../rate-limiter'
import { isInServiceArea } from './region'
import { mapKakaoCategory } from '../collectors/kakao-category'

const ENRICH_BATCH = 1000
const MATCH_THRESHOLD = 0.75
const EVENT_ENRICH_BATCH = 200
const EVENT_MATCH_THRESHOLD = 0.5

// ─── Main export ────────────────────────────────────────────────────────────

export interface KakaoEnrichResult {
  evaluated: number
  enriched: number
  noMatch: number
  errors: number
}

export async function runKakaoEnrichment(): Promise<KakaoEnrichResult> {
  const result: KakaoEnrichResult = {
    evaluated: 0,
    enriched: 0,
    noMatch: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  // Check remaining Kakao quota before starting
  const remaining = await kakaoLimiter.getRemainingDaily()
  if (remaining < 100) {
    console.log(`[kakao-enrich] Skipping — only ${remaining} Kakao calls remaining today`)
    return result
  }

  const batchSize = Math.min(ENRICH_BATCH, remaining - 50) // Leave 50 for other jobs

  // Fetch places that need enrichment: missing phone OR road_address, and no kakao_place_id
  // (kakao_place_id presence means it was already matched/enriched)
  const { data: places, error: fetchError } = await supabaseAdmin
    .from('places')
    .select('id, name, address, road_address, phone, kakao_place_id, sub_category, category')
    .eq('is_active', true)
    .is('kakao_place_id', null)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (fetchError || !places) {
    console.error('[kakao-enrich] Failed to fetch places:', fetchError)
    result.errors++
    return result
  }

  if (places.length === 0) {
    console.log('[kakao-enrich] No places need enrichment (all have kakao_place_id)')
    return result
  }

  console.log(`[kakao-enrich] Evaluating ${places.length} places for enrichment`)

  // Prefetch existing kakao_place_ids to avoid N+1 queries in enrichPlace()
  const usedKakaoIds = await prefetchUsedKakaoPlaceIds()
  console.log(`[kakao-enrich] Pre-fetched ${usedKakaoIds.size} existing kakao_place_ids`)

  for (const place of places) {
    result.evaluated++

    try {
      const updated = await enrichPlace(place, usedKakaoIds)
      if (updated) {
        result.enriched++
      } else {
        result.noMatch++
      }
    } catch (err) {
      console.error(`[kakao-enrich] Error enriching place ${place.id}:`, err)
      result.errors++
    }
  }

  await logCollection({
    collector: 'kakao-enrich',
    startedAt,
    resultsCount: result.evaluated,
    newPlaces: result.enriched,
    errors: result.errors,
  })

  console.log(`[kakao-enrich] Done: ${JSON.stringify(result)}`)
  return result
}

// ─── Prefetch helpers ─────────────────────────────────────────────────────

async function prefetchUsedKakaoPlaceIds(): Promise<Set<string>> {
  return prefetchIds({
    table: 'places',
    column: 'kakao_place_id',
    filters: [{ op: 'not_null', column: 'kakao_place_id' }],
  })
}

// ─── Per-place enrichment ──────────────────────────────────────────────────

interface PlaceRow {
  id: number
  name: string
  address: string | null
  road_address: string | null
  phone: string | null
  kakao_place_id: string | null
  sub_category: string | null
  category: string | null
}

async function enrichPlace(place: PlaceRow, usedKakaoIds: Set<string>): Promise<boolean> {
  const match = await searchKakaoPlace(place.name, place.address, {
    threshold: MATCH_THRESHOLD,
    addressWords: 3,
  })

  if (!match) return false

  // Check if this kakao_place_id is already used by another place (in-memory check)
  if (usedKakaoIds.has(match.id)) {
    // Already assigned to another place — mark current place as checked to skip next time
    await supabaseAdmin
      .from('places')
      .update({ kakao_place_id: `dup_${match.id}` })
      .eq('id', place.id)
    return false
  }

  // Build update object with only missing fields
  const updates: Record<string, string | null> = {
    kakao_place_id: match.id,
  }

  if (!place.phone && match.phone) {
    updates.phone = match.phone
  }
  if (!place.road_address && match.roadAddress) {
    updates.road_address = match.roadAddress
  }
  if (!place.sub_category && match.categoryName) {
    updates.sub_category = match.categoryName.split('>').pop()?.trim() ?? null
  }

  // Category correction: use Kakao's category_name to fix misclassified places
  if (match.categoryName && place.category) {
    const mapped = mapKakaoCategory(
      { categoryName: match.categoryName, name: match.name },
      place.category as any
    )
    if (mapped.category !== place.category) {
      updates.category = mapped.category
    }
  }

  const { error } = await supabaseAdmin
    .from('places')
    .update(updates)
    .eq('id', place.id)

  if (error) {
    console.error(`[kakao-enrich] Update error for place ${place.id}:`, error.message)
    return false
  }

  // Track newly assigned ID to prevent same-batch duplicates
  usedKakaoIds.add(match.id)
  return true
}

// ─── Event Kakao enrichment ──────────────────────────────────────────────────

export interface EventKakaoEnrichResult {
  evaluated: number
  enriched: number
  noMatch: number
  errors: number
}

/**
 * Fill missing lat/lng for events using Kakao Place search.
 * Same pattern as runKakaoEnrichment (places), but targets events table.
 * venue_name is typically a building name → lower threshold (0.5).
 */
export async function runEventKakaoEnrichment(): Promise<EventKakaoEnrichResult> {
  const result: EventKakaoEnrichResult = {
    evaluated: 0,
    enriched: 0,
    noMatch: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  const remaining = await kakaoLimiter.getRemainingDaily()
  if (remaining < 100) {
    console.log(`[kakao-enrich-events] Skipping — only ${remaining} Kakao calls remaining`)
    return result
  }

  const batchSize = Math.min(EVENT_ENRICH_BATCH, remaining - 50)
  const today = new Date().toISOString().split('T')[0]

  // Events with NULL lat, non-null venue_name, not yet expired
  const { data: events, error: fetchError } = await supabaseAdmin
    .from('events')
    .select('id, venue_name, venue_address')
    .is('lat', null)
    .not('venue_name', 'is', null)
    .gte('end_date', today)
    .order('id', { ascending: true })
    .limit(batchSize)

  if (fetchError || !events) {
    console.error('[kakao-enrich-events] Fetch error:', fetchError)
    result.errors++
    return result
  }

  if (events.length === 0) {
    console.log('[kakao-enrich-events] No events need coordinate enrichment')
    return result
  }

  console.log(`[kakao-enrich-events] Evaluating ${events.length} events`)

  for (const event of events) {
    result.evaluated++
    try {
      const kakaoResult = await searchKakaoPlaceDetailed(
        event.venue_name,
        event.venue_address || null,
        { threshold: EVENT_MATCH_THRESHOLD }
      )

      if (!kakaoResult.match) {
        result.noMatch++
        continue
      }

      if (!isInServiceArea(kakaoResult.match.lat, kakaoResult.match.lng)) {
        result.noMatch++
        continue
      }

      const { error } = await supabaseAdmin
        .from('events')
        .update({
          lat: kakaoResult.match.lat,
          lng: kakaoResult.match.lng,
          venue_address: event.venue_address || kakaoResult.match.roadAddress || kakaoResult.match.address,
        })
        .eq('id', event.id)

      if (error) {
        console.error(`[kakao-enrich-events] Update error event ${event.id}:`, error.message)
        result.errors++
      } else {
        result.enriched++
      }
    } catch (err) {
      console.error(`[kakao-enrich-events] Error event ${event.id}:`, err)
      result.errors++
    }
  }

  await logCollection({
    collector: 'kakao-enrich-events',
    startedAt,
    resultsCount: result.evaluated,
    newEvents: result.enriched,
    errors: result.errors,
  })

  console.log(`[kakao-enrich-events] Done: ${JSON.stringify(result)}`)
  return result
}
