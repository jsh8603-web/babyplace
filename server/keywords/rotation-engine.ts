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
 * Compute keyword-specific relevance score from its historical performance.
 * Uses keyword_logs to calculate average yield rate across recent cycles.
 * Returns 0-1, or 0.5 (neutral default) if no logs found.
 */
async function computeRelevanceScore(keywordId: number): Promise<number> {
  const DEFAULT_RELEVANCE = 0.5

  try {
    const { data: logs, error } = await supabaseAdmin
      .from('keyword_logs')
      .select('api_results, new_places, duplicates')
      .eq('keyword_id', keywordId)
      .order('ran_at', { ascending: false })
      .limit(10)

    if (error || !logs || logs.length === 0) {
      return DEFAULT_RELEVANCE
    }

    // Relevance = average yield rate (new_places / api_results) across recent cycles
    let totalResults = 0
    let totalNew = 0
    for (const log of logs) {
      totalResults += log.api_results ?? 0
      totalNew += log.new_places ?? 0
    }

    if (totalResults === 0) return DEFAULT_RELEVANCE

    return Math.min(totalNew / totalResults, 1.0)
  } catch (err) {
    console.error(`[keyword-rotation] Unexpected error computing relevance for keyword ${keywordId}:`, err)
    return DEFAULT_RELEVANCE
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

    if (oldStatus === 'NEW' || oldStatus === 'ACTIVE') {
      if (newEfficiencyScore < EFFICIENCY_THRESHOLD_DECLINING) {
        newStatus = 'DECLINING'
      }
    } else if (oldStatus === 'DECLINING') {
      if (newEfficiencyScore < EFFICIENCY_THRESHOLD_DECLINING) {
        newStatus = 'DECLINING' // stay declining, not yet exhausted
      } else if (newEfficiencyScore >= EFFICIENCY_THRESHOLD_ACTIVE) {
        newStatus = 'ACTIVE'
      }
    }

    // EXHAUSTED: triggered by 3 consecutive zeros only
    if (newConsecutiveZero >= 3) {
      newStatus = 'EXHAUSTED'
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
 * Revive EXHAUSTED keywords after 30+ days of inactivity.
 * Non-seasonal keywords transition: EXHAUSTED → DECLINING (fresh chance).
 * Resets counters so the keyword gets re-evaluated on next cycle.
 * Limited to 10 per provider per run to avoid flooding pipelines.
 */
export async function reviveExhaustedKeywords(provider: string): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { data, error } = await supabaseAdmin
    .from('keywords')
    .update({
      status: 'DECLINING',
      consecutive_zero_new: 0,
      efficiency_score: 0.15,
    })
    .eq('status', 'EXHAUSTED')
    .eq('provider', provider)
    .is('seasonal_months', null)
    .lt('last_used_at', cutoff.toISOString())
    .lt('cycle_count', 20) // 20+ cycles = permanently retired
    .limit(10)
    .select('id, keyword')

  if (error) {
    console.error(`[keyword-rotation] Revive error (${provider}):`, error)
    return 0
  }
  if (data?.length) {
    console.log(`[keyword-rotation] Revived ${data.length} ${provider} keywords: ${data.map(k => k.keyword).join(', ')}`)
  }
  return data?.length ?? 0
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
