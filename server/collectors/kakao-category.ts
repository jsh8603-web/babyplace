/**
 * Pipeline A — Kakao category/keyword search → places upsert
 *
 * Covers plan.md sections 18-5, 18-6, 18-9.
 *
 * Flow:
 *   1. Category codes (CT1, AT4) → processTarget() → no tracking
 *   2. DB keywords (provider='kakao') → processTarget() → per-keyword tracking
 *   3. Fallback hardcoded keywords if DB is empty
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { kakaoLimiter } from '../rate-limiter'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'
import { evaluateKeywordCycle } from '../keywords/rotation-engine'

// ─── Kakao API types ─────────────────────────────────────────────────────────

interface KakaoDocument {
  id: string
  place_name: string
  category_name: string
  category_group_code: string
  address_name: string
  road_address_name: string
  x: string // lng
  y: string // lat
  phone: string
  place_url: string
}

interface KakaoSearchResponse {
  documents: KakaoDocument[]
  meta: {
    is_end: boolean
    pageable_count: number
    total_count: number
  }
}

// ─── Search target types ─────────────────────────────────────────────────────

interface SearchTarget {
  kakaoCategory?: string       // category_group_code (e.g. CE7, FD6, CT1, AT4)
  keyword?: string             // free-text keyword search
  babyCategory: PlaceCategory  // BabyPlace category mapping
  isIndoor: boolean | null
}

interface DBKeywordTarget extends SearchTarget {
  keywordId: number            // keywords table id for tracking
}

// ─── Category code targets (no tracking) ─────────────────────────────────────

const CATEGORY_CODE_TARGETS: SearchTarget[] = [
  { kakaoCategory: 'CT1', babyCategory: '전시/체험', isIndoor: true },
  { kakaoCategory: 'AT4', babyCategory: '동물/자연', isIndoor: null },
]

// ─── Fallback keywords (used when DB is empty) ──────────────────────────────

const FALLBACK_KEYWORD_TARGETS: SearchTarget[] = [
  { keyword: '키즈카페', babyCategory: '놀이', isIndoor: true },
  { keyword: '실내놀이터', babyCategory: '놀이', isIndoor: true },
  { keyword: '볼풀', babyCategory: '놀이', isIndoor: true },
  { keyword: '어린이공원', babyCategory: '공원/놀이터', isIndoor: false },
  { keyword: '놀이터', babyCategory: '공원/놀이터', isIndoor: false },
  { keyword: '어린이도서관', babyCategory: '도서관', isIndoor: true },
  { keyword: '유아수영장', babyCategory: '수영/물놀이', isIndoor: true },
  { keyword: '키즈풀', babyCategory: '수영/물놀이', isIndoor: true },
  { keyword: '키즈존 식당', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '이유식카페', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '이유식', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '어린이박물관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '과학관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '동물원', babyCategory: '동물/자연', isIndoor: false },
  { keyword: '아쿠아리움', babyCategory: '동물/자연', isIndoor: true },
  { keyword: '유아체험', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '키즈수영', babyCategory: '수영/물놀이', isIndoor: true },
  { keyword: '트램폴린파크', babyCategory: '놀이', isIndoor: true },
  { keyword: '키즈레스토랑', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '어린이미술관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '유아놀이', babyCategory: '놀이', isIndoor: true },
  { keyword: '어린이체험관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '아기카페', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '가족나들이', babyCategory: '동물/자연', isIndoor: false },
  { keyword: '워터파크 키즈', babyCategory: '수영/물놀이', isIndoor: null },
]

// ─── Category to PlaceCategory mapping ──────────────────────────────────────

const KEYWORD_GROUP_TO_CATEGORY: Record<string, PlaceCategory> = {
  '놀이': '놀이',
  '공원/놀이터': '공원/놀이터',
  '도서관': '도서관',
  '수영/물놀이': '수영/물놀이',
  '식당/카페': '식당/카페',
  '전시/체험': '전시/체험',
  '동물/자연': '동물/자연',
  '문화행사': '문화행사',
  '편의시설': '편의시설',
}

/**
 * Grid of rect parameters (swLng,swLat,neLng,neLat) covering Seoul + Gyeonggi + Incheon.
 * 2 columns × 3 rows = 6 rectangles.
 */
