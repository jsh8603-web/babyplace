/**
 * Pipeline B — Naver + Daum blog reverse search → blog_mentions + mention_count
 *
 * Covers plan.md sections 18-6, 18-8.
 *
 * Two sub-methods (run in sequence):
 *
 * Method 1 — Reverse search (place → blog):
 *   Select up to 500 active places ordered by stale mention date.
 *   For each place, search Naver Blog + Daum Blog (Kakao) by place name.
 *   Insert new mentions into blog_mentions; increment mention_count.
 *
 * Method 2 — Keyword search (keyword → blog → DB match):
 *   Cycle through ACTIVE/NEW keywords from the keywords table.
 *   For each keyword, search Naver Blog; try to match results to existing places.
 *   Unmatched but promising results → insert into place_candidates.
 *
 * Adaptive keyword rotation (plan.md 9-2):
 *   After each keyword cycle, update efficiency_score and status.
 *   EXHAUSTED keywords are skipped; SEASONAL keywords are activated/deactivated
 *   based on the current month.
 */

import { extractWithGemini } from '../lib/gemini'
import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { naverLimiter, kakaoSearchLimiter } from '../rate-limiter'
import { findMatchingPlace } from '../matchers/duplicate'
import { normalizePlaceName } from '../matchers/similarity'
import { searchKakaoPlaceDetailed, type KakaoSearchResult } from '../lib/kakao-search'
import { isValidServiceAddress, isInServiceArea } from '../enrichers/region'
import { evaluateKeywordCycle } from '../keywords/rotation-engine'

// ─── Naver API types ──────────────────────────────────────────────────────────

export interface NaverBlogItem {
  title: string          // HTML-escaped, may contain <b> tags
  link: string
  description: string
  bloggername: string
  bloggerlink: string
  postdate: string       // YYYYMMDD
}

interface NaverSearchResponse<T> {
  lastBuildDate: string
  total: number
  start: number
  display: number
  items: T[]
}

// ─── Daum/Kakao API types ────────────────────────────────────────────────────

interface DaumBlogItem {
  title: string          // HTML-escaped
  contents: string       // snippet
  url: string
  blogname: string
  thumbnail: string
  datetime: string       // ISO 8601 (e.g. "2024-01-15T12:00:00.000+09:00")
}

interface DaumSearchResponse {
  meta: { total_count: number; pageable_count: number; is_end: boolean }
  documents: DaumBlogItem[]
}

// ─── Dynamic blacklist cache ─────────────────────────────────────────────────

let dynamicBlacklistTerms: string[] = []

