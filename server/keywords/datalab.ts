/**
 * Naver DataLab trend integration — Detect trending keywords for baby/parenting.
 *
 * Runs monthly on the 1st at 06:00 KST (schedule: '0 21 1 * *', plan.md 9-3).
 *
 * API: POST https://openapi.naver.com/v1/datalab/search
 * Headers: X-Naver-Client-Id, X-Naver-Client-Secret
 * Params: keywords[], startDate (yyyy-MM-dd), endDate (yyyy-MM-dd)
 *
 * Logic:
 * - Query 20-30 year-old parent keywords (demographic targeting)
 * - Compare 3 months ago vs now
 * - If growth ≥20%, insert as NEW keyword (plan.md 9-3)
 * - Rate-limited: 1,000 calls/day (plan.md 10-1)
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { dataLabLimiter, naverLimiter } from '../rate-limiter'
import { fetchNaverSearch, stripHtml } from '../collectors/naver-blog'

/**
 * Naver DataLab API response type.
 */
interface DataLabSearchResponse {
  results: DataLabTrendItem[]
}

interface DataLabTrendItem {
  title: string
  keywords: DataLabKeywordTrend[]
}

interface DataLabKeywordTrend {
  keyword: string
  data: DataLabDataPoint[]
}

interface DataLabDataPoint {
  period: string // YYYY-MM-DD
  ratio: number // 0~100 (relative ratio)
}

/**
 * Parent-related keywords to monitor for trends.
 * Filtered by ages 20-30 (demographic).
 * These are seed keywords for DataLab queries.
 */
const PARENT_TREND_KEYWORDS = [
  '아기 키즈카페',
  '어린이 박물관',
  '아기 물놀이',
  '키즈 카페',
  '유아 놀이터',
  '어린이집',
  '유치원',
  '아기 옷',
  '아기 음악',
  '유모차',
  '아기 외식',
  '키즈 식당',
]


/**
 * Run monthly DataLab trend detection.
 * Called on 1st of each month at 06:00 KST (plan.md 10-2).
 */
export async function runDataLabTrendDetection(): Promise<{
  newKeywordsInserted: number
  trendDataProcessed: number
  discoveryInserted: number
  errors: number
}> {
  const result = { newKeywordsInserted: 0, trendDataProcessed: 0, discoveryInserted: 0, errors: 0 }

  try {
    console.log('[datalab] Starting monthly trend detection...')

    // Query trends for seed parent keywords
    const trendData = await fetchDataLabTrends(PARENT_TREND_KEYWORDS)
    result.trendDataProcessed = trendData.length

    // Analyze trends: detect ≥20% growth
    for (const trend of trendData) {
      try {
        const grownKeywords = analyzeGrowthTrend(trend)

        for (const { keyword, growth } of grownKeywords) {
          const inserted = await insertNewKeyword(keyword, growth)
          if (inserted) {
            result.newKeywordsInserted++
          }
        }
      } catch (err) {
        console.error(`[datalab] Error analyzing trend for "${trend.keyword}":`, err)
        result.errors++
      }
    }

    // Discovery Queries: broad blog search for novel keywords
    result.discoveryInserted = await runDiscoveryQueries()

    console.log(
      `[datalab] Trend detection complete: ${result.newKeywordsInserted} trend keywords, ${result.discoveryInserted} discovery keywords`
    )

    return result
  } catch (err) {
    console.error('[datalab] Unexpected error in trend detection:', err)
    result.errors++
    return result
  }
}

/**
 * Fetch trend data from Naver DataLab API for a list of keywords.
 * Compares current month vs 3 months ago.
 *
 * Naver DataLab API allows max 5 keywordGroups per request,
 * so we batch keywords into groups of 5.
 */
