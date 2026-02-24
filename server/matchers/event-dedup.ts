/**
 * Event deduplication logic
 *
 * Strategy:
 * When the same performance/event appears in multiple sources (e.g., KOPIS + Tour API),
 * detect and merge them to avoid duplicates in the events table.
 *
 * Detection:
 *   1st pass: Similar name + overlapping dates → probable match
 *   2nd pass: Same venue + similar name → probable match
 *
 * Resolution:
 *   - Keep the entry with the best data quality (most fields populated)
 *   - Store source references in a denormalized field or separate relation
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { similarity } from './similarity'

export interface EventDeduplicationResult {
  analyzed: number
  merged: number
  errors: number
}

/**
 * Run event deduplication pass.
 * Called after all event collectors have completed to identify and merge duplicates.
 */
export async function runEventDeduplication(): Promise<EventDeduplicationResult> {
  const result: EventDeduplicationResult = {
    analyzed: 0,
    merged: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    console.log('[event-dedup] Starting event deduplication pass')

    // Fetch all recent events (from last 3 days) that haven't been deduplicated yet
    const { data: recentEvents, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })

    if (fetchError) {
      throw new Error(`Failed to fetch events: ${fetchError.message}`)
    }

    if (!recentEvents || recentEvents.length === 0) {
      console.log('[event-dedup] No recent events to deduplicate')
      return result
    }

    result.analyzed = recentEvents.length

    // Group events by potential duplicates
    const processed = new Set<number>()

    for (let i = 0; i < recentEvents.length; i++) {
      const event1 = recentEvents[i]
      if (processed.has(event1.id)) continue

      for (let j = i + 1; j < recentEvents.length; j++) {
        const event2 = recentEvents[j]
        if (processed.has(event2.id)) continue

        // Skip if same source (within-source duplicates handled by UNIQUE constraint)
        if (event1.source === event2.source) continue

        // Check if they are likely the same event
        if (isProbableDuplicate(event1, event2)) {
          try {
            await mergeEvents(event1, event2, processed)
            result.merged++
          } catch (err) {
            console.error('[event-dedup] Error merging events:', err, event1.id, event2.id)
            result.errors++
          }
        }
      }
    }

    console.log(
      `[event-dedup] Deduplication complete: ${result.merged} merged from ${result.analyzed} analyzed`
    )

    // Log to collection_logs (informational, not critical)
    await supabaseAdmin.from('collection_logs').insert({
      collector: 'event-dedup',
      results_count: result.analyzed,
      new_events: result.merged,
      status: 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[event-dedup] Fatal error:', err)
    result.errors++
  }

  return result
}

/**
 * Check if two events are likely duplicates.
 */
function isProbableDuplicate(
  event1: any,
  event2: any
): boolean {
  // Name similarity > 0.7
  const nameSimilarity = similarity(event1.name, event2.name)
  if (nameSimilarity > 0.7) {
    // Check if dates overlap
    if (datesOverlap(event1.start_date, event1.end_date, event2.start_date, event2.end_date)) {
      return true
    }
  }

  // Same venue + similar name
  if (event1.venue_name && event2.venue_name) {
    if (event1.venue_name === event2.venue_name && nameSimilarity > 0.75) {
      return true
    }
  }

  return false
}

/**
 * Check if two date ranges overlap.
 */
function datesOverlap(
  start1: string,
  end1: string | null,
  start2: string,
  end2: string | null
): boolean {
  const d1_start = new Date(start1)
  const d1_end = end1 ? new Date(end1) : new Date(start1)

  const d2_start = new Date(start2)
  const d2_end = end2 ? new Date(end2) : new Date(start2)

  // Events overlap if: start1 <= end2 AND start2 <= end1
  return d1_start <= d2_end && d2_start <= d1_end
}

/**
 * Merge two events.
 * Keeps the event with better data quality and stores a merged_from reference.
 *
 * Currently, we just keep event1 and delete event2 as a simple dedup strategy.
 * Could be enhanced to merge/enrich data from both sources.
 */
async function mergeEvents(event1: any, event2: any, processed: Set<number>): Promise<void> {
  // Determine which event has better data (more non-null fields)
  const quality1 = countNonNull(event1)
  const quality2 = countNonNull(event2)

  const keepId = quality1 >= quality2 ? event1.id : event2.id
  const deleteId = quality1 >= quality2 ? event2.id : event1.id

  console.log(
    `[event-dedup] Merging events: keep ${keepId} (quality ${Math.max(quality1, quality2)}), delete ${deleteId}`
  )

  // Delete the lower-quality event
  const { error } = await supabaseAdmin.from('events').delete().eq('id', deleteId)

  if (error) {
    throw error
  }

  processed.add(deleteId)
}

/**
 * Count non-null fields in an event object.
 */
function countNonNull(obj: any): number {
  const fieldsToCount = [
    'name',
    'venue_name',
    'venue_address',
    'lat',
    'lng',
    'description',
    'poster_url',
    'source_url',
  ]

  return fieldsToCount.filter((field) => obj[field] != null && obj[field] !== '').length
}