export async function initializeDynamicBlacklist(): Promise<void> {
  const { loadActiveBlacklistTerms } = await import('../utils/blog-noise-filter')
  dynamicBlacklistTerms = await loadActiveBlacklistTerms()
  console.log(`[pipeline-b] Loaded ${dynamicBlacklistTerms.length} dynamic blacklist terms`)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json'
const DAUM_BLOG_URL = 'https://dapi.kakao.com/v2/search/blog'

/** Number of places to reverse-search per pipeline run.
 *  Budget: each place = 2 API calls (naver blog + daum blog).
 *  Naver daily quota ~25K, Kakao search ~300K/month (~10K/day).
 *  4 runs/day × 500 = 4,000 calls per provider (well within budget). */
const REVERSE_SEARCH_BATCH = 750

/** Number of results per API call. */
const DISPLAY_COUNT = 30

/** Max keywords to cycle per run (budget: each keyword = 2 API calls). */
const MAX_KEYWORDS_PER_RUN = 150

// ─── LLM extraction constants ────────────────────────────────────────────────

/** Items per Gemini Flash request. */
const LLM_BATCH_SIZE = 30
const KAKAO_SIMILARITY_THRESHOLD = 0.7

/** Seoul / Gyeonggi / Incheon bounding box (swLng,swLat,neLng,neLat) */
const SERVICE_RECT = '126.5,36.9,127.9,38.0'

/** Gemini Flash Tier 1: 150 RPM — concurrency 4 + 2s delay stays well within. */
const LLM_CONCURRENCY = 4
const LLM_DELAY_MS = 2000

/** Supplementary pagination: fetch more pages when existing URLs dominate results. */
const TARGET_PER_KEYWORD = 30
const MAX_PAGES = 5
const MIN_YIELD = 0.2

interface LLMExtractedPlace {
  n: number
  name: string | null
  addr: string | null
  c?: number // confidence 0~1
}

interface BlogItemForLLM {
  title: string
  snippet: string
  link: string
  postdate: string | null
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineBResult {
  reverseSearch: {
    placesProcessed: number
    newMentions: number
    errors: number
  }
  keywordSearch: {
    keywordsProcessed: number
    newMentions: number
    newCandidates: number
    llmExtracted: number
    kakaoValidated: number
    errors: number
  }
}

interface CollectedKeywordData {
  keywordId: number
  keyword: string
  blogItems: BlogItemForLLM[]
  apiResults: number
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Method 1 only — daily schedule, no LLM cost.
 * Reverse-searches existing places across Naver/Daum blogs.
 */
export async function runReverseSearchOnly(): Promise<PipelineBResult['reverseSearch']> {
  await initializeDynamicBlacklist()
  const stats: PipelineBResult['reverseSearch'] = { placesProcessed: 0, newMentions: 0, errors: 0 }
  await runReverseSearch(stats)
  return stats
}

/**
 * Method 2 — weekly schedule (Mon/Thu), uses Gemini Flash (sync).
 * Collects blogs for all keywords → extracts place names with LLM → validates with Kakao.
 */
export async function runKeywordSearchBatch(): Promise<PipelineBResult['keywordSearch']> {
  const stats: PipelineBResult['keywordSearch'] = {
    keywordsProcessed: 0,
    newMentions: 0,
    newCandidates: 0,
    llmExtracted: 0,
    kakaoValidated: 0,
    errors: 0,
  }
  const startedAt = Date.now()

  // Phase 1: Collect blog data for all keywords (with URL dedup)
  const { collected: keywordData, sessionUrls } = await collectAllKeywordBlogs(stats)
  if (keywordData.length === 0) {
    console.log('[pipeline-b] No keywords with blog results to process')
    return stats
  }

  // Phase 2: Extract place names with Gemini Flash + validate with Kakao
  await extractAndProcessKeywords(keywordData, stats)

  // Phase 3: Record analyzed URLs for future dedup
  const newUrls = [...sessionUrls]
  for (let i = 0; i < newUrls.length; i += 500) {
    const batch = newUrls.slice(i, i + 500).map((url) => ({ url }))
    await supabaseAdmin.from('llm_analyzed_urls').upsert(batch, { onConflict: 'url' })
  }
  console.log(`[pipeline-b] Recorded ${newUrls.length} analyzed URLs`)

  await logCollection({
    collector: 'pipeline-b-keyword-search',
    startedAt,
    resultsCount: stats.newMentions,
    newPlaces: stats.newCandidates,
    errors: stats.errors,
  })

  return stats
}

/**
 * Both methods combined — used by manual mode.
 */
export async function runPipelineB(): Promise<PipelineBResult> {
  const result: PipelineBResult = {
    reverseSearch: { placesProcessed: 0, newMentions: 0, errors: 0 },
    keywordSearch: {
      keywordsProcessed: 0,
      newMentions: 0,
      newCandidates: 0,
      llmExtracted: 0,
      kakaoValidated: 0,
      errors: 0,
    },
  }

  const startedAt = Date.now()
  await initializeDynamicBlacklist()

  // Method 1: reverse search (no LLM)
  await runReverseSearch(result.reverseSearch)

  // Method 2: keyword search (Gemini Flash)
  const kwResult = await runKeywordSearchBatch()
  result.keywordSearch = kwResult

  const totalNew = result.reverseSearch.newMentions + result.keywordSearch.newMentions
  const totalErrors = result.reverseSearch.errors + result.keywordSearch.errors

  await logCollection({
    collector: 'pipeline-b-naver-blog',
    startedAt,
    resultsCount: totalNew,
    newPlaces: result.keywordSearch.newCandidates,
    errors: totalErrors,
  })

  return result
}

// ─── Method 1: Reverse search ────────────────────────────────────────────────

async function runReverseSearch(
  stats: PipelineBResult['reverseSearch']
): Promise<void> {
  // Phase 1: uncrawled places first (initial coverage, evenly distributed)
  const { data: uncrawled, error: err1 } = await supabaseAdmin
    .from('places')
    .select('id, name, road_address, address')
    .eq('is_active', true)
    .is('last_mentioned_at', null)
    .order('id', { ascending: true })
    .limit(REVERSE_SEARCH_BATCH)

  if (err1) {
    console.error('[pipeline-b] Failed to fetch uncrawled places:', err1)
    stats.errors++
    return
  }

  const uncrawledPlaces = uncrawled ?? []
  const remaining = REVERSE_SEARCH_BATCH - uncrawledPlaces.length

  // Phase 2: popular places that haven't been refreshed recently
  // Prioritize high mention_count (active places get new posts frequently)
  // with staleness as tiebreaker (oldest refresh first)
  let popularPlaces: Array<{ id: number; name: string; road_address: string | null; address: string | null }> = []
  if (remaining > 0) {
    const { data, error: err2 } = await supabaseAdmin
      .from('places')
      .select('id, name, road_address, address')
      .eq('is_active', true)
      .not('last_mentioned_at', 'is', null)
      .order('mention_count', { ascending: false })
      .order('last_mentioned_at', { ascending: true })
      .limit(remaining)

    if (err2) {
      console.error('[pipeline-b] Failed to fetch popular places:', err2)
      stats.errors++
    } else {
      popularPlaces = data ?? []
    }
  }

  const allPlaces = [...uncrawledPlaces, ...popularPlaces]
  console.log(
    `[pipeline-b] Reverse search: ${uncrawledPlaces.length} uncrawled + ${popularPlaces.length} popular = ${allPlaces.length} total`
  )

  for (const place of allPlaces) {
    try {
      const addr = parseAddressComponents(place.road_address, place.address)
      const isCommon = isCommonWordName(place.name)
      const newMentions = await reverseSearchPlace(place.id, place.name, addr, isCommon)
      stats.newMentions += newMentions
      stats.placesProcessed++
    } catch (err) {
      console.error(`[pipeline-b] Reverse search error for place ${place.id}:`, err)
      stats.errors++
    }
  }
}

/**
 * Searches Naver Blog + Daum Blog for a given place name + district.
 * Computes relevance_score per post (place name match in title/snippet).
 * Only inserts posts with relevance >= 0.4.
 * Returns number of new mentions inserted.
 */
async function reverseSearchPlace(
  placeId: number,
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean
): Promise<number> {
  const searchTerm = buildSearchTerm(placeName, addr, isCommon)

  // --- Naver Blog ---
  const naver = await searchNaverBlog(placeId, placeName, addr, isCommon, searchTerm)

  // --- Daum Blog (Kakao) — covers 티스토리 + Daum 블로그 ---
  const daum = await searchDaumBlog(placeId, placeName, addr, isCommon, searchTerm)

  const newCount = naver.count + daum.count
  if (newCount > 0) {
    // Use the latest post_date from either source (not collection date)
    const dates = [naver.maxDate, daum.maxDate].filter(Boolean) as string[]
    const latestDate = dates.length > 0 ? dates.sort().pop()! : null
    await updateMentionCount(placeId, newCount, latestDate)
  }

  return newCount
}

/** Search Naver Blog API and insert relevant mentions. */
async function searchNaverBlog(
  placeId: number,
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  searchTerm: string
): Promise<{ count: number; maxDate: string | null }> {
  const query = encodeURIComponent(searchTerm)
  const items = await fetchNaverSearch<NaverBlogItem>(
    `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&sort=date`
  )
  if (!items) return { count: 0, maxDate: null }

  let count = 0
  let maxDate: string | null = null
  for (const item of items) {
    if (!item.link) continue
    const title = stripHtml(item.title)
    const snippet = stripHtml(item.description).slice(0, 500)
    const relevance = computePostRelevance(placeName, addr, isCommon, title, snippet)
    if (relevance < 0.4) continue

    const postDate = parseNaverPostDate(item.postdate)
    const { error } = await supabaseAdmin.from('blog_mentions').insert({
      place_id: placeId,
      source_type: 'naver_blog',
      title,
      url: item.link,
      post_date: postDate,
      snippet,
      relevance_score: relevance,
    })
    if (!error) {
      count++
      if (postDate && (!maxDate || postDate > maxDate)) maxDate = postDate
    }
  }
  return { count, maxDate }
}

/** Search Daum/Kakao Blog API and insert relevant mentions. */
async function searchDaumBlog(
  placeId: number,
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  searchTerm: string
): Promise<{ count: number; maxDate: string | null }> {
  const items = await fetchDaumSearch(searchTerm)
  if (!items) return { count: 0, maxDate: null }

  let count = 0
  let maxDate: string | null = null
  for (const item of items) {
    if (!item.url) continue
    const title = stripHtml(item.title)
    const snippet = stripHtml(item.contents).slice(0, 500)
    const relevance = computePostRelevance(placeName, addr, isCommon, title, snippet)
    if (relevance < 0.4) continue

    const postDate = item.datetime ? item.datetime.slice(0, 10) : null // "2024-01-15"

    const { error } = await supabaseAdmin.from('blog_mentions').insert({
      place_id: placeId,
      source_type: 'daum_blog',
      title,
      url: item.url,
      post_date: postDate,
      snippet,
      relevance_score: relevance,
    })
    if (!error) {
      count++
      if (postDate && (!maxDate || postDate > maxDate)) maxDate = postDate
    }
  }
  return { count, maxDate }
}

// ─── Layer 1: Address component parser ────────────────────────────────────────

export interface AddressComponents {
  city: string          // "서울" | "경기" | "인천"
  district: string      // "중구" | "강남구" (접미사 포함)
  dong: string | null   // "남창동" | "와부읍"
  road: string | null   // "퇴계로" (숫자 제거)
}

const CITY_NORMALIZE: Record<string, string> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  경기도: '경기', 경기: '경기',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
}

function parseAddressComponents(
  roadAddress: string | null,
  address: string | null
): AddressComponents {
  const result: AddressComponents = { city: '', district: '', dong: null, road: null }
  const raw = roadAddress || address || ''
  if (!raw) return result

  const tokens = raw.replace(/\(([^)]+)\)/g, ' $1 ').split(/\s+/)

  for (const t of tokens) {
    // City
    if (!result.city && CITY_NORMALIZE[t]) {
      result.city = CITY_NORMALIZE[t]
      continue
    }
    // District (구/군/시 with suffix kept)
    if (!result.district && /^[가-힣]{1,5}[구군시]$/.test(t) && !CITY_NORMALIZE[t]) {
      result.district = t
      continue
    }
    // Dong (동/읍/면/리)
    if (!result.dong && /^[가-힣]{1,10}[동읍면리]$/.test(t)) {
      result.dong = t
      continue
    }
    // Road name (로/길 ending, strip trailing numbers)
    if (!result.road && /[가-힣]+[로길]/.test(t)) {
      result.road = t.replace(/[0-9가-]*$/, '').replace(/길$/, '').replace(/로$/, '') || t.replace(/[0-9가-]*$/, '')
      // Keep the base road name (e.g. "퇴계로6가길" → "퇴계로" or "퇴계")
      const roadMatch = t.match(/^([가-힣]+[로])/)
      if (roadMatch) result.road = roadMatch[1]
      continue
    }
  }

  // Fallback dong from parentheses in road_address
  if (!result.dong && roadAddress) {
    const parenMatch = roadAddress.match(/\(([가-힣]+[동읍면리])\)/)
    if (parenMatch) result.dong = parenMatch[1]
  }

  return result
}

// ─── Layer 2: Common-word name detector ───────────────────────────────────────

const COMMON_WORDS = new Set([
  // Korean common nouns used as venue names
  '피크닉', '놀이터', '카페', '맛집', '숲', '하늘', '바다', '나무', '꽃', '공원',
  '봄', '여름', '가을', '겨울', '별', '달', '사랑', '행복', '소풍', '나들이',
  '마을', '뜰', '정원', '아뜰리에', '작업실', '공방', '부엌', '식탁', '마당',
  '다락', '골목', '언덕', '숲속', '들판', '호수', '강', '산', '바위', '섬',
  // Transliterated English common words
  '파크', '가든', '키즈', '드림', '포레스트', '베이비', '리틀', '해피', '스마일',
  '플레이', '조이', '러브', '원더', '매직', '판타지', '빌리지', '하우스', '스토리',
  '아이', '아트', '플라워', '레인보우', '선샤인', '문', '스타',
])

function isCommonWordName(name: string): boolean {
  const normalized = name.replace(/\s+/g, '')
  // 2 chars or fewer in Korean → likely common word
  if (normalized.length <= 2) return true
  // 3 chars → check against set
  if (normalized.length <= 3 && COMMON_WORDS.has(normalized)) return true
  // Exact match in common words set
  if (COMMON_WORDS.has(normalized)) return true
  // Multi-word name but each word is common (e.g. "해피 키즈")
  const words = name.split(/\s+/)
  if (words.length >= 2 && words.every((w) => COMMON_WORDS.has(w))) return true
  return false
}

// ─── Layer 2b: Generic place suffix detector ────────────────────────────────

const GENERIC_PLACE_SUFFIXES = [
  '어린이공원', '근린공원', '소공원', '체육공원',
  '도시공원', '수변공원', '중앙공원',
]

function hasGenericPlaceSuffix(name: string): boolean {
  const n = name.replace(/\s+/g, '')
  return GENERIC_PLACE_SUFFIXES.some((s) => n.endsWith(s))
}

// ─── Layer 3: Search query builder ────────────────────────────────────────────

function buildSearchTerm(
  name: string,
  addr: AddressComponents,
  isCommon: boolean
): string {
  if (isCommon) {
    // Common-word names need location specificity
    const quotedName = `"${name}"`
    if (addr.dong) return `${quotedName} ${addr.dong}`
    if (addr.road) return `${quotedName} ${addr.road}`
    if (addr.district) return `${quotedName} ${addr.district}`
    return quotedName
  }
  // Unique names: name + best available location
  if (addr.dong) return `${name} ${addr.dong}`
  if (addr.district) return `${name} ${addr.district}`
  return name
}

// ─── Layer 4: Relevance scoring (rewritten) ───────────────────────────────────

// Layer 5 helpers integrated below

const COMPETING_LOCATIONS = new Set([
  // Metro cities & provinces outside service area (서울/경기/인천)
  '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '충청', '전북', '전남', '전라', '경북', '경남', '경상', '제주',
  // Major non-capital cities
  '진주', '김해', '창원', '포항', '구미', '거제', '통영', '양산',
  '여수', '순천', '목포', '군산', '전주', '익산',
  '천안', '아산', '청주',
  '춘천', '원주', '강릉', '속초', '동해',
])

// Cities/areas within the service area (경기도 시 단위 + 주요 상권명)
// Used to detect competing branches of chain stores within 서울/경기/인천
const SERVICE_AREA_CITIES = [
  // 경기도 시/군 (3글자+ 우선, 2글자는 false positive 낮은 것만)
  '시흥', '이천', '수원', '성남', '안양', '부천', '용인', '고양', '김포',
  '하남', '구리', '광명', '안산', '평택', '파주', '양주', '포천', '여주',
  '안성', '오산', '의왕', '군포', '과천', '양평', '가평', '동두천', '연천',
  '남양주', '의정부',
  // 경기도 주요 생활권명 (행정 시명과 다른 이름)
  '판교', '분당', '동탄', '일산', '산본', '광교', '위례', '운정', '배곧',
]

const IRRELEVANT_CONTENT_TERMS = [
  // Product reviews
  '구매후기', '제품리뷰', '상품평', '배송후기', '가격비교', '할인코드',
  '쿠팡', '네이버쇼핑', '11번가', '지마켓', '옥션',
  '사용후기', '언박싱', '개봉기',
  // Real estate (30% of noise)
  '분양정보', '매매가', '시세차익', '전세가', '재건축', '모델하우스',
  '평당가', '분양가', '청약', '입주자모집', '오피스텔분양', '빌라매매',
  // Spam
  '출장마사지', '출장안마', '홈타이',
]

function hasCompetingLocation(text: string, ownCity: string): boolean {
  for (const loc of COMPETING_LOCATIONS) {
    if (loc === ownCity) continue
    if (text.includes(loc)) return true
  }
  return false
}

// Sub-area → parent city mapping (동탄→화성, 판교→성남, etc.)
const SUB_AREA_TO_PARENT: Record<string, string> = {
  '동탄': '화성', '병점': '화성', '봉담': '화성', '향남': '화성',
  '판교': '성남', '분당': '성남', '야탑': '성남', '정자': '성남',
  '일산': '고양', '화정': '고양', '행신': '고양', '삼송': '고양',
  '산본': '군포', '광교': '수원', '영통': '수원',
  '운정': '파주', '배곧': '시흥', '정왕': '시흥',
  '위례': '하남',
}

/**
 * Detects if the blog post TITLE mentions a different city/area within the service area.
 * Only triggers when the title has a competing city AND does NOT mention the place's own location.
 * This catches chain-store branch misattributions (e.g. "시흥 담솥" for 담솥 왕십리역점).
 */
function hasCompetingServiceAreaCity(
  title: string, addr: AddressComponents
): boolean {
  const titleL = title.toLowerCase()
  const fullAddr = `${addr.city} ${addr.district || ''} ${addr.dong || ''} ${addr.road || ''}`

  // Resolve the place's parent city (e.g. addr.city="화성" → also covers "동탄","병점")
  const ownCities = new Set<string>()
  for (const token of [addr.city, addr.district, addr.dong]) {
    if (token) ownCities.add(token)
  }
  // Add sub-area ↔ parent mappings for the place's city
  for (const [sub, parent] of Object.entries(SUB_AREA_TO_PARENT)) {
    if (ownCities.has(parent)) ownCities.add(sub) // 화성 → 동탄 also "own"
    if (fullAddr.includes(sub)) ownCities.add(parent) // 동탄 in addr → 화성 also "own"
  }

  // Check if title mentions the place's own location (any addr component)
  const ownTokens = [addr.city, addr.district, addr.dong, addr.road]
    .filter((t): t is string => !!t && t.length >= 2)
  const titleHasOwnLocation = ownTokens.some(t => titleL.includes(t.toLowerCase()))

  // If title already mentions the place's location, not a competing branch
  if (titleHasOwnLocation) return false

  // Check if title mentions a different service-area city
  for (const city of SERVICE_AREA_CITIES) {
    if (ownCities.has(city)) continue // same city/sub-area as the place
    if (titleL.includes(city)) return true
  }
  return false
}

function hasIrrelevantContentSignals(text: string): boolean {
  if (IRRELEVANT_CONTENT_TERMS.some((t) => text.includes(t))) return true
  if (dynamicBlacklistTerms.some((t) => text.includes(t))) return true
  return false
}

// ─── Layer 4b: Landmark reference detector ──────────────────────────────────

const LANDMARK_MARKERS = ['근처', '옆에', '앞에', '뒤에', '인근', '부근', '바로 옆', '맞은편']

function isLandmarkReference(placeName: string, text: string): boolean {
  const nameL = placeName.toLowerCase().replace(/\s+/g, '')
  for (const marker of LANDMARK_MARKERS) {
    if (text.includes(nameL + ' ' + marker) || text.includes(nameL + marker)) return true
    if (text.includes(marker + ' ' + nameL) || text.includes(marker + nameL)) return true
  }
  return false
}

/**
 * Compute relevance score (0~1) for a blog post relative to a specific place.
 * Uses address verification and negative signals to filter false positives.
 */
export function computePostRelevance(
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  title: string,
  snippet: string
): number {
  const text = `${title} ${snippet}`.toLowerCase()
  const nameL = placeName.toLowerCase()
  let score = 0

  // --- Positive signals ---

  // Place name in title (expected from search, reduced weight)
  if (title.toLowerCase().includes(nameL)) {
    score += 0.25
  } else if (text.includes(nameL)) {
    score += 0.15
  } else {
    // Partial name match for multi-word names
    const nameWords = nameL.split(/\s+/).filter((w) => w.length >= 2)
    const matchedWords = nameWords.filter((w) => text.includes(w))
    if (matchedWords.length > 0) {
      score += 0.10 * (matchedWords.length / nameWords.length)
    }
  }

  // Address component matches (strong location verification)
  if (addr.dong && text.includes(addr.dong)) {
    score += 0.30
  }
  if (addr.road && text.includes(addr.road)) {
    score += 0.20
  }
  if (addr.district && text.includes(addr.district)) {
    score += 0.10
  }

  // Baby/kids content bonus
  const babyTerms = ['아기', '유아', '아이', '키즈', '어린이', '유모차', '수유']
  if (babyTerms.some((t) => text.includes(t))) {
    score += 0.10
  }

  // Visit intent bonus (actual visit vs mere location reference)
  const VISIT_INTENT_TERMS = ['다녀왔', '방문했', '갔다왔', '놀러갔', '산책했', '나들이', '데리고 갔', '다녀온']
  if (VISIT_INTENT_TERMS.some((t) => text.includes(t))) {
    score += 0.10
  }

  // --- Negative signals ---

  // Mentions a different city/province (outside service area)
  if (hasCompetingLocation(text, addr.city)) {
    score -= 0.50
  }

  // Competing branch within service area (e.g. "시흥 담솥" for 담솥 왕십리역점)
  if (hasCompetingServiceAreaCity(title, addr)) {
    score -= 0.30
  }

  // Irrelevant content patterns (product reviews, real estate, spam)
  if (hasIrrelevantContentSignals(text)) {
    score -= 0.20
  }

  // Landmark reference pattern (place used as location marker, not visit target)
  const isLandmarkRef = isLandmarkReference(placeName, text)
  if (isLandmarkRef) {
    score -= 0.20
  }

  // Generic suffix places (어린이공원, 근린공원, etc.)
  const hasGenericSuffix = hasGenericPlaceSuffix(placeName)
  const hasDongMatch = addr.dong ? text.includes(addr.dong) : false
  const hasRoadMatch = addr.road ? text.includes(addr.road) : false

  if (hasGenericSuffix) {
    // Generic suffix + no address verification = likely noise
    if (!hasDongMatch && !hasRoadMatch) score -= 0.15
    // Landmark reference is extra damaging for generic-suffix places
    if (isLandmarkRef) score -= 0.20
  }

  // Common-word name without address verification
  if (isCommon && !addr.dong?.length && !addr.road?.length) {
    // No address components to verify — can't penalize for missing match
    // but also can't trust name-only match
    score = Math.min(score, 0.20)
  } else if (isCommon) {
    // Have address data but post doesn't mention dong or road
    if (!hasDongMatch && !hasRoadMatch) {
      score -= 0.25
    }
  }

  return Math.max(0, Math.min(score, 1.0))
}

/**
 * Atomically increments mention_count for a place.
 * Uses a DB-side function so concurrent calls never lose increments
 * (avoids the read-then-write race condition in the previous implementation).
 */
async function updateMentionCount(
  placeId: number, increment: number, latestPostDate?: string | null
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('increment_mention_count', {
    p_place_id: placeId,
    p_increment: increment,
    p_last_mentioned_at: latestPostDate || new Date().toISOString(),
  })

  if (error) {
    console.error(`[pipeline-b] Failed to increment mention_count for place ${placeId}:`, error)
  }
}

// ─── Method 2: Keyword search (Batches API) ─────────────────────────────────

/**
 * Phase 1: Collect blog data for all active keywords.
 * No LLM calls — just Naver Blog API fetches.
 * Uses supplementary pagination to skip already-analyzed URLs.
 */
async function collectAllKeywordBlogs(
  stats: PipelineBResult['keywordSearch']
): Promise<{ collected: CollectedKeywordData[]; sessionUrls: Set<string> }> {
  const currentMonth = new Date().getMonth() + 1
  const sessionUrls = new Set<string>()

  const { data: keywords, error } = await supabaseAdmin
    .from('keywords')
    .select(
      'id, keyword, status, efficiency_score, cycle_count, consecutive_zero_new, seasonal_months'
    )
    .eq('provider', 'naver')
    .in('status', ['NEW', 'ACTIVE', 'DECLINING', 'SEASONAL'])
    .or('keyword_group.is.null,keyword_group.neq.문화행사')
    .order('efficiency_score', { ascending: false })
    .limit(MAX_KEYWORDS_PER_RUN)

  if (error || !keywords) {
    console.error('[pipeline-b] Failed to fetch keywords:', error)
    stats.errors++
    return { collected: [], sessionUrls }
  }

  const collected: CollectedKeywordData[] = []

  for (const kw of keywords) {
    if (kw.status === 'SEASONAL') {
      const months: number[] = kw.seasonal_months ?? []
      if (!months.includes(currentMonth)) continue
    }

    try {
      const blogItems: BlogItemForLLM[] = []
      let totalApiResults = 0

      for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * DISPLAY_COUNT + 1
        const query = encodeURIComponent(kw.keyword)
        const url = `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&start=${start}&sort=sim`
        const items = await fetchNaverSearch<NaverBlogItem>(url)

        if (!items || items.length === 0) break
        totalApiResults += items.length

        // Filter out already-analyzed URLs (DB batch check + session memory)
        const pageUrls = items.map((i) => i.link).filter(Boolean)
        const { data: dbExisting } = await supabaseAdmin
          .from('llm_analyzed_urls')
          .select('url')
          .in('url', pageUrls)
        const dbSet = new Set((dbExisting ?? []).map((r: { url: string }) => r.url))

        let newInPage = 0
        for (const item of items) {
          if (!item.link || dbSet.has(item.link) || sessionUrls.has(item.link)) continue
          sessionUrls.add(item.link)
          blogItems.push({
            title: stripHtml(item.title),
            snippet: stripHtml(item.description).slice(0, 300),
            link: item.link,
            postdate: parseNaverPostDate(item.postdate),
          })
          newInPage++
        }

        // Yield check: stop if too few new URLs
        const yieldRate = items.length > 0 ? newInPage / items.length : 0
        if (yieldRate < MIN_YIELD) break
        if (blogItems.length >= TARGET_PER_KEYWORD) break
      }

      if (blogItems.length === 0) {
        await evaluateKeywordCycle(kw.id, totalApiResults, 0, 0)
        stats.keywordsProcessed++
        continue
      }

      collected.push({
        keywordId: kw.id,
        keyword: kw.keyword,
        blogItems,
        apiResults: totalApiResults,
      })
    } catch (err) {
      console.error(`[pipeline-b] Blog fetch error "${kw.keyword}":`, err)
      stats.errors++
    }
  }

  console.log(`[pipeline-b] Collected blogs for ${collected.length} keywords (${collected.reduce((s, d) => s + d.blogItems.length, 0)} new items, skipped ${sessionUrls.size} session URLs)`)
  return { collected, sessionUrls }
}