const SERVICE_AREA_RECTS: string[] = [
  // Row 1 (south, lat 36.9–37.3)
  '126.5,36.9,127.2,37.3', // west
  '127.2,36.9,127.9,37.3', // east
  // Row 2 (middle, lat 37.3–37.65)
  '126.5,37.3,127.2,37.65',
  '127.2,37.3,127.9,37.65',
  // Row 3 (north, lat 37.65–38.0)
  '126.5,37.65,127.2,38.0',
  '127.2,37.65,127.9,38.0',
]

const KAKAO_API_BASE = 'https://dapi.kakao.com/v2/local/search'
const MAX_PAGES = 45
const PAGE_SIZE = 15

// ─── Main export ─────────────────────────────────────────────────────────────

export interface PipelineAResult {
  totalFetched: number
  newPlaces: number
  duplicates: number
  skippedOutOfArea: number
  errors: number
  keywordsProcessed: number
  keywordsFromDB: boolean
}

export async function runPipelineA(): Promise<PipelineAResult> {
  const result: PipelineAResult = {
    totalFetched: 0,
    newPlaces: 0,
    duplicates: 0,
    skippedOutOfArea: 0,
    errors: 0,
    keywordsProcessed: 0,
    keywordsFromDB: false,
  }

  const startedAt = Date.now()

  // Phase 1: Category codes (CT1, AT4) — no tracking
  for (const target of CATEGORY_CODE_TARGETS) {
    for (const rect of SERVICE_AREA_RECTS) {
      try {
        await processTarget(target, rect, result)
      } catch (err) {
        console.error(
          `[pipeline-a] Error processing category ${target.kakaoCategory} rect=${rect}:`,
          err
        )
        result.errors++
      }
    }
  }

  // Phase 2: DB keywords with per-keyword tracking
  const dbKeywords = await getKakaoKeywordsFromDB()

  if (dbKeywords.length > 0) {
    result.keywordsFromDB = true
    console.log(`[pipeline-a] Loaded ${dbKeywords.length} keywords from DB`)

    for (const kw of dbKeywords) {
      // Snapshot result before processing this keyword
      const beforeNewPlaces = result.newPlaces
      const beforeDuplicates = result.duplicates
      const beforeFetched = result.totalFetched

      for (const rect of SERVICE_AREA_RECTS) {
        try {
          await processTarget(kw, rect, result)
        } catch (err) {
          console.error(
            `[pipeline-a] Error processing keyword "${kw.keyword}" rect=${rect}:`,
            err
          )
          result.errors++
        }
      }

      // Calculate delta for this keyword
      const kwApiResults = result.totalFetched - beforeFetched
      const kwNewPlaces = result.newPlaces - beforeNewPlaces
      const kwDuplicates = result.duplicates - beforeDuplicates

      // Evaluate keyword cycle (logs to keyword_logs + updates status)
      await evaluateKeywordCycle(kw.keywordId, kwApiResults, kwNewPlaces, kwDuplicates)
      result.keywordsProcessed++
    }
  } else {
    // Fallback: no DB keywords → use hardcoded (no tracking)
    console.log('[pipeline-a] No DB keywords found, using fallback keywords')
    for (const target of FALLBACK_KEYWORD_TARGETS) {
      for (const rect of SERVICE_AREA_RECTS) {
        try {
          await processTarget(target, rect, result)
        } catch (err) {
          console.error(
            `[pipeline-a] Error processing fallback "${target.keyword}" rect=${rect}:`,
            err
          )
          result.errors++
        }
      }
    }
  }

  // Log summary to collection_logs
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'pipeline-a-kakao-category',
    results_count: result.totalFetched,
    new_places: result.newPlaces,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  console.log(
    `[pipeline-a] Complete: fetched=${result.totalFetched} new=${result.newPlaces} dup=${result.duplicates} keywords=${result.keywordsProcessed} fromDB=${result.keywordsFromDB}`
  )

  return result
}

// ─── DB keyword loading ──────────────────────────────────────────────────────

