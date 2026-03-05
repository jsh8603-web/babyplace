/**
 * Small Business Market Data Collector (소상공인 상권정보 API)
 *
 * Replaces the former LOCALDATA (api.localdata.com) collector.
 * Uses data.go.kr 소상공인시장진흥공단 상가(상권)정보 API.
 * Reuses existing DATA_GO_KR_API_KEY — no additional key required.
 *
 * API base: https://apis.data.go.kr/B553077/api/open/sdsc2
 * Docs: https://www.data.go.kr/data/15012005/openapi.do
 *
 * Strategy:
 *   1. storeListInUpjong — fetch by industry sub-code (indsSclsCd)
 *   2. Filter to Seoul/Gyeonggi by address (ctprvnNm) or coordinates
 *   3. Baby-keyword name filter to avoid generic stores
 *   4. Deduplicate → insert into places
 *
 * Coordinates: WGS84 (lon/lat) — no conversion needed.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { prefetchIds } from '../lib/prefetch'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'
import { checkPlaceGate } from '../matchers/place-gate'

// ─── API response types ─────────────────────────────────────────────────────

interface SdscResponse {
  header: {
    resultCode: string
    resultMsg: string
  }
  body: {
    pageNo: number
    numOfRows: number
    totalCount: number
    items: SdscItem[]
  }
}

interface SdscItem {
  bizesId: string // 상가업소번호 (unique ID)
  bizesNm: string // 상호명
  rdnmAdr?: string // 도로명주소
  lnoAdr?: string // 지번주소
  lon?: number // 경도 (WGS84)
  lat?: number // 위도 (WGS84)
  indsLclsCd?: string // 업종 대분류코드
  indsLclsNm?: string // 업종 대분류명
  indsMclsCd?: string // 업종 중분류코드
  indsMclsNm?: string // 업종 중분류명
  indsSclsCd?: string // 업종 소분류코드
  indsSclsNm?: string // 업종 소분류명
  ctprvnNm?: string // 시도명
  signguNm?: string // 시군구명
  adongNm?: string // 행정동명
}

// ─── Search targets ─────────────────────────────────────────────────────────

interface SearchTarget {
  /** Industry code level: 'indsLclsCd' | 'indsMclsCd' | 'indsSclsCd' */
  divId: string
  /** Industry code value */
  key: string
  /** Human-readable label for logging */
  label: string
  /** BabyPlace category */
  babyCategory: PlaceCategory
  isIndoor: boolean
  subCategory: string
  /**
   * Regex pattern to match baby-friendly store names.
   * null = accept all (the industry code itself is specific enough).
   */
  nameFilter: RegExp | null
}

/**
 * Search targets for baby-friendly businesses.
 *
 * Industry codes discovered via /largeUpjongList → /middleUpjongList → /smallUpjongList.
 * The 소상공인 API uses a hierarchical code system:
 *   대분류(1-2 chars) > 중분류(3-4 chars) > 소분류(5-6 chars)
 *
 * Strategy: Use broad codes (대분류/중분류) + nameFilter for precision,
 * since exact 소분류 codes for "키즈카페" vary by region/registration.
 */
const SEARCH_TARGETS: SearchTarget[] = [
  // 관광/여가/오락 대분류 — 키즈카페, 실내놀이터, 놀이시설
  {
    divId: 'indsLclsCd',
    key: 'N',
    label: '관광/여가/오락',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: '키즈카페/놀이시설',
    nameFilter: /키즈|아이|유아|어린이|볼풀|놀이|baby|kids|베이비|토들러|주니어/i,
  },
  // 음식 대분류 — 이유식카페, 키즈존 식당 (nameFilter로 정밀 필터링)
  {
    divId: 'indsLclsCd',
    key: 'Q',
    label: '음식 (키즈 필터)',
    babyCategory: '식당/카페',
    isIndoor: true,
    subCategory: '키즈존/이유식',
    nameFilter: /키즈|이유식|유아|아기|baby|kids|베이비/i,
  },
  // 학문/교육 — 체험학습, 어린이 교육시설
  {
    divId: 'indsLclsCd',
    key: 'R',
    label: '학문/교육 (키즈 필터)',
    babyCategory: '전시/체험',
    isIndoor: true,
    subCategory: '어린이 체험/교육',
    nameFilter: /키즈|어린이|유아|아이|체험|놀이|baby|kids/i,
  },
]

