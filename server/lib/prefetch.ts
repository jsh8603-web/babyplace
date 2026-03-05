/**
 * Common prefetch utility for paginated Supabase queries.
 *
 * Replaces ~150 lines of duplicated prefetch patterns across 6+ collectors.
 * Each collector had its own while-loop pagination fetching source_ids or
 * kakao_place_ids into a Set — this module unifies that pattern.
 */

import { supabaseAdmin } from './supabase-admin'

type FilterOp =
  | { op: 'eq'; column: string; value: string }
  | { op: 'in'; column: string; value: string[] }
  | { op: 'not_null'; column: string }

interface PrefetchConfig {
  table: string
  column: string
  filters?: FilterOp[]
  batchSize?: number
}

/**
 * Fetch all values of a single column into a Set, with paginated reads.
 *
 * @example
 * // Simple: all source_ids for a given source
 * const ids = await prefetchIds({
 *   table: 'places',
 *   column: 'source_id',
 *   filters: [{ op: 'eq', column: 'source', value: 'children-facility' }],
 * })
 *
 * @example
 * // Multiple sources
 * const ids = await prefetchIds({
 *   table: 'events',
 *   column: 'source_id',
 *   filters: [{ op: 'in', column: 'source', value: ['blog_discovery', 'exhibition_extraction'] }],
 * })
 *
 * @example
 * // NOT NULL filter
 * const ids = await prefetchIds({
 *   table: 'places',
 *   column: 'kakao_place_id',
 *   filters: [{ op: 'not_null', column: 'kakao_place_id' }],
 * })
 */
export async function prefetchIds(config: PrefetchConfig): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  const batchSize = config.batchSize ?? 1000

  while (true) {
    let query = supabaseAdmin.from(config.table).select(config.column)

    if (config.filters) {
      for (const f of config.filters) {
        if (f.op === 'eq') {
          query = query.eq(f.column, f.value)
        } else if (f.op === 'in') {
          query = query.in(f.column, f.value)
        } else if (f.op === 'not_null') {
          query = query.not(f.column, 'is', null)
        }
      }
    }

    const { data, error } = await query.range(offset, offset + batchSize - 1)

    if (error) {
      console.error(`[prefetch] Error fetching ${config.table}.${config.column}:`, error.message)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      const val = (row as Record<string, unknown>)[config.column]
      if (val != null) ids.add(String(val))
    }

    if (data.length < batchSize) break
    offset += batchSize
  }

  return ids
}
