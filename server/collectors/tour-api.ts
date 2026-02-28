/**
 * Tour API v2 (한국관광공사) collector
 *
 * Upgraded from KorService1 → KorService2.
 * Collects family-friendly attractions, cultural facilities, festivals, and leisure.
 *
 * Base: http://apis.data.go.kr/B551011/KorService2
 * Docs: https://www.data.go.kr/data/15101578/openapi.do
 * Key: TOUR_API_KEY (separate from DATA_GO_KR_API_KEY)
 *
 * Two-phase collection:
 *   Phase 1: areaBasedList2 — list places/events by area + content type
 *   Phase 2: detailIntro2 — baby-friendly fields (stroller, age range, kids facility)
 *
 * Dual storage:
 *   - Permanent facilities (contentTypeId 12,14,28) → places table
 *   - Time-limited events (contentTypeId 15) → events table
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'

// ─── API types ──────────────────────────────────────────────────────────────

interface TourListItem {
  contentid: number
  contenttypeid: number
  title: string
  addr1?: string
  addr2?: string
  areacode?: number
  sigungucode?: number
  cat1?: string
  cat2?: string
  cat3?: string
  mapx?: number // longitude (WGS84 decimal)
  mapy?: number // latitude (WGS84 decimal)
  firstimage?: string
  firstimage2?: string
  tel?: string
  modifiedtime?: string
}

interface TourListResponse {
  response?: {
    header?: { resultCode: string; resultMsg: string }
    body?: {
      items?: { item?: TourListItem[] | TourListItem }
      numOfRows?: number
      pageNo?: number
      totalCount?: number
    }
  }
}

interface TourIntroResponse {
  response?: {
    header?: { resultCode: string; resultMsg: string }
    body?: {
      items?: {
        item?: TourIntroItem[] | TourIntroItem
      }
    }
  }
}

/** detailIntro2 fields vary by contentTypeId — union of all relevant fields */
interface TourIntroItem {
  contentid?: number
  contenttypeid?: number
  // 관광지(12)
  chkbabycarriage?: string
  expagerange?: string
  usetime?: string
  restdate?: string
  usefee?: string
  // 문화시설(14)
  chkbabycarriageculture?: string
  usetimeculture?: string
  restdateculture?: string
  usefee?: string
  spendtime?: string
  // 축제(15)
  eventstartdate?: string
  eventenddate?: string
  playtime?: string
  eventplace?: string
  eventhomepage?: string
  agelimit?: string
  usetimefestival?: string
  // 레포츠(28)
  chkbabycarriageleports?: string
  expagerangeleports?: string
  usefeeleports?: string
  restdateleports?: string
  // 음식점(39)
  kidsfacility?: string
}

// ─── Config ─────────────────────────────────────────────────────────────────

const API_BASE = 'http://apis.data.go.kr/B551011/KorService2'
const PAGE_SIZE = 100
const AREA_CODES = [1, 2, 31] // Seoul, Incheon, Gyeonggi

/** Content types to collect, with storage target and category mapping */
interface ContentTypeConfig {
  id: number
  label: string
  storeTo: 'places' | 'events'
  babyCategory: PlaceCategory | string
  isIndoor: boolean | null
}

const CONTENT_TYPES: ContentTypeConfig[] = [
  { id: 14, label: '문화시설', storeTo: 'places', babyCategory: '전시/체험', isIndoor: true },
  { id: 12, label: '관광지', storeTo: 'places', babyCategory: '동물/자연', isIndoor: false },
  { id: 28, label: '레포츠', storeTo: 'places', babyCategory: '수영/물놀이', isIndoor: null },
  { id: 15, label: '축제/행사', storeTo: 'events', babyCategory: '문화행사', isIndoor: null },
]

// ─── Main export ────────────────────────────────────────────────────────────

export interface TourAPICollectorResult {
  totalFetched: number
  newPlaces: number
  newEvents: number
  duplicates: number
  enriched: number
  errors: number
}

