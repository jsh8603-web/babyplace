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
    // Fetch all active places with required fields (paginated — Supabase default limit is 1000)
    const places: {
      id: number; name: string; mention_count: number; source_count: number;
      last_mentioned_at: string | null; created_at: string;
      address: string | null; phone: string | null; tags: string[] | null; description: string | null;
    }[] = []

    const PAGE_SIZE = 1000
    let offset = 0
    while (true) {
      const { data: page, error: fetchError } = await supabaseAdmin
        .from('places')
        .select(
          'id, name, mention_count, source_count, last_mentioned_at, created_at, address, phone, tags, description'
        )
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (fetchError) {
        console.error('[scoring] Failed to fetch places at offset', offset, ':', fetchError)
        result.errors++
        break
      }
      if (!page || page.length === 0) break
      places.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (places.length === 0) {
      console.error('[scoring] No places fetched')
      result.errors++
      return result
    }

    console.log(`[scoring] Fetched ${places.length} active places`)

    if (places.length === 0) {
      console.log('[scoring] No active places to score')
      return result
    }

    // Compute Bayesian constant C = 25th percentile of mention_count
    const sortedMentions = places
      .map((p) => p.mention_count)
      .sort((a, b) => a - b)
    const cIndex = Math.floor(places.length * BAYESIAN_CONSTANT_PERCENTILE)
    const bayesianConstant = Math.max(sortedMentions[cIndex] ?? 1, 1)

    // Calculate raw scores for min/max normalization
    const rawScores: number[] = []
    const scoreMap = new Map<
      number,
      { raw: number; final: number; completeness: number; recency: number }
    >()

    // Pre-compute max log(mention_count) for normalization (all components → 0~1)
    const maxMentionCount = places.reduce((max, p) => Math.max(max, p.mention_count ?? 0), 0)
    const maxLogMention = Math.log(1 + maxMentionCount)

    for (const place of places) {
      try {
        const completeness = computeDataCompleteness(place)
        const recency = computeRecency(place.last_mentioned_at ?? place.created_at)

        const normalizedMention = maxLogMention > 0
          ? Math.log(1 + place.mention_count) / maxLogMention
          : 0

        const raw =
          0.35 * normalizedMention +
          0.25 * (Math.min(place.source_count ?? 1, 4) / 4) + // source_diversity: capped at 4
          0.25 * recency +
          0.15 * completeness

        if (isNaN(raw)) continue // skip places with invalid data
        rawScores.push(raw)
        scoreMap.set(place.id, { raw, final: 0, completeness, recency })
      } catch (err) {
        console.error(`[scoring] Error computing raw score for place ${place.id}:`, err)
        result.errors++
      }
    }

    // Normalize raw scores to [0, 1]
    if (rawScores.length > 0) {
      let minRaw = Infinity
      let maxRaw = -Infinity
      for (const s of rawScores) { if (s < minRaw) minRaw = s; if (s > maxRaw) maxRaw = s }
      const range = Math.max(maxRaw - minRaw, 0.001) // avoid division by zero

      for (const place of places) {
        const entry = scoreMap.get(place.id)
        if (!entry) continue

        // Places with no mentions get a low base score (below any mentioned place)
        if (place.mention_count === 0) {
          entry.final = 0.30
          continue
        }

        // Normalize raw score
        const normalized = (entry.raw - minRaw) / range

        // Apply Bayesian smoothing with prior=0.35 (ensures mentioned places > unmentioned)
        const bayes =
          (normalized * place.mention_count + 0.35 * bayesianConstant) /
          (place.mention_count + bayesianConstant)

        entry.final = Math.max(0.31, Math.min(1, bayes)) // floor above unmentioned base
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
export function computeDataCompleteness(place: Partial<Place>): number {
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
export function computeRecency(lastMentionDate: string | null, halfLifeDays = RECENCY_HALF_LIFE_DAYS): number {
  if (!lastMentionDate) return 0 // No mention ever recorded

  const lastDate = new Date(lastMentionDate)
  const now = new Date()
  const daysSince = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)

  return Math.exp(-daysSince / halfLifeDays)
}

// ─── Event Scoring ───────────────────────────────────────────────────────────

const EVENT_RECENCY_HALF_LIFE = 90 // events are more time-sensitive
const EVENT_DATA_FIELDS = ['poster_url', 'description', 'venue_address'] as const

export interface EventScoringResult {
  eventsProcessed: number
  minScore: number
  maxScore: number
  avgScore: number
  updated: number
  errors: number
}

export async function runEventScoring(): Promise<EventScoringResult> {
  const result: EventScoringResult = {
    eventsProcessed: 0,
    minScore: 1.0,
    maxScore: 0,
    avgScore: 0,
    updated: 0,
    errors: 0,
  }

  try {
    const { data: events, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('id, mention_count, last_mentioned_at, poster_url, description, venue_address')
      .eq('is_hidden', false)
      .order('id', { ascending: true })

    if (fetchError) {
      console.error('[event-scoring] Failed to fetch events:', fetchError)
      result.errors++
      return result
    }

    if (!events || events.length === 0) {
      console.log('[event-scoring] No events to score')
      return result
    }

    console.log(`[event-scoring] Scoring ${events.length} events`)

    // Bayesian constant C = 25th percentile of mention_count
    const sortedMentions = events.map((e) => e.mention_count ?? 0).sort((a, b) => a - b)
    const cIndex = Math.floor(events.length * 0.25)
    const bayesianConstant = Math.max(sortedMentions[cIndex] ?? 1, 1)

    // Max log for normalization
    const maxMentionCount = events.reduce((max, e) => Math.max(max, e.mention_count ?? 0), 0)
    const maxLogMention = Math.log(1 + maxMentionCount)

    const updates: { id: number; score: number }[] = []
    let scoreSum = 0

    for (const event of events) {
      const mc = event.mention_count ?? 0
      const normalizedMention = maxLogMention > 0 ? Math.log(1 + mc) / maxLogMention : 0
      const recency = computeRecency(event.last_mentioned_at, EVENT_RECENCY_HALF_LIFE)

      // Data quality: poster_url, description, venue_address presence
      let filledFields = 0
      if (event.poster_url) filledFields++
      if (event.description) filledFields++
      if (event.venue_address) filledFields++
      const dataQuality = filledFields / EVENT_DATA_FIELDS.length

      const raw = 0.50 * normalizedMention + 0.30 * recency + 0.20 * dataQuality

      // Bayesian smoothing
      let finalScore: number
      if (mc === 0) {
        finalScore = 0.10
      } else {
        const bayes = (raw * mc + 0.15 * bayesianConstant) / (mc + bayesianConstant)
        finalScore = Math.max(0.11, Math.min(1, bayes))
      }

      updates.push({ id: event.id, score: finalScore })
      scoreSum += finalScore
      result.minScore = Math.min(result.minScore, finalScore)
      result.maxScore = Math.max(result.maxScore, finalScore)
      result.eventsProcessed++
    }

    if (updates.length > 0) {
      result.avgScore = scoreSum / updates.length

      const { error: updateError } = await supabaseAdmin.rpc('update_event_scores_batch', {
        updates_json: JSON.stringify(updates),
      })

      if (updateError) {
        // Fallback: one by one
        let successCount = 0
        for (const { id, score } of updates) {
          const { error } = await supabaseAdmin
            .from('events')
            .update({ popularity_score: score })
            .eq('id', id)
          if (!error) successCount++
        }
        result.updated = successCount
      } else {
        result.updated = updates.length
      }
    }

    console.log(
      `[event-scoring] Done: ${result.eventsProcessed} events, avg=${result.avgScore.toFixed(3)}`
    )
    return result
  } catch (err) {
    console.error('[event-scoring] Fatal error:', err)
    result.errors++
    return result
  }
}

// ─── Event Auto-Hide ─────────────────────────────────────────────────────────

export interface EventAutoHideResult {
  previouslyHidden: number
  newlyHidden: number
  hideThreshold: number
}

export async function runEventAutoHide(): Promise<EventAutoHideResult> {
  const result: EventAutoHideResult = {
    previouslyHidden: 0,
    newlyHidden: 0,
    hideThreshold: 20,
  }

  try {
    // Read threshold from app_settings
    const { data: setting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'event_auto_hide_count')
      .maybeSingle()

    const hideCount = setting?.value ? Number(setting.value) : 20
    result.hideThreshold = hideCount

    // Reset previous auto-hidden events
    const { data: resetData } = await supabaseAdmin
      .from('events')
      .update({ is_hidden: false, auto_hidden: false })
      .eq('auto_hidden', true)
      .select('id')

    result.previouslyHidden = resetData?.length ?? 0

    // Find bottom N events by popularity_score (only those with blog search completed)
    const today = new Date().toISOString().split('T')[0]
    const { data: bottomEvents, error: bottomError } = await supabaseAdmin
      .from('events')
      .select('id')
      .eq('is_hidden', false)
      .gt('mention_count', 0)
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.gte.${today},end_date.is.null`)
      .order('popularity_score', { ascending: true })
      .limit(hideCount)

    if (bottomError) {
      console.error('[event-auto-hide] Failed to fetch bottom events:', bottomError)
      return result
    }

    if (bottomEvents && bottomEvents.length > 0) {
      const ids = bottomEvents.map((e) => e.id)
      const { error: hideError } = await supabaseAdmin
        .from('events')
        .update({ is_hidden: true, auto_hidden: true })
        .in('id', ids)

      if (!hideError) {
        result.newlyHidden = ids.length
      }
    }

    console.log(
      `[event-auto-hide] Reset ${result.previouslyHidden}, hidden ${result.newlyHidden} (threshold: ${hideCount})`
    )
    return result
  } catch (err) {
    console.error('[event-auto-hide] Fatal error:', err)
    return result
  }
}
