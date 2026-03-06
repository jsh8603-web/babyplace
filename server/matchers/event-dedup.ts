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
import { logCollection } from '../lib/collection-log'
import { similarity } from './similarity'

// Event data priority (name, venue, description, etc.)
const SOURCE_DATA_PRIORITY: Record<string, number> = {
  tour_api: 100,
  seoul_events: 100,
  interpark: 80,
  babygo: 60,
  blog_discovery: 40,
  exhibition_extraction: 40,
}

// Poster URL priority — official sources and interpark/babygo always use their own poster
// blog_discovery/exhibition_extraction use LLM-searched posters (lowest priority)
const SOURCE_POSTER_PRIORITY: Record<string, number> = {
  tour_api: 100,
  seoul_events: 100,
  interpark: 90,
  babygo: 80,
  blog_discovery: 40,
  exhibition_extraction: 40,
}

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

    // Fetch recent events (last 3 days) as "new" candidates
    const { data: recentEvents, error: recentError } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })

    if (recentError) {
      throw new Error(`Failed to fetch recent events: ${recentError.message}`)
    }

    // Fetch ALL active events to compare against
    const allEvents: any[] = []
    let offset = 0
    const PAGE = 1000
    while (true) {
      const { data, error: allError } = await supabaseAdmin
        .from('events')
        .select('*')
        .range(offset, offset + PAGE - 1)
      if (allError) throw new Error(`Failed to fetch events: ${allError.message}`)
      if (!data || data.length === 0) break
      allEvents.push(...data)
      if (data.length < PAGE) break
      offset += PAGE
    }

    if (!recentEvents || recentEvents.length === 0) {
      console.log('[event-dedup] No recent events to deduplicate')
      return result
    }

    result.analyzed = allEvents.length
    console.log(`[event-dedup] Comparing ${recentEvents.length} recent vs ${allEvents.length} total events`)

    const recentIds = new Set(recentEvents.map((e: any) => e.id))
    const processed = new Set<number>()

    // Compare each recent event against ALL other events
    for (const event1 of recentEvents) {
      if (processed.has(event1.id)) continue

      for (const event2 of allEvents) {
        if (event2.id === event1.id) continue
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

    // Also compare non-recent events against each other (catch old cross-source duplicates)
    const nonRecentEvents = allEvents.filter((e: any) => !recentIds.has(e.id) && !processed.has(e.id))
    for (let i = 0; i < nonRecentEvents.length; i++) {
      const event1 = nonRecentEvents[i]
      if (processed.has(event1.id)) continue

      for (let j = i + 1; j < nonRecentEvents.length; j++) {
        const event2 = nonRecentEvents[j]
        if (processed.has(event2.id)) continue
        if (event1.source === event2.source) continue

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

    // Pass 3: Cross-source null-date cleanup
    // When one event has dates and the other doesn't, with high name similarity
    const remainingEvents = allEvents.filter((e: any) => !processed.has(e.id))
    for (let i = 0; i < remainingEvents.length; i++) {
      const e1 = remainingEvents[i]
      if (processed.has(e1.id)) continue

      for (let j = i + 1; j < remainingEvents.length; j++) {
        const e2 = remainingEvents[j]
        if (processed.has(e2.id)) continue
        if (e1.source === e2.source) continue

        const sim = similarity(e1.name, e2.name)
        if (sim < 0.8) continue

        const hasDate1 = !!e1.start_date
        const hasDate2 = !!e2.start_date
        if (hasDate1 === hasDate2) continue // both have or both lack dates

        const keep = hasDate1 ? e1 : e2
        const del = hasDate1 ? e2 : e1
        const keepPri = SOURCE_DATA_PRIORITY[keep.source] ?? 0
        const delPri = SOURCE_DATA_PRIORITY[del.source] ?? 0

        if (keepPri >= delPri) {
          try {
            await mergeEvents(keep, del, processed)
            result.merged++
          } catch (err) {
            console.error('[event-dedup] Error merging null-date events:', err, keep.id, del.id)
            result.errors++
          }
        }
      }
    }

    // Pass 4: Within-source cleanup
    // Same source + same venue + high similarity → delete the one without dates
    const remainingEvents2 = allEvents.filter((e: any) => !processed.has(e.id))
    for (let i = 0; i < remainingEvents2.length; i++) {
      const e1 = remainingEvents2[i]
      if (processed.has(e1.id)) continue

      for (let j = i + 1; j < remainingEvents2.length; j++) {
        const e2 = remainingEvents2[j]
        if (processed.has(e2.id)) continue
        if (e1.source !== e2.source) continue
        if (!e1.venue_name || e1.venue_name !== e2.venue_name) continue

        const sim = similarity(e1.name, e2.name)
        if (sim < 0.8) continue

        // Delete the one without dates
        let keep: any, del: any
        if (e1.start_date && !e2.start_date) {
          keep = e1; del = e2
        } else if (!e1.start_date && e2.start_date) {
          keep = e2; del = e1
        } else {
          continue // both have or both lack dates — skip
        }

        try {
          await mergeEvents(keep, del, processed)
          result.merged++
        } catch (err) {
          console.error('[event-dedup] Error merging within-source events:', err, keep.id, del.id)
          result.errors++
        }
      }
    }

    console.log(
      `[event-dedup] Deduplication complete: ${result.merged} merged from ${result.analyzed} analyzed`
    )

    // Log to collection_logs (informational, not critical)
    await logCollection({
      collector: 'event-dedup',
      startedAt,
      resultsCount: result.analyzed,
      newEvents: result.merged,
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
export function isProbableDuplicate(
  event1: any,
  event2: any
): boolean {
  const nameSim = similarity(event1.name, event2.name)

  // Direct name similarity + date overlap
  if (nameSim > 0.7) {
    if (datesOverlap(event1.start_date, event1.end_date, event2.start_date, event2.end_date)) {
      return true
    }
  }

  // Token-based match for word-order differences (e.g. "40주년 보노보노" vs "보노보노 40주년")
  if (nameSim > 0.5) {
    const tokenOverlap = tokenSimilarity(event1.name, event2.name)
    if (tokenOverlap >= 0.75 && datesOverlap(event1.start_date, event1.end_date, event2.start_date, event2.end_date)) {
      return true
    }
  }

  // Same venue + similar name
  if (event1.venue_name && event2.venue_name) {
    if (event1.venue_name === event2.venue_name && nameSim > 0.75) {
      return true
    }
  }

  return false
}

/**
 * Token-based similarity (order-independent).
 * Splits names into tokens and computes Jaccard-like overlap.
 */
export function tokenSimilarity(name1: string, name2: string): number {
  const normalize = (s: string) =>
    s.replace(/[〈〉<>()[\]'"「」『』：:·\-–—,./\\]/g, ' ')
      .replace(/\d{4}/g, '') // strip years
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

  const tokens1 = new Set(normalize(name1).split(' ').filter(t => t.length >= 2))
  const tokens2 = new Set(normalize(name2).split(' ').filter(t => t.length >= 2))

  if (tokens1.size === 0 || tokens2.size === 0) return 0

  let intersection = 0
  for (const t of tokens1) {
    if (tokens2.has(t)) intersection++
  }

  // Overlap coefficient: intersection / min(|A|, |B|)
  return intersection / Math.min(tokens1.size, tokens2.size)
}

/**
 * Check if two date ranges overlap.
 */
export function datesOverlap(
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
 * Merge two events using source priority.
 *
 * 1. Data priority determines which event to keep (source-based, field count fallback)
 * 2. Poster priority determines which poster_url to use
 * 3. Non-null fields from the deleted event fill null fields in the kept event
 */
async function mergeEvents(event1: any, event2: any, processed: Set<number>): Promise<void> {
  const dataPri1 = SOURCE_DATA_PRIORITY[event1.source] ?? 0
  const dataPri2 = SOURCE_DATA_PRIORITY[event2.source] ?? 0

  // Determine keep/delete by data priority, fallback to field count
  let keep: any, del: any
  if (dataPri1 !== dataPri2) {
    keep = dataPri1 >= dataPri2 ? event1 : event2
    del = dataPri1 >= dataPri2 ? event2 : event1
  } else {
    const q1 = countNonNull(event1)
    const q2 = countNonNull(event2)
    keep = q1 >= q2 ? event1 : event2
    del = q1 >= q2 ? event2 : event1
  }

  // Poster priority: use higher-priority poster if available
  const posterPriKeep = SOURCE_POSTER_PRIORITY[keep.source] ?? 0
  const posterPriDel = SOURCE_POSTER_PRIORITY[del.source] ?? 0
  const updates: Record<string, any> = {}

  if (del.poster_url && posterPriDel > posterPriKeep && !keep.poster_url) {
    updates.poster_url = del.poster_url
  } else if (del.poster_url && posterPriDel > posterPriKeep) {
    updates.poster_url = del.poster_url
  }

  // Fill null fields in keep from del
  const fillableFields = [
    'venue_name', 'venue_address', 'lat', 'lng', 'description',
    'source_url', 'price_info', 'time_info', 'age_range',
  ]
  for (const field of fillableFields) {
    if ((keep[field] == null || keep[field] === '') && del[field] != null && del[field] !== '') {
      updates[field] = del[field]
    }
  }

  console.log(
    `[event-dedup] Merging: keep ${keep.id} (${keep.source}), delete ${del.id} (${del.source})${Object.keys(updates).length > 0 ? `, filling ${Object.keys(updates).join(',')}` : ''}`
  )

  // Apply field updates to keep event
  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('events')
      .update(updates)
      .eq('id', keep.id)

    if (updateError) {
      console.error(`[event-dedup] Update error for ${keep.id}:`, updateError.message)
    }
  }

  // Delete the lower-priority event
  const { error } = await supabaseAdmin.from('events').delete().eq('id', del.id)

  if (error) {
    throw error
  }

  // Record merge in dedup audit log
  const nameSim = similarity(keep.name, del.name)
  const matchReason = keep.venue_name && keep.venue_name === del.venue_name
    ? 'venue_name'
    : keep.source === del.source ? 'source_id' : 'name_date'
  await supabaseAdmin.from('event_dedup_audit_log').insert({
    kept_event_id: keep.id,
    removed_event_id: del.id,
    kept_event_name: keep.name,
    removed_event_name: del.name,
    similarity_score: nameSim,
    match_reason: matchReason,
    kept_source: keep.source,
    removed_source: del.source,
    kept_dates: { start_date: keep.start_date, end_date: keep.end_date },
    removed_dates: { start_date: del.start_date, end_date: del.end_date },
    venue_name: keep.venue_name || del.venue_name || null,
  }).then(({ error: auditErr }) => {
    if (auditErr) console.error('[event-dedup] Audit log error:', auditErr.message)
  })

  processed.add(del.id)
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