async function getKakaoKeywordsFromDB(): Promise<DBKeywordTarget[]> {
  const currentMonth = new Date().getMonth() + 1 // 1-12

  const { data: keywords, error } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword, keyword_group, status, is_indoor, seasonal_months')
    .eq('provider', 'kakao')
    .in('status', ['NEW', 'ACTIVE', 'DECLINING', 'SEASONAL'])
    .order('efficiency_score', { ascending: false })

  if (error || !keywords) {
    console.error('[pipeline-a] Failed to load kakao keywords from DB:', error)
    return []
  }

  return (keywords as any[])
    .filter((kw) => {
      // Skip SEASONAL if not in season
      if (kw.status === 'SEASONAL') {
        const months: number[] = kw.seasonal_months ?? []
        return months.includes(currentMonth)
      }
      return true
    })
    .map((kw) => ({
      keyword: kw.keyword,
      keywordId: kw.id,
      babyCategory: (KEYWORD_GROUP_TO_CATEGORY[kw.keyword_group] ?? '놀이') as PlaceCategory,
      isIndoor: kw.is_indoor ?? null,
    }))
}

// ─── Per-target processing ────────────────────────────────────────────────────

async function processTarget(
  target: SearchTarget,
  rect: string,
  result: PipelineAResult
): Promise<void> {
  let page = 1

  while (page <= MAX_PAGES) {
    const docs = await fetchKakaoPage(target, rect, page)
    if (docs === null) break // rate limit error or empty
    if (docs.documents.length === 0) break

    result.totalFetched += docs.documents.length

    for (const doc of docs.documents) {
      // Skip non-baby-relevant landmarks (palaces, temples, historical sites)
      if (shouldSkipKakaoPlace(doc.place_name, doc.category_name)) continue

      const lat = parseFloat(doc.y)
      const lng = parseFloat(doc.x)
      const address = doc.road_address_name || doc.address_name

      if (!isInServiceRegion(lat, lng, address)) {
        result.skippedOutOfArea++
        continue
      }

      const dup = await checkDuplicate({
        kakaoPlaceId: doc.id,
        name: doc.place_name,
        address,
        lat,
        lng,
      })

      if (dup.isDuplicate && dup.existingId) {
        // Bump mention_count to record that Kakao still knows about this place
        await supabaseAdmin
          .from('places')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', dup.existingId)
        result.duplicates++
        continue
      }

      // New place → insert with dynamic category mapping
      const districtCode = await getDistrictCode(lat, lng, address)
      const mapped = mapKakaoCategory(doc, target.babyCategory)
      const subCategory = normalizeSubCategory(doc.category_name)

      const { error } = await supabaseAdmin.from('places').insert({
        name: doc.place_name,
        category: mapped.category,
        sub_category: subCategory,
        address: doc.address_name || null,
        road_address: doc.road_address_name || null,
        district_code: districtCode,
        lat,
        lng,
        phone: doc.phone || null,
        source: 'kakao',
        source_id: doc.id,
        kakao_place_id: doc.id,
        is_indoor: mapped.isIndoor ?? target.isIndoor,
        is_active: true,
      })

      if (error) {
        // Unique constraint violation on kakao_place_id → already exists
        if (error.code === '23505') {
          result.duplicates++
        } else {
          console.error('[pipeline-a] Insert error:', error.message, doc.id)
          result.errors++
        }
      } else {
        result.newPlaces++
      }
    }

    if (docs.meta.is_end) break
    page++
  }
}

// ─── Kakao API fetch ──────────────────────────────────────────────────────────