/**
 * Phase 2: Extract place names with Gemini Flash (sync) and process results.
 * Processes keywords in chunks with concurrency control (Tier 1: 150 RPM).
 */
async function extractAndProcessKeywords(
  allData: CollectedKeywordData[],
  stats: PipelineBResult['keywordSearch']
): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[pipeline-b] No GEMINI_API_KEY, skipping LLM extraction')
    return
  }

  // Build all LLM requests as (keywordData, chunkIndex) pairs
  const tasks: Array<{ data: CollectedKeywordData; chunkStart: number; chunk: BlogItemForLLM[] }> = []
  for (const data of allData) {
    for (let i = 0; i < data.blogItems.length; i += LLM_BATCH_SIZE) {
      tasks.push({ data, chunkStart: i, chunk: data.blogItems.slice(i, i + LLM_BATCH_SIZE) })
    }
  }

  console.log(`[pipeline-b] Gemini Flash extraction: ${tasks.length} requests for ${allData.length} keywords`)

  // Track per-keyword stats
  const kwStats = new Map<
    number,
    { newMentions: number; newCandidates: number; llmExtracted: number; kakaoValidated: number; duplicates: number }
  >()
  for (const data of allData) {
    kwStats.set(data.keywordId, {
      newMentions: 0, newCandidates: 0, llmExtracted: 0, kakaoValidated: 0, duplicates: 0,
    })
  }

  // Phase 2a: LLM extraction + persist to intermediate table
  const batchId = new Date().toISOString().replace(/[:.]/g, '-')
  const allExtractions: Array<{
    keywordId: number; keyword: string
    blogUrl: string; blogTitle: string; blogSnippet: string; blogPostdate: string | null
    extractedName: string; extractedAddr: string | null; llmConfidence: number | null
  }> = []

  for (let i = 0; i < tasks.length; i += LLM_CONCURRENCY) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, LLM_DELAY_MS))
    }

    const batch = tasks.slice(i, i + LLM_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((task) => extractPlaceNamesWithLLM(task.chunk, task.data.keyword))
    )

    for (let j = 0; j < results.length; j++) {
      const task = batch[j]
      const result = results[j]
      if (result.status !== 'fulfilled' || !result.value) continue

      for (const place of result.value) {
        if (!place.name) continue
        // Filter low-confidence extractions (generic nouns, vague names)
        if (place.c !== undefined && place.c < 0.6) continue
        const blogIdx = task.chunkStart + place.n - 1
        const sourceItem = task.data.blogItems[blogIdx]
        if (!sourceItem) continue

        allExtractions.push({
          keywordId: task.data.keywordId,
          keyword: task.data.keyword,
          blogUrl: sourceItem.link,
          blogTitle: sourceItem.title,
          blogSnippet: sourceItem.snippet.slice(0, 500),
          blogPostdate: sourceItem.postdate,
          extractedName: place.name,
          extractedAddr: place.addr,
          llmConfidence: place.c ?? null,
        })
      }
    }
  }

  // Persist LLM extraction results to intermediate table
  console.log(`[pipeline-b] Persisting ${allExtractions.length} LLM extractions (batch=${batchId})`)
  for (let i = 0; i < allExtractions.length; i += 500) {
    const rows = allExtractions.slice(i, i + 500).map((e) => ({
      batch_id: batchId,
      keyword_id: e.keywordId,
      keyword: e.keyword,
      blog_url: e.blogUrl,
      blog_title: e.blogTitle,
      blog_snippet: e.blogSnippet,
      blog_postdate: e.blogPostdate,
      extracted_name: e.extractedName,
      extracted_addr: e.extractedAddr,
      llm_confidence: e.llmConfidence,
    }))
    await supabaseAdmin.from('llm_extraction_results').insert(rows)
  }

  // Phase 2b: Process extractions (DB match + Kakao validation)
  await processExtractions(allExtractions, kwStats, stats, batchId)
  stats.llmExtracted = allExtractions.length

  // Count per-keyword llmExtracted from allExtractions
  for (const e of allExtractions) {
    const kStat = kwStats.get(e.keywordId)
    if (kStat) kStat.llmExtracted++
  }

  // Update keyword rotation stats
  for (const data of allData) {
    const kStat = kwStats.get(data.keywordId)!
    stats.keywordsProcessed++
    try {
      await evaluateKeywordCycle(
        data.keywordId,
        data.apiResults,
        kStat.newMentions + kStat.newCandidates,
        kStat.duplicates
      )
    } catch (err) {
      console.error(`[pipeline-b] Keyword eval error "${data.keyword}":`, err)
    }
    if (kStat.llmExtracted > 0) {
      console.log(
        `[pipeline-b] Keyword "${data.keyword}": extracted ${kStat.llmExtracted}, kakao ${kStat.kakaoValidated}, mentions ${kStat.newMentions}, candidates ${kStat.newCandidates}`
      )
    }
  }
}

