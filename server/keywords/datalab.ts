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
import { dataLabLimiter } from '../rate-limiter'

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
]


/**
 * Run monthly DataLab trend detection.
 * Called on 1st of each month at 06:00 KST (plan.md 10-2).
 */
export async function runDataLabTrendDetection(): Promise<{
  newKeywordsInserted: number
  trendDataProcessed: number
  errors: number
}> {
  const result = { newKeywordsInserted: 0, trendDataProcessed: 0, errors: 0 }

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

    console.log(
      `[datalab] Trend detection complete: ${result.newKeywordsInserted} new keywords inserted`
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

    // Call Naver DataLab API via rate limiter
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
          keywordGroups: keywords.map((keyword) => ({
            groupName: keyword,
            keywords: [keyword],
          })),
        }),
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Naver DataLab API error: ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as DataLabSearchResponse

    // Flatten results: collect all keyword trends
    const allTrends: DataLabKeywordTrend[] = []
    for (const result of data.results) {
      allTrends.push(...result.keywords)
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
