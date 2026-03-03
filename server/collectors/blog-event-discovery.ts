/**
 * Blog Event Discovery — Naver blog search → Gemini extraction → events table
 *
 * Discovers baby/child events not listed in public APIs (Tour API, Seoul Events)
 * by searching Naver blogs for event keywords and extracting structured data with LLM.
 *
 * Flow:
 *   1. Fetch keywords with keyword_group='문화행사' from keywords table
 *   2. Search Naver Blog API per keyword (30 results × 3 pages)
 *   3. Extract event info with Gemini Flash (name, venue, dates, confidence)
 *   4. Deduplicate against existing events table (name similarity)
 *   5. Validate venue with Kakao Place API (coordinates)
 *   6. Insert new events (source='blog_discovery')
 */

import { extractWithGemini } from '../lib/gemini'
import { supabaseAdmin } from '../lib/supabase-admin'
import { kakaoSearchLimiter } from '../rate-limiter'
import { fetchNaverSearch, stripHtml } from './naver-blog'
import { searchKakaoPlaceDetailed } from '../lib/kakao-search'
import { similarity, normalizePlaceName } from '../matchers/similarity'
import { classifyEventByTitle } from '../utils/event-classifier'
import { isInServiceArea, isValidServiceAddress } from '../enrichers/region'

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_EVENT_KEYWORDS = 30
const DISPLAY_COUNT = 30
const MAX_PAGES = 3
const LLM_BATCH_SIZE = 20
const LLM_CONCURRENCY = 4
const LLM_DELAY_MS = 2000
const CONFIDENCE_THRESHOLD = 0.8
const EVENT_SIMILARITY_THRESHOLD = 0.7
const DEFAULT_DURATION_DAYS = 30
const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog'

interface NaverBlogItem {
  title: string
  link: string
  description: string
  bloggername: string
  postdate?: string
}

interface ExtractedEvent {
  event: string
  venue: string
  addr: string
  dates: string
  c: number
}

export interface BlogEventDiscoveryResult {
  keywordsProcessed: number
  blogPostsFetched: number
  eventsExtracted: number
  duplicatesSkipped: number
  venueValidated: number
  regionSkipped: number
  eventsInserted: number
  errors: number
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function runBlogEventDiscovery(): Promise<BlogEventDiscoveryResult> {
  const result: BlogEventDiscoveryResult = {
    keywordsProcessed: 0,
    blogPostsFetched: 0,
    eventsExtracted: 0,
    duplicatesSkipped: 0,
    venueValidated: 0,
    regionSkipped: 0,
    eventsInserted: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[blog-event] Missing GEMINI_API_KEY, skipping')
      return result
    }

    // Step 1: Fetch event keywords
    const keywords = await fetchEventKeywords()
    if (keywords.length === 0) {
      console.log('[blog-event] No event keywords found')
      return result
    }
    console.log(`[blog-event] Found ${keywords.length} event keywords`)

    // Step 2: Collect blog posts
    const posts = await collectBlogPosts(keywords, result)
    console.log(`[blog-event] Collected ${posts.length} blog posts`)

    if (posts.length === 0) return result

    // Step 3: Extract events with LLM
    const extracted = await extractEventsWithLLM(posts, result)
    console.log(`[blog-event] Extracted ${extracted.length} candidate events`)

    if (extracted.length === 0) return result

    // Step 4: Deduplicate against existing events
    const fresh = await deduplicateAgainstDB(extracted, result)
    console.log(`[blog-event] ${fresh.length} new events after dedup`)

    // Pre-fetch known source_ids to avoid N+1 queries (seoul-events.ts pattern)
    const knownSourceIds = await prefetchKnownSourceIds()
    console.log(`[blog-event] Pre-fetched ${knownSourceIds.size} known source_ids`)

    // Step 5+6: Validate venue + insert
    for (const event of fresh) {
      try {
        await validateAndInsert(event, result, knownSourceIds)
      } catch (err) {
        console.error('[blog-event] Insert error:', err)
        result.errors++
      }
    }

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'blog-event-discovery',
      results_count: result.blogPostsFetched,
      new_events: result.eventsInserted,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[blog-event] Fatal error:', err)
    result.errors++

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'blog-event-discovery',
      status: 'error',
      error: String(err),
      duration_ms: Date.now() - startedAt,
    })
  }

  return result
}

// ─── Step 1: Fetch event keywords ───────────────────────────────────────────

async function fetchEventKeywords(): Promise<{ id: number; keyword: string }[]> {
  const { data, error } = await supabaseAdmin
    .from('keywords')
    .select('id, keyword')
    .eq('provider', 'naver')
    .eq('keyword_group', '문화행사')
    .in('status', ['NEW', 'ACTIVE'])
    .limit(MAX_EVENT_KEYWORDS)

  if (error || !data) {
    console.error('[blog-event] Failed to fetch keywords:', error)
    return []
  }

  return data
}

