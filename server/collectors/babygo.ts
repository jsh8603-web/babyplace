/**
 * BabyGo (애기야가자) Place Collector
 *
 * Collects place data from api.babygo.kr (no auth required).
 * 12 grid coordinates × 5 pages → detail fetch for lat/lng → dedup → insert.
 *
 * API notes:
 *   - List API returns correct UTF-8 name/address
 *   - Detail API returns lat/lng, phone_number (text fields have encoding issues)
 *   - We use list name/address as primary, detail only for coordinates + phone
 *
 * Schedule: weekly (Sunday, via run.ts)
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { checkPlaceGate } from '../matchers/place-gate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.babygo.kr/api/v1'
const PAGES_PER_GRID = 5
const DELAY_MS = 500 // 2 req/sec

const GRID_POINTS = [
  // Seoul (6)
  { label: '강남', lat: 37.498, lng: 127.028 },
  { label: '홍대', lat: 37.557, lng: 126.924 },
  { label: '잠실', lat: 37.513, lng: 127.100 },
  { label: '여의도', lat: 37.525, lng: 126.926 },
  { label: '종로', lat: 37.572, lng: 126.979 },
  { label: '노원', lat: 37.654, lng: 127.056 },
  // Gyeonggi (6)
  { label: '분당', lat: 37.382, lng: 127.119 },
  { label: '일산', lat: 37.659, lng: 126.770 },
  { label: '수원', lat: 37.264, lng: 127.000 },
  { label: '하남', lat: 37.539, lng: 127.214 },
  { label: '김포', lat: 37.615, lng: 126.716 },
  { label: '용인', lat: 37.241, lng: 127.178 },
]

// ─── Types ───────────────────────────────────────────────────────────────────

interface BabygoListItem {
  id: string
  name: string
  address: string
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
}

interface BabygoDetailRaw {
  lat: number
  lng: number
  phone_number: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
}

interface BabygoPlace {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  phone: string | null
  likers_count: number
  event_starts_at: string | null
}

export interface BabygoResult {
  uniqueFromGrid: number
  withCoordinates: number
  outOfArea: number
  duplicates: number
  placeGateBlocked: number
  newPlaces: number
  errors: number
  events: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function inferCategory(name: string): {
  category: string
  subCategory: string | null
} {
  if (/키즈카페|놀이카페|키즈파크|실내놀이/.test(name))
    return { category: '놀이', subCategory: '키즈카페' }
  if (/놀이터|어린이공원/.test(name))
    return { category: '공원/놀이터', subCategory: '놀이터' }
  if (/공원|숲|자연|생태/.test(name))
    return { category: '공원/놀이터', subCategory: '공원' }
  if (/전시|박물관|미술관|체험|과학관/.test(name))
    return { category: '전시/체험', subCategory: null }
  if (/공연|극장|인형극|뮤지컬/.test(name))
    return { category: '공연', subCategory: null }
  if (/동물원|아쿠아|수족관|농장/.test(name))
    return { category: '동물/자연', subCategory: null }
  if (/식당|카페|레스토랑|뷔페|맛집/.test(name))
    return { category: '식당/카페', subCategory: null }
  if (/도서관|북카페|서점/.test(name))
    return { category: '도서관', subCategory: null }
  if (/수영|워터|물놀이|풀/.test(name))
    return { category: '수영/물놀이', subCategory: null }
  if (/수유실|기저귀/.test(name))
    return { category: '편의시설', subCategory: null }

  return { category: '놀이', subCategory: null }
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

async function fetchListPages(): Promise<Map<string, BabygoListItem>> {
  const seen = new Map<string, BabygoListItem>()

  for (const point of GRID_POINTS) {
    for (let page = 1; page <= PAGES_PER_GRID; page++) {
      const url = `${API_BASE}/places?lat=${point.lat}&lng=${point.lng}&page=${page}`
      const data = await fetchJson<{ places: BabygoListItem[] }>(url)

      if (!data?.places || data.places.length === 0) break

      for (const item of data.places) {
        if (!seen.has(item.id)) seen.set(item.id, item)
      }
      await sleep(DELAY_MS)
    }
  }

  console.log(`[babygo] Grid scan: ${seen.size} unique places`)
  return seen
}

async function fetchDetailsAndMerge(
  items: Map<string, BabygoListItem>
): Promise<BabygoPlace[]> {
  const places: BabygoPlace[] = []
  let i = 0

  for (const [id, listItem] of items) {
    i++
    if (i % 100 === 0) console.log(`[babygo] Detail ${i}/${items.size}...`)

    const detail = await fetchJson<BabygoDetailRaw>(`${API_BASE}/places/${id}`)

    if (detail?.lat && detail?.lng) {
      places.push({
        id: listItem.id,
        name: listItem.name,
        address: listItem.address,
        lat: detail.lat,
        lng: detail.lng,
        phone: detail.phone_number || null,
        likers_count: detail.likers_count ?? listItem.likers_count,
        event_starts_at: detail.event_starts_at ?? listItem.event_starts_at,
      })
    }
    await sleep(DELAY_MS)
  }

  console.log(`[babygo] Details: ${places.length}/${items.size} with coordinates`)
  return places
}

// ─── Pre-fetch existing source_ids ──────────────────────────────────────────

async function prefetchExistingIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  let from = 0
  const PAGE = 1000

  while (true) {
    const { data } = await supabaseAdmin
      .from('places')
      .select('source_id')
      .eq('source', 'babygo')
      .range(from, from + PAGE - 1)

    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.source_id) ids.add(row.source_id)
    }
    from += PAGE
  }

  return ids
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runBabygoCollector(): Promise<BabygoResult> {
  const result: BabygoResult = {
    uniqueFromGrid: 0,
    withCoordinates: 0,
    outOfArea: 0,
    duplicates: 0,
    placeGateBlocked: 0,
    newPlaces: 0,
    errors: 0,
    events: 0,
  }

  // Step 1: Fetch list pages
  const listItems = await fetchListPages()
  result.uniqueFromGrid = listItems.size

  if (listItems.size === 0) return result

  // Step 2: Fetch details
  const places = await fetchDetailsAndMerge(listItems)
  result.withCoordinates = places.length

  // Pre-fetch existing babygo source_ids for fast skip
  const existingIds = await prefetchExistingIds()
  console.log(`[babygo] Existing babygo places in DB: ${existingIds.size}`)

  // Steps 3-5: Filter, dedup, insert
  for (const place of places) {
    if (place.event_starts_at) result.events++

    // Service area
    if (!isInServiceRegion(place.lat, place.lng, place.address || null)) {
      result.outOfArea++
      continue
    }

    // Fast source_id skip (already imported from babygo before)
    if (existingIds.has(place.id)) {
      result.duplicates++
      continue
    }

    // Full duplicate check (coordinate + name similarity)
    const dup = await checkDuplicate({
      kakaoPlaceId: `babygo_${place.id}`,
      name: place.name,
      address: place.address || '',
      lat: place.lat,
      lng: place.lng,
    })

    if (dup.isDuplicate) {
      if (dup.existingId) {
        await supabaseAdmin.rpc('increment_source_count', {
          p_place_id: dup.existingId,
        })
      }
      result.duplicates++
      continue
    }

    // Place Gate
    const { category, subCategory } = inferCategory(place.name)
    const gate = await checkPlaceGate({
      name: place.name,
      subCategory,
      source: 'babygo',
    })
    if (!gate.allowed) {
      result.placeGateBlocked++
      continue
    }

    // INSERT
    const districtCode = await getDistrictCode(
      place.lat,
      place.lng,
      place.address || ''
    )

    const { error } = await supabaseAdmin.from('places').insert({
      name: place.name,
      category,
      sub_category: subCategory,
      address: place.address || null,
      lat: place.lat,
      lng: place.lng,
      district_code: districtCode,
      phone: place.phone || null,
      source: 'babygo',
      source_id: place.id,
      is_active: true,
    })

    if (error) {
      if (error.code === '23505') {
        result.duplicates++
      } else {
        result.errors++
      }
    } else {
      result.newPlaces++
      existingIds.add(place.id) // prevent re-insert within same run
    }
  }

  console.log(`[babygo] Done: ${result.newPlaces} new, ${result.duplicates} dup, ${result.errors} err`)
  return result
}
