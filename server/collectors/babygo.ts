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
import { logCollection } from '../lib/collection-log'
import { prefetchIds } from '../lib/prefetch'
import { checkDuplicate } from '../matchers/duplicate'
import { checkPlaceGate } from '../matchers/place-gate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { classifyEventByTitle } from '../utils/event-classifier'

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
  thumbnail: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
}

interface BabygoDetailRaw {
  lat: number
  lng: number
  phone_number: string | null
  note: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
  images: { image: string }[] | null
  amenities: { name: string }[] | null
  products: { name: string; price: number }[] | null
  business_hours: { name: string; start_at: string; end_at: string }[] | null
  main_child: string | null
}

interface BabygoPlace {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  phone: string | null
  thumbnail: string | null
  note: string | null
  likers_count: number
  event_starts_at: string | null
  event_ends_at: string | null
  amenities: string | null
  priceInfo: string | null
  businessHours: string | null
  ageRange: string | null
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
  if (/키즈카페|놀이카페|키즈파크|실내놀이|트램폴린|볼풀|바운스/.test(name))
    return { category: '놀이', subCategory: '키즈카페' }
  if (/놀이터|어린이공원/.test(name))
    return { category: '공원/놀이터', subCategory: '놀이터' }
  if (/공원|숲|자연|생태|수목원|식물원|정원$/.test(name))
    return { category: '공원/놀이터', subCategory: '공원' }
  if (/전시|박물관|미술관|체험|과학관|궁$|궁궐|문화회관|문화원|기념관/.test(name))
    return { category: '전시/체험', subCategory: null }
  if (/공연|극장|인형극|뮤지컬/.test(name))
    return { category: '공연', subCategory: null }
  if (/동물원|아쿠아|수족관|농장|목장/.test(name))
    return { category: '동물/자연', subCategory: null }
  if (/식당|카페|레스토랑|뷔페|맛집|베이커리|빵집/.test(name))
    return { category: '식당/카페', subCategory: null }
  if (/도서관|북카페|서점|교보문고|영풍문고/.test(name))
    return { category: '도서관', subCategory: null }
  if (/수영|워터|물놀이|풀/.test(name))
    return { category: '수영/물놀이', subCategory: null }
  if (/수유실|기저귀|육아.*센터|지원센터|보육.*센터|보건소|소아과/.test(name))
    return { category: '편의시설', subCategory: null }
  if (/호텔|리조트|펜션|캠핑|글램핑/.test(name))
    return { category: '놀이', subCategory: null }

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
      // Build amenity/price/hours summaries
      const amenities = detail.amenities?.map((a) => a.name).join(', ') || null
      const priceInfo = detail.products?.map((p) => `${p.name} ${p.price}원`).join(', ') || null
      const businessHours = detail.business_hours?.map((h) => `${h.name} ${h.start_at}~${h.end_at}`).join(', ') || null

