/**
 * Pipeline B — Naver blog/café reverse search → blog_mentions + mention_count
 *
 * Covers plan.md sections 18-6, 18-8.
 *
 * Two sub-methods (run in sequence):
 *
 * Method 1 — Reverse search (place → blog):
 *   Select up to 100 active places ordered by stale mention date.
 *   For each place, search Naver Blog + Café by place name.
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
import { naverLimiter } from '../rate-limiter'
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

interface NaverCafeItem {
  title: string
  link: string
  description: string
  cafename: string
  cafeurl: string
}

interface NaverSearchResponse<T> {
  lastBuildDate: string
  total: number
  start: number
  display: number
  items: T[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json'
const NAVER_CAFE_URL = 'https://openapi.naver.com/v1/search/cafearticle.json'

/** Number of places to reverse-search per pipeline run. */
const REVERSE_SEARCH_BATCH = 100

/** Number of results per Naver API call (max 100). */
const DISPLAY_COUNT = 10

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
  // Select places most in need of a mention refresh (plan.md 18-8)
  const { data: places, error } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .eq('is_active', true)
    .order('last_mentioned_at', { ascending: true, nullsFirst: true })
    .order('popularity_score', { ascending: false })
    .limit(REVERSE_SEARCH_BATCH)

  if (error || !places) {
    console.error('[pipeline-b] Failed to fetch places for reverse search:', error)
    stats.errors++
    return
  }

  for (const place of places) {
    try {
      const newMentions = await reverseSearchPlace(place.id, place.name)
      stats.newMentions += newMentions
      stats.placesProcessed++
    } catch (err) {
      console.error(`[pipeline-b] Reverse search error for place ${place.id}:`, err)
      stats.errors++
    }
  }
}

/**
 * Searches Naver Blog and Café for a given place name.
 * Inserts new blog_mentions and updates the place's mention_count.
 * Returns number of new mentions inserted.
 */
async function reverseSearchPlace(
  placeId: number,
  placeName: string
): Promise<number> {
  const query = encodeURIComponent(placeName)
  let newCount = 0

  // Search both blog and cafe
  const sources: Array<{
    url: string
    type: 'naver_blog' | 'naver_cafe'
  }> = [
    { url: `${NAVER_BLOG_URL}?query=${query}&display=${DISPLAY_COUNT}&sort=date`, type: 'naver_blog' },
    { url: `${NAVER_CAFE_URL}?query=${query}&display=${DISPLAY_COUNT}&sort=date`, type: 'naver_cafe' },
  ]

  for (const source of sources) {
    const items = await fetchNaverSearch<NaverBlogItem | NaverCafeItem>(source.url)
    if (!items) continue

    for (const item of items) {
      const url = item.link
      if (!url) continue

      // Check for advertisement signals (future use: weight down ad-sourced mentions)
      const _isAd = isAdvertisement(item.description || item.title)
      void _isAd

      // Attempt to insert (url has UNIQUE constraint → skip if already exists)
      const postDate = parseNaverPostDate(
        'postdate' in item ? item.postdate : undefined
      )

      const { error } = await supabaseAdmin.from('blog_mentions').insert({
        place_id: placeId,
        source_type: source.type,
        title: stripHtml(item.title),
        url,
        post_date: postDate,
        snippet: stripHtml(item.description).slice(0, 500),
      })

      if (!error) {
        newCount++
      }
      // error.code === '23505' means duplicate URL → skip silently
    }
  }

  if (newCount > 0) {
    await updateMentionCount(placeId, newCount)
  }

  return newCount
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
