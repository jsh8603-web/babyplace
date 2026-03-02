/**
 * Seasonal keyword calendar — Auto-switching based on season.
 *
 * Seasons and their keywords (plan.md 9-2, 25):
 *   - 봄 (3~5월): 벚꽃, 공원, 봄 축제
 *   - 여름 (6~8월): 물놀이, 워터파크, 계곡
 *   - 가을 (9~11월): 단풍, 숲, 가을 축제
 *   - 겨울 (12~2월): 실내 시설, 눈썰매, 겨울 축제
 *
 * Logic:
 *   - 1개월 전: SEASONAL → ACTIVE (e.g., Feb 1 activates spring keywords)
 *   - 시즌 종료: ACTIVE → SEASONAL (e.g., Jun 1 deactivates spring, activates summer)
 *   - Runs daily during scoring job (plan.md 10-2, 05:00 KST)
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import {
  activateSeasonalKeyword,
  deactivateSeasonalKeyword,
  getSeasonalKeywordsForMonth,
} from './rotation-engine'

/**
 * Run seasonal keyword transitions for the current date.
 * Called daily during scoring job (plan.md 10-2).
 *
 * Logic:
 * - Current month: Keep active keywords for current season
 * - Next month (1 month early): Activate keywords for upcoming season
 * - Deactivate keywords for off-season
 */
export async function runSeasonalTransition(): Promise<{
  activated: number
  deactivated: number
  errors: number
}> {
  const result = { activated: 0, deactivated: 0, errors: 0 }

  try {
    const now = new Date()
    const currentMonth = now.getMonth() + 1 // 1-12
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1

    console.log(
      `[seasonal-calendar] Seasonal transition check: current=${currentMonth}, next=${nextMonth}`
    )

    // --- Phase 0: Seed default seasonal keywords if not already present ---
    const seedResult = await initializeDefaultSeasonalKeywords()
    if (seedResult.inserted > 0) {
      console.log(`[seasonal-calendar] Seeded ${seedResult.inserted} new seasonal keywords`)
    }

    // --- Phase 1: Activate keywords for upcoming season (1 month early) ---
    console.log('[seasonal-calendar] Phase 1: Activate upcoming season keywords...')
    const upcomingSeasonKeywords = await getSeasonalKeywordsForMonth(nextMonth)

    for (const keyword of upcomingSeasonKeywords) {
      const isAlreadyActive = keyword.status === 'ACTIVE'
      if (!isAlreadyActive) {
        const activated = await activateSeasonalKeyword(keyword.id)
        if (activated) {
          result.activated++
        } else {
          result.errors++
        }
      }
    }

    console.log(`[seasonal-calendar] Activated ${result.activated} keywords for next season`)

    // --- Phase 2: Deactivate off-season keywords ---
    // Find keywords with seasonal_months set that are ACTIVE/EXHAUSTED/DECLINING
    // but NOT in current or next month → deactivate back to SEASONAL
    console.log('[seasonal-calendar] Phase 2: Deactivate off-season keywords...')

    const { data: activeSeasonals, error: fetchError } = await supabaseAdmin
      .from('keywords')
      .select('*')
      .not('seasonal_months', 'is', null)
      .in('status', ['ACTIVE', 'EXHAUSTED', 'DECLINING'])

    if (fetchError) {
      console.warn('[seasonal-calendar] Failed to fetch active seasonal keywords:', fetchError)
      result.errors++
      return result
    }

    for (const kw of (activeSeasonals as any[]) || []) {
      const months: number[] = kw.seasonal_months ?? []
      if (months.length === 0) continue
      // If keyword's season does NOT include current or next month → deactivate
      if (!months.includes(currentMonth) && !months.includes(nextMonth)) {
        const deactivated = await deactivateSeasonalKeyword(kw.id)
        if (deactivated) {
          result.deactivated++
        } else {
          result.errors++
        }
      }
    }

    console.log(
      `[seasonal-calendar] Deactivated ${result.deactivated} off-season keywords`
    )

    console.log(
      `[seasonal-calendar] Seasonal transition complete: activated=${result.activated}, deactivated=${result.deactivated}`
    )
    return result
  } catch (err) {
    console.error('[seasonal-calendar] Unexpected error in seasonal transition:', err)
    result.errors++
    return result
  }
}

/**
 * Initialize pre-defined seasonal keywords.
 * Called during setup/migration to populate seasonal keywords if not already present.
 */
