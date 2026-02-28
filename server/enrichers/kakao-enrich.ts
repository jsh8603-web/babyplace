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
import { kakaoLimiter } from '../rate-limiter'
import { similarity } from '../matchers/similarity'

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword'
const ENRICH_BATCH = 1000
const MATCH_THRESHOLD = 0.75

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
    .select('id, name, address, road_address, phone, kakao_place_id, sub_category')
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

  for (const place of places) {
    result.evaluated++

    try {
      const updated = await enrichPlace(place)
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

  await supabaseAdmin.from('collection_logs').insert({
    collector: 'kakao-enrich',
    results_count: result.evaluated,
    new_places: result.enriched,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  console.log(`[kakao-enrich] Done: ${JSON.stringify(result)}`)
  return result
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
}

async function enrichPlace(place: PlaceRow): Promise<boolean> {
  const query = place.address
    ? `${place.name} ${place.address.split(/\s+/).slice(0, 3).join(' ')}`
    : place.name

  const params = new URLSearchParams({ query, size: '5' })

  const response = await kakaoLimiter.throttle(() =>
    fetch(`${KAKAO_KEYWORD_URL}?${params.toString()}`, {
      headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` },
    })
  )

  if (!response.ok) return false

  const data = await response.json()
  const documents = data.documents ?? []
  if (documents.length === 0) return false

  // Find best match
  let bestDoc: (typeof documents)[0] | null = null
  let bestScore = 0

  for (const doc of documents) {
    const score = similarity(place.name, doc.place_name)
    if (score > bestScore) {
      bestScore = score
      bestDoc = doc
    }
  }

  if (bestScore < MATCH_THRESHOLD || !bestDoc) return false

  // Build update object with only missing fields
  const updates: Record<string, string | null> = {
    kakao_place_id: bestDoc.id,
  }

  if (!place.phone && bestDoc.phone) {
    updates.phone = bestDoc.phone
  }
  if (!place.road_address && bestDoc.road_address_name) {
    updates.road_address = bestDoc.road_address_name
  }
  if (!place.sub_category && bestDoc.category_name) {
    updates.sub_category = bestDoc.category_name.split('>').pop()?.trim() ?? null
  }

  const { error } = await supabaseAdmin
    .from('places')
    .update(updates)
    .eq('id', place.id)

  if (error) {
    console.error(`[kakao-enrich] Update error for place ${place.id}:`, error.message)
    return false
  }

  return true
}
