/**
 * Popularity scoring engine for places.
 *
 * Computes popularity_score for all active places based on:
 *   - mention_count (blog/café references)
 *   - source_count (distinct data sources)
 *   - recency (days since last mention, exponential decay)
 *   - data_completeness (filled fields ratio)
 *
 * Formula (plan.md 8-1):
 *   raw_score = (
 *     0.35 × normalize(log(1 + mention_count)) +
 *     0.25 × source_diversity +
 *     0.25 × recency(exp(-days/180)) +
 *     0.15 × data_completeness
 *   )
 *
 *   bayesian_score = (raw × n + avg × C) / (n + C)
 *     where C = 25th percentile of mention_count across all places
 *
 * Runs daily at 05:00 KST (schedule: '0 20 * * *').
 * Results logged to scoring_logs table.
 */

import { supabaseAdmin } from './lib/supabase-admin'
import { Place } from '../src/types/index'

export interface ScoringResult {
  placesProcessed: number
  minScore: number
  maxScore: number
  avgScore: number
  logsInserted: number
  errors: number
}

const RECENCY_HALF_LIFE_DAYS = 180 // exponential decay half-life
const DATA_FIELDS = ['name', 'address', 'phone', 'tags', 'description'] // for completeness
const BAYESIAN_CONSTANT_PERCENTILE = 0.25 // use 25th percentile of mention_count as smoothing constant

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runScoring(): Promise<ScoringResult> {
  const result: ScoringResult = {
    placesProcessed: 0,
    minScore: 1.0,
    maxScore: 0,
    avgScore: 0,
    logsInserted: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    // Fetch all active places with required fields
    const { data: places, error: fetchError } = await supabaseAdmin
      .from('places')
      .select(
        'id, name, mention_count, source_count, last_mentioned_at, created_at, address, phone, tags, description'
      )
      .eq('is_active', true)
      .order('mention_count', { ascending: false })

    if (fetchError || !places) {
      console.error('[scoring] Failed to fetch places:', fetchError)
      result.errors++
      return result
    }

    if (places.length === 0) {
      console.log('[scoring] No active places to score')
      return result
    }

    // Compute Bayesian constant C = 25th percentile of mention_count
    const sortedMentions = places
      .map((p) => p.mention_count)
      .sort((a, b) => a - b)
    const cIndex = Math.floor(places.length * BAYESIAN_CONSTANT_PERCENTILE)
    const bayesianConstant = sortedMentions[cIndex] ?? 1

    // Calculate raw scores for min/max normalization
    const rawScores: number[] = []
    const scoreMap = new Map<
      number,
      { raw: number; final: number; completeness: number; recency: number }
    >()

    for (const place of places) {
      try {
        const completeness = computeDataCompleteness(place)
        const recency = computeRecency(place.last_mentioned_at ?? place.created_at)

        const raw =
          0.35 * Math.log(1 + place.mention_count) +
          0.25 * (Math.min(place.source_count, 4) / 4) + // source_diversity: capped at 4
          0.25 * recency +
          0.15 * completeness

        rawScores.push(raw)
        scoreMap.set(place.id, { raw, final: 0, completeness, recency })
      } catch (err) {
        console.error(`[scoring] Error computing raw score for place ${place.id}:`, err)
        result.errors++
      }
    }

    // Normalize raw scores to [0, 1]
    if (rawScores.length > 0) {
      const minRaw = Math.min(...rawScores)
      const maxRaw = Math.max(...rawScores)
      const range = Math.max(maxRaw - minRaw, 0.001) // avoid division by zero

      for (const place of places) {
        const entry = scoreMap.get(place.id)
        if (!entry) continue

        // Normalize raw score
        const normalized = (entry.raw - minRaw) / range

        // Apply Bayesian smoothing (weighted average with category average)
        const bayes =
          (normalized * place.mention_count + 0.5 * bayesianConstant) /
          (place.mention_count + bayesianConstant)

        entry.final = Math.max(0, Math.min(1, bayes)) // clamp to [0, 1]
      }
    }

    // Collect scores for update
    const updates: { id: number; score: number }[] = []
    let scoreSum = 0

    for (const place of places) {
      const entry = scoreMap.get(place.id)
      if (!entry) continue

      updates.push({ id: place.id, score: entry.final })
      scoreSum += entry.final
      result.minScore = Math.min(result.minScore, entry.final)
      result.maxScore = Math.max(result.maxScore, entry.final)
      result.placesProcessed++
    }

    if (updates.length > 0) {
      result.avgScore = scoreSum / updates.length
    }

    // Batch update places using RPC
    const { error: updateError } = await supabaseAdmin.rpc('update_place_scores_batch', {
      updates_json: JSON.stringify(updates),
    })

    if (updateError) {
      // Fallback: update one by one (slower but reliable)
      let successCount = 0
      for (const { id, score } of updates) {
        const { error } = await supabaseAdmin
          .from('places')
          .update({ popularity_score: score })
          .eq('id', id)

        if (!error) successCount++
        else console.error(`[scoring] Failed to update place ${id}:`, error)
      }
      result.logsInserted = successCount
    } else {
      result.logsInserted = updates.length
    }

    // Log scoring run
    const { error: logError } = await supabaseAdmin.from('scoring_logs').insert({
      places_count: result.placesProcessed,
      min_score: result.minScore,
      max_score: result.maxScore,
      avg_score: result.avgScore,
      bayesian_constant: bayesianConstant,
      duration_ms: Date.now() - startedAt,
    })

    if (logError) {
      console.error('[scoring] Failed to log scoring run:', logError)
      result.errors++
    }

    console.log(
      `[scoring] Completed: ${result.placesProcessed} places, avg=${result.avgScore.toFixed(3)}, min=${result.minScore.toFixed(3)}, max=${result.maxScore.toFixed(3)}`
    )

    return result
  } catch (err) {
    console.error('[scoring] Fatal error:', err)
    result.errors++
    return result
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Computes data completeness: ratio of non-null, non-empty fields.
 * Fields checked: name, address, phone, tags, description
 */
function computeDataCompleteness(place: Partial<Place>): number {
  let filled = 0

  if (place.name && place.name.trim().length > 0) filled++
  if (place.address && place.address.trim().length > 0) filled++
  if (place.phone && place.phone.trim().length > 0) filled++
  if (place.tags && Array.isArray(place.tags) && place.tags.length > 0) filled++
  if (place.description && place.description.trim().length > 0) filled++

  return filled / DATA_FIELDS.length
}

/**
 * Computes recency: exponential decay based on days since last mention.
 * Formula: exp(-days / half_life)
 *   - Today: exp(0) = 1.0
 *   - 180 days ago: exp(-1) ≈ 0.368
 *   - 360 days ago: exp(-2) ≈ 0.135
 */
function computeRecency(lastMentionDate: string | null): number {
  if (!lastMentionDate) return 0 // No mention ever recorded

  const lastDate = new Date(lastMentionDate)
  const now = new Date()
  const daysSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)

  return Math.exp(-daysSince / RECENCY_HALF_LIFE_DAYS)
}
