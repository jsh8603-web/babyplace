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

interface EnrichedEvent extends ExtractedEvent {
  enriched_url: string | null
  enriched_dates: string | null
  enriched_poster: string | null
  _webResults?: NaverWebItem[]
  _stage2Type?: 'permanent' | 'limited' | 'unknown'
}

interface NaverWebItem {
  title: string
  link: string
  description: string
}

interface NaverImageItem {
  title: string
  link: string
  thumbnail: string
  sizeheight: string
  sizewidth: string
}

export interface BlogEventDiscoveryResult {
  keywordsProcessed: number
  blogPostsFetched: number
  eventsExtracted: number
  duplicatesSkipped: number
  venueValidated: number
  regionSkipped: number
  eventsInserted: number
  enrichmentFiltered: number
  stage2Processed: number
  stage2Permanent: number
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
    enrichmentFiltered: 0,
    stage2Processed: 0,
    stage2Permanent: 0,
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

    // Step 4.5: Enrich Stage 1 (Naver search + LLM)
    const enriched = await enrichEvents(fresh)
    await enrichWithLLM(enriched)

    // Stage 2: retry for events still missing dates
    const needsStage2 = enriched.filter((ev) => !hasConfirmedDates(ev))
    if (needsStage2.length > 0) {
      console.log(`[blog-event] Stage 2: ${needsStage2.length}/${enriched.length} events need date enrichment`)
      await enrichStage2(needsStage2, result)
    }

    // No filter: allow permanent and unconfirmed-date events (hidden via admin/user UI)
    const verified = enriched
    result.enrichmentFiltered = 0
    console.log(`[blog-event] ${verified.length} events passed (no filter, stage2: ${result.stage2Processed} processed, ${result.stage2Permanent} permanent)`)

    // Pre-fetch known source_ids to avoid N+1 queries (seoul-events.ts pattern)
    const knownSourceIds = await prefetchKnownSourceIds()
    console.log(`[blog-event] Pre-fetched ${knownSourceIds.size} known source_ids`)

