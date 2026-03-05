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
import { logCollection } from '../lib/collection-log'
import { prefetchIds } from '../lib/prefetch'
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

    await logCollection({
      collector: 'blog-event-discovery',
      startedAt,
      resultsCount: result.blogPostsFetched,
      newEvents: result.eventsInserted,
      errors: result.errors,
    })
  } catch (err) {
    console.error('[blog-event] Fatal error:', err)
    result.errors++

    await logCollection({
      collector: 'blog-event-discovery',
      startedAt,
      error: String(err),
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
  // Fetch active events from DB for similarity comparison (include NULL end_date)
  const todayStr = new Date().toISOString().split('T')[0]
  const { data: existingEvents } = await supabaseAdmin
    .from('events')
    .select('name, venue_name')
    .or(`end_date.gte.${todayStr},end_date.is.null`)

  const existingEntries = (existingEvents || []).map((e) => ({
    name: normalizeEventName(e.name),
    venue: normalizePlaceName(e.venue_name || ''),
  }))

  // Also deduplicate within the extracted batch
  const seen = new Set<string>()
  const fresh: ExtractedEvent[] = []

  for (const event of events) {
    const normalized = normalizeEventName(event.event)
    const normalizedVenue = normalizePlaceName(event.venue || '')

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

    // Check similarity against DB events (name match OR name+venue match)
    let isDuplicate = false
    for (const existing of existingEntries) {
      const nameSim = similarity(normalized, existing.name)
      const threshold = normalized.length <= 10 || existing.name.length <= 10 ? 0.65 : EVENT_SIMILARITY_THRESHOLD

      // Primary: name similarity above threshold
      if (nameSim > threshold) {
        isDuplicate = true
        break
      }
      // Secondary: moderate name similarity + same venue
      if (nameSim > 0.5 && normalizedVenue && existing.venue) {
        if (similarity(normalizedVenue, existing.venue) > 0.8) {
          isDuplicate = true
          break
        }
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
export function normalizeEventName(name: string): string {
  return normalizePlaceName(
    name
      .replace(/^\s*\[.*?\]\s*/, '') // Strip leading [기관명] bracket only
      .replace(/\d{4}/g, '') // Strip all years ("2026 포켓몬런" + "포켓몬런 2026")
      .replace(/서울|경기|인천|수원|성남|부산|대구|대전|광주|고양|용인|부천|안산|안양/g, '')
      .replace(/\s+in\s+\S+$/i, '') // Strip " in Seoul" suffix
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

  // Skip events from past years or already ended
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]
  if (startDate && parseInt(startDate.substring(0, 4)) < currentYear - 1) {
    result.duplicatesSkipped++
    return
  }
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
  return prefetchIds({
    table: 'events',
    column: 'source_id',
    filters: [{ op: 'in', column: 'source', value: ['blog_discovery', 'exhibition_extraction'] }],
  })
}

// ─── Enrichment constants ────────────────────────────────────────────────────

const NAVER_WEB_URL = 'https://openapi.naver.com/v1/search/webkr'
const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'
const ENRICH_BATCH_SIZE = 10

// ─── Poster selection with strict relevance filtering ────────────────────────

/**
 * Domain blocklist: sources that almost never provide official event posters.
 * Pinterest, DC Inside, Instiz = user-uploaded/fan content
 * Personal blogs, YouTube thumbnails, book covers, Airbnb = irrelevant
 */
const POSTER_BLOCKED_DOMAINS = [
  // Original
  'i.pinimg.com', 'pinimg.com', 'dcimg', 'dcinside.com',
  'instiz.net', 'postfiles.pstatic.net', 'yt3.googleusercontent.com',
  'aladin.co.kr', 'woodo.kr', 'muscache.com', 'coupangcdn.com',
  'fimg5.pann.com', 'momsdiary.co.kr', 'khidi.or.kr', 'anewsa.com',
  // YouTube
  'i.ytimg.com', 'img.youtube.com', 'yt3.ggpht.com',
  // Stock/template
  'clipartkorea.co.kr', 'mangoboard.net', 'miricanvas.com',
  'img.freepik.com', 'png.pngtree.com', 'marketplace.canva.com',
  'preview.gettyimagesbank.com', 'media.istockphoto.com', 'img.lovepik.com',
  'thumb2.gettyimageskorea.com',
  'st3.depositphotos.com', 'st2.depositphotos.com', 'st.depositphotos.com',
  'previews.123rf.com', 'us.123rf.com',
  'thumbs.dreamstime.com', 'www.shutterstock.com',
  'image.shutterstock.com', 'thumb.ac-illust.com',
  // Shopping
  'shop-phinf.pstatic.net', 'shop1.phinf.naver.net', 'shopping.phinf.naver.net',
  'item.ssgcdn.com', 'ai.esmplus.com', 'image.msscdn.net',
  'cdn.dealbada.com', 'thumbnail.10x10.co.kr', 'image.idus.com',
  'partybungbung.com',
  // Community
  'i1.ruliweb.com', 'i2.ruliweb.com', 'ruliweb.com',
  'upload3.inven.co.kr', 'cdn.mania.kr', 'img.extmovie.com',
  'img-cdn.theqoo.net', 'img.theqoo.net', 'img-store.theqoo.net',
  'img.dmitory.com', 'fimg6.pann.com', 'edgio.clien.net',
  'cdnweb01.wikitree.co.kr', 'imgssl.ezday.co.kr', 'www.momq.co.kr',
  'dprime.kr', 'chulsa.kr', 'imgfiles.plaync.com',
  // Music/video
  'is1-ssl.mzstatic.com', 'i1.sndcdn.com', 'image.genie.co.kr',
  'file.kinolights.com',
  'kakaotv/kakaoaccount', 'img.tumblbug.com',
  // News archive
  'cphoto.asiae.co.kr', 'img.asiatoday.co.kr', 'pds.joins.com',
  'cdn.socialfocus.co.kr', 'cdn.autoherald.co.kr',
  'www.gukjenews.com', 'www.kns.tv', 'www.ctnews.kr',
  'www.woorinews.co.kr', 'www.bodonews.com', 'thesegye.com', 'kr.news.cn',
  // Wrong region
  'www.jinju.go.kr', 'jinju.go.kr', 'taean.go.kr', 'lib.changwon.go.kr',
  'www.yeonggwang.go.kr', 'www.bonghwa.go.kr', 'www.naju.go.kr',
  'www.jje.go.kr', 'www.gjartcenter.kr', 'www.cu.ac.kr',
  'www.cng.go.kr', 'www.jj.ac.kr', 'www.uiryeong.go.kr',
  'www.gokseong.go.kr',
  // Other
  'data.ad.co.kr', 'mir-s3-cdn-cf.behance.net', 'd7hftxdivxxvm.cloudfront.net',
  'www.reportworld.co.kr', 'www.ibric.org', 'bric.postech.ac.kr',
  'www.ksponco.or.kr', 'contents.kyobobook.co.kr', 'cdn.getyourguide.com',
  'cdn.imweb.me', 'www.e-redpoint.com', 'www.theteams.kr',
  'overseas.mofa.go.kr', 'www.traveli.co.kr', 'www.youthnavi.net',
  'pds.saramin.co.kr', 'ldb-phinf.pstatic.net', 'dbscthumb-phinf.pstatic.net',
  'lh7-rt.googleusercontent.com',
  'cdninstagram.com',  // all instagram CDN variants
  'inaturalist-open-data.s3.amazonaws.com',
  'gall-img.com', '3.gall-img.com',
  'image.slidesharecdn.com', 'cdn.class101.net', 'cdn.crowdpic.net',
  'static.leisureq.io', 'd2ur7st6jjikze.cloudfront.net',
  'ak-d.tripcdn.com', 'media.triple.guide',
  'www.all-con.co.kr', 'cdn.wikiwiki.jp',
  'image.ohou.se', 'image.ohousecdn.com',
  'www.gc.go.kr', 'dimg.donga.com', 'www.kgeu.org',
  'i.namu.wiki', 'www.wevity.com',
  'naverbooking-phinf.pstatic.net', 'www.archives.go.kr',
  'influencer-phinf.pstatic.net', 'www.bucheonphil.or.kr',
  'www.forest.go.kr', 't1.daumcdn.net/cafeattach',
  'search.pstatic.net/common', 'www.idfac.or.kr',
  // R23: site logos found as og:images
  'img.designhouse.co.kr', 'pngegg.com',
  'play-lh.googleusercontent.com', 'lh3.googleusercontent.com',
]

/**
 * Trusted poster sources: official event/culture portals.
 * Images from these domains get priority scoring.
 */
const POSTER_TRUSTED_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr', 'sejongpac.or.kr',
  'og-data.s3.amazonaws.com', 'gwanak.go.kr', 'incheon.go.kr',
  'ticket.melon.com', 'ticketlink.co.kr', 'interpark.com',
  'yes24.com', 'cjcgv.co.kr', 'megabox.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'museum.seoul.go.kr', 'visitkorea.or.kr', 'mediahub.seoul.go.kr',
]

/** Trusted page domains for Naver Web Search og:image extraction */
const OG_TRUSTED_PAGE_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'museum.seoul.go.kr',
  'tickets.interpark.com', 'ticket.yes24.com', 'ticketlink.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'visitkorea.or.kr', 'korean.visitseoul.net', 'mediahub.seoul.go.kr',
  'lottemuseum.com', 'sac.or.kr', 'sejongpac.or.kr',
]

/** og:image blocklist — site-wide default images (logos, placeholders) */
const OG_IMAGE_BLOCKLIST = [
  'culturePotalImg', 'mainUX/main.png', 'og_noImage',
  'kakaobanner', 'default_og', 'logo', 'Logo', 'favicon',
  '/common/img/', 'share_img', 'shareImg', 'back_img',
  '/images/common/', 'ticketlink_rebranding', 'defaultMobileBanner',
  'defaultBanner', 'tketlink.dn.toastoven.net/static',
  // R23: generic og:image patterns (site logos)
  'og_image', 'og_img', 'ogimage', 'meta_img',
  'sns_sImg', '_meta2', '/templete/', '/include/image/common/',
]

function cleanEventName(name: string): string {
  return name
    .replace(/<[^>]+>/g, ' ')
    .replace(/[「」『』《》<>〈〉]/g, ' ')
    .replace(/[·•:：\-\|\/]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCoreKeywords(name: string): string {
  const cleaned = cleanEventName(name)
  const tokens = cleaned.split(' ').filter(t =>
    t.length >= 2 &&
    !['체험', '무료', '기념', '특가', '프로그램', '이벤트', '전시', '공연', '축제', '팝업', '뮤지컬'].includes(t)
  )
  return tokens.slice(0, 3).join(' ')
}

function isBlocked(url: string): boolean {
  const lower = url.toLowerCase()
  return POSTER_BLOCKED_DOMAINS.some((d) => lower.includes(d))
}

function isTrusted(url: string): boolean {
  return POSTER_TRUSTED_DOMAINS.some((d) => url.includes(d))
}

function isPageTrusted(url: string): boolean {
  return OG_TRUSTED_PAGE_DOMAINS.some((d) => url.includes(d))
}

/**
 * Fetch og:image from a URL using simple regex extraction.
 */
async function fetchOgImage(pageUrl: string): Promise<{ url: string; title: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyPlacePosterBot/1.0)' },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeout)
    if (!res.ok) return null

    const html = await res.text()
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)
    if (!ogMatch) return null

    let imgUrl = ogMatch[1]
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl
    else if (imgUrl.startsWith('/')) {
      const base = new URL(pageUrl)
      imgUrl = base.origin + imgUrl
    }

    if (OG_IMAGE_BLOCKLIST.some(p => imgUrl.includes(p))) return null

    const titleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
      || html.match(/<title>([^<]+)<\/title>/i)
    const title = titleMatch ? stripHtml(titleMatch[1]) : ''

    return { url: imgUrl, title }
  } catch {
    return null
  }
}

interface PosterCandidate {
  title: string
  link: string
  width: number
  height: number
  source: 'og:image' | 'naver_image' | 'web_og:image' | 'current'
}

function preFilterImages(images: NaverImageItem[]): PosterCandidate[] {
  return images
    .filter((img) => {
      if (isBlocked(img.link)) return false
      if (hasStaleYear(img.link)) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 200 || h < 200) return false
      return true
    })
    .map(img => ({
      title: stripHtml(img.title),
      link: img.link,
      width: parseInt(img.sizewidth) || 0,
      height: parseInt(img.sizeheight) || 0,
      source: 'naver_image' as const,
    }))
}

/**
 * Check if URL contains a stale year (< current year) in path segments.
 */
function hasStaleYear(url: string): boolean {
  const currentYear = new Date().getFullYear()
  const yearMatches = url.match(/\/(20[0-2]\d)\//g)
  if (!yearMatches) return false
  return yearMatches.some((m) => {
    const year = parseInt(m.replace(/\//g, ''))
    return year < currentYear - 1
  })
}

/**
 * Select the best poster from Naver Image Search results.
 * Strict filtering: blocked domains → stale year → size → scoring.
 * Returns null if no confident match (better empty than wrong).
 */
function selectBestPoster(images: NaverImageItem[], eventName: string, venueName?: string): string | null {
  const normalizedEvent = eventName
    .replace(/[[\]<>()「」『』""'']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const eventTokens = normalizedEvent.split(/[\s,.:;·\-~]+/).filter((t) => t.length >= 2)
  const venueTokens = (venueName || '').replace(/[[\]<>()]/g, '').toLowerCase()
    .split(/[\s,.:;·\-~]+/).filter((t) => t.length >= 2)

  const candidates = images
    .filter((img) => {
      const url = img.link.toLowerCase()
      if (POSTER_BLOCKED_DOMAINS.some((d) => url.includes(d))) return false
      if (hasStaleYear(url)) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 200 || h < 200) return false
      return true
    })
    .map((img) => {
      const title = stripHtml(img.title).toLowerCase()
      const w = parseInt(img.sizewidth) || 1
      const h = parseInt(img.sizeheight) || 1
      const aspectRatio = h / w
      let score = 0

      // Title relevance (0~50)
      const matchedTokens = eventTokens.filter((t) => title.includes(t))
      const titleRelevance = eventTokens.length > 0 ? matchedTokens.length / eventTokens.length : 0
      score += titleRelevance * 50

      // Venue name matching (+10)
      if (venueTokens.filter((t) => title.includes(t)).length > 0) score += 10

      // Trusted domain (+20)
      if (POSTER_TRUSTED_DOMAINS.some((d) => img.link.includes(d))) score += 20

      // Poster aspect ratio (+10/+5)
      if (aspectRatio >= 0.8 && aspectRatio <= 2.5) score += 10
      if (aspectRatio >= 1.2 && aspectRatio <= 1.8) score += 5

      // News image CDN — conditional scoring
      if (img.link.includes('imgnews.naver.net') || img.link.includes('NISI')) {
        const urlYearMatch = img.link.match(/\/(20\d{2})\//)
        const urlYear = urlYearMatch ? parseInt(urlYearMatch[1]) : 0
        const currentYear = new Date().getFullYear()
        if (titleRelevance >= 0.5 && urlYear >= currentYear - 1) {
          score += 5
        } else if (titleRelevance < 0.3 || urlYear < currentYear - 1) {
          score -= 15
        }
      }

      // Official keywords (+10)
      if (/공식|포스터|메인|키비주얼|대표/.test(title)) score += 10
      // Performance/exhibition keywords (+5)
      if (/전시|공연|뮤지컬|축제|페스티벌|팝업/.test(title)) score += 5

      // Scene/review penalty (-15)
      if (/현장|후기|방문|리뷰|체험기|블로그|스냅|사진찍/.test(title)) score -= 15
      // News article URL penalty (-5)
      if (/\/article\/|\/news\/|NISI\d/.test(img.link)) score -= 5

      return { img, score, titleRelevance }
    })
    .filter((c) => c.titleRelevance >= 0.3 || c.score >= 20)
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (best && best.score >= 15) {
    return best.img.link
  }

  return null
}

// ─── Multi-source poster collection + LLM selection (R20 optimized) ─────────

/**
 * Collect poster candidates from multiple sources:
 * 1. Naver Image Search (5-step fallback, 2-query collection)
 * 2. Naver Web Search → trusted domain og:image extraction
 * Then: pre-filter → Gemini LLM selection with R20 optimal prompt.
 */
async function collectPosterCandidates(
  eventName: string,
  venueName: string,
): Promise<PosterCandidate[]> {
  const candidates: PosterCandidate[] = []

  // ─── Source 1: Naver Image Search (5-step fallback) ─────────────────────
  const cleaned = cleanEventName(eventName)
  const coreKw = extractCoreKeywords(eventName)
  const queries = [
    `${cleaned} 포스터`,
    venueName ? `${cleaned} ${venueName}` : null,
    cleaned,
    coreKw !== cleaned ? coreKw : null,
    venueName ? `${venueName} ${coreKw}` : null,
  ].filter(Boolean) as string[]
  const uniqueQueries = [...new Set(queries)]

  // R14: collect from up to 2 successful queries
  let naverHits = 0
  for (const q of uniqueQueries) {
    const imgUrl = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(q)}&display=20&sort=sim`
    const imgResults = await fetchNaverSearch<NaverImageItem>(imgUrl)
    if (imgResults && imgResults.length > 0) {
      const filtered = preFilterImages(imgResults)
      if (filtered.length > 0) {
        candidates.push(...filtered)
        naverHits++
        if (naverHits >= 2) break
      }
    }
    await new Promise(r => setTimeout(r, 150))
  }

  // ─── Source 2: Naver Web Search → og:image from trusted pages ──────────
  const hasTrustedCandidate = candidates.some(c => isTrusted(c.link))
  if (!hasTrustedCandidate) {
    const webQueries = [`${cleaned} 포스터`, cleaned]
    let trustedPages: { title: string; link: string }[] = []
    for (const wq of webQueries) {
      const webUrl = `${NAVER_WEB_URL}?query=${encodeURIComponent(wq)}&display=10`
      const webResults = await fetchNaverSearch<{ title: string; link: string; description: string }>(webUrl)
      trustedPages = (webResults || []).filter(r => isPageTrusted(r.link))
      if (trustedPages.length > 0) break
      await new Promise(r => setTimeout(r, 150))
    }

    for (const page of trustedPages.slice(0, 3)) {
      const ogResult = await fetchOgImage(page.link)
      if (ogResult && ogResult.url && !isBlocked(ogResult.url) && !hasStaleYear(ogResult.url)) {
        candidates.push({
          title: ogResult.title || stripHtml(page.title),
          link: ogResult.url,
          width: 0, height: 0,
          source: 'web_og:image',
        })
      }
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return candidates.filter(c => {
    if (seen.has(c.link)) return false
    seen.add(c.link)
    return true
  })
}

/**
 * Use Gemini Flash to select the best poster from multi-source candidates.
 * R20 optimal prompt: region matching, tour performance allowance, book cover ban.
 * Falls back to rule-based selectBestPoster if LLM fails.
 */
export async function selectPosterWithLLM(
  candidates: PosterCandidate[],
  eventName: string,
  venueName?: string,
  currentPosterUrl?: string | null
): Promise<string | null> {
  // R24: Include current poster as candidate with [현재] tag
  const allInput = [...candidates]
  if (currentPosterUrl && !candidates.some(c => c.link === currentPosterUrl)) {
    let currentDomain = ''
    try { currentDomain = new URL(currentPosterUrl).hostname } catch { /* */ }
    allInput.unshift({
      title: `[현재 DB 포스터] ${currentDomain}`,
      link: currentPosterUrl,
      width: 0, height: 0,
      source: 'current' as PosterCandidate['source'],
    })
  }

  if (allInput.length === 0) return null

  const allCandidates = allInput.slice(0, 15).map((img, i) => {
    let domain = ''
    try { domain = new URL(img.link).hostname } catch { domain = 'unknown' }
    const trusted = isTrusted(img.link)
    return { idx: i + 1, title: img.title, link: img.link, domain, w: img.width, h: img.height, trusted, source: img.source }
  })

  // Auto-select: single og:image from trusted page → skip LLM
  if (allCandidates.length === 1 && allCandidates[0].source === 'og:image' && isPageTrusted(allCandidates[0].link)) {
    return allCandidates[0].link
  }

  const prompt = `이벤트 "${eventName}"${venueName ? ` (장소: ${venueName})` : ''}의 포스터를 선택하세요.

판단 순서:
1. [현재] 표시 후보 → 현재 DB에 저장된 공식 API 포스터. 다른 후보가 명확히 더 나은 경우에만 교체.
   "명확히 더 나은" = 이벤트명이 정확히 일치하는 공식 포스터 또는 이벤트 전용 이미지.
   뉴스 기사 이미지, 블로그 이미지, 유사 키워드만 매칭되는 이미지는 [현재]보다 낫지 않음.
2. [공식] 표시 후보 → source_url 또는 공식 페이지에서 직접 가져온 이벤트 전용 이미지.
   단, 사이트 로고/기본 이미지가 아닌 실제 이벤트 콘텐츠 이미지만.
3. [신뢰] 표시 후보 → 예매/문화포털 공식 포스터.
   단, yes24/interpark 상품이 도서·음반 표지인 경우 제외 (공연 포스터만).
4. 이벤트명 핵심 키워드가 제목에 포함된 이미지 (뉴스 보도 허용).
5. 같은 IP/브랜드의 다른 행사 포스터도 허용.
6. 후보 모두 이벤트명과 완전히 무관하면 → 0.

중요: 같은 제목/IP의 공연·전시 순회공연은 다른 공연장이어도 허용.
단, 완전히 다른 행사(다른 지역 유사 테마)는 제외.

금지:
- 완전히 다른 IP/작품의 포스터
- 다른 지역의 유사 테마 행사 (같은 작품 순회공연은 예외)
- 개인 블로그 방문 후기, 셀카, 스냅
- 상품/책/앨범/도서 표지, 스톡/템플릿

후보:
${allCandidates.map((c) => {
  const tag = c.source === 'current' ? '[현재]' : c.source === 'og:image' ? '[공식]' : c.trusted ? '[신뢰]' : ''
  const size = c.w > 0 ? ` (${c.w}×${c.h})` : ''
  return `${c.idx}. ${tag} [${c.domain}] "${c.title}"${size}`
}).join('\n')}

JSON만 응답: {"pick": 번호, "reason": "이유"}`

  try {
    const text = await extractWithGemini(prompt)
    const parsed = JSON.parse(text) as { pick: number; reason: string }
    if (parsed.pick > 0 && parsed.pick <= allCandidates.length) {
      return allCandidates[parsed.pick - 1].link
    }
    return null
  } catch {
    // Fallback to rule-based selection
    const naverImages = candidates
      .filter(c => c.source === 'naver_image')
      .map(c => ({ title: c.title, link: c.link, thumbnail: c.link, sizewidth: String(c.width), sizeheight: String(c.height) }))
    return selectBestPoster(naverImages, eventName, venueName)
  }
}

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

    // 2) Multi-source poster collection (5-step fallback + web search + LLM)
    const posterCandidates = await collectPosterCandidates(event.event, event.venue)
    let bestPoster: string | null = null
    if (posterCandidates.length > 0) {
      bestPoster = await selectPosterWithLLM(posterCandidates, event.event, event.venue)
    }

    enriched.push({
      ...event,
      enriched_url: null,
      enriched_dates: null,
      enriched_poster: bestPoster,
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
      .or(`end_date.gte.${todayStr},end_date.is.null`)
    const existingEventNames = (existingEventsData || []).map((e) => normalizeEventName(e.name))
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

          const normalized = normalizeEventName(ev.event)
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

    await logCollection({
      collector: 'exhibition-event-extraction',
      startedAt,
      resultsCount: result.blogPostsFetched,
      newEvents: result.eventsInserted,
      errors: result.errors,
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
