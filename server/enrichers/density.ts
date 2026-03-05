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
import { logCollection } from '../lib/collection-log'

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
    // Single query: fetch all places with district_code and popularity_score
    const { data: allPlacesData, error: fetchError } = await supabaseAdmin
      .from('places')
      .select('id, name, district_code, popularity_score, is_active')
      .not('district_code', 'is', null)
      .not('popularity_score', 'is', null)
      .order('popularity_score', { ascending: false })

    if (fetchError || !allPlacesData) {
      console.error('[density] Failed to fetch places:', fetchError)
      result.errors++
      return result
    }

    // Group by district_code in memory (already sorted by popularity_score DESC)
    const districtMap = new Map<string, typeof allPlacesData>()
    for (const place of allPlacesData) {
      if (!place.district_code) continue
      const list = districtMap.get(place.district_code)
      if (list) {
        list.push(place)
      } else {
        districtMap.set(place.district_code, [place])
      }
    }

    console.log(`[density] Processing ${districtMap.size} districts (${allPlacesData.length} places)`)

    // For each district, enforce Top-N from in-memory data
    for (const [districtCode, places] of districtMap) {
      try {
        await enforceDistrictTopN(districtCode, PLACES_PER_DISTRICT_TOP_N, places)
        result.districtsProcessed++
      } catch (err) {
        console.error(`[density] Error processing district "${districtCode}":`, err)
        result.errors++
      }
    }

    // Log density control run
    await logCollection({
      collector: 'density-control',
      startedAt,
      resultsCount: result.districtsProcessed,
      errors: result.errors,
    })

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
 * Enforces Top-N rule for a single district using pre-fetched data.
 * Places are already sorted by popularity_score DESC.
 */
async function enforceDistrictTopN(
  districtCode: string,
  topN: number,
  allPlaces: Array<{ id: number; name: string; popularity_score: number | null; is_active: boolean }>
): Promise<void> {
  // Reactivate top-N places that were previously deactivated (score recovered)
  const topNPlaces = allPlaces.slice(0, topN)
  const toReactivate = topNPlaces.filter((p) => !p.is_active).map((p) => p.id)
  if (toReactivate.length > 0) {
    await supabaseAdmin
      .from('places')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in('id', toReactivate)
  }

  if (allPlaces.length <= topN) {
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