// ─── Step 2: Collect blog posts ─────────────────────────────────────────────

interface BlogPost {
  keyword: string
  title: string
  snippet: string
  postdate: string
}

async function collectBlogPosts(
  keywords: { id: number; keyword: string }[],
  result: BlogEventDiscoveryResult
): Promise<BlogPost[]> {
  const posts: BlogPost[] = []
  const seenUrls = new Set<string>()
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10).replace(/-/g, '')

  for (const kw of keywords) {
    result.keywordsProcessed++

    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * DISPLAY_COUNT + 1
      const query = encodeURIComponent(kw.keyword)
      const url = `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&start=${start}&sort=date`

      const items = await fetchNaverSearch<NaverBlogItem>(url)
      if (!items || items.length === 0) break

      for (const item of items) {
        // Skip old posts
        if (item.postdate && item.postdate < cutoff) continue

        // Deduplicate by URL within session
        if (seenUrls.has(item.link)) continue
        seenUrls.add(item.link)

        posts.push({
          keyword: kw.keyword,
          title: stripHtml(item.title),
          snippet: stripHtml(item.description).slice(0, 500),
          postdate: item.postdate || '',
        })
        result.blogPostsFetched++
      }

      // Stop paginating if fewer than expected
      if (items.length < DISPLAY_COUNT) break
    }
  }

  return posts
}

// ─── Step 3: Extract events with LLM ───────────────────────────────────────

async function extractEventsWithLLM(
  posts: BlogPost[],
  result: BlogEventDiscoveryResult
): Promise<ExtractedEvent[]> {
  const allEvents: ExtractedEvent[] = []
  const batches: BlogPost[][] = []

  for (let i = 0; i < posts.length; i += LLM_BATCH_SIZE) {
    batches.push(posts.slice(i, i + LLM_BATCH_SIZE))
  }

  console.log(`[blog-event] LLM extraction: ${posts.length} posts in ${batches.length} batches`)

  for (let i = 0; i < batches.length; i += LLM_CONCURRENCY) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, LLM_DELAY_MS))
    }

    const chunk = batches.slice(i, i + LLM_CONCURRENCY)
    const promises = chunk.map((batch) => extractBatch(batch))
    const results = await Promise.allSettled(promises)

    for (const r of results) {
      if (r.status === 'fulfilled') {
        allEvents.push(...r.value)
      } else {
        console.error('[blog-event] LLM batch error:', r.reason)
        result.errors++
      }
    }
  }

  result.eventsExtracted = allEvents.length
  return allEvents
}

async function extractBatch(posts: BlogPost[]): Promise<ExtractedEvent[]> {
  const items = posts.map((p, i) => ({
    n: i + 1,
    title: p.title,
    snippet: p.snippet,
  }))

  const prompt = `블로그 포스팅에서 아기/어린이 대상 이벤트 정보를 추출하세요.

추출 대상: 캐릭터/테마 전시, 팝업스토어, 어린이 공연/뮤지컬/인형극, 유아/가족 축제/체험전, 키즈카페 특별 이벤트
명시적 제외: 상설 시설(키즈카페 일반 영업, 놀이공원 상시 운영), 제품 리뷰, 육아 정보글, 성인 전시/공연

각 포스팅에서 이벤트를 발견하면 아래 필드로 추출:
- event: 이벤트 공식 명칭
- venue: 장소명 (건물/전시장)
- addr: 주소 힌트 (구/동 수준)
- dates: 기간 (YYYY-MM-DD~YYYY-MM-DD 또는 빈 문자열)
- c: 확신도 (0.0~1.0, 실제 기간제 이벤트 확실할수록 높음)

이벤트가 없는 포스팅은 건너뛰세요. 같은 이벤트가 여러 포스팅에 있으면 1번만.

${JSON.stringify(items, null, 0)}

JSON 배열만 응답: [{"event":"...","venue":"...","addr":"...","dates":"...","c":0.9}, ...]`

  try {
    const text = await extractWithGemini(prompt)
    const parsed = JSON.parse(text) as ExtractedEvent[]
    return parsed.filter((e) => e.c >= CONFIDENCE_THRESHOLD && e.event && e.venue)
  } catch (err) {
    console.error('[blog-event] Extract batch parse error:', err)
    return []
  }
}

// ─── Step 4: Deduplicate against DB ─────────────────────────────────────────

