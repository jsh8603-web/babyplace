import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin, errorResponse } from '../lib/admin-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface TopQuery {
  query: string
  count: number
  avg_results: number
}

interface GapQuery {
  query: string
  count: number
}

/**
 * GET /api/admin/search-analysis
 * Returns top search queries and zero-result (gap) queries
 * Params: days (default 30), limit (default 50)
 * Admin role required
 */
export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const days = parseInt(searchParams.get('days') ?? '30', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  try {
    // Top queries: group by query, count + avg results_count
    const { data: allLogs, error: logsError } = await supabaseAdmin
      .from('search_logs')
      .select('query, results_count')
      .gte('created_at', since)

    if (logsError) throw logsError

    // Aggregate in JS (Supabase doesn't support GROUP BY in PostgREST)
    const queryMap = new Map<string, { count: number; totalResults: number }>()
    for (const log of allLogs ?? []) {
      const q = log.query.toLowerCase().trim()
      if (!q) continue
      const entry = queryMap.get(q) ?? { count: 0, totalResults: 0 }
      entry.count++
      entry.totalResults += log.results_count ?? 0
      queryMap.set(q, entry)
    }

    const topQueries: TopQuery[] = Array.from(queryMap.entries())
      .map(([query, { count, totalResults }]) => ({
        query,
        count,
        avg_results: count > 0 ? Math.round(totalResults / count) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    const gapQueries: GapQuery[] = Array.from(queryMap.entries())
      .filter(([, { totalResults, count }]) => totalResults === 0 || totalResults / count === 0)
      .map(([query, { count }]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

    return NextResponse.json({ topQueries, gapQueries })
  } catch (err) {
    console.error('[GET /api/admin/search-analysis] Error:', err)
    return errorResponse('Failed to fetch search analysis', 500)
  }
}
