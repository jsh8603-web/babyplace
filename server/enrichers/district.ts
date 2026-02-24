/**
 * Administrative district (행정동) assignment for places.
 *
 * Uses @turf/boolean-point-in-polygon with a GeoJSON dataset stored at
 * data/districts/seoul_gyeonggi.json.
 *
 * Falls back to address-string parsing when GeoJSON is unavailable or the
 * point does not intersect any polygon (e.g. border regions).
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// Turf types — only imported if GeoJSON is available
let booleanPointInPolygon: ((pt: unknown, polygon: unknown) => boolean) | null =
  null
let turfPoint: ((coords: [number, number]) => unknown) | null = null

interface DistrictFeature {
  type: 'Feature'
  geometry: unknown
  properties: {
    adm_cd: string
    adm_nm?: string
    [key: string]: unknown
  }
}

interface DistrictGeoJSON {
  type: 'FeatureCollection'
  features: DistrictFeature[]
}

let districtsGeoJSON: DistrictGeoJSON | null = null
let geojsonLoadAttempted = false

/**
 * Lazily loads the district GeoJSON and Turf functions.
 * If the file does not exist or turf is not installed, silently skips.
 */
async function loadGeoJSON(): Promise<void> {
  if (geojsonLoadAttempted) return
  geojsonLoadAttempted = true

  const geojsonPath = join(process.cwd(), 'data', 'districts', 'seoul_gyeonggi.json')
  if (!existsSync(geojsonPath)) {
    console.warn('[district] GeoJSON not found at', geojsonPath, '— using address fallback')
    return
  }

  try {
    const raw = readFileSync(geojsonPath, 'utf-8')
    districtsGeoJSON = JSON.parse(raw) as DistrictGeoJSON

    // Dynamically import Turf (optional dependency)
    const turfPip = await import('@turf/boolean-point-in-polygon')
    const turfHelpers = await import('@turf/helpers')
    booleanPointInPolygon =
      (turfPip.default as typeof booleanPointInPolygon) ?? turfPip.booleanPointInPolygon
    turfPoint =
      (turfHelpers.point as typeof turfPoint) ?? turfHelpers.default?.point
  } catch (err) {
    console.warn('[district] Failed to load GeoJSON or turf:', err)
    districtsGeoJSON = null
  }
}

/**
 * Returns the 행정동 code for a given coordinate pair.
 *
 * Priority:
 *   1. GeoJSON point-in-polygon (if available)
 *   2. Address string prefix fallback (less accurate)
 *   3. null — if neither method works
 */
export async function getDistrictCode(
  lat: number,
  lng: number,
  address?: string | null
): Promise<string | null> {
  await loadGeoJSON()

  // --- Method 1: GeoJSON point-in-polygon ---
  if (districtsGeoJSON && booleanPointInPolygon && turfPoint) {
    try {
      const pt = turfPoint([lng, lat]) // turf uses [lng, lat]
      for (const feature of districtsGeoJSON.features) {
        if (booleanPointInPolygon(pt, feature)) {
          return feature.properties.adm_cd
        }
      }
    } catch (err) {
      console.warn('[district] Point-in-polygon error:', err)
    }
  }

  // --- Method 2: Address-based fallback ---
  if (address) {
    return extractDistrictCodeFromAddress(address)
  }

  return null
}

/**
 * Extracts a rough district code from an address string.
 * Format: first two tokens joined, lowercased (approximate).
 * Returns a string like "서울강남구" — not an official code but useful for grouping.
 */
function extractDistrictCodeFromAddress(address: string): string | null {
  const parts = address.trim().split(/\s+/)
  if (parts.length < 2) return null

  // Use first 3 parts (시/도 + 시/구 + 동/읍/면 when available)
  return parts.slice(0, 3).join('_').replace(/[^\uAC00-\uD7A3a-zA-Z0-9_]/g, '')
}