async function fetchKakaoPage(
  target: SearchTarget,
  rect: string,
  page: number
): Promise<KakaoSearchResponse | null> {
  const params = new URLSearchParams({
    rect,
    page: String(page),
    size: String(PAGE_SIZE),
  })

  let endpoint: string
  if (target.kakaoCategory) {
    endpoint = `${KAKAO_API_BASE}/category`
    params.set('category_group_code', target.kakaoCategory)
  } else if (target.keyword) {
    endpoint = `${KAKAO_API_BASE}/keyword`
    params.set('query', target.keyword)
  } else {
    return null
  }

  const url = `${endpoint}?${params.toString()}`

  try {
    const response = await kakaoLimiter.throttle(() =>
      fetch(url, {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
        },
      })
    )

    if (!response.ok) {
      console.error(
        `[pipeline-a] Kakao API HTTP ${response.status} for ${target.keyword ?? target.kakaoCategory}`
      )
      return null
    }

    return (await response.json()) as KakaoSearchResponse
  } catch (err) {
    console.error('[pipeline-a] Fetch error:', err)
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Skip non-baby-relevant places from Kakao results.
 * Filters out historical landmarks, temples, streets, hotels, churches, pet parks.
 */
function shouldSkipKakaoPlace(name: string, categoryName: string): boolean {
  // Name patterns for non-baby-relevant places
  const skipNamePatterns = /궁$|궁궐|사찰|사당|서원$|향교|명륜|번사|총국|관아|왕릉|능묘|묘소|성곽|성터|성벽|봉수대|비석|기념비|전적지|유적|기념탑|사적|종묘|반려견|애견/
  if (skipNamePatterns.test(name)) return true

  // Non-baby franchise chains: comic cafes, board game cafes, escape rooms
  const skipBrands = /^(벌툰|놀숲|레드버튼|홈즈앤루팡|히어로보드게임|나인블럭|스타벅스|이디야|투썸플레이스|할리스|메가커피|컴포즈|빽다방)\s/
  if (skipBrands.test(name)) return true

  // Kakao category_name patterns to skip
  const skipCategories = /테마거리|먹자골목|카페거리|도보여행|고궁|궁$|사적지|유적지|성지$|묘$|사찰|교회$|성당$|호텔$|여관|모텔|반려견|만화카페|보드게임|방탈출|스터디카페|코인노래방|PC방|당구|볼링장|노래방|네일|피부관리|미용실|안경/
  if (skipCategories.test(categoryName)) return true

  return false
}

/**
 * Dynamically map Kakao category_name to BabyPlace PlaceCategory.
 * AT4 (관광명소) is too broad — use sub-category for fine-grained mapping.
 * Falls back to the target's babyCategory if no specific match.
 */
function mapKakaoCategory(
  doc: KakaoDocument,
  defaultCategory: PlaceCategory
): { category: PlaceCategory; isIndoor: boolean | null } {
  const catName = doc.category_name || ''
  const name = doc.place_name || ''

  // 동물원/아쿠아리움/농장 → 동물/자연
  if (/동물원|아쿠아리움|수족관|농장|목장|곤충|파충류/.test(catName) ||
      /동물원|아쿠아|수족|농장|목장/.test(name)) {
    return { category: '동물/자연', isIndoor: /실내|아쿠아|수족/.test(name) }
  }

  // 워터파크/수영장 → 수영/물놀이
  if (/워터|수영|물놀이/.test(catName) || /워터파크|수영|물놀이/.test(name)) {
    return { category: '수영/물놀이', isIndoor: null }
  }

  // 박물관/미술관/과학관/전시 → 전시/체험
  if (/박물관|미술관|과학관|전시관|체험관/.test(catName) ||
      /박물관|미술관|과학관|전시|체험관/.test(name)) {
    return { category: '전시/체험', isIndoor: true }
  }

  // 공원/놀이터 → 공원/놀이터
  if (/공원|놀이터|유원지/.test(catName) || /공원|놀이터/.test(name)) {
    return { category: '공원/놀이터', isIndoor: false }
  }

  // 테마파크 → keep as 동물/자연 (most theme parks in Korea have animal areas)
  if (/테마파크/.test(catName)) {
    return { category: '동물/자연', isIndoor: false }
  }

  return { category: defaultCategory, isIndoor: null }
}

/**
 * Extracts a sub-category label from Kakao's hierarchical category string.
 * Example: "음식점 > 카페 > 키즈카페" → "키즈카페"
 */
function normalizeSubCategory(categoryName: string): string | null {
  if (!categoryName) return null
  const parts = categoryName.split('>').map((p) => p.trim())
  return parts[parts.length - 1] || null
}