export async function runTourAPICollector(): Promise<TourAPICollectorResult> {
  const result: TourAPICollectorResult = {
    totalFetched: 0,
    newPlaces: 0,
    newEvents: 0,
    duplicates: 0,
    enriched: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  if (!process.env.TOUR_API_KEY) {
    console.warn('[tour-api] TOUR_API_KEY not set, skipping')
    return result
  }

  try {
    for (const ct of CONTENT_TYPES) {
      for (const areaCode of AREA_CODES) {
        try {
          console.log(`[tour-api] Fetching ${ct.label} area=${areaCode}`)
          await fetchAndProcess(ct, areaCode, result)
        } catch (err) {
          console.error(`[tour-api] Error ${ct.label} area=${areaCode}:`, err)
          result.errors++
        }
      }
    }

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'tour-api-v2',
      results_count: result.totalFetched,
      new_places: result.newPlaces,
      new_events: result.newEvents,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[tour-api] Fatal error:', err)
    result.errors++

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'tour-api-v2',
      status: 'error',
      error: String(err),
      duration_ms: Date.now() - startedAt,
    })
  }

  console.log(`[tour-api] Done: ${JSON.stringify(result)}`)
  return result
}

// ─── Phase 1: List collection ───────────────────────────────────────────────

async function fetchAndProcess(
  ct: ContentTypeConfig,
  areaCode: number,
  result: TourAPICollectorResult
): Promise<void> {
  let pageNo = 1

  while (true) {
    const resp = await fetchListPage(ct.id, areaCode, pageNo)
    const body = resp?.response?.body
    if (!body?.items?.item) break

    const items = Array.isArray(body.items.item) ? body.items.item : [body.items.item]
    result.totalFetched += items.length

    for (const item of items) {
      try {
        if (ct.storeTo === 'places') {
          await processAsPlace(item, ct, result)
        } else {
          await processAsEvent(item, result)
        }
      } catch (err) {
        console.error('[tour-api] Item error:', err, item.contentid)
        result.errors++
      }
    }

    const totalCount = body.totalCount || 0
    if (pageNo * PAGE_SIZE >= totalCount) break
    pageNo++
  }
}

