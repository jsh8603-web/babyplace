import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { verifyAdmin, errorResponse } from '../lib/admin-utils'

interface PipelineStatus {
  collector: string
  lastRun: string
  errorRate: number
  status: 'success' | 'error' | 'pending'
}

interface StatsResponse {
  totalPlaces: number
  totalEvents: number
  totalUsers: number
  todayNewPlaces: number
  todayNewUsers: number
  todayReviews: number
  pipeline: PipelineStatus[]
}

/**
 * GET /api/admin/stats
 * Dashboard statistics for admin panel
 * - Total counts: places, events, users
 * - Today's metrics: new places, new users, reviews
 * - Pipeline status: collection_logs aggregation + error rate
 *
 * Admin role required
 */
export async function GET(request: NextRequest) {
  // Verify admin
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const supabase = await createServerSupabase()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayStartISO = todayStart.toISOString()

  try {
    // Count total places
    const { count: totalPlaces, error: placesError } = await supabase
      .from('places')
      .select('*', { count: 'exact', head: true })

    if (placesError) throw placesError

    // Count total events
    const { count: totalEvents, error: eventsError } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })

    if (eventsError) throw eventsError

    // Count total users
    const { count: totalUsers, error: usersError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    if (usersError) throw usersError

    // Today's new places
    const { count: todayNewPlaces, error: todayPlacesError } = await supabase
      .from('places')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStartISO)

    if (todayPlacesError) throw todayPlacesError

    // Today's new users
    const { count: todayNewUsers, error: todayUsersError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStartISO)

    if (todayUsersError) throw todayUsersError

    // Today's reviews (favorites created today — proxy for user engagement/reviews)
    const { count: todayReviews, error: todayFavError } = await supabase
      .from('favorites')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStartISO)

    if (todayFavError) throw todayFavError

    // Pipeline status: Get last 24 hours of collection_logs, group by collector
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    const { data: collectionLogs, error: logsError } = await supabase
      .from('collection_logs')
      .select('collector, status, ran_at')
      .gte('ran_at', oneDayAgo)
      .order('ran_at', { ascending: false })

    if (logsError) throw logsError

    // Group by collector, calculate error rate, get last run
    const pipelineMap = new Map<string, PipelineStatus>()

    for (const log of collectionLogs || []) {
      const collector = log.collector
      if (!pipelineMap.has(collector)) {
        pipelineMap.set(collector, {
          collector,
          lastRun: log.ran_at,
          errorRate: 0,
          status: 'pending',
        })
      }

      const entry = pipelineMap.get(collector)!
      entry.lastRun = log.ran_at // Already sorted by ran_at DESC

      if (log.status === 'error') {
        entry.errorRate += 1
      }
    }

    // Calculate error rates
    const pipeline: PipelineStatus[] = Array.from(pipelineMap.values()).map((entry) => {
      const collectorLogs = (collectionLogs || []).filter((l) => l.collector === entry.collector)
      const errorCount = collectorLogs.filter((l) => l.status === 'error').length
      const totalCount = collectorLogs.length

      return {
        ...entry,
        errorRate: totalCount > 0 ? Math.round((errorCount / totalCount) * 100) : 0,
        status: errorCount > 0 ? 'error' : 'success',
      }
    })

    const response: StatsResponse = {
      totalPlaces: totalPlaces || 0,
      totalEvents: totalEvents || 0,
      totalUsers: totalUsers || 0,
      todayNewPlaces: todayNewPlaces || 0,
      todayNewUsers: todayNewUsers || 0,
      todayReviews: todayReviews || 0,
      pipeline,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('[GET /api/admin/stats] Error:', err)
    return errorResponse('Failed to fetch statistics', 500)
  }
}