/**
 * Service area grids (same as kakao-category.ts).
 * 소상공인 API /storeListInRectangle uses minx,miny,maxx,maxy (WGS84).
 */
const SERVICE_AREA_RECTS = [
  { minx: 126.5, miny: 36.9, maxx: 127.2, maxy: 37.3 },
  { minx: 127.2, miny: 36.9, maxx: 127.9, maxy: 37.3 },
  { minx: 126.5, miny: 37.3, maxx: 127.2, maxy: 37.65 },
  { minx: 127.2, miny: 37.3, maxx: 127.9, maxy: 37.65 },
  { minx: 126.5, miny: 37.65, maxx: 127.2, maxy: 38.0 },
  { minx: 127.2, miny: 37.65, maxx: 127.9, maxy: 38.0 },
]

const API_BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2'
const PAGE_SIZE = 1000 // API max per page
const MAX_PAGES = 30

// ─── Main export ────────────────────────────────────────────────────────────

export interface LocalDataResult {
  totalFetched: number
  newPlaces: number
  duplicates: number
  skippedOutOfArea: number
  skippedByNameFilter: number
  errors: number
}

export async function runLocalData(): Promise<LocalDataResult> {
  // Run Wed/Sat only — data changes slowly, saves API calls
  const dayOfWeek = new Date().getUTCDay() // 0=Sun, ..., 3=Wed, 6=Sat
  const isCollectionDay = dayOfWeek === 3 || dayOfWeek === 6
  if (!isCollectionDay && process.argv[2] !== 'manual') {
    console.log(`[small-biz] Skipping — runs Wed/Sat only (today: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`)
    return {
      totalFetched: 0,
      newPlaces: 0,
      duplicates: 0,
      skippedOutOfArea: 0,
      skippedByNameFilter: 0,
      errors: 0,
    }
  }

  const apiKey = process.env.DATA_GO_KR_API_KEY
  if (!apiKey) {
    console.warn('[small-biz] DATA_GO_KR_API_KEY not set, skipping')
    return {
      totalFetched: 0,
      newPlaces: 0,
      duplicates: 0,
      skippedOutOfArea: 0,
      skippedByNameFilter: 0,
      errors: 0,
    }
  }

  const result: LocalDataResult = {
    totalFetched: 0,
    newPlaces: 0,
    duplicates: 0,
    skippedOutOfArea: 0,
    skippedByNameFilter: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  // Prefetch existing source_ids to skip known items without DB query
  const existingSourceIds = await prefetchSourceIds()
  console.log(`[small-biz] Pre-fetched ${existingSourceIds.size} existing source_ids`)

  // Fetch each rect once, distribute items to all targets (saves 2/3 of API calls)
  await processAllTargets(apiKey, result, existingSourceIds)

  await logCollection({
    collector: 'small-biz',
    startedAt,
    resultsCount: result.totalFetched,
    newPlaces: result.newPlaces,
    errors: result.errors,
  })

  console.log(`[small-biz] Done: ${JSON.stringify(result)}`)
  return result
}

// ─── Prefetch helpers ───────────────────────────────────────────────────────

async function prefetchSourceIds(): Promise<Set<string>> {
  return prefetchIds({
    table: 'places',
    column: 'source_id',
    filters: [{ op: 'eq', column: 'source', value: 'small-biz' }],
  })
}

// ─── Rect-first processing (each rect fetched once, distributed to all targets) ──

async function processAllTargets(
  apiKey: string,
  result: LocalDataResult,
  existingSourceIds: Set<string>
): Promise<void> {
  for (const rect of SERVICE_AREA_RECTS) {
    let page = 1

    while (page <= MAX_PAGES) {
      const allItems = await fetchRectPageRaw(apiKey, rect, page)
      if (!allItems || allItems.length === 0) break

      // Distribute items to matching targets
      for (const target of SEARCH_TARGETS) {
        const targetItems = allItems.filter((item) => {
          const field = target.divId as keyof SdscItem
          return item[field] === target.key
        })

        result.totalFetched += targetItems.length

        for (const item of targetItems) {
          try {
            await processItem(item, target, result, existingSourceIds)
          } catch (err) {
            console.error('[small-biz] Item error:', err, item.bizesId)
            result.errors++
          }
        }
      }

      if (allItems.length < PAGE_SIZE) break
      page++
    }
  }
}

async function processItem(
  item: SdscItem,
  target: SearchTarget,
  result: LocalDataResult,
  existingSourceIds: Set<string>
): Promise<void> {
  const lat = item.lat
  const lng = item.lon
  const address = item.rdnmAdr || item.lnoAdr || ''

  if (lat == null || lng == null) {
    result.skippedOutOfArea++
    return
  }

  // Name filter: skip stores whose name doesn't match baby keywords
  if (target.nameFilter && !target.nameFilter.test(item.bizesNm)) {
    result.skippedByNameFilter++
    return
  }

  if (!isInServiceRegion(lat, lng, address)) {
    result.skippedOutOfArea++
    return
  }

  // Fast in-memory duplicate check using pre-fetched source_ids
  if (existingSourceIds.has(item.bizesId)) {
    result.duplicates++
    return
  }

  const dup = await checkDuplicate({
    kakaoPlaceId: `sdsc_${item.bizesId}`,
    name: item.bizesNm,
    address,
    lat,
    lng,
  })

  if (dup.isDuplicate && dup.existingId) {
    await supabaseAdmin.rpc('increment_source_count', { p_place_id: dup.existingId })
    result.duplicates++
    return
  }

  const gate = await checkPlaceGate({
    name: item.bizesNm,
    subCategory: item.indsSclsNm || item.indsMclsNm,
    source: 'small-biz',
  })
  if (!gate.allowed) return

  const districtCode = await getDistrictCode(lat, lng, address)

  const { error } = await supabaseAdmin.from('places').insert({
    name: item.bizesNm,
    category: target.babyCategory,
    sub_category: item.indsSclsNm || item.indsMclsNm || target.subCategory,
    address,
    road_address: item.rdnmAdr || null,
    lat,
    lng,
    district_code: districtCode,
    source: 'small-biz',
    source_id: item.bizesId,
    is_indoor: target.isIndoor,
    is_active: true,
  })

  if (error) {
    if (error.code === '23505') {
      result.duplicates++
    } else {
      console.error('[small-biz] Insert error:', error.message, item.bizesId)
      result.errors++
    }
  } else {
    result.newPlaces++
  }
}

// ─── API fetch ──────────────────────────────────────────────────────────────

/** Fetch all items in a rect (no target filtering — caller distributes to targets) */
async function fetchRectPageRaw(
  apiKey: string,
  rect: { minx: number; miny: number; maxx: number; maxy: number },
  page: number
): Promise<SdscItem[] | null> {
  const params = new URLSearchParams({
    type: 'json',
    minx: String(rect.minx),
    miny: String(rect.miny),
    maxx: String(rect.maxx),
    maxy: String(rect.maxy),
    pageNo: String(page),
    numOfRows: String(PAGE_SIZE),
  })

  const url = `${API_BASE}/storeListInRectangle?serviceKey=${apiKey}&${params.toString()}`

  try {
    const response = await fetch(url)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`[small-biz] HTTP ${response.status} page ${page}:`, body.slice(0, 300))
      return null
    }

    const text = await response.text()
    let json: SdscResponse

    try {
      json = JSON.parse(text) as SdscResponse
    } catch {
      // Response is not valid JSON (type=json param may have failed)
      console.error('[small-biz] Non-JSON response, skipping page')
      return null
    }

    if (json.header?.resultCode !== '00') {
      console.error(`[small-biz] API error: ${json.header?.resultMsg} (code: ${json.header?.resultCode})`)
      return null
    }

    return json.body?.items ?? []
  } catch (err) {
    console.error('[small-biz] Fetch error:', err)
    return null
  }
}
