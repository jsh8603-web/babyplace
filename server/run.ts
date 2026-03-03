/**
 * Cron entry point for the BabyPlace data collection pipeline.
 *
 * Called by GitHub Actions via:
 *   npx tsx server/run.ts "${{ github.event.schedule || 'manual' }}"
 *
 * Schedule-to-pipeline mapping:
 *
 *   Daily (every day):
 *     0 17 * * *   Pipeline A: Kakao category scan (02:00 KST)
 *     0 18 * * *   Public Data + Pipeline B Method 1: reverse search (03:00 KST)
 *     0 19 * * *   Events: Tour API, Seoul, Gemini classifier (04:00 KST)
 *     0 20 * * *   Scoring + Gemini noise filter + promotion + density (05:00 KST)
 *     0 21 1 * *   Monthly: DataLab trends (06:00 KST, 1st of month)
 *
 *   Weekly (Mon/Thu):
 *     0 17 * * 1,4  Pipeline B Method 2: keyword search (Batches API, 50% off)
 *
 * LLM cost optimization:
 *   - Easy tasks (event classification, noise filter) → Gemini Flash-Lite (free)
 *   - Hard tasks (place name extraction) → Anthropic Batches API (50% off)
 *
 * Environment variables required (set via GitHub Actions secrets):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KAKAO_REST_KEY,
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, TOUR_API_KEY, SEOUL_API_KEY,
 *   GEMINI_API_KEY (Tier 1: Flash + Flash-Lite)
 */

import { runPipelineA } from './collectors/kakao-category'
import { runPipelineB, runReverseSearchOnly, runKeywordSearchBatch } from './collectors/naver-blog'
import { runPublicData } from './collectors/public-data'
import { runLocalData } from './collectors/localdata'
import { runScoring } from './scoring'
import { runDensityControl } from './enrichers/density'
import { runKakaoEnrichment } from './enrichers/kakao-enrich'
import { runAutoPromotion } from './candidates/auto-promote'
import { runAutoDeactivate } from './candidates/auto-deactivate'
import { runTourAPICollector } from './collectors/tour-api'
import { runChildrenFacility } from './collectors/children-facility'
import { runSeoulEventsCollector } from './collectors/seoul-events'
import { runEventDeduplication } from './matchers/event-dedup'
import { runKeywordRotation } from './keywords/keyword-rotation'
import { runBlogNoiseFilter } from './utils/blog-noise-filter'
import { runDataLabTrendDetection } from './keywords/datalab'
import { initializeAllLimiters, flushAllLimiters } from './rate-limiter'

// ─── Schedule dispatch ────────────────────────────────────────────────────────

const PIPELINE_A_SCHEDULE = '0 17 * * *'
const PUBLIC_DATA_SCHEDULE = '0 18 * * *'
const EVENTS_SCHEDULE = '0 19 * * *'
const SCORING_SCHEDULE = '0 20 * * *'
const MONTHLY_SCHEDULE = '0 21 1 * *' // 1st of month, 06:00 KST (21:00 UTC)
const KEYWORD_BATCH_SCHEDULE = '0 17 * * 1,4' // Mon/Thu — Pipeline B Method 2 (Batches API)

async function main(): Promise<void> {
  const schedule = process.argv[2] ?? 'manual'

  console.log(`[run] Starting pipeline run — schedule: "${schedule}"`)
  console.log(`[run] Time: ${new Date().toISOString()}`)

  validateEnv()

  // Load daily API counters from DB once (avoids ~7,000 DB round-trips during pipeline)
  await initializeAllLimiters()

  try {
    switch (schedule) {
      case PIPELINE_A_SCHEDULE:
        await runPipelineAJob()
        break

      case PUBLIC_DATA_SCHEDULE:
        await runPublicDataAndReverseSearchJob()
        break

      case EVENTS_SCHEDULE:
        await runEventsJob()
        break

      case SCORING_SCHEDULE:
        await runScoringJob()
        break

      case MONTHLY_SCHEDULE:
        await runMonthlyJob()
        break

      case KEYWORD_BATCH_SCHEDULE:
        await runKeywordBatchJob()
        break

      case 'manual':
        // Run all daily pipelines
        console.log('[run] Manual mode — running all daily pipelines (use "manual-monthly" to include DataLab)')
        await runPipelineAJob()
        await runPublicDataAndReverseSearchJob()
        await runEventsJob()
        await runScoringJob()
        break

      case 'manual-monthly':
        // Run everything including monthly DataLab trend detection
        console.log('[run] Manual-monthly mode — running all pipelines including DataLab')
        await runPipelineAJob()
        await runPublicDataAndReverseSearchJob()
        await runEventsJob()
        await runScoringJob()
        await runMonthlyJob()
        break

      case 'manual-batch':
        // Run keyword search with Batches API (for testing)
        console.log('[run] Manual-batch mode — running keyword search batch')
        await runKeywordBatchJob()
        break

      default:
        console.error(`[run] Unknown schedule: "${schedule}"`)
        break
    }

    console.log('[run] Pipeline run completed successfully')
    await flushAllLimiters()
    process.exit(0)
  } catch (err) {
    console.error('[run] Fatal error:', err)
    await flushAllLimiters()
    process.exit(1)
  }
}

