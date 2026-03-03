/**
 * Expired event cleanup — DELETE events past end_date + 7 days grace period.
 *
 * Pattern: auto-deactivate.ts (places use is_active flag; events use end_date as lifecycle).
 * 7-day grace: recently ended events remain searchable briefly.
 *
 * Runs at the start of runEventsJob() (clean before collecting new).
 */

import { supabaseAdmin } from '../lib/supabase-admin'

export interface EventCleanupResult {
  deleted: number
  errors: number
}

export async function runEventCleanup(): Promise<EventCleanupResult> {
  const result: EventCleanupResult = { deleted: 0, errors: 0 }
  const startedAt = Date.now()

  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffDate = cutoff.toISOString().split('T')[0]

    const { data, error } = await supabaseAdmin
      .from('events')
      .delete()
      .lt('end_date', cutoffDate)
      .select('id')

    if (error) {
      console.error('[event-cleanup] Delete error:', error.message)
      result.errors++
    } else {
      result.deleted = data?.length ?? 0
    }

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'event-cleanup',
      results_count: result.deleted,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[event-cleanup] Fatal error:', err)
    result.errors++
  }

  console.log(`[event-cleanup] Done: deleted=${result.deleted}, errors=${result.errors}`)
  return result
}