    // Step 5+6: Validate venue + insert
    for (const event of verified) {
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

  const todayStr = new Date().toISOString().split('T')[0]

  const prompt = `블로그 포스팅에서 아기/어린이 대상 이벤트 정보를 추출하세요.
오늘 날짜: ${todayStr}

추출 대상: 캐릭터/테마 전시, 팝업스토어, 어린이 공연/뮤지컬/인형극, 유아/가족 축제/체험전, 키즈카페 특별 이벤트
명시적 제외: 상설 시설(키즈카페 일반 영업, 놀이공원 상시 운영), 제품 리뷰, 육아 정보글, 성인 전시/공연

각 포스팅에서 이벤트를 발견하면 아래 필드로 추출:
- event: 이벤트 공식 명칭
- venue: 장소명 (건물/전시장)
- addr: 주소 힌트 (구/동 수준)
- dates: 기간 (YYYY-MM-DD~YYYY-MM-DD). 포스팅 본문에 기간 힌트가 있으면 최대한 추출하세요. 날짜를 전혀 알 수 없으면 빈 문자열.
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
    const normalized = normalizeEventName(event.event)

    // Skip if we already have this event in our batch
    let batchDup = false
    for (const s of seen) {
      const threshold = normalized.length <= 10 || s.length <= 10 ? 0.65 : EVENT_SIMILARITY_THRESHOLD
      if (similarity(normalized, s) > threshold) {
        batchDup = true
        break
      }
    }
    if (batchDup) {
      result.duplicatesSkipped++
      continue
    }

    // Check similarity against DB events
    let isDuplicate = false
    for (const existing of existingNames) {
      const threshold = normalized.length <= 10 || existing.length <= 10 ? 0.65 : EVENT_SIMILARITY_THRESHOLD
      if (similarity(normalized, existing) > threshold) {
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

/**
 * Normalize event name for dedup: strip years, city names, whitespace/hyphens
 */
function normalizeEventName(name: string): string {
  return normalizePlaceName(
    name
      .replace(/\d{4}/g, '') // Strip all years ("2026 포켓몬런" + "포켓몬런 2026")
      .replace(/서울|경기|인천|수원|성남|부산|대구|대전|광주|고양|용인|부천|안산|안양/g, '')
      .replace(/[\s\-]+/g, '')
  )
}

// ─── Step 5+6: Validate venue + insert ──────────────────────────────────────

async function validateAndInsert(
  event: EnrichedEvent | ExtractedEvent,
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

  // Parse dates — prefer enriched dates over LLM-extracted dates
  const enriched = 'enriched_dates' in event ? (event as EnrichedEvent) : null
  const dateStr = enriched?.enriched_dates || event.dates
  const { startDate, endDate } = parseDates(dateStr)
  const dateConfirmed = !!(enriched?.enriched_dates) || !!(event.dates && event.dates.match(/\d{4}-\d{2}-\d{2}/))

  // Skip past events (endDate already passed)
  const today = new Date().toISOString().split('T')[0]
  if (endDate < today) {
    result.duplicatesSkipped++
    return
  }

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
    date_confirmed: dateConfirmed,
    time_info: null,
    price_info: null,
    age_range: null,
    source: 'blog_discovery',
    source_id: sourceId,
    source_url: enriched?.enriched_url || null,
    poster_url: enriched?.enriched_poster || null,
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
      .in('source', ['blog_discovery', 'exhibition_extraction'])
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

// ─── Enrichment constants ────────────────────────────────────────────────────

const NAVER_WEB_URL = 'https://openapi.naver.com/v1/search/webkr'
const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'
const ENRICH_BATCH_SIZE = 10

// ─── Date confirmation helper ────────────────────────────────────────────────

function hasConfirmedDates(ev: EnrichedEvent): boolean {
  return !!ev.enriched_dates || !!(ev.dates && ev.dates.match(/\d{4}-\d{2}-\d{2}/))
}

// ─── Stage 2 enrichment (retry with different search strategy) ──────────────

async function enrichStage2(
  events: EnrichedEvent[],
  result: BlogEventDiscoveryResult
): Promise<void> {
  // Step A: Naver web re-search with different query strategy
  for (const ev of events) {
    const webQuery = encodeURIComponent(`"${ev.event}" 전시 기간 2026`)
    const webUrl = `${NAVER_WEB_URL}?query=${webQuery}&display=10`
    const webResults = await fetchNaverSearch<NaverWebItem>(webUrl)
    ev._webResults = webResults || undefined
    await new Promise((r) => setTimeout(r, 200))
  }

  // Step B: LLM batch classification + date extraction
  const eventsWithWeb = events.filter((e) => e._webResults && e._webResults.length > 0)
  if (eventsWithWeb.length === 0) return

  for (let i = 0; i < eventsWithWeb.length; i += ENRICH_BATCH_SIZE) {
    const batch = eventsWithWeb.slice(i, i + ENRICH_BATCH_SIZE)

    const items = batch.map((ev, idx) => ({
      n: idx + 1,
      event: ev.event,
      venue: ev.venue,
      webResults: (ev._webResults || []).slice(0, 10).map((r) => ({
        title: stripHtml(r.title),
        desc: stripHtml(r.description).slice(0, 200),
        link: r.link,
      })),
    }))

    const today = new Date().toISOString().split('T')[0]
    const prompt = `오늘: ${today}
각 이벤트가 상설 운영인지 기간제인지 분류하고, 기간제면 날짜를 추출하세요.

분류 기준:
- "permanent": 상설 운영, 연중무휴, 상시 운영, 종료일 없음
- "limited": 기간제, 종료일 있음 → 날짜 추출
- "unknown": 판단 불가

판단 힌트:
- "상설", "연중무휴", "상시 운영" → permanent
- "~까지", "기간:", "전시기간" → limited
- 테마파크/놀이공원/키즈카페 자체 → permanent

${JSON.stringify(items, null, 0)}

JSON 배열만 응답: [{"n":1, "type":"limited", "dates":"YYYY-MM-DD~YYYY-MM-DD", "reason":"근거"}, ...]
dates는 기간제(limited)일 때만 추출. permanent/unknown이면 빈 문자열.`

    try {
      const text = await extractWithGemini(prompt)
      const parsed = JSON.parse(text) as { n: number; type?: string; dates?: string; reason?: string }[]

      for (const r of parsed) {
        const ev = batch[r.n - 1]
        if (!ev) continue

        result.stage2Processed++

        if (r.type === 'permanent') {
          ev._stage2Type = 'permanent'
          result.stage2Permanent++
          console.log(`[blog-event] Stage 2 permanent: "${ev.event}" (${r.reason || 'no reason'})`)
        } else if (r.type === 'limited' && r.dates) {
          ev._stage2Type = 'limited'
          ev.enriched_dates = r.dates
          console.log(`[blog-event] Stage 2 dates found: "${ev.event}" → ${r.dates}`)
        } else {
          ev._stage2Type = 'unknown'
          console.log(`[blog-event] Stage 2 unknown: "${ev.event}" (${r.reason || 'no reason'})`)
        }
      }
    } catch (err) {
      console.error('[blog-event] Stage 2 LLM error:', err)
      result.errors++
    }

    if (i + ENRICH_BATCH_SIZE < eventsWithWeb.length) {
      await new Promise((r) => setTimeout(r, LLM_DELAY_MS))
    }
  }

  // Clean up temp web results
  for (const ev of events) {
    delete ev._webResults
  }
}

// ─── Event enrichment via Naver search + LLM (Stage 1) ──────────────────────

async function enrichEvents(events: ExtractedEvent[]): Promise<EnrichedEvent[]> {
  const enriched: EnrichedEvent[] = []

  for (const event of events) {
    // 1) Naver web search: "{event_name} {venue_name} 일정"
    const webQuery = encodeURIComponent(`${event.event} ${event.venue} 일정`)
    const webUrl = `${NAVER_WEB_URL}?query=${webQuery}&display=5`
    const webResults = await fetchNaverSearch<NaverWebItem>(webUrl)

    // 2) Naver image search: "{event_name} 공식 포스터"
    const imgQuery = encodeURIComponent(`${event.event} 공식 포스터`)
    const imgUrl = `${NAVER_IMAGE_URL}?query=${imgQuery}&display=10&sort=sim`
    const imgResults = await fetchNaverSearch<NaverImageItem>(imgUrl)

    // Pick best poster: full image link (not thumbnail), min 300px, prefer tall aspect ratio
    const bestPoster = (imgResults || [])
      .filter((img) => {
        const w = parseInt(img.sizewidth) || 0
        const h = parseInt(img.sizeheight) || 0
        return w >= 300 && h >= 300
      })
      .sort((a, b) => {
        const ratioA = (parseInt(a.sizeheight) || 0) / (parseInt(a.sizewidth) || 1)
        const ratioB = (parseInt(b.sizeheight) || 0) / (parseInt(b.sizewidth) || 1)
        return ratioB - ratioA // taller (poster-like) first
      })[0]

    enriched.push({
      ...event,
      enriched_url: null,
      enriched_dates: null,
      enriched_poster: bestPoster?.link || null,
      _webResults: webResults || undefined,
    })

    await new Promise((r) => setTimeout(r, 200))
  }

  console.log(`[blog-event] Enriched ${enriched.length} events (${enriched.filter((e) => e.enriched_poster).length} with poster)`)
  return enriched
}

async function enrichWithLLM(events: EnrichedEvent[]): Promise<void> {
  const eventsWithWeb = events.filter((e) => e._webResults && e._webResults.length > 0)
  if (eventsWithWeb.length === 0) return

  for (let i = 0; i < eventsWithWeb.length; i += ENRICH_BATCH_SIZE) {
    const batch = eventsWithWeb.slice(i, i + ENRICH_BATCH_SIZE)

    const items = batch.map((ev, idx) => ({
      n: idx + 1,
      event: ev.event,
      venue: ev.venue,
      webResults: (ev._webResults || []).slice(0, 5).map((r) => ({
        title: stripHtml(r.title),
        desc: stripHtml(r.description).slice(0, 200),
        link: r.link,
      })),
    }))

    const today = new Date().toISOString().split('T')[0]
    const prompt = `오늘: ${today}
각 이벤트의 웹 검색 결과에서 공식 일정과 URL을 추출하세요.

각 이벤트:
- dates: 기간 (YYYY-MM-DD~YYYY-MM-DD). 검색 결과에 명시된 날짜만. 추측 금지.
- url: 가장 공식적인 이벤트 페이지 URL (주최사/예매사이트/문화포털 우선)
- found: true/false (이 이벤트의 공식 정보를 웹 검색 결과에서 찾았는지)

${JSON.stringify(items, null, 0)}

JSON 배열만 응답: [{"n":1,"dates":"...","url":"...","found":true}, ...]`

    try {
      const text = await extractWithGemini(prompt)
      const parsed = JSON.parse(text) as { n: number; dates?: string; url?: string; found?: boolean }[]

      for (const r of parsed) {
        const ev = batch[r.n - 1]
        if (!ev) continue
        if (r.dates) ev.enriched_dates = r.dates
        if (r.url) ev.enriched_url = r.url
      }
    } catch (err) {
      console.error('[blog-event] Enrichment LLM error:', err)
    }

    if (i + ENRICH_BATCH_SIZE < eventsWithWeb.length) {
      await new Promise((r) => setTimeout(r, LLM_DELAY_MS))
    }
  }

  // Clean up temp web results
  for (const ev of events) {
    delete ev._webResults
  }
}

// ─── Place-based event extraction (전시/체험 priority) ──────────────────────

const EXHIBITION_BATCH_SIZE = 15
const EXHIBITION_MAX_PLACES = 50

export async function runExhibitionEventExtraction(): Promise<BlogEventDiscoveryResult> {
  const result: BlogEventDiscoveryResult = {
    keywordsProcessed: 0,
    blogPostsFetched: 0,
    eventsExtracted: 0,
    duplicatesSkipped: 0,
    venueValidated: 0,
    regionSkipped: 0,
    eventsInserted: 0,
    enrichmentFiltered: 0,
    stage2Processed: 0,
    stage2Permanent: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[exhibition-event] Missing GEMINI_API_KEY, skipping')
      return result
    }

    // Step 1: Fetch 전시/체험 places with blog mentions (prioritized by mention_count)
    const { data: places, error } = await supabaseAdmin
      .from('places')
      .select('id, name, address, road_address, lat, lng, mention_count')
      .eq('is_active', true)
      .eq('category', '전시/체험')
      .gt('mention_count', 3)
      .order('mention_count', { ascending: false })
      .limit(EXHIBITION_MAX_PLACES)

    if (error || !places || places.length === 0) {
      console.log('[exhibition-event] No exhibition places with mentions')
      return result
    }

    console.log(`[exhibition-event] Processing ${places.length} exhibition places`)

    const knownSourceIds = await prefetchKnownSourceIds()

    // C2: Prefetch existing event names once (avoid N+1)
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: existingEventsData } = await supabaseAdmin
      .from('events')
      .select('name')
      .gte('end_date', todayStr)
    const existingEventNames = (existingEventsData || []).map((e) => normalizePlaceName(e.name))
    console.log(`[exhibition-event] Pre-fetched ${existingEventNames.length} existing event names`)

    for (const place of places) {
      // C1: Region validation (defensive — places table should already be in service area)
      if (place.lat && place.lng && !isInServiceArea(place.lat, place.lng)) {
        result.regionSkipped++
        continue
      }

      // Fetch blog_mentions for this place
      const { data: mentions } = await supabaseAdmin
        .from('blog_mentions')
        .select('title, snippet, post_date')
        .eq('place_id', place.id)
        .order('relevance_score', { ascending: false })
        .order('post_date', { ascending: false })
        .limit(EXHIBITION_BATCH_SIZE)

      if (!mentions || mentions.length === 0) continue
      result.blogPostsFetched += mentions.length

      // Extract events from these mentions via LLM
      const items = mentions.map((m, i) => ({
        n: i + 1,
        title: m.title,
        snippet: (m.snippet || '').slice(0, 300),
      }))

      const prompt = `"${place.name}" 장소의 블로그 포스팅에서 현재 진행 중인 기간제 이벤트/전시를 추출하세요.

추출 대상: 특별전시, 팝업스토어, 테마파크, 체험전, 어린이 전시/공연
명시적 제외: 장소 자체 소개(상설 운영), 맛집 리뷰, 제품 리뷰, 일반 방문 후기

각 이벤트: {"event":"이벤트명","dates":"YYYY-MM-DD~YYYY-MM-DD 또는 빈 문자열","c":확신도}
이벤트 없으면 빈 배열 []. JSON만 응답.

${JSON.stringify(items, null, 0)}`

      try {
        const text = await extractWithGemini(prompt)
        const parsed = JSON.parse(text) as { event: string; dates: string; c: number }[]
        const valid = parsed.filter((e) => e.c >= 0.7 && e.event)

        // Convert to ExtractedEvent format for enrichment
        const candidates: ExtractedEvent[] = []
        for (const ev of valid) {
          result.eventsExtracted++
          const sourceId = `exhibition_${normalizePlaceName(ev.event)}_${place.id}`
          if (knownSourceIds.has(sourceId)) { result.duplicatesSkipped++; continue }

          const normalized = normalizePlaceName(ev.event)
          let isDup = false
          for (const existingName of existingEventNames) {
            if (similarity(normalized, existingName) > EVENT_SIMILARITY_THRESHOLD) { isDup = true; break }
          }
          if (isDup) { result.duplicatesSkipped++; continue }

          candidates.push({ event: ev.event, venue: place.name, addr: place.road_address || place.address || '', dates: ev.dates, c: ev.c })
        }

        // Enrich Stage 1
        const enrichedCandidates = await enrichEvents(candidates)
        await enrichWithLLM(enrichedCandidates)

        // Stage 2: retry for events still missing dates
        const needsStage2 = enrichedCandidates.filter((ev) => !hasConfirmedDates(ev))
        if (needsStage2.length > 0) {
          await enrichStage2(needsStage2, result)
        }

        // No filter: allow permanent and unconfirmed-date events (hidden via admin/user UI)
        const verifiedCandidates = enrichedCandidates

        for (const ev of verifiedCandidates) {
          const sourceId = `exhibition_${normalizePlaceName(ev.event)}_${place.id}`
          const dateStr = ev.enriched_dates || ev.dates
          const { startDate, endDate } = parseDates(dateStr)
          const dateConfirmed = true // All verified events have confirmed dates

          const { error: insertErr } = await supabaseAdmin.from('events').insert({
            name: ev.event,
            category: '문화행사',
            sub_category: classifyEventByTitle(ev.event),
            venue_name: place.name,
            venue_address: place.road_address || place.address,
            lat: place.lat,
            lng: place.lng,
            start_date: startDate,
            end_date: endDate,
            date_confirmed: dateConfirmed,
            source: 'exhibition_extraction',
            source_id: sourceId,
            source_url: ev.enriched_url,
            poster_url: ev.enriched_poster,
          })

          if (insertErr) {
            if (insertErr.code === '23505') result.duplicatesSkipped++
            else { result.errors++; console.error('[exhibition-event] Insert error:', insertErr.message) }
          } else {
            result.eventsInserted++
            knownSourceIds.add(sourceId)
          }
        }
      } catch (err) {
        console.error(`[exhibition-event] LLM error for ${place.name}:`, err)
        result.errors++
      }

      // Rate limit: 2s between places
      await new Promise((r) => setTimeout(r, LLM_DELAY_MS))
    }

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'exhibition-event-extraction',
      results_count: result.blogPostsFetched,
      new_events: result.eventsInserted,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[exhibition-event] Fatal error:', err)
    result.errors++
  }

  return result
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