      places.push({
        id: listItem.id,
        name: listItem.name,
        address: listItem.address,
        lat: detail.lat,
        lng: detail.lng,
        phone: detail.phone_number || null,
        thumbnail: listItem.thumbnail || detail.images?.[0]?.image || null,
        note: detail.note || null,
        likers_count: detail.likers_count ?? listItem.likers_count,
        event_starts_at: detail.event_starts_at ?? listItem.event_starts_at,
        event_ends_at: detail.event_ends_at ?? listItem.event_ends_at,
        amenities,
        priceInfo,
        businessHours,
        ageRange: detail.main_child || null,
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

    // Create event entry regardless of place dedup (events are independent)
    if (place.event_starts_at && place.event_ends_at) {
      await createBabygoEvent(place, result)
      // Event-only items: don't insert into places table
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

  console.log(`[babygo] Done: ${result.newPlaces} new, ${result.duplicates} dup, ${result.events} events, ${result.errors} err`)
  return result
}

/**
 * Parse BabyGo event timestamp: "2024-09-09 18:09:1725872400" → "2024-09-09"
 */
function parseBabygoDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

/**
 * Create an event entry from BabyGo place with event dates.
 */
async function createBabygoEvent(place: BabygoPlace, result: BabygoResult): Promise<void> {
  const startDate = parseBabygoDate(place.event_starts_at!)
  const endDate = parseBabygoDate(place.event_ends_at!)
  if (!startDate) return

  // Skip events from past years or already ended
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]
  if (parseInt(startDate.substring(0, 4)) < currentYear - 1) return
  if (endDate && endDate < today) return

  const sourceId = `babygo_event_${place.id}`

  const { error } = await supabaseAdmin.from('events').insert({
    name: place.name,
    category: '문화행사',
    sub_category: classifyEventByTitle(place.name),
    venue_name: place.name,
    venue_address: place.address || null,
    lat: place.lat,
    lng: place.lng,
    start_date: startDate,
    end_date: endDate,
    price_info: place.priceInfo,
    age_range: place.ageRange,
    description: place.note,
    source: 'babygo',
    source_id: sourceId,
    source_url: null,
    poster_url: place.thumbnail,
  })

  if (error) {
    if (error.code !== '23505') {
      console.error('[babygo] Event insert error:', error.message, place.name)
    }
  } else {
    result.events++
  }
}

// ─── BabyGo Events API ──────────────────────────────────────────────────────

interface BabygoEventListItem {
  id: string
  name: string
  thumbnail: string | null
  place_type: string | null
  starts_at: string | null
  ends_at: string | null
}

interface BabygoEventDetail {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  phone_number: string | null
  images: { image: string }[] | null
  note: string | null
  amenities: { name: string }[] | null
  products: { name: string; price: number }[] | null
  business_hours: { name: string; start_at: string; end_at: string }[] | null
  url: string | null
  top_region: { id: number; name: string } | null
}

export interface BabygoEventsResult {
  fetched: number
  outOfArea: number
  skipped: number
  inserted: number
  errors: number
}

function mapPlaceTypeToSubCategory(placeType: string | null): string | null {
  if (!placeType) return null
  if (/전시/.test(placeType)) return '전시'
  if (/축제/.test(placeType)) return '축제'
  if (/공연|뮤지컬|연극/.test(placeType)) return '공연'
  return null
}

/**
 * Collect events from BabyGo Events API.
 * Fetches current + next 2 months, enriches with detail API, filters by region.
 */
export async function fetchBabygoEvents(): Promise<BabygoEventsResult> {
  const result: BabygoEventsResult = {
    fetched: 0,
    outOfArea: 0,
    skipped: 0,
    inserted: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    console.log('[babygo-events] Starting BabyGo Events API collection')

    // Prefetch existing babygo_event source_ids
    const existingIds = await prefetchIds({
      table: 'events',
      column: 'source_id',
      filters: [{ op: 'eq', column: 'source', value: 'babygo' }],
    })
    console.log(`[babygo-events] Existing babygo events: ${existingIds.size}`)

    const currentYear = new Date().getFullYear()
    const today = new Date().toISOString().split('T')[0]

    // Fetch current month + next 2 months
    const months = getTargetMonths(3)
    const allEvents = new Map<string, BabygoEventListItem>()

    for (const month of months) {
      let page = 1
      while (true) {
        const url = `${API_BASE}/places/events?range=${month}&page=${page}`
        const data = await fetchJson<{ next_url: string | null; events: BabygoEventListItem[] }>(url)

        if (!data?.events || data.events.length === 0) break

        for (const ev of data.events) {
          if (!allEvents.has(ev.id)) allEvents.set(ev.id, ev)
        }

        if (!data.next_url) break
        page++
        await sleep(DELAY_MS)
      }
      await sleep(DELAY_MS)
    }

    result.fetched = allEvents.size
    console.log(`[babygo-events] Fetched ${allEvents.size} events from ${months.length} months`)

    // Process each event
    for (const [id, ev] of allEvents) {
      try {
        const sourceId = `babygo_event_${id}`
        if (existingIds.has(sourceId)) {
          result.skipped++
          continue
        }

        // Parse dates
        const startDate = ev.starts_at ? ev.starts_at.substring(0, 10) : null
        const endDate = ev.ends_at ? ev.ends_at.substring(0, 10) : null

        // Date filters
        if (startDate && parseInt(startDate.substring(0, 4)) < currentYear - 1) {
          result.skipped++
          continue
        }
        if (endDate && endDate < today) {
          result.skipped++
          continue
        }

        // Fetch detail for location, description, etc.
        const detail = await fetchJson<BabygoEventDetail>(`${API_BASE}/places/${id}`)
        await sleep(DELAY_MS)

        if (!detail) {
          result.errors++
          continue
        }

        // Region filter using top_region
        const regionName = detail.top_region?.name
        if (regionName && regionName !== '서울' && regionName !== '경기') {
          result.outOfArea++
          continue
        }

        // If no top_region, check coordinates/address
        if (!regionName) {
          if (detail.lat && detail.lng) {
            if (!isInServiceRegion(detail.lat, detail.lng, detail.address || null)) {
              result.outOfArea++
              continue
            }
          } else {
            // No location info at all — skip
            result.skipped++
            continue
          }
        }

        // Build data
        const thumbnail = ev.thumbnail || detail.images?.[0]?.image || null
        const priceInfo = detail.products?.map((p) => `${p.name} ${p.price}원`).join(', ') || null
        const timeInfo = detail.business_hours?.map((h) => `${h.name} ${h.start_at}~${h.end_at}`).join(', ') || null
        const subCategory = mapPlaceTypeToSubCategory(ev.place_type) || classifyEventByTitle(ev.name)

        const { error } = await supabaseAdmin.from('events').insert({
          name: ev.name,
          category: '문화행사',
          sub_category: subCategory,
          venue_name: ev.name,
          venue_address: detail.address || null,
          lat: detail.lat || null,
          lng: detail.lng || null,
          start_date: startDate,
          end_date: endDate,
          price_info: priceInfo,
          time_info: timeInfo,
          description: detail.note || null,
          source: 'babygo',
          source_id: sourceId,
          source_url: detail.url || null,
          poster_url: thumbnail,
        })

        if (error) {
          if (error.code === '23505') {
            result.skipped++
          } else {
            console.error(`[babygo-events] Insert error: ${error.message}`, ev.name)
            result.errors++
          }
        } else {
          result.inserted++
          existingIds.add(sourceId)
        }
      } catch (err) {
        console.error(`[babygo-events] Error processing ${id}:`, err)
        result.errors++
      }
    }

    console.log(`[babygo-events] Done: ${result.inserted} inserted, ${result.outOfArea} out-of-area, ${result.skipped} skipped`)
  } catch (err) {
    console.error('[babygo-events] Fatal error:', err)
    result.errors++
  }

  await logCollection({
    collector: 'babygo-events',
    startedAt,
    resultsCount: result.fetched,
    newEvents: result.inserted,
    errors: result.errors,
  })

  return result
}

function getTargetMonths(count: number): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    months.push(`${y}-${m}`)
  }
  return months
}
