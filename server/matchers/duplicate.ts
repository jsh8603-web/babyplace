/**
 * Duplicate detection for places.
 *
 * Strategy (from plan.md 18-9):
 *   1st pass: kakao_place_id exact match → definite duplicate
 *   2nd pass: name similarity > 0.7 + address proximity (or address string match)
 *             → probable duplicate → increment mention_count only
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { similarity } from './similarity'

export interface KakaoPlaceInput {
  kakaoPlaceId: string
  name: string
  address: string
  lat: number
  lng: number
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  existingId?: number
  existingName?: string
  matchType?: 'kakao_id' | 'name_address'
  similarityScore?: number
}

/**
 * Checks whether a Kakao API result already exists in the places table.
 *
 * Returns the existing place id if a duplicate is found, so the caller can
 * increment mention_count instead of inserting a new row.
 */
export async function checkDuplicate(
  input: KakaoPlaceInput
): Promise<DuplicateCheckResult> {
  // --- Pass 1: exact kakao_place_id match ---
  const { data: byId } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .eq('kakao_place_id', input.kakaoPlaceId)
    .maybeSingle()

  if (byId) {
    return {
      isDuplicate: true,
      existingId: byId.id,
      existingName: byId.name,
      matchType: 'kakao_id',
      similarityScore: 1.0,
    }
  }

  // --- Pass 2: nearby places (within ~100m bounding box) + name similarity ---
  // Approximate 100m in degrees: ~0.0009 degrees latitude, ~0.0011 degrees longitude
  const LAT_DELTA = 0.0009
  const LNG_DELTA = 0.0011

  const { data: nearby } = await supabaseAdmin
    .from('places')
    .select('id, name, lat, lng')
    .eq('is_active', true)
    .gte('lat', input.lat - LAT_DELTA)
    .lte('lat', input.lat + LAT_DELTA)
    .gte('lng', input.lng - LNG_DELTA)
    .lte('lng', input.lng + LNG_DELTA)

  if (nearby && nearby.length > 0) {
    for (const place of nearby) {
      const score = similarity(input.name, place.name)
      if (score > 0.7) {
        return {
          isDuplicate: true,
          existingId: place.id,
          existingName: place.name,
          matchType: 'name_address',
          similarityScore: score,
        }
      }
    }
  }

  return { isDuplicate: false }
}

/**
 * Checks a candidate (from blog mentions) against existing places using
 * name similarity alone (no coordinates available).
 *
 * Returns the best matching place if similarity > threshold.
 */
export async function findMatchingPlace(
  candidateName: string,
  candidateAddress: string | null,
  threshold = 0.8
): Promise<{ placeId: number; score: number } | null> {
  // Pull a limited set of places with similar-starting names to avoid full scans.
  // ilike on the first 4 chars is a coarse filter; Dice coefficient does the fine match.
  const { data: candidates } = await supabaseAdmin
    .from('places')
    .select('id, name, address')
    .eq('is_active', true)
    .ilike('name', `%${candidateName.slice(0, 4)}%`)
    .limit(50)

  if (!candidates || candidates.length === 0) return null

  let bestId = -1
  let bestScore = 0

  for (const place of candidates) {
    const score = similarity(candidateName, place.name)

    // Boost if addresses share the same district prefix
    let finalScore = score
    if (
      candidateAddress &&
      place.address &&
      addressDistrictMatch(candidateAddress, place.address)
    ) {
      finalScore = Math.min(1.0, score + 0.05)
    }

    if (finalScore > bestScore) {
      bestScore = finalScore
      bestId = place.id
    }
  }

  if (bestId >= 0 && bestScore >= threshold) {
    return { placeId: bestId, score: bestScore }
  }
  return null
}

/**
 * Returns true if two address strings share the same district-level prefix.
 * Examples: "서울 강남구" matches "서울특별시 강남구 삼성동".
 */
function addressDistrictMatch(addrA: string, addrB: string): boolean {
  // Extract first two address tokens (e.g. "서울" "강남구")
  const tokensA = addrA.split(/\s+/).slice(0, 2).join('')
  const tokensB = addrB.split(/\s+/).slice(0, 2).join('')

  if (tokensA.length < 2 || tokensB.length < 2) return false

  const clean = (s: string) =>
    s
      .replace(/특별시|광역시|도|시|구|군/g, '')
      .replace(/\s+/g, '')
      .toLowerCase()

  return clean(tokensA).slice(0, 3) === clean(tokensB).slice(0, 3)
}