// ─── Pipeline jobs ────────────────────────────────────────────────────────────

async function runPipelineAJob(): Promise<void> {
  console.log('[run] === Pipeline A: Kakao category scan ===')
  const result = await runPipelineA()
  console.log('[run] Pipeline A result:', JSON.stringify(result, null, 2))
}

async function runPublicDataAndReverseSearchJob(): Promise<void> {
  console.log('[run] === Public data + Pipeline B Method 1 (reverse search) ===')

  // Pipeline B Method 1: reverse search (no LLM cost)
  console.log('[run] Running reverse search...')
  const reverseResult = await runReverseSearchOnly()
  console.log('[run] Reverse search result:', JSON.stringify(reverseResult, null, 2))

  console.log('[run] === Public data collectors ===')

  // Public data collectors: playgrounds, parks, libraries, museums
  console.log('[run] Running public data collector...')
  const publicResult = await runPublicData()
  console.log('[run] Public data result:', JSON.stringify(publicResult, null, 2))

  // Small business market data (소상공인 상권정보): kids cafes, indoor play facilities
  console.log('[run] Running small business collector...')
  const localDataResult = await runLocalData()
  console.log('[run] Small business result:', JSON.stringify(localDataResult, null, 2))

  // Children play facility safety data (행안부 어린이놀이시설)
  console.log('[run] Running children facility collector...')
  const childrenResult = await runChildrenFacility()
  console.log('[run] Children facility result:', JSON.stringify(childrenResult, null, 2))
}

async function runEventsJob(): Promise<void> {
  console.log('[run] === Events collectors (Tour API, Seoul) ===')

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
  console.log('[run] === Kakao enrichment + scoring + keyword rotation + density + promotion + deactivation ===')

  // Kakao enrichment: fill missing phone/road_address before scoring
  console.log('[run] Running Kakao enrichment...')
  const enrichResult = await runKakaoEnrichment()
  console.log('[run] Kakao enrichment result:', JSON.stringify(enrichResult, null, 2))

  // Popularity scoring: compute scores for all active places
  console.log('[run] Running popularity scoring...')
  const scoringResult = await runScoring()
  console.log('[run] Scoring result:', JSON.stringify(scoringResult, null, 2))

  // Keyword rotation: evaluate keyword efficiency + state transitions + seasonal transitions
  console.log('[run] Running keyword rotation...')
  const keywordResult = await runKeywordRotation()
  console.log('[run] Keyword rotation result:', JSON.stringify(keywordResult, null, 2))

  // Blog noise filter: LLM-based borderline mention review + blacklist term accumulation
  console.log('[run] Running blog noise filter...')
  const noiseResult = await runBlogNoiseFilter()
  console.log('[run] Blog noise filter:', JSON.stringify(noiseResult, null, 2))

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

async function runKeywordBatchJob(): Promise<void> {
  console.log('[run] === Pipeline B Method 2: Keyword search (Gemini Flash) ===')
  const result = await runKeywordSearchBatch()
  console.log('[run] Keyword batch result:', JSON.stringify(result, null, 2))
}

async function runMonthlyJob(): Promise<void> {
  console.log('[run] === Monthly: DataLab trends ===')

  // Naver DataLab: detect trending keywords for baby/parenting
  console.log('[run] Running DataLab trend detection...')
  const dataLabResult = await runDataLabTrendDetection()
  console.log('[run] DataLab result:', JSON.stringify(dataLabResult, null, 2))

  // Note: seasonal transition is handled daily by runKeywordRotation() in scoringJob
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
