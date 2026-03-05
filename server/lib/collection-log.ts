/**
 * Unified collection_logs helper.
 *
 * Replaces ~50 lines of duplicated insert patterns across 12+ files.
 */

import { supabaseAdmin } from './supabase-admin'

interface CollectionLogParams {
  collector: string
  startedAt: number
  resultsCount?: number
  newPlaces?: number
  newEvents?: number
  errors?: number
  error?: string
}

/**
 * Log a collection run result.
 *
 * Status is auto-determined: error string → 'error', errors > 0 → 'partial', else 'success'.
 *
 * @example
 * await logCollection({
 *   collector: 'children-facility',
 *   startedAt,
 *   resultsCount: result.totalFetched,
 *   newPlaces: result.newPlaces,
 *   errors: result.errors,
 * })
 */
export async function logCollection(params: CollectionLogParams): Promise<void> {
  const status = params.error
    ? 'error'
    : (params.errors ?? 0) > 0
      ? 'partial'
      : 'success'

  await supabaseAdmin.from('collection_logs').insert({
    collector: params.collector,
    status,
    duration_ms: Date.now() - params.startedAt,
    ...(params.resultsCount !== undefined && { results_count: params.resultsCount }),
    ...(params.newPlaces !== undefined && { new_places: params.newPlaces }),
    ...(params.newEvents !== undefined && { new_events: params.newEvents }),
    ...(params.error && { error: params.error }),
  })
}
