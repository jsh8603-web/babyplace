/**
 * Density control: limit the number of active places per district.
 *
 * Enforces district-based Top-N visibility (plan.md 8-2):
 *   - 행정 동 (지역별로 상위 N개만 표시)
 *   - 저순위 장소: is_active = false 처리 (데이터 유지하되 지도에 미표시)
 *
 * Zoom-level-based density:
 *   - 줌 7-9: Top 5 per 시/도
 *   - 줌 10-12: Top 10 per 구
 *   - 줌 13-14: Top 20 per 동
 *   - 줌 15+: unlimited (뷰포트 내 전체, 최대 200)
 *
 * This module enforces zoom 13-14 density (Top 20 per 동).
 * Runs after scoring batch to ensure consistent ranking.
 */

import { supabaseAdmin } from '../lib/supabase-admin'

export interface DensityControlResult {
  districtsProcessed: number
  placesDeactivated: number
  errors: number
}

// District-based Top-N thresholds
const PLACES_PER_DISTRICT_TOP_N = 20

export async function runDensityControl(): Promise<DensityControlResult> {
  const result: DensityControlResult = {
    districtsProcessed: 0,
    placesDeactivated: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    // Fetch all districts that have places
    const { data: allPlacesData, error: fetchDistrictsError } = await supabaseAdmin
      .from('places')
      .select('district_code')
      .eq('is_active', true)
      .not('district_code', 'is', null)

    if (fetchDistrictsError || !allPlacesData) {
      console.error('[density] Failed to fetch districts:', fetchDistrictsError)
      result.errors++
      return result
    }

    // Get unique district codes
    const uniqueDistricts = new Set(
      allPlacesData.map((p) => p.district_code).filter((dc) => dc)
    )

    console.log(`[density] Processing ${uniqueDistricts.size} districts`)

    // For each district, enforce Top-N by popularity_score
    for (const districtCode of uniqueDistricts) {
      if (!districtCode) continue

      try {
        await enforceDistrictTopN(districtCode, PLACES_PER_DISTRICT_TOP_N)
        result.districtsProcessed++
      } catch (err) {
        console.error(`[density] Error processing district "${districtCode}":`, err)
        result.errors++
      }
    }

    // Log density control run
    const { error: logError } = await supabaseAdmin.from('collection_logs').insert({
      collector: 'density-control',
      results_count: result.districtsProcessed,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })

    if (logError) {
      console.error('[density] Failed to log density control run:', logError)
      result.errors++
    }

    console.log(
      `[density] Completed: ${result.districtsProcessed} districts, ${result.placesDeactivated} places deactivated`
    )

    return result
  } catch (err) {
    console.error('[density] Fatal error:', err)
    result.errors++
    return result
  }
}

// ─── District enforcement ─────────────────────────────────────────────────────

/**
 * Enforces Top-N rule for a single district:
 *   1. Fetch top N places by popularity_score (DESC)
 *   2. Fetch remaining places (rank > N)
 *   3. Deactivate places beyond top N
 *
 * Side effect: Updates places.is_active = false for low-ranked places.
 */
async function enforceDistrictTopN(
  districtCode: string,
  topN: number
): Promise<void> {
  // Fetch all places in the district, ordered by popularity_score DESC
  const { data: allPlaces, error: fetchError } = await supabaseAdmin
    .from('places')
    .select('id, name, popularity_score, is_active')
    .eq('district_code', districtCode)
    .order('popularity_score', { ascending: false })

  if (fetchError || !allPlaces) {
    throw new Error(
      `Failed to fetch places for district "${districtCode}": ${fetchError?.message}`
    )
  }

  if (allPlaces.length <= topN) {
    // All places fit within Top-N — no deactivation needed
    return
  }

  // Places beyond Top-N
  const toDeactivate = allPlaces.slice(topN)
  const deactivateIds = toDeactivate.map((p) => p.id)

  // Batch deactivate (only if they were previously active)
  const { error: updateError } = await supabaseAdmin
    .from('places')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .in('id', deactivateIds)
    .eq('is_active', true)

  if (updateError) {
    throw new Error(
      `Failed to deactivate places in district "${districtCode}": ${updateError.message}`
    )
  }

  // Log deactivation
  console.log(
    `[density] District "${districtCode}": kept top ${topN}, deactivated ${toDeactivate.length} places. ` +
      `Top scorer: "${allPlaces[0]?.name}" (${allPlaces[0]?.popularity_score?.toFixed(3)})`
  )
}
