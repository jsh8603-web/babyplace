import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { verifyAdmin, errorResponse } from '../lib/admin-utils'

export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const supabase = await createServerSupabase()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayStartISO = todayStart.toISOString()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const todayISO = now.toISOString().slice(0, 10) // YYYY-MM-DD

  try {
    const [
      // Section 1: KPIs
      activePlacesRes,
      activeEventsRes,
      expiringSoonRes,
      totalMentionsRes,
      recentMentionsRes,
      totalUsersRes,
      todayNewPlacesRes,
      todayFavoritesRes,
      // Section 2: Alerts
      pendingPlaceSubmissionsRes,
      pendingEventSubmissionsRes,
      failedPipelinesRes,
      hiddenPostersRes,
      recoveryPendingRes,
      candidatesPendingRes,
      pendingPosterAuditRes,
      pendingMentionAuditRes,
      pendingClassificationAuditRes,
      pendingPlaceAuditRes,
      pendingDedupAuditRes,
      pendingCandidateAuditRes,
      // Section 3: Pipeline
      collectionLogsRes,
      // Section 4: Audit quality (judged + positive counts)
      posterJudgedRes,
      posterApprovedRes,
      mentionJudgedRes,
      mentionCorrectRes,
      classJudgedRes,
      classCorrectRes,
      placeJudgedRes,
      placeAccurateRes,
      dedupJudgedRes,
      dedupCorrectRes,
      candidateJudgedRes,
      candidateCorrectRes,
      // Section 5: Distribution
      placeCategoriesRes,
      eventSourcesRes,
    ] = await Promise.all([
      // Section 1
      supabase.from('places').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('events').select('*', { count: 'exact', head: true }).gte('end_date', todayISO).eq('is_hidden', false),
      supabase.from('events').select('*', { count: 'exact', head: true }).gte('end_date', todayISO).lte('end_date', new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)).eq('is_hidden', false),
      supabase.from('blog_mentions').select('*', { count: 'exact', head: true }),
      supabase.from('blog_mentions').select('*', { count: 'exact', head: true }).gte('collected_at', sevenDaysAgo),
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('places').select('*', { count: 'exact', head: true }).gte('created_at', todayStartISO),
      supabase.from('favorites').select('*', { count: 'exact', head: true }).gte('created_at', todayStartISO),
      // Section 2: Alerts
      supabase.from('places').select('*', { count: 'exact', head: true }).eq('submission_status', 'pending'),
      supabase.from('events').select('*', { count: 'exact', head: true }).eq('submission_status', 'pending'),
      supabase.from('collection_logs').select('*', { count: 'exact', head: true }).gte('ran_at', oneDayAgo).eq('status', 'error'),
      supabase.from('events').select('*', { count: 'exact', head: true }).eq('poster_hidden', true),
      supabase.from('poster_audit_log').select('*', { count: 'exact', head: true }).eq('action', 'recovery').eq('audit_status', 'pending'),
      supabase.from('place_candidates').select('*', { count: 'exact', head: true }),
      supabase.from('poster_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      supabase.from('mention_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      supabase.from('classification_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      supabase.from('place_accuracy_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      supabase.from('event_dedup_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      supabase.from('candidate_promotion_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'pending'),
      // Section 3: Pipeline logs
      supabase.from('collection_logs').select('collector, status, ran_at, results_count, new_places, new_events').gte('ran_at', oneDayAgo).order('ran_at', { ascending: false }),
      // Section 4: Audit quality — judged (not pending) and positive verdict counts
      supabase.from('poster_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('poster_audit_log').select('*', { count: 'exact', head: true }).eq('audit_status', 'approved'),
      supabase.from('mention_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('mention_audit_log').select('*', { count: 'exact', head: true }).eq('audit_verdict', 'correct'),
      supabase.from('classification_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('classification_audit_log').select('*', { count: 'exact', head: true }).eq('audit_verdict', 'correct'),
      supabase.from('place_accuracy_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('place_accuracy_audit_log').select('*', { count: 'exact', head: true }).eq('audit_verdict', 'accurate'),
      supabase.from('event_dedup_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('event_dedup_audit_log').select('*', { count: 'exact', head: true }).eq('audit_verdict', 'correct_merge'),
      supabase.from('candidate_promotion_audit_log').select('*', { count: 'exact', head: true }).neq('audit_status', 'pending'),
      supabase.from('candidate_promotion_audit_log').select('*', { count: 'exact', head: true }).eq('audit_verdict', 'correct'),
      // Section 5: Distribution (narrow select, JS aggregation)
      supabase.from('places').select('category').eq('is_active', true),
      supabase.from('events').select('source').gte('end_date', todayISO).eq('is_hidden', false),
    ])

    // Section 3: Pipeline aggregation
    const collectionLogs = collectionLogsRes.data || []
    const pipelineMap = new Map<string, {
      collector: string
      lastRun: string
      status: 'success' | 'error' | 'pending'
      errorRate: number
      resultsCount: number
      newPlaces: number
      newEvents: number
    }>()

    for (const log of collectionLogs) {
      if (!pipelineMap.has(log.collector)) {
        pipelineMap.set(log.collector, {
          collector: log.collector,
          lastRun: log.ran_at,
          status: 'pending',
          errorRate: 0,
          resultsCount: log.results_count ?? 0,
          newPlaces: log.new_places ?? 0,
          newEvents: log.new_events ?? 0,
        })
      }
    }

    const pipeline = Array.from(pipelineMap.values()).map((entry) => {
      const logs = collectionLogs.filter((l) => l.collector === entry.collector)
      const errorCount = logs.filter((l) => l.status === 'error').length
      return {
        ...entry,
        errorRate: logs.length > 0 ? Math.round((errorCount / logs.length) * 100) : 0,
        status: (errorCount > 0 ? 'error' : 'success') as 'success' | 'error' | 'pending',
      }
    })

    // Section 5: Aggregate distributions
    const placeCategoryMap = new Map<string, number>()
    for (const row of placeCategoriesRes.data || []) {
      const cat = row.category || 'unknown'
      placeCategoryMap.set(cat, (placeCategoryMap.get(cat) || 0) + 1)
    }
    const placesByCategory = Array.from(placeCategoryMap.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)

    const eventSourceMap = new Map<string, number>()
    for (const row of eventSourcesRes.data || []) {
      const src = row.source || 'unknown'
      eventSourceMap.set(src, (eventSourceMap.get(src) || 0) + 1)
    }
    const eventsBySource = Array.from(eventSourceMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)

    const pendingSubmissions = (pendingPlaceSubmissionsRes.count || 0) + (pendingEventSubmissionsRes.count || 0)
    const pendingAuditsTotal = (pendingPosterAuditRes.count || 0) + (pendingMentionAuditRes.count || 0) +
      (pendingClassificationAuditRes.count || 0) + (pendingPlaceAuditRes.count || 0) +
      (pendingDedupAuditRes.count || 0) + (pendingCandidateAuditRes.count || 0)

    return NextResponse.json({
      // Section 1
      activePlaces: activePlacesRes.count || 0,
      activeEvents: activeEventsRes.count || 0,
      expiringSoon: expiringSoonRes.count || 0,
      totalMentions: totalMentionsRes.count || 0,
      recentMentions: recentMentionsRes.count || 0,
      totalUsers: totalUsersRes.count || 0,
      todayNewPlaces: todayNewPlacesRes.count || 0,
      todayFavorites: todayFavoritesRes.count || 0,
      // Section 2
      alerts: {
        pendingSubmissions,
        failedPipelines: failedPipelinesRes.count || 0,
        hiddenPosters: hiddenPostersRes.count || 0,
        recoveryPending: recoveryPendingRes.count || 0,
        candidatesPending: candidatesPendingRes.count || 0,
        pendingAudits: {
          poster: pendingPosterAuditRes.count || 0,
          mention: pendingMentionAuditRes.count || 0,
          classification: pendingClassificationAuditRes.count || 0,
          place: pendingPlaceAuditRes.count || 0,
          dedup: pendingDedupAuditRes.count || 0,
          candidate: pendingCandidateAuditRes.count || 0,
        },
        pendingAuditsTotal,
      },
      // Section 3
      pipeline,
      // Section 4
      auditQuality: {
        poster: { judged: posterJudgedRes.count || 0, approved: posterApprovedRes.count || 0, pending: pendingPosterAuditRes.count || 0 },
        mention: { judged: mentionJudgedRes.count || 0, correct: mentionCorrectRes.count || 0, pending: pendingMentionAuditRes.count || 0 },
        classification: { judged: classJudgedRes.count || 0, correct: classCorrectRes.count || 0, pending: pendingClassificationAuditRes.count || 0 },
        place: { judged: placeJudgedRes.count || 0, accurate: placeAccurateRes.count || 0, pending: pendingPlaceAuditRes.count || 0 },
        dedup: { judged: dedupJudgedRes.count || 0, correctMerge: dedupCorrectRes.count || 0, pending: pendingDedupAuditRes.count || 0 },
        candidate: { judged: candidateJudgedRes.count || 0, correct: candidateCorrectRes.count || 0, pending: pendingCandidateAuditRes.count || 0 },
      },
      // Section 5
      placesByCategory,
      eventsBySource,
    })
  } catch (err) {
    console.error('[GET /api/admin/stats] Error:', err)
    return errorResponse('Failed to fetch statistics', 500)
  }
}