// ─── Phase 2b: Process LLM extractions (DB match + Kakao) ─────────────────

interface ExtractionRecord {
  keywordId: number
  keyword: string
  blogUrl: string
  blogTitle: string
  blogSnippet: string
  blogPostdate: string | null
  extractedName: string
  extractedAddr: string | null
  llmConfidence?: number | null
}

async function processExtractions(
  extractions: ExtractionRecord[],
  kwStats: Map<number, { newMentions: number; newCandidates: number; llmExtracted: number; kakaoValidated: number; duplicates: number }>,
  stats: PipelineBResult['keywordSearch'],
  batchId?: string
): Promise<void> {
  // Step 1: Group by normalized name for dedup
  const nameGroups = new Map<string, ExtractionRecord[]>()
  for (const e of extractions) {
    const key = normalizePlaceName(e.extractedName)
    const group = nameGroups.get(key) ?? []
    group.push(e)
    nameGroups.set(key, group)
  }

  console.log(`[pipeline-b] processExtractions: ${extractions.length} items → ${nameGroups.size} unique names`)

  // Step 2: Process each unique name once
  let kakaoQuotaExhausted = false
  for (const [, group] of nameGroups) {
    const first = group[0]

    // DB match (once per unique name)
    const existingMatch = await findMatchingPlace(first.extractedName, first.extractedAddr, 0.8)
    if (existingMatch) {
      // Apply blog_mentions for all items in the group
      for (const e of group) {
        const kStat = kwStats.get(e.keywordId)
        if (!kStat) continue

        const { error } = await supabaseAdmin.from('blog_mentions').insert({
          place_id: existingMatch.placeId,
          source_type: 'naver_blog',
          title: e.blogTitle,
          url: e.blogUrl,
          post_date: e.blogPostdate,
          snippet: e.blogSnippet,
        })
        if (!error) {
          kStat.newMentions++
          stats.newMentions++
        } else if (error.code === '23505') {
          kStat.duplicates++
        }
      }
      // Increment mention count once for the whole group (use actual post dates)
      const maxPostDate = group.map(e => e.blogPostdate).filter(Boolean).sort().pop() ?? null
      await updateMentionCount(existingMatch.placeId, group.length, maxPostDate)

      // Track match result
      if (batchId) {
        await updateMatchResults(group, 'db_match', 1.0)
      }
      continue
    }

    // Kakao validation (once per unique name)
    if (kakaoQuotaExhausted) continue
    const kakaoResult = await validateWithKakao(first.extractedName, first.extractedAddr)
    if (kakaoResult === null) {
      // null = exception (likely quota exceeded) — stop Kakao calls
      kakaoQuotaExhausted = true
      console.warn(`[pipeline-b] Kakao validation error — skipping remaining ${nameGroups.size} names`)
      continue
    }
    if (kakaoResult?.validation) {
      // First item creates/updates the candidate; rest add source_urls
      for (const e of group) {
        const kStat = kwStats.get(e.keywordId)
        if (!kStat) continue

        kStat.kakaoValidated++
        stats.kakaoValidated++
        await upsertCandidate(
          kakaoResult.validation.name,
          kakaoResult.validation.address,
          e.blogUrl,
          kakaoResult.validation.lat,
          kakaoResult.validation.lng,
          kakaoResult.validation.kakaoPlaceId,
          kakaoResult.validation.similarity,
          {
            title: e.blogTitle,
            snippet: e.blogSnippet,
            post_date: e.blogPostdate,
            source_type: 'naver_blog',
            url: e.blogUrl,
          }
        )
        kStat.newCandidates++
        stats.newCandidates++
      }

      if (batchId) {
        await updateMatchResults(group, 'kakao_validated', kakaoResult.bestScore)
      }
    } else if (kakaoResult && batchId) {
      // Kakao search returned results but no valid match — track failure reason
      await updateMatchResults(group, kakaoResult.failureReason ?? 'kakao_error', kakaoResult.bestScore)
    }
  }
}

