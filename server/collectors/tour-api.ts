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
import { tourLimiter } from '../rate-limiter'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion, isValidServiceAddress } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'
import { checkPlaceGate } from '../matchers/place-gate'
import { classifyEventByTitle } from '../utils/event-classifier'
import { logCollection } from '../lib/collection-log'

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
  usefeeculture?: string
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
  { id: 39, label: '음식점', storeTo: 'places', babyCategory: '식당/카페', isIndoor: true },
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

  // Run only twice a week (Mon/Thu) — data changes slowly, saves 23min + API calls
  const dayOfWeek = new Date().getUTCDay() // 0=Sun, 1=Mon, ..., 4=Thu
  const isCollectionDay = dayOfWeek === 1 || dayOfWeek === 4 // Mon, Thu
  if (!isCollectionDay && process.argv[2] !== 'manual') {
    console.log(`[tour-api] Skipping — runs Mon/Thu only (today: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`)
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

    await logCollection({
      collector: 'tour-api-v2',
      startedAt,
      resultsCount: result.totalFetched,
      newPlaces: result.newPlaces,
      newEvents: result.newEvents,
      errors: result.errors,
    })
  } catch (err) {
    console.error('[tour-api] Fatal error:', err)
    result.errors++

    await logCollection({
      collector: 'tour-api-v2',
      startedAt,
      error: String(err),
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
  let fetchedTotal = 0
  let skippedTotal = 0
  let processedTotal = 0

  while (true) {
    const resp = await fetchListPage(ct.id, areaCode, pageNo)
    const body = resp?.response?.body
    if (!body?.items?.item) break

    const items = Array.isArray(body.items.item) ? body.items.item : [body.items.item]
    result.totalFetched += items.length
    fetchedTotal += items.length

    const prevNew = result.newPlaces + result.newEvents
    const prevDup = result.duplicates

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

    const newAfter = result.newPlaces + result.newEvents
    const dupAfter = result.duplicates
    const pageProcessed = (newAfter - prevNew) + (dupAfter - prevDup)
    processedTotal += pageProcessed
    skippedTotal += items.length - pageProcessed

    const totalCount = body.totalCount || 0
    if (pageNo * PAGE_SIZE >= totalCount) break
    pageNo++
  }

  console.log(`[tour-api] ${ct.label} area=${areaCode}: fetched=${fetchedTotal}, skipped=${skippedTotal}, processed=${processedTotal}`)
}

async function fetchListPage(
  contentTypeId: number,
  areaCode: number,
  pageNo: number
): Promise<TourListResponse> {
  const params = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'BabyPlace',
    _type: 'json',
    contentTypeId: String(contentTypeId),
    areaCode: String(areaCode),
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
    arrange: 'Q', // modified time desc
  })

  // Build URL with raw serviceKey to avoid double-encoding (same pattern as other data.go.kr collectors)
  const url = `${API_BASE}/areaBasedList2?serviceKey=${process.env.TOUR_API_KEY}&${params.toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await tourLimiter.throttle(() =>
      fetch(url, { signal: controller.signal })
    )
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

  // Skip non-baby-relevant landmarks (palaces, temples, historical sites, etc.)
  if (shouldSkipPlace(item.title || '', item.contenttypeid, item.cat3)) return

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
    await supabaseAdmin.rpc('increment_source_count', { p_place_id: dup.existingId })
    result.duplicates++
    // Enrich existing place with tour data only if not already enriched (tags is null)
    const { data: existing } = await supabaseAdmin
      .from('places')
      .select('tags')
      .eq('id', dup.existingId)
      .maybeSingle()
    if (!existing?.tags) {
      await enrichWithIntro(item.contentid, item.contenttypeid, dup.existingId)
      result.enriched++
    }
    return
  }

  // Place Gate: central quality filter
  const gate = await checkPlaceGate({
    name: item.title,
    source: 'tour_api',
  })
  if (!gate.allowed) return

  const districtCode = await getDistrictCode(lat, lng, address)
  const category = mapToCategory(item.contenttypeid, item.cat1, item.title, item.cat3)
  const isIndoor =
    ct.isIndoor !== null ? ct.isIndoor : guessIndoor(item.title, item.cat3)

  // Store human-readable sub_category instead of raw cat3 code
  const whitelisted = item.cat3 ? BABY_RELEVANT_CAT3.get(item.cat3) : undefined
  const subCategory = whitelisted?.name
    || (ct.id === 14 ? guessCultureSubCategory(item.title || '', item.cat3)
      : ct.id === 28 ? guessLeportsSubCategory(item.title || '')
      : ct.id === 39 ? guessRestaurantSubCategory(item.title || '')
      : item.cat3 || ct.label)

  const { error } = await supabaseAdmin.from('places').insert({
    name: item.title,
    category,
    sub_category: subCategory,
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

  // Region validation: same check as processAsPlace
  if (lat && lng) {
    if (!isInServiceRegion(lat, lng, address)) return
  } else if (address && !isValidServiceAddress(address)) {
    return
  }

  // Fetch intro for event dates
  const intro = await fetchIntro(item.contentid, item.contenttypeid)
  const startDate = parseYYYYMMDD(intro?.eventstartdate) || new Date().toISOString().split('T')[0]
  const endDate = parseYYYYMMDD(intro?.eventenddate)

  // Skip events from past years or already ended
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]
  if (parseInt(startDate.substring(0, 4)) < currentYear - 1) return
  if (endDate && endDate < today) return

  const { error } = await supabaseAdmin.from('events').insert({
    name: item.title,
    category: '문화행사',
    sub_category: classifyEventByTitle(item.title),
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
    poster_url: item.firstimage ? item.firstimage.replace('http://', 'https://') : null,
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
    MobileOS: 'ETC',
    MobileApp: 'BabyPlace',
    _type: 'json',
    contentId: String(contentId),
    contentTypeId: String(contentTypeId),
  })

  const url = `${API_BASE}/detailIntro2?serviceKey=${process.env.TOUR_API_KEY}&${params.toString()}`

  try {
    const response = await tourLimiter.throttle(() => fetch(url))
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

/**
 * WHITELIST of baby-relevant Tour API cat3 codes (primarily for type 12 관광지).
 */
const BABY_RELEVANT_CAT3 = new Map<string, { name: string; category: PlaceCategory }>([
  // A0206 문화시설
  ['A02060100', { name: '박물관', category: '전시/체험' }],
  ['A02060300', { name: '전시관', category: '전시/체험' }],
  ['A02060500', { name: '미술관', category: '전시/체험' }],
  ['A02060600', { name: '공연장', category: '전시/체험' }],
  ['A02060900', { name: '도서관', category: '도서관' }],
  // A0203 체험관광
  ['A02030100', { name: '체험마을', category: '전시/체험' }],
  ['A02030200', { name: '농어촌체험', category: '전시/체험' }],
  ['A02030300', { name: '전통체험', category: '전시/체험' }],
  ['A02030400', { name: '이색체험', category: '놀이' }],
  // A0101 자연관광지
  ['A01010500', { name: '생태관광지', category: '동물/자연' }],
  ['A01010700', { name: '수목원', category: '동물/자연' }],
  // A0202 휴양관광
  ['A02020600', { name: '테마공원', category: '놀이' }],
])

// Common blacklist — historical landmarks, adult-only, pet facilities (kakao-category.ts pattern)
const TOUR_BLACKLIST = /궁$|궁궐|사찰|사당|서원$|향교|왕릉|묘소|성곽|유적|기념탑|사적|종묘|반려견|애견|카지노|나이트클럽|성인/

// Type 28 (레포츠) whitelist — only baby/family-relevant leisure passes
const LEPORTS_WHITELIST = /수영|워터파크|물놀이|스케이트|아이스링크|썰매|캠핑|글램핑|어린이|키즈|유아|아기|가족|체험|자전거.*공원|인라인|트램폴린|짚라인.*키즈|놀이/

// Type 39 (음식점) whitelist — only kids/family-friendly restaurants pass
const RESTAURANT_WHITELIST = /키즈|어린이|유아|패밀리|아이|아기|베이비|kids|baby|놀이방|키즈존|이유식/

// Type 12 (관광지) title rescue — when cat3 doesn't match whitelist
const TITLE_RESCUE = /동물|아쿠아|수족|농장|목장|체험|키즈|어린이|유아|놀이|박물관|미술관|과학관|생태|수목원|식물원|플레이|교육관|학습원/

/**
 * Skip non-baby-relevant places from Tour API.
 * Branching by contenttypeid:
 *   - Common blacklist for all types
 *   - Type 14 (문화시설): default INCLUDE, cat3 blacklist only
 *   - Type 28 (레포츠): default EXCLUDE, title whitelist only
 *   - Type 12 (관광지): cat3 whitelist + title rescue
 */
function shouldSkipPlace(title: string, contenttypeid?: number, cat3?: string): boolean {
  // 1) Common blacklist (all types)
  if (TOUR_BLACKLIST.test(title)) return true

  // 2) Type 14 (문화시설): default include, only blacklist specific cat3
  if (contenttypeid === 14) {
    if (cat3 === 'A02060200') return true   // 기념관 (전쟁/역사)
    if (cat3 === 'A02060400') return true   // 컨벤션센터
    if (cat3 === 'A02060800') return true   // 외국문화원
    return false
  }

  // 3) Type 28 (레포츠): default exclude, only whitelist passes
  if (contenttypeid === 28) {
    if (LEPORTS_WHITELIST.test(title)) return false
    return true
  }

  // 4) Type 39 (음식점): default exclude, only kids/family whitelist passes
  if (contenttypeid === 39) {
    if (RESTAURANT_WHITELIST.test(title)) return false
    return true
  }

  // 4) Type 12 (관광지): cat3 whitelist + title rescue
  if (cat3 && BABY_RELEVANT_CAT3.has(cat3)) return false
  if (TITLE_RESCUE.test(title)) return false
  return true
}

/** Guess sub_category for type 14 (문화시설) from title */
function guessCultureSubCategory(title: string, cat3?: string): string {
  if (/박물관/.test(title)) return '박물관'
  if (/미술관/.test(title)) return '미술관'
  if (/도서관/.test(title)) return '도서관'
  if (/전시/.test(title)) return '전시관'
  if (/공연|극장|아트홀/.test(title)) return '공연장'
  if (/과학관/.test(title)) return '과학관'
  if (/체험/.test(title)) return '체험관'
  return cat3 || '문화시설'
}

/** Guess sub_category for type 39 (음식점) from title */
function guessRestaurantSubCategory(title: string): string {
  if (/키즈존|키즈카페/.test(title)) return '키즈존식당'
  if (/패밀리|가족/.test(title)) return '패밀리레스토랑'
  if (/이유식/.test(title)) return '이유식카페'
  if (/놀이방/.test(title)) return '놀이방식당'
  if (/뷔페/.test(title)) return '키즈뷔페'
  return '키즈식당'
}

/** Guess sub_category for type 28 (레포츠) from title */
function guessLeportsSubCategory(title: string): string {
  if (/수영|풀/.test(title)) return '수영장'
  if (/워터파크|물놀이/.test(title)) return '워터파크'
  if (/캠핑|글램핑/.test(title)) return '캠핑장'
  if (/스케이트|아이스/.test(title)) return '스케이트장'
  if (/썰매/.test(title)) return '썰매장'
  if (/트램폴린/.test(title)) return '트램폴린'
  if (/자전거/.test(title)) return '자전거공원'
  return '레포츠'
}

function mapToCategory(
  contentTypeId: number,
  cat1?: string,
  title?: string,
  cat3?: string
): PlaceCategory {
  // Use whitelist mapping if cat3 is known
  const whitelisted = cat3 ? BABY_RELEVANT_CAT3.get(cat3) : undefined
  if (whitelisted) return whitelisted.category

  if (contentTypeId === 14) {
    if (title && /공원/.test(title)) return '공원/놀이터'
    return '전시/체험'
  }
  if (contentTypeId === 28) return '수영/물놀이'
  if (contentTypeId === 39) return '식당/카페'
  if (contentTypeId === 12) {
    if (cat1 === 'A03') return '수영/물놀이'
    if (title && /동물|아쿠아|수족|농장|목장/.test(title)) return '동물/자연'
    if (title && /공원|숲|자연|생태/.test(title)) return '공원/놀이터'
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