async function fetchListPage(
  contentTypeId: number,
  areaCode: number,
  pageNo: number
): Promise<TourListResponse> {
  const params = new URLSearchParams({
    serviceKey: process.env.TOUR_API_KEY!,
    MobileOS: 'ETC',
    MobileApp: 'BabyPlace',
    _type: 'json',
    contentTypeId: String(contentTypeId),
    areaCode: String(areaCode),
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
    arrange: 'Q', // modified time desc
  })

  const url = `${API_BASE}/areaBasedList2?${params.toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as TourListResponse
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Process as Place (permanent facilities) ────────────────────────────────

async function processAsPlace(
  item: TourListItem,
  ct: ContentTypeConfig,
  result: TourAPICollectorResult
): Promise<void> {
  if (!item.contentid) return

  // Coordinates are WGS84 decimal (no division needed)
  const lat = item.mapy || null
  const lng = item.mapx || null
  if (!lat || !lng) return

  const address = [item.addr1, item.addr2].filter(Boolean).join(' ')
  if (!isInServiceRegion(lat, lng, address)) return

  const dup = await checkDuplicate({
    kakaoPlaceId: `tour_${item.contentid}`,
    name: item.title,
    address,
    lat,
    lng,
  })

  if (dup.isDuplicate && dup.existingId) {
    result.duplicates++
    // Enrich existing place with tour data if not already enriched
    await enrichWithIntro(item.contentid, item.contenttypeid, dup.existingId)
    result.enriched++
    return
  }

  const districtCode = await getDistrictCode(lat, lng, address)
  const category = mapToCategory(item.contenttypeid, item.cat1, item.title)
  const isIndoor =
    ct.isIndoor !== null ? ct.isIndoor : guessIndoor(item.title, item.cat3)

  const { error } = await supabaseAdmin.from('places').insert({
    name: item.title,
    category,
    sub_category: item.cat3 || item.cat2 || ct.label,
    address,
    road_address: item.addr1 || null,
    lat,
    lng,
    district_code: districtCode,
    phone: item.tel || null,
    source: 'tour_api',
    source_id: String(item.contentid),
    is_indoor: isIndoor,
    is_active: true,
  })

  if (error) {
    if (error.code === '23505') {
      result.duplicates++
    } else {
      console.error('[tour-api] Place insert error:', error.message, item.contentid)
      result.errors++
    }
  } else {
    result.newPlaces++
    // Fetch baby-friendly detail for newly inserted places
    const { data: inserted } = await supabaseAdmin
      .from('places')
      .select('id')
      .eq('source', 'tour_api')
      .eq('source_id', String(item.contentid))
      .maybeSingle()
    if (inserted) {
      await enrichWithIntro(item.contentid, item.contenttypeid, inserted.id)
      result.enriched++
    }
  }
}

// ─── Process as Event (festivals, performances) ─────────────────────────────

async function processAsEvent(
  item: TourListItem,
  result: TourAPICollectorResult
): Promise<void> {
  if (!item.contentid) return

  const { data: existing } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('source', 'tour_api')
    .eq('source_id', String(item.contentid))
    .maybeSingle()

  if (existing) {
    result.duplicates++
    return
  }

  const lat = item.mapy || null
  const lng = item.mapx || null
  const address = [item.addr1, item.addr2].filter(Boolean).join(' ')

  // Fetch intro for event dates
  const intro = await fetchIntro(item.contentid, item.contenttypeid)
  const startDate = parseYYYYMMDD(intro?.eventstartdate) || new Date().toISOString().split('T')[0]
  const endDate = parseYYYYMMDD(intro?.eventenddate)

  const { error } = await supabaseAdmin.from('events').insert({
    name: item.title,
    category: '문화행사',
    venue_name: intro?.eventplace || null,
    venue_address: address || null,
    lat,
    lng,
    start_date: startDate,
    end_date: endDate || null,
    time_info: intro?.usetimefestival || intro?.playtime || null,
    price_info: null,
    age_range: intro?.agelimit || null,
    source: 'tour_api',
    source_id: String(item.contentid),
    source_url: intro?.eventhomepage || null,
    poster_url: item.firstimage || null,
    description: null,
  })

  if (error) {
    if (error.code === '23505') {
      result.duplicates++
    } else {
      console.error('[tour-api] Event insert error:', error.message, item.contentid)
      result.errors++
    }
  } else {
    result.newEvents++
  }
}

// ─── Phase 2: Detail enrichment ─────────────────────────────────────────────

async function enrichWithIntro(
  contentId: number,
  contentTypeId: number,
  placeId: number
): Promise<void> {
  const intro = await fetchIntro(contentId, contentTypeId)
  if (!intro) return

  const stroller =
    intro.chkbabycarriage ||
    intro.chkbabycarriageculture ||
    intro.chkbabycarriageleports ||
    null
  const ageRange =
    intro.expagerange ||
    intro.expagerangeleports ||
    intro.agelimit ||
    null
  const kidsFacility = intro.kidsfacility || null

  if (!stroller && !ageRange && !kidsFacility) return

  // Store baby-friendly info in tags array
  const tags: string[] = []
  if (stroller && stroller !== '불가' && stroller !== '없음') tags.push('유모차대여')
  if (kidsFacility && kidsFacility !== '없음') tags.push('어린이놀이방')
  if (ageRange) tags.push(`체험연령:${ageRange}`)

  if (tags.length > 0) {
    await supabaseAdmin
      .from('places')
      .update({ tags, description: [stroller, ageRange, kidsFacility].filter(Boolean).join(' / ') })
      .eq('id', placeId)
  }
}

async function fetchIntro(
  contentId: number,
  contentTypeId: number
): Promise<TourIntroItem | null> {
  if (!process.env.TOUR_API_KEY) return null

  const params = new URLSearchParams({
    serviceKey: process.env.TOUR_API_KEY,
    MobileOS: 'ETC',
    MobileApp: 'BabyPlace',
    _type: 'json',
    contentId: String(contentId),
    contentTypeId: String(contentTypeId),
  })

  const url = `${API_BASE}/detailIntro2?${params.toString()}`

  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const json = (await response.json()) as TourIntroResponse
    const items = json.response?.body?.items?.item
    if (!items) return null
    return Array.isArray(items) ? items[0] : items
  } catch {
    return null
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapToCategory(
  contentTypeId: number,
  cat1?: string,
  title?: string
): PlaceCategory {
  if (contentTypeId === 14) return '전시/체험'
  if (contentTypeId === 28) return '수영/물놀이'
  if (contentTypeId === 12) {
    if (cat1 === 'A03') return '수영/물놀이'
    if (title && /동물|아쿠아|수족|농장/.test(title)) return '동물/자연'
    return '전시/체험'
  }
  return '전시/체험'
}

function guessIndoor(title: string, cat3?: string): boolean {
  const indoorKeywords = /박물관|미술관|과학관|체험관|전시|수족관|아쿠아/
  const outdoorKeywords = /공원|농장|동물원|자연|숲|해변|캠핑/
  if (indoorKeywords.test(title)) return true
  if (outdoorKeywords.test(title)) return false
  return true // default indoor
}

function parseYYYYMMDD(dateStr?: string): string | null {
  if (!dateStr || dateStr.length < 8) return null
  const y = dateStr.substring(0, 4)
  const m = dateStr.substring(4, 6)
  const d = dateStr.substring(6, 8)
  return `${y}-${m}-${d}`
}