/** Batch-update match_result + kakao_best_score for a group of extractions. */
async function updateMatchResults(
  group: ExtractionRecord[],
  matchResult: string,
  bestScore: number
): Promise<void> {
  const urls = group.map((e) => e.blogUrl)
  await supabaseAdmin
    .from('llm_extraction_results')
    .update({ match_result: matchResult, kakao_best_score: bestScore })
    .in('blog_url', urls)
}

/**
 * Replay Kakao/DB matching from a saved batch in llm_extraction_results.
 * Skips LLM extraction and blog collection — just re-runs matching logic.
 */
export async function replayFromExtraction(
  batchId: string
): Promise<PipelineBResult['keywordSearch']> {
  const stats: PipelineBResult['keywordSearch'] = {
    keywordsProcessed: 0, newMentions: 0, newCandidates: 0,
    llmExtracted: 0, kakaoValidated: 0, errors: 0,
  }

  // Paginate to avoid Supabase default 1000-row limit
  const allRows: Record<string, unknown>[] = []
  let offset = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data: page, error: pageError } = await supabaseAdmin
      .from('llm_extraction_results')
      .select('*')
      .eq('batch_id', batchId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (pageError) {
      console.error(`[replay] Query error:`, pageError)
      break
    }
    if (!page || page.length === 0) break
    allRows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  if (allRows.length === 0) {
    console.error(`[replay] No extraction results for batch ${batchId}`)
    return stats
  }
  const rows = allRows

  console.log(`[replay] Loaded ${rows.length} extraction results from batch ${batchId}`)

  // Group by keyword for stats
  const kwIds = new Set<number>()
  const kwStats = new Map<
    number,
    { newMentions: number; newCandidates: number; llmExtracted: number; kakaoValidated: number; duplicates: number }
  >()

  const extractions: ExtractionRecord[] = rows.map((r: Record<string, unknown>) => {
    const kid = r.keyword_id as number
    kwIds.add(kid)
    if (!kwStats.has(kid)) {
      kwStats.set(kid, { newMentions: 0, newCandidates: 0, llmExtracted: 0, kakaoValidated: 0, duplicates: 0 })
    }
    return {
      keywordId: kid,
      keyword: r.keyword as string,
      blogUrl: r.blog_url as string,
      blogTitle: r.blog_title as string,
      blogSnippet: r.blog_snippet as string,
      blogPostdate: r.blog_postdate as string | null,
      extractedName: r.extracted_name as string,
      extractedAddr: r.extracted_addr as string | null,
    }
  })

  stats.llmExtracted = extractions.length
  await processExtractions(extractions, kwStats, stats, batchId)

  stats.keywordsProcessed = kwIds.size
  for (const [, kStat] of kwStats) {
    if (kStat.llmExtracted > 0 || kStat.kakaoValidated > 0) {
      console.log(
        `[replay] kakao ${kStat.kakaoValidated}, mentions ${kStat.newMentions}, candidates ${kStat.newCandidates}`
      )
    }
  }

  console.log(
    `[replay] Done: llmExtracted=${stats.llmExtracted}, dbMatch=${stats.newMentions}, kakaoValidated=${stats.kakaoValidated}, candidates=${stats.newCandidates}`
  )
  return stats
}

