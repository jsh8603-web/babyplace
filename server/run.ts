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
 *   '0 19 * * *'    → Events collectors (KOPIS, Tour, Seoul) [04:00 KST] (Phase 2 — stub)
 *   '0 20 * * *'    → Scoring + auto-promotion + auto-deactivation [05:00 KST]
 *   'manual'        → Run all pipelines (for local testing / manual trigger)
 *
 * Environment variables required (set via GitHub Actions secrets):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   KAKAO_REST_KEY
 *   NAVER_CLIENT_ID
 *   NAVER_CLIENT_SECRET
 */

import { runPipelineA } from './collectors/kakao-category'
import { runPipelineB } from './collectors/naver-blog'
import { runAutoPromotion } from './candidates/auto-promote'
import { runAutoDeactivate } from './candidates/auto-deactivate'

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
  // Phase 2: public dataset collectors (놀이시설, 공원, 도서관, 박물관)
  // Stub — to be implemented in Phase 2
  console.log('[run] === Public data collectors (Phase 2 — not yet implemented) ===')
}

async function runEventsJob(): Promise<void> {
  // Phase 2: events collectors (KOPIS, Tour API, Seoul cultural events)
  // Stub — to be implemented in Phase 2
  console.log('[run] === Events collectors (Phase 2 — not yet implemented) ===')
}

async function runScoringJob(): Promise<void> {
  console.log('[run] === Scoring + auto-promotion + auto-deactivation ===')

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