async function fetchDataLabTrends(keywords: string[]): Promise<DataLabKeywordTrend[]> {
  try {
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      throw new Error('Missing Naver API credentials for DataLab')
    }

    // Date range: last 3 months (approx)
    const now = new Date()
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())

    const endDate = formatDateISO(now)
    const startDate = formatDateISO(threeMonthsAgo)

    console.log(`[datalab] Fetching trends from ${startDate} to ${endDate}`)

    // Batch keywords into groups of 5 (API limit)
    const BATCH_SIZE = 5
    const batches: string[][] = []
    for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
      batches.push(keywords.slice(i, i + BATCH_SIZE))
    }

    const allTrends: DataLabKeywordTrend[] = []

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]
      console.log(`[datalab] Batch ${batchIdx + 1}/${batches.length}: ${batch.join(', ')}`)

      const response = await dataLabLimiter.throttle(async () => {
        return fetch('https://openapi.naver.com/v1/datalab/search', {
          method: 'POST',
          headers: {
            'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
            'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate,
            endDate,
            timeUnit: 'month',
            keywordGroups: batch.map((keyword) => ({
              groupName: keyword,
              keywords: [keyword],
            })),
          }),
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[datalab] Batch ${batchIdx + 1} API error: ${response.status} - ${errorText}`)
        continue
      }

      const data = (await response.json()) as DataLabSearchResponse

      for (const result of data.results) {
        allTrends.push(...result.keywords)
      }
    }

    console.log(`[datalab] Fetched ${allTrends.length} keyword trends`)

    return allTrends
  } catch (err) {
    console.error('[datalab] Error fetching DataLab trends:', err)
    return []
  }
}

/**
 * Analyze a keyword trend: detect if growth is ≥20% (current vs 3 months ago).
 *
 * Returns keywords with significant growth.
 */
function analyzeGrowthTrend(
  trend: DataLabKeywordTrend
): Array<{ keyword: string; growth: number }> {
  if (!trend.data || trend.data.length < 2) {
    return []
  }

  // Sort by period (ascending)
  const sorted = [...trend.data].sort((a, b) => a.period.localeCompare(b.period))

  // First data point (3 months ago) vs last data point (current)
  const oldRatio = sorted[0]?.ratio ?? 0
  const newRatio = sorted[sorted.length - 1]?.ratio ?? 0

  if (oldRatio === 0) {
    // If old ratio is 0, treat as massive growth (new trend)
    console.log(`[datalab] "${trend.keyword}" is a NEW TREND (zero prior data)`)
    return [{ keyword: trend.keyword, growth: 100 }]
  }

  const growth = ((newRatio - oldRatio) / oldRatio) * 100
  const threshold = 20 // 20% growth required

  if (growth >= threshold) {
    console.log(`[datalab] "${trend.keyword}" growth: ${growth.toFixed(1)}%`)
    return [{ keyword: trend.keyword, growth: Math.round(growth) }]
  }

  return []
}

/**
 * Insert a trending keyword into the keywords table with status=NEW.
 * Returns true if successfully inserted, false if duplicate/error.
 */
async function insertNewKeyword(keyword: string, growth: number): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('keywords').insert({
      keyword: keyword.trim(),
      status: 'NEW',
      source: 'datalab',
      efficiency_score: 0.5, // Initial score for trending keywords (higher than manual)
      cycle_count: 0,
      consecutive_zero_new: 0,
      created_at: new Date().toISOString(),
      // Note: store growth info in description or separate field if needed
    })

    if (error) {
      if (error.code === '23505') {
        // Duplicate keyword (already exists)
        console.log(`[datalab] Keyword already exists: "${keyword}"`)
        return false
      }

      console.error(`[datalab] Failed to insert keyword "${keyword}":`, error)
      return false
    }

    console.log(`[datalab] Inserted NEW trending keyword: "${keyword}" (growth: ${growth}%)`)
    return true
  } catch (err) {
    console.error(`[datalab] Unexpected error inserting keyword "${keyword}":`, err)
    return false
  }
}

/**
 * Format date to ISO 8601 (YYYY-MM-DD).
 */
function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Get remaining daily DataLab API calls (for monitoring).
 */
export async function getDataLabDailyRemaining(): Promise<number> {
  return dataLabLimiter.getRemainingDaily()
}

/**
 * Get current daily DataLab API call count (for monitoring).
 */
export async function getDataLabDailyCount(): Promise<number> {
  const remaining = await getDataLabDailyRemaining()
  return 1_000 - remaining
}

// ─── Discovery Queries — broad blog search for novel keywords ───────────────

const DISCOVERY_QUERIES = [
  '아기랑 갈만한곳 추천',
  '영유아 나들이 추천',
  '아이랑 주말 서울',
  '육아맘 추천 장소',
  '아기 체험 추천',
  '아기랑 식당 추천',
  '키즈존 맛집 후기',
  '유아 외식 브런치',
]

const DISCOVERY_STOP_WORDS = new Set([
  // 검색어 자체 구성 단어
  '추천', '후기', '방문', '리뷰', '블로그', '서울', '경기', '인천',
  '아기', '아이', '유아', '영유아', '어린이', '키즈', '육아',
  '엄마', '아빠', '맘', '베이비', '가족', '나들이', '주말',
  // 조사/기능어/일반어
  '좋은', '최고', '진짜', '우리', '오늘', '사진', '장소',
  '갈만한곳', '데려', '함께', '같이', '대박', '완전',
  '아기랑', '아이랑', '아이와', '아기와', '육아맘', '갈만한',
  '있는', '없는', '했는', '하는', '되는', '같은', '이런', '저런',
  '개월', '돌아', '지금', '정말', '너무', '엄청', '매우', '약간',
  '가볼만한곳', '데이트', '코스', '먹방', '이벤트', '무료',
  '여행', '일상', '그리고', '그래서', '그런데', '때문',
])

// Korean verb/adjective/particle endings — tokens ending with these are not place nouns
const JUNK_SUFFIX = /[는된한을를에서로와과의게며도만요다면으니지고이가]$/
// Place-type suffixes — tokens ending with these are highly likely place/activity nouns
const PLACE_SUFFIX = /(카페|파크|센터|랜드|관|원|실|장|점|터|숲|마을|공원|클래스|클럽|교실|놀이|캠핑|글램핑|수영|미용|볼링|스키|동물원|박물관|미술관|도서관|체험|수목원|식물원|식당|맛집|레스토랑|뷔페|브런치)$/

interface NaverBlogItem {
  title: string
  description: string
  link: string
}

/**
 * Returns true if a token looks like a place-type or activity noun.
 * Only accepts tokens with known place/activity suffixes to minimize noise.
 */
function isPlaceLikeToken(token: string): boolean {
  // Reject tokens ending in common Korean particles/endings
  if (JUNK_SUFFIX.test(token)) return false
  // Only accept tokens with place-type suffixes (strict positive filter)
  return PLACE_SUFFIX.test(token)
}

/**
 * Search broad parenting queries on Naver Blog, extract novel place-type tokens,
 * and insert as NEW keywords. Max 10/month to avoid spam.
 */
async function runDiscoveryQueries(): Promise<number> {
  const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json'
  let inserted = 0
  const tokenFreq = new Map<string, number>()

  for (const query of DISCOVERY_QUERIES) {
    try {
      const encoded = encodeURIComponent(query)
      const url = `${NAVER_BLOG_URL}?query=${encoded}&display=30&sort=sim`
      const items = await fetchNaverSearch<NaverBlogItem>(url)
      if (!items) continue

      for (const item of items) {
        const text = stripHtml(`${item.title} ${item.description}`)
        // Extract 3-5 char tokens only (2-char too noisy)
        const tokens = text.match(/[가-힣]{3,5}/g) ?? []
        for (const token of tokens) {
          if (DISCOVERY_STOP_WORDS.has(token)) continue
          if (!isPlaceLikeToken(token)) continue
          tokenFreq.set(token, (tokenFreq.get(token) ?? 0) + 1)
        }
      }
    } catch (err) {
      console.error(`[datalab] Discovery query error "${query}":`, err)
    }
  }

  // Filter: freq >= 3 (stricter threshold to reduce noise)
  const candidates: string[] = []
  for (const [token, freq] of tokenFreq) {
    if (freq < 3) continue
    if (DISCOVERY_STOP_WORDS.has(token)) continue
    candidates.push(token)
  }

  // Sort by frequency descending, take top candidates
  candidates.sort((a, b) => (tokenFreq.get(b) ?? 0) - (tokenFreq.get(a) ?? 0))

  // Check existing keywords to avoid duplicates
  const { data: existing } = await supabaseAdmin
    .from('keywords')
    .select('keyword')
    .eq('provider', 'naver')

  const existingSet = new Set((existing ?? []).map((k: { keyword: string }) => k.keyword.toLowerCase()))

  for (const token of candidates.slice(0, 20)) {
    if (inserted >= 10) break

    const newKeyword = `아기 ${token}`
    if (existingSet.has(newKeyword.toLowerCase())) continue
    if (existingSet.has(token.toLowerCase())) continue

    const { error } = await supabaseAdmin.from('keywords').insert({
      keyword: newKeyword,
      provider: 'naver',
      status: 'NEW',
      source: 'discovery',
      efficiency_score: 0.5,
      cycle_count: 0,
      consecutive_zero_new: 0,
    })

    if (!error) {
      console.log(`[datalab] Discovery: inserted "${newKeyword}" (freq: ${tokenFreq.get(token)})`)
      inserted++
      existingSet.add(newKeyword.toLowerCase())
    }
  }

  console.log(`[datalab] Discovery: searched ${DISCOVERY_QUERIES.length} queries, inserted ${inserted} new keywords`)
  return inserted
}