/** Counter for debug logging (first N requests per session). */
let llmDebugCounter = 0

/**
 * Call Gemini Flash to extract place names from a batch of blog items.
 */
async function extractPlaceNamesWithLLM(
  chunk: BlogItemForLLM[],
  keyword?: string
): Promise<LLMExtractedPlace[]> {
  const items = chunk.map((m, j) => ({
    n: j + 1,
    제목: m.title,
    내용: m.snippet.slice(0, 200),
  }))

  const keywordCtx = keyword ? `\n현재 검색 키워드: "${keyword}"` : ''

  const prompt = `당신은 블로그 포스트에서 아기/유아와 함께 갈 수 있는 장소의 고유 상호명을 추출합니다.${keywordCtx}

각 항목은 블로그 포스트의 제목+내용 요약입니다.

추출 규칙:
- 고유 상호명만 추출 (체인명+지점명 포함, 예: "맥도날드 왕십리역점", "코코몽키즈카페 성수점")
- 실제 방문 후기에서만 추출 (광고/리스트/추천모음 글은 skip)
- 주소 힌트가 있으면 함께 추출 (구/동/역 단위)
- c(확신도 0~1): 고유 상호명이 확실하면 0.9+, 불확실하면 0.5 이하

제외 대상 (반드시 name=null):
- 일반명사/카테고리: "키즈카페", "맛집", "놀이터", "동물원", "수영장", "도서관", "카페", "식당"
- 지역+카테고리: "강남 키즈카페", "홍대 맛집", "판교 카페"
- 시설 유형명: "실내놀이터", "문화센터", "무료체험관", "아기 수영장", "키즈풀"
- 프로그램/제품/서비스명: "아기 수영 클래스", "범보 의자", "문센 수업"
- 지역명 단독: "서울숲", "한강공원" (단, "서울숲놀이터"처럼 시설명이 붙으면 추출)

JSON 응답: [{"n":1,"name":"코코몽키즈카페","addr":"성동구 왕십리","c":0.95},{"n":2,"name":null}]
n=번호, name=장소명(없으면 null), addr=주소힌트(없으면 null), c=확신도(0~1)

${JSON.stringify(items, null, 0)}`

  try {
    const text = await extractWithGemini(prompt)

    // Debug logging for first 3 requests
    if (llmDebugCounter < 3) {
      console.log(`[pipeline-b] Gemini raw response #${llmDebugCounter + 1}: ${text.slice(0, 300)}`)
      llmDebugCounter++
    }

    // Strip markdown code block if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    let match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) {
      // Try to recover truncated JSON: find last complete object and close the array
      const truncatedMatch = cleaned.match(/\[[\s\S]*\}/)
      if (truncatedMatch) {
        const recovered = truncatedMatch[0] + ']'
        try {
          const parsed = JSON.parse(recovered)
          console.warn(`[pipeline-b] Recovered truncated JSON (${parsed.length} items)`)
          return parsed
        } catch {
          // Recovery failed
        }
      }
      console.warn(`[pipeline-b] JSON parse failed for chunk: no array found in response (${text.slice(0, 100)})`)
      return []
    }
    return JSON.parse(match[0])
  } catch (err) {
    console.warn(`[pipeline-b] JSON parse failed for chunk: ${err}`)
    return []
  }
}

