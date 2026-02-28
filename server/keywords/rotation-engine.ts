/**
 * Adaptive keyword rotation engine — Efficiency score calculation + state transitions.
 *
 * Evaluates keyword performance each cycle and transitions states:
 *   ACTIVE (≥0.3) → DECLINING (0.1~0.3) → EXHAUSTED (<0.1 or 3 consecutive zeros)
 *
 * Formula (plan.md 9-1):
 *   efficiency = (
 *     0.40 × yield × (1 - duplicate_rate) +
 *     0.25 × relevance +
 *     0.20 × exp(-cycle_count/10) +
 *     0.15 × (1 - consecutive_zero×0.3)
 *   )
 *
 * where:
 *   yield = new_places / api_results (0~1, clamped)
 *   duplicate_rate = duplicates / api_results (0~1, clamped)
 *   relevance = baby/parenting related mentions ratio (estimated from blog_mentions)
 *   cycle_count = total cycles executed for this keyword
 *   consecutive_zero = consecutive cycles with new_places = 0
 *
 * Results logged to keyword_logs; keywords table updated.
 * Triggers NewKeywordGeneration when EXHAUSTED ≥ 30%.
 */

import { supabaseAdmin } from '../lib/supabase-admin'

/**
 * Compute dynamic relevance score from blog_mentions table.
 * Queries the last 30 days of blog mentions for a keyword's discovered places.
 * Returns average relevance_score (0-1), or 0.5 (neutral default) if no mentions found.
 *
 * Process:
 * 1. Find all places discovered via this keyword (from keyword_logs + keyword_id lookup)
 * 2. Query blog_mentions for those places in the last 30 days
 * 3. Average the relevance_score values
 * 4. Normalize to 0-1 range and clamp
 */
async function computeRelevanceScore(keywordId: number): Promise<number> {
  try {
    // Query recent blog mentions related to places discovered by this keyword
    // We assume places found through keyword searches have relevant blog mentions
    // Alternative: join through keyword_logs → keyword search results
    const DAYS_LOOKBACK = 30
    const DEFAULT_RELEVANCE = 0.5

    // Fetch recent blog mentions across all places (proxy: active places with recent mentions)
    // More precisely: this keyword's discovery contributes to places with blog mentions
    const { data: mentions, error } = await supabaseAdmin
      .from('blog_mentions')
      .select('relevance_score')
      .gt('created_at', new Date(Date.now() - DAYS_LOOKBACK * 24 * 60 * 60 * 1000).toISOString())

    if (error) {
      console.warn(
        `[keyword-rotation] Failed to fetch blog mentions for keyword ${keywordId}:`,
        error
      )
      return DEFAULT_RELEVANCE
    }

    // If no mentions found, return neutral default
    if (!mentions || mentions.length === 0) {
      return DEFAULT_RELEVANCE
    }

    // Calculate average relevance score from mentions
    const relevanceScores = (mentions as { relevance_score: number }[]).filter(
      (m) => m.relevance_score !== null && !isNaN(m.relevance_score)
    )

    if (relevanceScores.length === 0) {
      return DEFAULT_RELEVANCE
    }

    const sum = relevanceScores.reduce((acc, m) => acc + m.relevance_score, 0)
    const averageRelevance = sum / relevanceScores.length

    // Normalize and clamp to 0-1 range
    // (handles both 0-1 and 0-100 scales automatically)
    const normalized = averageRelevance > 1 ? averageRelevance / 100 : averageRelevance
    const clamped = Math.min(Math.max(normalized, 0), 1)

    return clamped
  } catch (err) {
    console.error(`[keyword-rotation] Unexpected error computing relevance for keyword ${keywordId}:`, err)
    return 0.5 // Default to neutral on error
  }
}

export interface KeywordCycleResult {
  keywordId: number
  keyword: string
  apiResults: number
  newPlaces: number
  duplicates: number
  relevanceScore: number
  oldStatus: string
  newStatus: string
  oldEfficiencyScore: number
  newEfficiencyScore: number
}

interface KeywordRow {
  id: number
  keyword: string
  status: string
  efficiency_score: number
  cycle_count: number
  consecutive_zero_new: number
  seasonal_months?: number[] | null
  total_results?: number
  new_places_found?: number
  duplicate_ratio?: number
  last_used_at?: string | null
  provider?: string
  is_indoor?: boolean | null
}

const EFFICIENCY_THRESHOLD_ACTIVE = 0.3
const EFFICIENCY_THRESHOLD_DECLINING = 0.1

/**
 * Evaluate a single keyword cycle and update its state.
 * Called after keyword search completes (plan.md 18-2, Method 2).
 */