async function deduplicateAgainstDB(
  events: ExtractedEvent[],
  result: BlogEventDiscoveryResult
): Promise<ExtractedEvent[]> {
  // Fetch active events from DB for similarity comparison
  const { data: existingEvents } = await supabaseAdmin
    .from('events')
    .select('name')
    .gte('end_date', new Date().toISOString().split('T')[0])

  const existingNames = (existingEvents || []).map((e) => normalizePlaceName(e.name))

  // Also deduplicate within the extracted batch
  const seen = new Set<string>()
  const fresh: ExtractedEvent[] = []

  for (const event of events) {
    const normalized = normalizePlaceName(event.event)

    // Skip if we already have this event in our batch
    if (seen.has(normalized)) {
      result.duplicatesSkipped++
      continue
    }

    // Check similarity against DB events
    let isDuplicate = false
    for (const existing of existingNames) {
      if (similarity(normalized, existing) > EVENT_SIMILARITY_THRESHOLD) {
        isDuplicate = true
        break
      }
    }

    if (isDuplicate) {
      result.duplicatesSkipped++
      continue
    }

    seen.add(normalized)
    fresh.push(event)
  }

  return fresh
}

// ─── Step 5+6: Validate venue + insert ──────────────────────────────────────

async function validateAndInsert(
  event: ExtractedEvent,
  result: BlogEventDiscoveryResult,
  knownSourceIds: Set<string>
): Promise<void> {
  // Build source_id for UNIQUE constraint
  const sourceId = `blog_${normalizePlaceName(event.event)}_${normalizePlaceName(event.venue)}`

  // Check existing by source_id (memory lookup instead of DB query)
  if (knownSourceIds.has(sourceId)) {
    result.duplicatesSkipped++
    return
  }

  // Validate venue with Kakao
  let lat: number | null = null
  let lng: number | null = null
  let venueAddress: string | null = null

  const kakaoResult = await searchKakaoPlaceDetailed(
    event.venue,
    event.addr || null,
    { limiter: kakaoSearchLimiter, threshold: 0.5 }
  )

  if (kakaoResult.match) {
    // Region validation: Kakao match must be within service area
    if (!isInServiceArea(kakaoResult.match.lat, kakaoResult.match.lng)) {
      result.regionSkipped++
      return
    }
    lat = kakaoResult.match.lat
    lng = kakaoResult.match.lng
    venueAddress = kakaoResult.match.roadAddress || kakaoResult.match.address
    result.venueValidated++
  } else if (!isValidServiceAddress(event.addr || '')) {
    // No Kakao match + no service area address hint → skip
    result.regionSkipped++
    return
  }

  // Parse dates
  const { startDate, endDate } = parseDates(event.dates)

  const eventData = {
    name: event.event,
    category: '문화행사',
    sub_category: classifyEventByTitle(event.event),
    venue_name: event.venue,
    venue_address: venueAddress,
    lat,
    lng,
    start_date: startDate,
    end_date: endDate,
    time_info: null,
    price_info: null,
    age_range: null,
    source: 'blog_discovery',
    source_id: sourceId,
    source_url: null,
    poster_url: null,
    description: null,
  }

  const { error } = await supabaseAdmin.from('events').insert(eventData)

  if (error) {
    if (error.code === '23505') {
      result.duplicatesSkipped++
    } else {
      console.error('[blog-event] Insert error:', error.message, sourceId)
      result.errors++
    }
  } else {
    result.eventsInserted++
  }
}

// ─── Source ID prefetch (seoul-events.ts pattern) ───────────────────────────

async function prefetchKnownSourceIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  const batchSize = 1000

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('events')
      .select('source_id')
      .eq('source', 'blog_discovery')
      .range(offset, offset + batchSize - 1)

    if (error) {
      console.error('[blog-event] Prefetch error:', error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.source_id) ids.add(row.source_id)
    }

    if (data.length < batchSize) break
    offset += batchSize
  }

  return ids
}

// ─── Date parsing ───────────────────────────────────────────────────────────

function parseDates(dates: string): { startDate: string; endDate: string } {
  const today = new Date()
  const defaultStart = today.toISOString().split('T')[0]
  const defaultEnd = new Date(today.getTime() + DEFAULT_DURATION_DAYS * 86400000)
    .toISOString()
    .split('T')[0]

  if (!dates) return { startDate: defaultStart, endDate: defaultEnd }

  // Try YYYY-MM-DD~YYYY-MM-DD format
  const rangeMatch = dates.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/)
  if (rangeMatch) {
    return { startDate: rangeMatch[1], endDate: rangeMatch[2] }
  }

  // Try single date
  const singleMatch = dates.match(/(\d{4}-\d{2}-\d{2})/)
  if (singleMatch) {
    const end = new Date(new Date(singleMatch[1]).getTime() + DEFAULT_DURATION_DAYS * 86400000)
      .toISOString()
      .split('T')[0]
    return { startDate: singleMatch[1], endDate: end }
  }

  return { startDate: defaultStart, endDate: defaultEnd }
}