// ─── Candidate upsert ─────────────────────────────────────────────────────────

interface BlogMetadata {
  title: string
  snippet: string
  post_date: string | null
  source_type: string
  url: string
}

async function upsertCandidate(
  name: string,
  address: string,
  sourceUrl: string,
  lat?: number,
  lng?: number,
  kakaoPlaceId?: string,
  kakaoSimilarity?: number,
  blogMeta?: BlogMetadata
): Promise<void> {
  // Check if candidate already exists
  const { data: existing } = await supabaseAdmin
    .from('place_candidates')
    .select('id, source_urls, source_count, source_metadata')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()

  if (existing) {
    const urls: string[] = existing.source_urls ?? []
    if (!urls.includes(sourceUrl)) {
      const metadata: BlogMetadata[] = existing.source_metadata ?? []
      if (blogMeta) metadata.push(blogMeta)

      const updateData: Record<string, unknown> = {
        source_urls: [...urls, sourceUrl],
        source_count: (existing.source_count ?? 1) + 1,
        source_metadata: metadata,
        last_seen_at: new Date().toISOString(),
      }
      // Fill in Kakao data if not already present and now available
      if (lat != null && lng != null) {
        updateData.lat = lat
        updateData.lng = lng
      }
      if (kakaoPlaceId) updateData.kakao_place_id = kakaoPlaceId
      if (kakaoSimilarity != null) updateData.kakao_similarity = kakaoSimilarity
      await supabaseAdmin
        .from('place_candidates')
        .update(updateData)
        .eq('id', existing.id)
    }
  } else {
    await supabaseAdmin.from('place_candidates').insert({
      name,
      address,
      source_urls: [sourceUrl],
      source_count: 1,
      source_metadata: blogMeta ? [blogMeta] : [],
      ...(lat != null && lng != null ? { lat, lng } : {}),
      ...(kakaoPlaceId ? { kakao_place_id: kakaoPlaceId } : {}),
      ...(kakaoSimilarity != null ? { kakao_similarity: kakaoSimilarity } : {}),
    })
  }
}

