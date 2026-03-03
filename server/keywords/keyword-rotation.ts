/**
 * Keyword rotation orchestrator — Called daily during scoring job.
 *
 * Coordinates:
 * 1. Seasonal keyword transitions (activate/deactivate by month)
 * 2. Keyword health check (% exhausted)
 * 3. Generate new keyword candidates if needed
 *
 * Runs as part of SCORING_SCHEDULE (daily 05:00 KST, schedule: '0 20 * * *').
 */

import { runSeasonalTransition } from './seasonal-calendar'
import { checkKeywordHealthAndGenerate, getActiveKeywords, reviveExhaustedKeywords } from './rotation-engine'
import { generateNewKeywordCandidates, generateDiverseKeywordsWithLLM } from './candidate-generator'
import { supabaseAdmin } from '../lib/supabase-admin'

interface ProviderHealth {
  totalKeywords: number
  exhaustedCount: number
  percentExhausted: number
  shouldGenerateNew: boolean
}

export interface KeywordRotationResult {
  seasonalTransition: {
    activated: number
    deactivated: number
    errors: number
  }
  revived: { naver: number; kakao: number }
  naverKeywordHealth: ProviderHealth
  kakaoKeywordHealth: ProviderHealth
  newKeywordGeneration?: {
    naver?: { candidatesGenerated: number; candidatesInserted: number; errors: number }
    kakao?: { candidatesGenerated: number; candidatesInserted: number; errors: number }
  }
  activeKeywords: number
  errors: number
}

/**
 * Run daily keyword rotation pipeline.
 * Called as part of runScoringJob() in server/run.ts.
 */
export async function runKeywordRotation(): Promise<KeywordRotationResult> {
  const emptyHealth: ProviderHealth = {
    totalKeywords: 0, exhaustedCount: 0, percentExhausted: 0, shouldGenerateNew: false,
  }
  const result: KeywordRotationResult = {
    seasonalTransition: { activated: 0, deactivated: 0, errors: 0 },
    revived: { naver: 0, kakao: 0 },
    naverKeywordHealth: { ...emptyHealth },
    kakaoKeywordHealth: { ...emptyHealth },
    activeKeywords: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    console.log('[keyword-rotation] === Keyword rotation orchestration ===')

    // --- Phase 1: Seasonal transitions (both providers) ---
    console.log('[keyword-rotation] Phase 1: Running seasonal transition...')
    const seasonalResult = await runSeasonalTransition()
    result.seasonalTransition = seasonalResult

    // --- Phase 1.5: Revive old EXHAUSTED keywords (30+ days) ---
    console.log('[keyword-rotation] Phase 1.5: Reviving old EXHAUSTED keywords...')
    const [naverRevived, kakaoRevived] = await Promise.all([
      reviveExhaustedKeywords('naver'),
      reviveExhaustedKeywords('kakao'),
    ])
    result.revived = { naver: naverRevived, kakao: kakaoRevived }
    if (naverRevived + kakaoRevived > 0) {
      console.log(`[keyword-rotation] Phase 1.5: Revived naver=${naverRevived}, kakao=${kakaoRevived}`)
    }

    // --- Phase 2: Check keyword health per provider ---
    console.log('[keyword-rotation] Phase 2: Checking keyword health (naver + kakao)...')
    const [naverHealth, kakaoHealth] = await Promise.all([
      checkKeywordHealthAndGenerate('naver'),
      checkKeywordHealthAndGenerate('kakao'),
    ])
    result.naverKeywordHealth = naverHealth
    result.kakaoKeywordHealth = kakaoHealth

    // --- Phase 3: Generate new keywords per provider if needed ---
    if (naverHealth.shouldGenerateNew || kakaoHealth.shouldGenerateNew) {
      result.newKeywordGeneration = {}

      if (naverHealth.shouldGenerateNew) {
        console.log(
          `[keyword-rotation] Phase 3: Naver keyword generation (${naverHealth.percentExhausted}% exhausted)`
        )
        result.newKeywordGeneration.naver = await generateNewKeywordCandidates('naver')
      }

      if (kakaoHealth.shouldGenerateNew) {
        console.log(
          `[keyword-rotation] Phase 3: Kakao keyword generation (${kakaoHealth.percentExhausted}% exhausted)`
        )
        result.newKeywordGeneration.kakao = await generateNewKeywordCandidates('kakao')
      }
    } else {
      console.log('[keyword-rotation] Phase 3: Skipped (keyword health OK for both providers)')
    }

    // --- Phase 3b: LLM-based diverse keyword generation ---
    const shouldRunLLM = await shouldTriggerLLMKeywords()
    if (shouldRunLLM) {
      console.log('[keyword-rotation] Phase 3b: LLM diverse keyword generation')
      if (!result.newKeywordGeneration) result.newKeywordGeneration = {}
      const llmResult = await generateDiverseKeywordsWithLLM()
      // Merge LLM results into naver generation stats
      if (result.newKeywordGeneration.naver) {
        result.newKeywordGeneration.naver.candidatesGenerated += llmResult.candidatesGenerated
        result.newKeywordGeneration.naver.candidatesInserted += llmResult.candidatesInserted
        result.newKeywordGeneration.naver.errors += llmResult.errors
      } else {
        result.newKeywordGeneration.naver = llmResult
      }
    }

    // --- Phase 4: Count active keywords ---
    const activeKeywords = await getActiveKeywords()
    result.activeKeywords = activeKeywords.length

    const duration = Date.now() - startedAt
    console.log(
      `[keyword-rotation] Rotation complete in ${duration}ms: seasonal=${result.seasonalTransition.activated}, naver=${naverHealth.percentExhausted}% exhausted, kakao=${kakaoHealth.percentExhausted}% exhausted, active=${result.activeKeywords}`
    )

    return result
  } catch (err) {
    console.error('[keyword-rotation] Unexpected error in rotation orchestration:', err)
    result.errors++
    return result
  }
}

/**
 * Determine if LLM keyword generation should run.
 * Triggers:
 *   1. First deployment: 0 keywords with source='llm_generated'
 *   2. Monthly: 1st day of month
 *   3. Safety net: Mon/Thu + ACTIVE+NEW < 30
 */
async function shouldTriggerLLMKeywords(): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false

  // Trigger 1: First time — no LLM-generated keywords exist
  const { count: llmCount } = await supabaseAdmin
    .from('keywords')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'llm_generated')
  if (llmCount === 0) {
    console.log('[keyword-rotation] LLM trigger: first deployment (0 llm_generated keywords)')
    return true
  }

  const now = new Date()
  const day = now.getDate()
  const dow = now.getDay() // 0=Sun, 1=Mon, ..., 4=Thu

  // Trigger 2: Monthly on the 1st
  if (day === 1) {
    console.log('[keyword-rotation] LLM trigger: monthly (1st of month)')
    return true
  }

  // Trigger 3: Mon/Thu safety net when active pool is low
  if (dow === 1 || dow === 4) {
    const { count: activeCount } = await supabaseAdmin
      .from('keywords')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'naver')
      .in('status', ['ACTIVE', 'NEW'])
    if ((activeCount ?? 0) < 30) {
      console.log(`[keyword-rotation] LLM trigger: safety net (active+new=${activeCount} < 30)`)
      return true
    }
  }

  return false
}
