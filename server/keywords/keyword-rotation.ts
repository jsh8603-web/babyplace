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
import { checkKeywordHealthAndGenerate, getActiveKeywords } from './rotation-engine'
import { generateNewKeywordCandidates } from './candidate-generator'

export interface KeywordRotationResult {
  seasonalTransition: {
    activated: number
    deactivated: number
    errors: number
  }
  keywordHealth: {
    totalKeywords: number
    exhaustedCount: number
    percentExhausted: number
    shouldGenerateNew: boolean
  }
  newKeywordGeneration?: {
    candidatesGenerated: number
    candidatesInserted: number
    errors: number
  }
  activeKeywords: number
  errors: number
}

/**
 * Run daily keyword rotation pipeline.
 * Called as part of runScoringJob() in server/run.ts.
 */
export async function runKeywordRotation(): Promise<KeywordRotationResult> {
  const result: KeywordRotationResult = {
    seasonalTransition: { activated: 0, deactivated: 0, errors: 0 },
    keywordHealth: {
      totalKeywords: 0,
      exhaustedCount: 0,
      percentExhausted: 0,
      shouldGenerateNew: false,
    },
    activeKeywords: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    console.log('[keyword-rotation] === Keyword rotation orchestration ===')

    // --- Phase 1: Seasonal transitions ---
    console.log('[keyword-rotation] Phase 1: Running seasonal transition...')
    const seasonalResult = await runSeasonalTransition()
    result.seasonalTransition = seasonalResult

    // --- Phase 2: Check keyword health ---
    console.log('[keyword-rotation] Phase 2: Checking keyword health...')
    const healthResult = await checkKeywordHealthAndGenerate()
    result.keywordHealth = healthResult

    // --- Phase 3: Generate new keywords if needed ---
    if (healthResult.shouldGenerateNew) {
      console.log(
        `[keyword-rotation] Phase 3: Triggering new keyword generation (${healthResult.percentExhausted}% exhausted)`
      )
      const genResult = await generateNewKeywordCandidates()
      result.newKeywordGeneration = genResult
    } else {
      console.log('[keyword-rotation] Phase 3: Skipped (keyword health OK)')
    }

    // --- Phase 4: Count active keywords ---
    const activeKeywords = await getActiveKeywords()
    result.activeKeywords = activeKeywords.length

    const duration = Date.now() - startedAt
    console.log(
      `[keyword-rotation] Rotation complete in ${duration}ms: seasonal=${result.seasonalTransition.activated} activated, health=${result.keywordHealth.percentExhausted}% exhausted, active=${result.activeKeywords}`
    )

    return result
  } catch (err) {
    console.error('[keyword-rotation] Unexpected error in rotation orchestration:', err)
    result.errors++
    return result
  }
}