// ─── Kakao Place API validation ──────────────────────────────────────────────

interface KakaoValidation {
  kakaoPlaceId: string
  name: string
  address: string
  lat: number
  lng: number
  similarity: number
}

interface KakaoValidationResult {
  validation: KakaoValidation | null
  bestScore: number
  failureReason: string | null
}

/** Check coords first (precise), fallback to address text (approximate) */
function isMatchInServiceArea(match: { lat: number; lng: number; address: string }): boolean {
  return isInServiceArea(match.lat, match.lng) || isValidServiceAddress(match.address)
}

/**
 * Validates an LLM-extracted place name against Kakao Place API.
 * If addressHint is provided but fails, retries with name-only.
 * Always returns result info for tracking (validation=null on failure).
 */
async function validateWithKakao(
  name: string,
  addressHint: string | null
): Promise<KakaoValidationResult | null> {
  const searchOpts = {
    limiter: kakaoSearchLimiter,
    threshold: KAKAO_SIMILARITY_THRESHOLD,
    addressWords: 0 as number,
    rect: SERVICE_RECT,
  }

  try {
    // 1st attempt: name + addressHint
    const result1 = await searchKakaoPlaceDetailed(name, addressHint, searchOpts)

    if (result1.match && isMatchInServiceArea(result1.match)) {
      return {
        validation: toKakaoValidation(result1.match),
        bestScore: result1.bestScore,
        failureReason: null,
      }
    }

    // Check if match exists but is out of service area
    const result1OutOfArea = result1.match && !isMatchInServiceArea(result1.match)

    // 2nd attempt: retry without addressHint (addr may mislead search)
    if (addressHint) {
      const result2 = await searchKakaoPlaceDetailed(name, null, searchOpts)

      if (result2.match && isMatchInServiceArea(result2.match)) {
        return {
          validation: toKakaoValidation(result2.match),
          bestScore: result2.bestScore,
          failureReason: null,
        }
      }

      // Use the better result for failure tracking
      const best = result2.bestScore > result1.bestScore ? result2 : result1
      const outOfArea = result1OutOfArea || (result2.match && !isMatchInServiceArea(result2.match))
      return {
        validation: null,
        bestScore: best.bestScore,
        failureReason: classifyKakaoFailure(best, !!outOfArea),
      }
    }

    // No addressHint, single attempt failed
    return {
      validation: null,
      bestScore: result1.bestScore,
      failureReason: classifyKakaoFailure(result1, !!result1OutOfArea),
    }
  } catch (err) {
    console.error('[pipeline-b] Kakao validation error:', err)
    return null
  }
}

function toKakaoValidation(match: { id: string; name: string; address: string; roadAddress: string; lat: number; lng: number; similarity: number }): KakaoValidation {
  return {
    kakaoPlaceId: match.id,
    name: match.name,
    address: match.roadAddress || match.address,
    lat: match.lat,
    lng: match.lng,
    similarity: match.similarity,
  }
}

/** Classify why Kakao search failed. */
function classifyKakaoFailure(result: KakaoSearchResult, outOfArea: boolean): string {
  if (result.resultCount === 0) return 'kakao_no_results'
  if (outOfArea) return 'kakao_out_of_area'
  if (result.bestScore < KAKAO_SIMILARITY_THRESHOLD) return 'kakao_low_similarity'
  return 'kakao_out_of_area'
}


// ─── Naver API fetch ──────────────────────────────────────────────────────────

export async function fetchNaverSearch<T>(url: string): Promise<T[] | null> {
  try {
    const response = await naverLimiter.throttle(() =>
      fetch(url, {
        headers: {
          'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID ?? '',
          'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET ?? '',
        },
      })
    )

    if (!response.ok) {
      console.error(`[pipeline-b] Naver API HTTP ${response.status}`)
      return null
    }

    const data = (await response.json()) as NaverSearchResponse<T>
    return data.items ?? []
  } catch (err) {
    console.error('[pipeline-b] Naver fetch error:', err)
    return null
  }
}

// ─── Daum/Kakao API fetch ────────────────────────────────────────────────────

async function fetchDaumSearch(query: string): Promise<DaumBlogItem[] | null> {
  try {
    const encodedQuery = encodeURIComponent(query)
    const url = `${DAUM_BLOG_URL}?query=${encodedQuery}&size=${DISPLAY_COUNT}&sort=recency`

    const response = await kakaoSearchLimiter.throttle(() =>
      fetch(url, {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY ?? ''}`,
        },
      })
    )

    if (!response.ok) {
      console.error(`[pipeline-b] Daum Blog API HTTP ${response.status}`)
      return null
    }

    const data = (await response.json()) as DaumSearchResponse
    return data.documents ?? []
  } catch (err) {
    console.error('[pipeline-b] Daum Blog fetch error:', err)
    return null
  }
}

// ─── Text processing helpers ─────────────────────────────────────────────────

/** Strips HTML tags and decodes common HTML entities. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** Converts Naver's YYYYMMDD post date to ISO date string. */
export function parseNaverPostDate(postdate?: string): string | null {
  if (!postdate || postdate.length !== 8) return null
  const y = postdate.slice(0, 4)
  const mo = postdate.slice(4, 6)
  const d = postdate.slice(6, 8)
  return `${y}-${mo}-${d}`
}

