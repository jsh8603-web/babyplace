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

import { supabaseAdmin } from '../lib/supabase-admin'
import { naverLimiter, kakaoSearchLimiter } from '../rate-limiter'
import { findMatchingPlace } from '../matchers/duplicate'
import { isValidServiceAddress } from '../enrichers/region'

// ─── Naver API types ──────────────────────────────────────────────────────────

interface NaverBlogItem {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json'
const DAUM_BLOG_URL = 'https://dapi.kakao.com/v2/search/blog'

/** Number of places to reverse-search per pipeline run.
 *  Budget: each place = 2 API calls (naver blog + daum blog).
 *  Naver daily quota ~25K, Kakao search ~300K/month (~10K/day).
 *  4 runs/day × 500 = 4,000 calls per provider (well within budget). */
const REVERSE_SEARCH_BATCH = 500

/** Number of results per API call. */
const DISPLAY_COUNT = 30

/** Max keywords to cycle per run (budget: each keyword = 2 API calls). */
const MAX_KEYWORDS_PER_RUN = 60

// ─── Main export ──────────────────────────────────────────────────────────────

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
    errors: number
  }
}

export async function runPipelineB(): Promise<PipelineBResult> {
  const result: PipelineBResult = {
    reverseSearch: { placesProcessed: 0, newMentions: 0, errors: 0 },
    keywordSearch: {
      keywordsProcessed: 0,
      newMentions: 0,
      newCandidates: 0,
      errors: 0,
    },
  }

  const startedAt = Date.now()

  // --- Method 1: reverse search ---
  await runReverseSearch(result.reverseSearch)

  // --- Method 2: keyword search ---
  await runKeywordSearch(result.keywordSearch)

  // Log to collection_logs
  const totalNew =
    result.reverseSearch.newMentions + result.keywordSearch.newMentions
  const totalErrors =
    result.reverseSearch.errors + result.keywordSearch.errors

  await supabaseAdmin.from('collection_logs').insert({
    collector: 'pipeline-b-naver-blog',
    results_count: totalNew,
    new_places: result.keywordSearch.newCandidates,
    status: totalErrors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
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
 * Only inserts posts with relevance >= 0.3.
 * Returns number of new mentions inserted.
 */
async function reverseSearchPlace(
  placeId: number,
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean
): Promise<number> {
  const searchTerm = buildSearchTerm(placeName, addr, isCommon)
  let newCount = 0

  // --- Naver Blog ---
  newCount += await searchNaverBlog(placeId, placeName, addr, isCommon, searchTerm)

  // --- Daum Blog (Kakao) — covers 티스토리 + Daum 블로그 ---
  newCount += await searchDaumBlog(placeId, placeName, addr, isCommon, searchTerm)

  if (newCount > 0) {
    await updateMentionCount(placeId, newCount)
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
): Promise<number> {
  const query = encodeURIComponent(searchTerm)
  const items = await fetchNaverSearch<NaverBlogItem>(
    `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&sort=date`
  )
  if (!items) return 0

  let count = 0
  for (const item of items) {
    if (!item.link) continue
    const title = stripHtml(item.title)
    const snippet = stripHtml(item.description).slice(0, 500)
    const relevance = computePostRelevance(placeName, addr, isCommon, title, snippet)
    if (relevance < 0.3) continue

    const { error } = await supabaseAdmin.from('blog_mentions').insert({
      place_id: placeId,
      source_type: 'naver_blog',
      title,
      url: item.link,
      post_date: parseNaverPostDate(item.postdate),
      snippet,
      relevance_score: relevance,
    })
    if (!error) count++
  }
  return count
}

/** Search Daum/Kakao Blog API and insert relevant mentions. */
async function searchDaumBlog(
  placeId: number,
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  searchTerm: string
): Promise<number> {
  const items = await fetchDaumSearch(searchTerm)
  if (!items) return 0

  let count = 0
  for (const item of items) {
    if (!item.url) continue
    const title = stripHtml(item.title)
    const snippet = stripHtml(item.contents).slice(0, 500)
    const relevance = computePostRelevance(placeName, addr, isCommon, title, snippet)
    if (relevance < 0.3) continue

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
    if (!error) count++
  }
  return count
}

// ─── Layer 1: Address component parser ────────────────────────────────────────

interface AddressComponents {
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

const PRODUCT_REVIEW_TERMS = [
  '구매후기', '제품리뷰', '상품평', '배송후기', '가격비교', '할인코드',
  '쿠팡', '네이버쇼핑', '11번가', '지마켓', '옥션',
  '사용후기', '언박싱', '개봉기',
]

function hasCompetingLocation(text: string, ownCity: string): boolean {
  for (const loc of COMPETING_LOCATIONS) {
    if (loc === ownCity) continue
    if (text.includes(loc)) return true
  }
  return false
}

function hasProductReviewSignals(text: string): boolean {
  return PRODUCT_REVIEW_TERMS.some((t) => text.includes(t))
}

/**
 * Compute relevance score (0~1) for a blog post relative to a specific place.
 * Uses address verification and negative signals to filter false positives.
 */
function computePostRelevance(
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

  // --- Negative signals ---

  // Mentions a different city/province
  if (hasCompetingLocation(text, addr.city)) {
    score -= 0.50
  }

  // Product review patterns
  if (hasProductReviewSignals(text)) {
    score -= 0.20
  }

  // Common-word name without address verification
  if (isCommon && !addr.dong?.length && !addr.road?.length) {
    // No address components to verify — can't penalize for missing match
    // but also can't trust name-only match
    score = Math.min(score, 0.20)
  } else if (isCommon) {
    // Have address data but post doesn't mention dong or road
    const hasDongMatch = addr.dong ? text.includes(addr.dong) : false
    const hasRoadMatch = addr.road ? text.includes(addr.road) : false
    if (!hasDongMatch && !hasRoadMatch) {
      score -= 0.25
    }
  }

  return Math.max(0, Math.min(score, 1.0))
}

/** @deprecated Use parseAddressComponents instead */
function extractDistrict(address: string): string {
  if (!address) return ''
  const match = address.match(/([가-힣]+)[시군구]\b/)
  return match ? match[1] : ''
}

/**
 * Atomically increments mention_count for a place.
 * Uses a DB-side function so concurrent calls never lose increments
 * (avoids the read-then-write race condition in the previous implementation).
 */
async function updateMentionCount(placeId: number, increment: number): Promise<void> {
  const { error } = await supabaseAdmin.rpc('increment_mention_count', {
    p_place_id: placeId,
    p_increment: increment,
    p_last_mentioned_at: new Date().toISOString(),
  })

  if (error) {
    console.error(`[pipeline-b] Failed to increment mention_count for place ${placeId}:`, error)
  }
}

// ─── Method 2: Keyword search ─────────────────────────────────────────────────

async function runKeywordSearch(
  stats: PipelineBResult['keywordSearch']
): Promise<void> {
  const currentMonth = new Date().getMonth() + 1 // 1-12

  // Select active/new keywords, skipping exhausted ones
  // Also activate seasonal keywords whose season is now
  const { data: keywords, error } = await supabaseAdmin
    .from('keywords')
    .select(
      'id, keyword, status, efficiency_score, cycle_count, consecutive_zero_new, seasonal_months'
    )
    .eq('provider', 'naver')
    .in('status', ['NEW', 'ACTIVE', 'DECLINING', 'SEASONAL'])
    .order('efficiency_score', { ascending: false })
    .limit(MAX_KEYWORDS_PER_RUN)

  if (error || !keywords) {
    console.error('[pipeline-b] Failed to fetch keywords:', error)
    stats.errors++
    return
  }

  for (const kw of keywords) {
    // Skip SEASONAL if not in season
    if (kw.status === 'SEASONAL') {
      const months: number[] = kw.seasonal_months ?? []
      if (!months.includes(currentMonth)) continue
    }

    try {
      const result = await processKeyword(kw.id, kw.keyword)
      stats.newMentions += result.newMentions
      stats.newCandidates += result.newCandidates
      stats.keywordsProcessed++

      // Update keyword efficiency metrics
      await updateKeywordMetrics(kw, result)
    } catch (err) {
      console.error(`[pipeline-b] Keyword error "${kw.keyword}":`, err)
      stats.errors++
    }
  }
}

interface KeywordProcessResult {
  apiResults: number
  newMentions: number
  newCandidates: number
  duplicates: number
}

async function processKeyword(
  keywordId: number,
  keyword: string
): Promise<KeywordProcessResult> {
  const result: KeywordProcessResult = {
    apiResults: 0,
    newMentions: 0,
    newCandidates: 0,
    duplicates: 0,
  }

  const query = encodeURIComponent(keyword)
  const url = `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&sort=sim`

  const items = await fetchNaverSearch<NaverBlogItem>(url)
  if (!items) return result

  result.apiResults = items.length

  for (const item of items) {
    const text = stripHtml(item.title + ' ' + item.description)

    // Try to extract a place name from the blog content
    const extractedNames = extractPlaceNamesFromText(keyword, text)

    for (const name of extractedNames) {
      // Try to match to existing place
      const match = await findMatchingPlace(name, null, 0.8)

      if (match) {
        // Link this blog post to the matched place
        const { error } = await supabaseAdmin.from('blog_mentions').insert({
          place_id: match.placeId,
          source_type: 'naver_blog',
          title: stripHtml(item.title),
          url: item.link,
          post_date: parseNaverPostDate(item.postdate),
          snippet: stripHtml(item.description).slice(0, 500),
        })

        if (!error) {
          result.newMentions++
          await updateMentionCount(match.placeId, 1)
        } else if (error.code !== '23505') {
          // Non-duplicate error
        } else {
          result.duplicates++
        }
      } else {
        // No existing match → create a candidate if address looks valid
        const addressInText = extractAddressFromText(text)
        if (addressInText && isValidServiceAddress(addressInText)) {
          await upsertCandidate(name, addressInText, item.link)
          result.newCandidates++
        }
      }
    }
  }

  // Log keyword cycle
  await supabaseAdmin.from('keyword_logs').insert({
    keyword_id: keywordId,
    api_results: result.apiResults,
    new_places: result.newMentions + result.newCandidates,
    duplicates: result.duplicates,
  })

  return result
}

// ─── Candidate upsert ─────────────────────────────────────────────────────────

async function upsertCandidate(
  name: string,
  address: string,
  sourceUrl: string
): Promise<void> {
  // Check if candidate already exists
  const { data: existing } = await supabaseAdmin
    .from('place_candidates')
    .select('id, source_urls, source_count')
    .ilike('name', name)
    .limit(1)
    .maybeSingle()

  if (existing) {
    const urls: string[] = existing.source_urls ?? []
    if (!urls.includes(sourceUrl)) {
      await supabaseAdmin
        .from('place_candidates')
        .update({
          source_urls: [...urls, sourceUrl],
          source_count: (existing.source_count ?? 1) + 1,
          last_seen_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    }
  } else {
    await supabaseAdmin.from('place_candidates').insert({
      name,
      address,
      source_urls: [sourceUrl],
      source_count: 1,
    })
  }
}

// ─── Keyword metrics update ───────────────────────────────────────────────────

interface KeywordRow {
  id: number
  keyword: string
  status: string
  efficiency_score: number
  cycle_count: number
  consecutive_zero_new: number
  seasonal_months: number[] | null
}

async function updateKeywordMetrics(
  kw: KeywordRow,
  result: KeywordProcessResult
): Promise<void> {
  const yieldRate =
    result.apiResults > 0
      ? (result.newMentions + result.newCandidates) / result.apiResults
      : 0
  const duplicateRatio =
    result.apiResults > 0 ? result.duplicates / result.apiResults : 0

  // Simple efficiency formula (plan.md 9-1)
  const newCycleCount = kw.cycle_count + 1
  const newConsecZero =
    result.newMentions + result.newCandidates === 0
      ? kw.consecutive_zero_new + 1
      : 0

  const efficiency =
    0.4 * yieldRate * (1 - duplicateRatio) +
    0.25 * Math.max(0, 1 - duplicateRatio) +
    0.2 * Math.exp(-newCycleCount / 10) +
    0.15 * (1 - newConsecZero * 0.3)

  // State transitions (plan.md 9-2)
  let newStatus = kw.status
  if (kw.status !== 'SEASONAL') {
    if (efficiency >= 0.3) newStatus = 'ACTIVE'
    else if (efficiency >= 0.1) newStatus = 'DECLINING'
    else if (efficiency < 0.1 || newConsecZero >= 3) newStatus = 'EXHAUSTED'
  }

  // Fetch current counters before updating
  const { data: current } = await supabaseAdmin
    .from('keywords')
    .select('total_results, new_places_found')
    .eq('id', kw.id)
    .single()

  await supabaseAdmin
    .from('keywords')
    .update({
      efficiency_score: Math.round(efficiency * 1000) / 1000,
      cycle_count: newCycleCount,
      consecutive_zero_new: newConsecZero,
      duplicate_ratio: Math.round(duplicateRatio * 1000) / 1000,
      total_results: (current?.total_results ?? 0) + result.apiResults,
      new_places_found:
        (current?.new_places_found ?? 0) +
        result.newMentions +
        result.newCandidates,
      status: newStatus,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', kw.id)
}

// ─── Naver API fetch ──────────────────────────────────────────────────────────

async function fetchNaverSearch<T>(url: string): Promise<T[] | null> {
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
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * Attempts to extract place name candidates from blog text.
 * Uses the search keyword as context to anchor extraction.
 */
function extractPlaceNamesFromText(keyword: string, text: string): string[] {
  const names: string[] = []

  // Pattern 1: look for quoted names near the keyword context
  // e.g. "코코몽에코파크" or 『키즈카페 아무개』
  const quoteMatterns = [
    /[「『"']([가-힣a-zA-Z0-9\s]{2,20})[」』"']/g,
    /\[([가-힣a-zA-Z0-9\s]{2,20})\]/g,
  ]

  for (const pattern of quoteMatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const candidate = m[1].trim()
      if (candidate.length >= 2) names.push(candidate)
    }
  }

  // Pattern 2: keyword itself often IS the place name in title
  // e.g. "키즈카페 코코몽 후기" → extract "코코몽"
  const keywordParts = keyword.split(/\s+/)
  for (const part of keywordParts) {
    if (part.length >= 2) names.push(keyword)
  }

  // Deduplicate
  return [...new Set(names)]
}

/**
 * Attempts to extract a district-level address from blog text.
 * Returns the first recognized Seoul/Gyeonggi address pattern.
 */
function extractAddressFromText(text: string): string | null {
  const addressPattern =
    /(서울|경기|인천)[^\s]*?\s*[가-힣]+[구군시]\s*[가-힣]+[동읍면]?/
  const m = addressPattern.exec(text)
  return m ? m[0].trim() : null
}

/** Converts Naver's YYYYMMDD post date to ISO date string. */
function parseNaverPostDate(postdate?: string): string | null {
  if (!postdate || postdate.length !== 8) return null
  const y = postdate.slice(0, 4)
  const mo = postdate.slice(4, 6)
  const d = postdate.slice(6, 8)
  return `${y}-${mo}-${d}`
}

/** Returns true if the text contains advertisement signals. */
function isAdvertisement(text: string): boolean {
  const adPatterns = ['협찬', '제공받아', '광고', '유료광고', '제품을 받아']
  return adPatterns.some((p) => text.includes(p))
}
