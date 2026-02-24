/**
 * Cron entry point for the BabyPlace data collection pipeline.
 *
 * Called by GitHub Actions via:
 *   npx tsx server/run.ts "${{ github.event.schedule || 'manual' }}"
 *
 * Schedule-to-pipeline mapping (plan.md 10-2, 18-11):
 *
 *   '0 */6 * * *'   → Pipeline B: Naver blog reverse search + keyword rotation
 *   '0 17 * * *'    → Pipeline A: Kakao category scan (places discovery) [02:00 KST]
 *   '0 18 * * *'    → Public data collectors [03:00 KST] (Phase 2 — stub)
 *   '0 19 * * *'    → Events collectors (KOPIS, Tour, Seoul) [04:00 KST]
 *   '0 20 * * *'    → Scoring + auto-promotion + auto-deactivation [05:00 KST]
 *   'manual'        → Run all pipelines (for local testing / manual trigger)
 *
 * Environment variables required (set via GitHub Actions secrets):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   KAKAO_REST_KEY
 *   NAVER_CLIENT_ID
 *   NAVER_CLIENT_SECRET
 *   KOPIS_API_KEY (for KOPIS events)
 *   TOUR_API_KEY (for Tour API events)
 *   SEOUL_API_KEY (optional, for Seoul cultural events)
 */

import { runPipelineA } from './collectors/kakao-category'
import { runPipelineB } from './collectors/naver-blog'
import { runPublicData } from './collectors/public-data'
import { runLocalData } from './collectors/localdata'
import { runScoring } from './scoring'
import { runDensityControl } from './enrichers/density'
import { runAutoPromotion } from './candidates/auto-promote'
import { runAutoDeactivate } from './candidates/auto-deactivate'
import { runKOPISCollector } from './collectors/kopis'
import { runTourAPICollector } from './collectors/tour-api'
import { runSeoulEventsCollector } from './collectors/seoul-events'
import { runEventDeduplication } from './matchers/event-dedup'

// ─── Schedule dispatch ────────────────────────────────────────────────────────

const PIPELINE_B_SCHEDULE = '0 */6 * * *'
const PIPELINE_A_SCHEDULE = '0 17 * * *'
const PUBLIC_DATA_SCHEDULE = '0 18 * * *'
const EVENTS_SCHEDULE = '0 19 * * *'
const SCORING_SCHEDULE = '0 20 * * *'

async function main(): Promise<void> {
  const schedule = process.argv[2] ?? 'manual'

  console.log(`[run] Starting pipeline run — schedule: "${schedule}"`)
  console.log(`[run] Time: ${new Date().toISOString()}`)

  validateEnv()

  try {
    switch (schedule) {
      case PIPELINE_B_SCHEDULE:
        await runPipelineBJob()
        break

      case PIPELINE_A_SCHEDULE:
        await runPipelineAJob()
        break

      case PUBLIC_DATA_SCHEDULE:
        await runPublicDataJob()
        break

      case EVENTS_SCHEDULE:
        await runEventsJob()
        break

      case SCORING_SCHEDULE:
        await runScoringJob()
        break

      case 'manual':
      default:
        // Run all pipelines in order for manual testing
        console.log('[run] Manual mode — running all pipelines')
        await runPipelineAJob()
        await runPipelineBJob()
        await runScoringJob()
        break
    }

    console.log('[run] Pipeline run completed successfully')
    process.exit(0)
  } catch (err) {
    console.error('[run] Fatal error:', err)
    process.exit(1)
  }
}

// ─── Pipeline jobs ────────────────────────────────────────────────────────────

async function runPipelineAJob(): Promise<void> {
  console.log('[run] === Pipeline A: Kakao category scan ===')
  const result = await runPipelineA()
  console.log('[run] Pipeline A result:', JSON.stringify(result, null, 2))
}

async function runPipelineBJob(): Promise<void> {
  console.log('[run] === Pipeline B: Naver blog reverse search ===')
  const result = await runPipelineB()
  console.log('[run] Pipeline B result:', JSON.stringify(result, null, 2))
}

async function runPublicDataJob(): Promise<void> {
  console.log('[run] === Public data collectors (data.go.kr + LOCALDATA) ===')

  // Public data collectors: playgrounds, parks, libraries, museums
  console.log('[run] Running public data collector...')
  const publicResult = await runPublicData()
  console.log('[run] Public data result:', JSON.stringify(publicResult, null, 2))

  // LOCALDATA: kids cafes, indoor play facilities
  console.log('[run] Running LOCALDATA collector...')
  const localDataResult = await runLocalData()
  console.log('[run] LOCALDATA result:', JSON.stringify(localDataResult, null, 2))
}

async function runEventsJob(): Promise<void> {
  console.log('[run] === Events collectors (KOPIS, Tour API, Seoul) ===')

  // KOPIS 공연 정보
  console.log('[run] Running KOPIS collector...')
  const kopisResult = await runKOPISCollector()
  console.log('[run] KOPIS result:', JSON.stringify(kopisResult, null, 2))

  // Tour API 관광정보
  console.log('[run] Running Tour API collector...')
  const tourResult = await runTourAPICollector()
  console.log('[run] Tour API result:', JSON.stringify(tourResult, null, 2))

  // Seoul cultural events
  console.log('[run] Running Seoul events collector...')
  const seoulResult = await runSeoulEventsCollector()
  console.log('[run] Seoul events result:', JSON.stringify(seoulResult, null, 2))

  // Event deduplication
  console.log('[run] Running event deduplication...')
  const dedupResult = await runEventDeduplication()
  console.log('[run] Event deduplication result:', JSON.stringify(dedupResult, null, 2))
}

async function runScoringJob(): Promise<void> {
  console.log('[run] === Scoring + density control + auto-promotion + auto-deactivation ===')

  // Popularity scoring: compute scores for all active places
  console.log('[run] Running popularity scoring...')
  const scoringResult = await runScoring()
  console.log('[run] Scoring result:', JSON.stringify(scoringResult, null, 2))

  // Density control: enforce Top-N per district after scoring
  console.log('[run] Running density control...')
  const densityResult = await runDensityControl()
  console.log('[run] Density control result:', JSON.stringify(densityResult, null, 2))

  // Auto-promotion: promote qualified candidates to places
  console.log('[run] Running auto-promotion...')
  const promoteResult = await runAutoPromotion()
  console.log('[run] Auto-promotion result:', JSON.stringify(promoteResult, null, 2))

  // Auto-deactivation: detect closed places
  console.log('[run] Running auto-deactivation...')
  const deactivateResult = await runAutoDeactivate()
  console.log(
    '[run] Auto-deactivation result:',
    JSON.stringify(deactivateResult, null, 2)
  )
}

// ─── Environment validation ───────────────────────────────────────────────────

function validateEnv(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'KAKAO_REST_KEY',
    'NAVER_CLIENT_ID',
    'NAVER_CLIENT_SECRET',
  ]

  const missing = required.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `[run] Missing required environment variables: ${missing.join(', ')}`
    )
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main()
