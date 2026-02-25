import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { verifyAdmin, errorResponse, successResponse } from '../lib/admin-utils'
import { spawn } from 'child_process'
import { promisify } from 'util'

interface CollectionLog {
  id: number
  collector: string
  keyword: string | null
  results_count: number
  new_places: number
  new_events: number
  status: string
  error: string | null
  duration_ms: number | null
  ran_at: string
}

interface CollectorSummary {
  collector: string
  totalRuns: number
  successCount: number
  errorCount: number
  successRate: number
  avgDuration: number
}

interface PipelineResponse {
  logs: CollectionLog[]
  summary: CollectorSummary[]
}

/**
 * GET /api/admin/pipeline
 * Monitor collection pipeline status
 *
 * Query params:
 * - collector?: string (filter by specific collector, e.g., 'kakao', 'naver', 'kopis')
 * - days?: number (look back N days, default 7)
 * - limit?: number (max logs to return, default 100)
 *
 * Admin role required
 */
export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const collectorFilter = searchParams.get('collector') || ''
  const days = Math.max(1, parseInt(searchParams.get('days') || '7', 10))
  const limit = Math.min(500, parseInt(searchParams.get('limit') || '100', 10))

  const supabase = await createServerSupabase()

  try {
    const lookbackDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    let query = supabase
      .from('collection_logs')
      .select('*')
      .gte('ran_at', lookbackDate)
      .order('ran_at', { ascending: false })
      .limit(limit)

    if (collectorFilter) {
      query = query.eq('collector', collectorFilter)
    }

    const { data: logs, error } = await query

    if (error) throw error

    // Calculate summary by collector
    const summaryMap = new Map<string, CollectorSummary>()

    for (const log of logs || []) {
      const collector = log.collector
      if (!summaryMap.has(collector)) {
        summaryMap.set(collector, {
          collector,
          totalRuns: 0,
          successCount: 0,
          errorCount: 0,
          successRate: 0,
          avgDuration: 0,
        })
      }

      const summary = summaryMap.get(collector)!
      summary.totalRuns += 1

      if (log.status === 'success') {
        summary.successCount += 1
      } else if (log.status === 'error') {
        summary.errorCount += 1
      }

      if (log.duration_ms) {
        summary.avgDuration = (summary.avgDuration * (summary.totalRuns - 1) + log.duration_ms) / summary.totalRuns
      }
    }

    // Calculate success rates
    const summary: CollectorSummary[] = Array.from(summaryMap.values()).map((s) => ({
      ...s,
      successRate: s.totalRuns > 0 ? Math.round((s.successCount / s.totalRuns) * 100) : 0,
      avgDuration: Math.round(s.avgDuration),
    }))

    const response: PipelineResponse = {
      logs: (logs as CollectionLog[]) || [],
      summary,
    }

    return successResponse(response)
  } catch (err) {
    console.error('[GET /api/admin/pipeline] Error:', err)
    return errorResponse('Failed to fetch pipeline status', 500)
  }
}

/**
 * POST /api/admin/pipeline/trigger
 * Manually trigger a collection pipeline
 *
 * Body:
 * {
 *   pipeline: 'A' | 'B' | 'public' | 'events' | 'scoring'
 * }
 *
 * Pipeline mapping (from server/run.ts):
 * - 'A': kakaoPlacesJob (카카오 지도 API)
 * - 'B': naveralBlogJob (네이버 블로그 역검색)
 * - 'public': publicDataJob (공공데이터)
 * - 'events': collectEventsJob (KOPIS + Tour API + Seoul)
 * - 'scoring': runScoringJob (점수 계산 + 키워드 로테이션)
 *
 * NOTE: This endpoint enqueues the job; actual execution happens asynchronously.
 * Check collection_logs to verify job completion.
 *
 * Admin role required
 */
export async function POST(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  const { pipeline } = body as any

  const pipelineNames: Record<string, string> = {
    A: 'Kakao Places Collection',
    B: 'Naver Blog Reverse Search',
    public: 'Public Data Collection',
    events: 'Events Collection',
    scoring: 'Scoring & Keyword Rotation',
  }

  if (!pipeline || !pipelineNames[pipeline]) {
    return errorResponse(
      `pipeline must be one of: ${Object.keys(pipelineNames).join(', ')}`,
      400
    )
  }

  const startTime = new Date().toISOString()

  try {
    // Trigger pipeline execution asynchronously via child process
    // This executes server/run.ts with the corresponding schedule mapping
    const scheduleMap: Record<string, string> = {
      A: '0 17 * * *', // Kakao category scan
      B: '0 */6 * * *', // Naver blog reverse search
      public: '0 18 * * *', // Public data collectors
      events: '0 19 * * *', // Events collectors
      scoring: '0 20 * * *', // Scoring + keyword rotation + density + auto-promotion
    }

    const schedule = scheduleMap[pipeline]

    // Spawn child process to run the pipeline (non-blocking)
    // This allows the API to return immediately while execution happens in background
    const child = spawn('npx', ['tsx', 'server/run.ts', schedule], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })

    // Unref allows parent process to exit without waiting for child
    child.unref()

    // Log the trigger for audit purposes
    console.log(`[POST /api/admin/pipeline/trigger] Pipeline ${pipeline} triggered with schedule "${schedule}"`)

    return successResponse({
      status: 'enqueued',
      pipeline,
      message: `${pipelineNames[pipeline]} job enqueued`,
      startTime,
      checkStatus: 'Use GET /api/admin/pipeline to monitor collection_logs for job completion',
    })
  } catch (err) {
    console.error('[POST /api/admin/pipeline/trigger] Error:', err)
    return errorResponse('Failed to trigger pipeline', 500)
  }
}