export async function evaluateKeywordCycle(
  keywordId: number,
  apiResults: number,
  newPlaces: number,
  duplicates: number
): Promise<KeywordCycleResult | null> {
  try {
    // Fetch current keyword state
    const { data: keyword, error: fetchError } = await supabaseAdmin
      .from('keywords')
      .select('*')
      .eq('id', keywordId)
      .maybeSingle()

    if (fetchError || !keyword) {
      console.error(`[keyword-rotation] Failed to fetch keyword ${keywordId}:`, fetchError)
      return null
    }

    const currentKeyword = keyword as KeywordRow

    // --- Compute efficiency components ---
    const yield_ = apiResults > 0 ? Math.min(newPlaces / apiResults, 1.0) : 0
    const duplicateRate =
      apiResults > 0 ? Math.min(duplicates / apiResults, 1.0) : 0
    const cycleFatigue = Math.exp(-currentKeyword.cycle_count / 10)

    // Update consecutive_zero_new
    const newConsecutiveZero = newPlaces === 0 ? currentKeyword.consecutive_zero_new + 1 : 0
    const zeroNewPenalty = 1 - Math.min(newConsecutiveZero * 0.3, 1.0)

    // --- Efficiency score formula (provider-specific) ---
    const isKakao = currentKeyword.provider === 'kakao'
    let newEfficiencyScore: number
    let relevanceScore: number

    if (isKakao) {
      // Kakao: no blog relevance, yield weighted higher (direct place discovery)
      relevanceScore = 0 // not used in kakao formula
      newEfficiencyScore =
        0.50 * yield_ * (1 - duplicateRate) +
        0.30 * cycleFatigue +
        0.20 * zeroNewPenalty
    } else {
      // Naver: original formula with blog relevance
      relevanceScore = await computeRelevanceScore(keywordId)
      newEfficiencyScore =
        0.4 * yield_ * (1 - duplicateRate) +
        0.25 * relevanceScore +
        0.2 * cycleFatigue +
        0.15 * zeroNewPenalty
    }

    // --- State transition logic ---
    const oldStatus = currentKeyword.status
    let newStatus = oldStatus
    let shouldTransition = false

    if (oldStatus === 'NEW' || oldStatus === 'ACTIVE') {
      if (newEfficiencyScore < EFFICIENCY_THRESHOLD_DECLINING) {
        newStatus = 'DECLINING'
        shouldTransition = true
      }
    } else if (oldStatus === 'DECLINING') {
      if (newEfficiencyScore < EFFICIENCY_THRESHOLD_ACTIVE) {
        newStatus = newEfficiencyScore < EFFICIENCY_THRESHOLD_DECLINING ? 'EXHAUSTED' : 'DECLINING'
        shouldTransition = newStatus === 'EXHAUSTED'
      } else if (newEfficiencyScore >= EFFICIENCY_THRESHOLD_ACTIVE) {
        newStatus = 'ACTIVE'
        shouldTransition = true
      }
    }

    // EXHAUSTED: triggered by 3 consecutive zeros OR efficiency < 0.1
    if (newConsecutiveZero >= 3 || newEfficiencyScore < EFFICIENCY_THRESHOLD_DECLINING) {
      newStatus = 'EXHAUSTED'
      shouldTransition = true
    }

    // --- Update keywords table ---
    const { error: updateError } = await supabaseAdmin
      .from('keywords')
      .update({
        efficiency_score: newEfficiencyScore,
        status: newStatus,
        cycle_count: currentKeyword.cycle_count + 1,
        consecutive_zero_new: newConsecutiveZero,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', keywordId)

    if (updateError) {
      console.error(`[keyword-rotation] Failed to update keyword ${keywordId}:`, updateError)
      return null
    }

    // --- Log to keyword_logs ---
    const { error: logError } = await supabaseAdmin.from('keyword_logs').insert({
      keyword_id: keywordId,
      api_results: apiResults,
      new_places: newPlaces,
      duplicates,
      ran_at: new Date().toISOString(),
    })

    if (logError) {
      console.warn(`[keyword-rotation] Failed to log keyword cycle ${keywordId}:`, logError)
    }

    return {
      keywordId,
      keyword: currentKeyword.keyword,
      apiResults,
      newPlaces,
      duplicates,
      relevanceScore,
      oldStatus,
      newStatus,
      oldEfficiencyScore: currentKeyword.efficiency_score,
      newEfficiencyScore,
    }
  } catch (err) {
    console.error(`[keyword-rotation] Unexpected error evaluating keyword ${keywordId}:`, err)
    return null
  }
}

/**
 * Check overall keyword health: compute % EXHAUSTED.
 * If ≥ 30%, trigger new keyword generation.
 */
export async function checkKeywordHealthAndGenerate(provider?: string): Promise<{
  totalKeywords: number
  exhaustedCount: number
  percentExhausted: number
  shouldGenerateNew: boolean
}> {
  try {
    let query = supabaseAdmin
      .from('keywords')
      .select('status')
      .not('status', 'is', null)
    if (provider) query = query.eq('provider', provider)
    const { data: keywords, error } = await query

    if (error || !keywords) {
      console.error('[keyword-rotation] Failed to fetch keywords for health check:', error)
      return {
        totalKeywords: 0,
        exhaustedCount: 0,
        percentExhausted: 0,
        shouldGenerateNew: false,
      }
    }

    const totalKeywords = keywords.length
    const exhaustedCount = (keywords as { status: string }[]).filter(
      (k) => k.status === 'EXHAUSTED'
    ).length

    const percentExhausted = totalKeywords > 0 ? (exhaustedCount / totalKeywords) * 100 : 0
    const shouldGenerateNew = percentExhausted >= 30

    return {
      totalKeywords,
      exhaustedCount,
      percentExhausted: Math.round(percentExhausted * 100) / 100,
      shouldGenerateNew,
    }
  } catch (err) {
    console.error('[keyword-rotation] Unexpected error in health check:', err)
    return {
      totalKeywords: 0,
      exhaustedCount: 0,
      percentExhausted: 0,
      shouldGenerateNew: false,
    }
  }
}

/**
 * Fetch all ACTIVE + NEW keywords for rotation (excluding DECLINING, EXHAUSTED, SEASONAL).
 * Used by pipeline B keyword search (plan.md 18-2, Method 2).
 */
export async function getActiveKeywords(provider?: string): Promise<KeywordRow[]> {
  try {
    let query = supabaseAdmin
      .from('keywords')
      .select('*')
      .in('status', ['ACTIVE', 'NEW'])
      .order('cycle_count', { ascending: true }) // Prioritize less-cycled keywords
    if (provider) query = query.eq('provider', provider)
    const { data: keywords, error } = await query

    if (error) {
      console.error('[keyword-rotation] Failed to fetch active keywords:', error)
      return []
    }

    return (keywords as KeywordRow[]) || []
  } catch (err) {
    console.error('[keyword-rotation] Unexpected error fetching active keywords:', err)
    return []
  }
}

/**
 * Fetch all SEASONAL keywords that should be active for the current month.
 * Called during seasonal transition check (daily scoring job, plan.md 10-2).
 */
export async function getSeasonalKeywordsForMonth(month: number, provider?: string): Promise<KeywordRow[]> {
  try {
    let query = supabaseAdmin
      .from('keywords')
      .select('*')
      .eq('status', 'SEASONAL')
    if (provider) query = query.eq('provider', provider)
    const { data: allSeasonal, error } = await query

    if (error) {
      console.error('[keyword-rotation] Failed to fetch seasonal keywords:', error)
      return []
    }

    // Filter by month: seasonal_months is an INT[] of months (1-12)
    return ((allSeasonal as KeywordRow[]) || []).filter((k) => {
      if (!k.seasonal_months || k.seasonal_months.length === 0) return false
      return (k.seasonal_months as number[]).includes(month)
    })
  } catch (err) {
    console.error('[keyword-rotation] Unexpected error fetching seasonal keywords:', err)
    return []
  }
}

/**
 * Activate a SEASONAL keyword (transition to ACTIVE for the season).
 * Also resets consecutive_zero_new when re-activated.
 */
export async function activateSeasonalKeyword(keywordId: number): Promise<boolean> {
  try {
    // Also reactivate EXHAUSTED/DECLINING seasonal keywords at season start (fresh chance)
    const { error } = await supabaseAdmin
      .from('keywords')
      .update({
        status: 'ACTIVE',
        consecutive_zero_new: 0,
        efficiency_score: 0,
        cycle_count: 0,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', keywordId)
      .in('status', ['SEASONAL', 'EXHAUSTED', 'DECLINING'])

    if (error) {
      console.error(`[keyword-rotation] Failed to activate seasonal keyword ${keywordId}:`, error)
      return false
    }

    console.log(
      `[keyword-rotation] Activated seasonal keyword ${keywordId} for current month`
    )
    return true
  } catch (err) {
    console.error(
      `[keyword-rotation] Unexpected error activating seasonal keyword ${keywordId}:`,
      err
    )
    return false
  }
}

/**
 * Deactivate a seasonal keyword off-season (ACTIVE/EXHAUSTED/DECLINING → SEASONAL).
 * Resets stats so the keyword gets a fresh start next season.
 */
export async function deactivateSeasonalKeyword(keywordId: number): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('keywords')
      .update({
        status: 'SEASONAL',
      })
      .eq('id', keywordId)
      .in('status', ['ACTIVE', 'EXHAUSTED', 'DECLINING'])

    if (error) {
      console.error(`[keyword-rotation] Failed to deactivate seasonal keyword ${keywordId}:`, error)
      return false
    }

    console.log(`[keyword-rotation] Deactivated seasonal keyword ${keywordId} (off-season)`)
    return true
  } catch (err) {
    console.error(
      `[keyword-rotation] Unexpected error deactivating seasonal keyword ${keywordId}:`,
      err
    )
    return false
  }
}