export async function initializeDefaultSeasonalKeywords(): Promise<{
  inserted: number
  errors: number
}> {
  const result = { inserted: 0, errors: 0 }

  const defaultSeasonalKeywords: { keyword: string; months: number[]; provider: string; keywordGroup?: string; isIndoor?: boolean | null }[] = [
    // Naver — Spring
    { keyword: '아기 벚꽃', months: [3, 4, 5], provider: 'naver' },
    { keyword: '아기 봄 공원', months: [3, 4, 5], provider: 'naver' },
    { keyword: '봄 축제', months: [3, 4, 5], provider: 'naver' },
    { keyword: '아기 봄나들이', months: [3, 4, 5], provider: 'naver' },
    // Naver — Summer
    { keyword: '아기 물놀이', months: [6, 7, 8], provider: 'naver' },
    { keyword: '아기 워터파크', months: [6, 7, 8], provider: 'naver' },
    { keyword: '아기 계곡', months: [6, 7, 8], provider: 'naver' },
    { keyword: '여름 물놀이터', months: [6, 7, 8], provider: 'naver' },
    // Naver — Autumn
    { keyword: '아기 단풍', months: [9, 10, 11], provider: 'naver' },
    { keyword: '아기 숲', months: [9, 10, 11], provider: 'naver' },
    { keyword: '가을 축제', months: [9, 10, 11], provider: 'naver' },
    { keyword: '아기 가을 공원', months: [9, 10, 11], provider: 'naver' },
    // Naver — Winter
    { keyword: '아기 실내', months: [12, 1, 2], provider: 'naver' },
    { keyword: '아기 눈썰매', months: [12, 1, 2], provider: 'naver' },
    { keyword: '겨울 실내놀이터', months: [12, 1, 2], provider: 'naver' },
    { keyword: '아기 온실', months: [12, 1, 2], provider: 'naver' },

    // Kakao — Summer
    { keyword: '물놀이장', months: [6, 7, 8], provider: 'kakao', keywordGroup: '수영/물놀이', isIndoor: false },
    { keyword: '유아워터파크', months: [6, 7, 8], provider: 'kakao', keywordGroup: '수영/물놀이', isIndoor: null },
    { keyword: '여름키즈', months: [6, 7, 8], provider: 'kakao', keywordGroup: '놀이', isIndoor: null },
    // Kakao — Winter
    { keyword: '실내키즈카페', months: [12, 1, 2], provider: 'kakao', keywordGroup: '놀이', isIndoor: true },
    { keyword: '눈썰매장', months: [12, 1, 2], provider: 'kakao', keywordGroup: '놀이', isIndoor: false },
    { keyword: '실내놀이공원', months: [12, 1, 2], provider: 'kakao', keywordGroup: '놀이', isIndoor: true },
    // Kakao — Spring
    { keyword: '벚꽃놀이터', months: [3, 4, 5], provider: 'kakao', keywordGroup: '공원/놀이터', isIndoor: false },
    { keyword: '봄나들이', months: [3, 4, 5], provider: 'kakao', keywordGroup: '동물/자연', isIndoor: false },
    // Kakao — Autumn
    { keyword: '단풍공원', months: [9, 10, 11], provider: 'kakao', keywordGroup: '공원/놀이터', isIndoor: false },
    { keyword: '가을체험', months: [9, 10, 11], provider: 'kakao', keywordGroup: '전시/체험', isIndoor: false },
  ]

  for (const { keyword, months, provider, keywordGroup, isIndoor } of defaultSeasonalKeywords) {
    try {
      const { error } = await supabaseAdmin.from('keywords').insert({
        keyword,
        provider,
        keyword_group: keywordGroup || null,
        is_indoor: isIndoor ?? null,
        status: 'SEASONAL',
        seasonal_months: months,
        source: 'seasonal',
        efficiency_score: 0,
        cycle_count: 0,
        consecutive_zero_new: 0,
        created_at: new Date().toISOString(),
      })

      if (error) {
        if (error.code !== '23505') {
          // Ignore duplicate key errors
          console.warn(`[seasonal-calendar] Failed to insert seasonal keyword "${keyword}":`, error)
          result.errors++
        }
      } else {
        result.inserted++
      }
    } catch (err) {
      console.error(`[seasonal-calendar] Unexpected error inserting seasonal keyword "${keyword}":`, err)
      result.errors++
    }
  }

  console.log(`[seasonal-calendar] Initialized ${result.inserted} default seasonal keywords`)
  return result
}
