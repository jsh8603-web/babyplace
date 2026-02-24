/**
 * LOCALDATA Collector — License-based data collection
 *
 * Covers plan.md 2-1 (play category) and additional data sources.
 *
 * Fetches:
 *   - Kids cafes (food service license)
 *   - Indoor play facilities (amusement facility type)
 *   - Other child-friendly facilities
 *
 * Data sources:
 *   - LOCALDATA API: Nationwide business license data
 *   - Address format: "Seoul city Gangnam-gu ...", "Gyeonggi-do Seongnam-si ..."
 *   - Coordinates: WGS84 (lng, lat)
 *
 * Flow:
 *   - Query LOCALDATA API by facility type + region
 *   - Filter to Seoul/Gyeonggi service area
 *   - Check for duplicates
 *   - Enrich with district code
 *   - Upsert into places table
 *   - Log results to collection_logs
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'

// LOCALDATA API Types

interface LocalDataResponse<T> {
  code: string
  message: string
  data?: {
    page: number
    perPage: number
    totalCount: number
    totalPage: number
    items: T[]
  }
}

interface LocalDataPlace {
  bizplaceId: string
  bizplaceName: string
  licenseName?: string
  licenseType?: string
  address: string
  addressOld?: string
  lat: number
  lng: number
  phone?: string
  homepage?: string
  createdDate?: string
  licenseDate?: string
}

// Search targets

interface LocalDataTarget {
  keyword: string
  licenseType?: string
  babyCategory: PlaceCategory
  isIndoor: boolean
  subCategory: string
}

/**
 * LOCALDATA search targets based on facility type and keyword.
 * Each target is searched independently (pagination until no results).
 */
const SEARCH_TARGETS: LocalDataTarget[] = [
  {
    keyword: 'kids cafe',
    licenseType: 'FD',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: 'Kids cafe',
  },
  {
    keyword: 'indoor play',
    licenseType: 'FD',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: 'Indoor play',
  },
  {
    keyword: 'ball pool',
    licenseType: 'FD',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: 'Ball pool',
  },
  {
    keyword: 'children play facility',
    licenseType: 'AM',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: 'Play facility',
  },
  {
    keyword: 'toddler play',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: 'Toddler play',
  },
]

const LOCALDATA_API_BASE = 'https://api.localdata.com/v2/search'
const PAGE_SIZE = 100
const MAX_PAGES = 50

// Main export

export interface LocalDataResult {
  totalFetched: number
  newPlaces: number
  duplicates: number
  skippedOutOfArea: number
  errors: number
}

export async function runLocalData(): Promise<LocalDataResult> {
  const result: LocalDataResult = {
    totalFetched: 0,
    newPlaces: 0,
    duplicates: 0,
    skippedOutOfArea: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  for (const target of SEARCH_TARGETS) {
    try {
      await processTarget(target, result)
    } catch (err) {
      console.error(`[localdata] Error processing target "${target.keyword}":`, err)
      result.errors++
    }
  }

  // Log summary to collection_logs
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'localdata',
    results_count: result.totalFetched,
    new_places: result.newPlaces,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  return result
}

// Per-target processing

async function processTarget(target: LocalDataTarget, result: LocalDataResult): Promise<void> {
  let page = 1

  while (page <= MAX_PAGES) {
    const items = await fetchLocalDataPage(target, page)
    if (items === null) break
    if (items.length === 0) break

    result.totalFetched += items.length

    for (const item of items) {
      try {
        const lat = item.lat
        const lng = item.lng
        const address = item.address || item.addressOld || ''

        if (!isInServiceRegion(lat, lng, address)) {
          result.skippedOutOfArea++
          continue
        }

        const dup = await checkDuplicate({
          kakaoPlaceId: `localdata_${item.bizplaceId}`,
          name: item.bizplaceName,
          address,
          lat,
          lng,
        })

        if (dup.isDuplicate && dup.existingId) {
          result.duplicates++
          continue
        }

        // New place insertion
        const districtCode = await getDistrictCode(lat, lng, address)

        const { error } = await supabaseAdmin.from('places').insert({
          name: item.bizplaceName,
          category: target.babyCategory,
          sub_category: target.subCategory,
          address,
          lat,
          lng,
          district_code: districtCode,
          phone: item.phone || null,
          homepage: item.homepage || null,
          source: 'localdata',
          source_id: item.bizplaceId,
          is_indoor: target.isIndoor,
          is_active: true,
        })

        if (error) {
          if (error.code === '23505') {
            result.duplicates++
          } else {
            console.error('[localdata] Insert error:', error.message, item.bizplaceId)
            result.errors++
          }
        } else {
          result.newPlaces++
        }
      } catch (err) {
        console.error('[localdata] Item processing error:', err)
        result.errors++
      }
    }

    page++
  }
}

// LOCALDATA API fetch

async function fetchLocalDataPage(
  target: LocalDataTarget,
  page: number
): Promise<LocalDataPlace[] | null> {
  const apiKey = process.env.LOCALDATA_API_KEY
  if (!apiKey) {
    console.warn('[localdata] LOCALDATA_API_KEY not set, cannot fetch')
    return null
  }

  const params = new URLSearchParams({
    query: target.keyword,
    page: String(page),
    perPage: String(PAGE_SIZE),
    sort: 'accuracy',
  })

  if (target.licenseType) {
    params.set('licenseType', target.licenseType)
  }

  const regionFilter = ['Seoul', 'Gyeonggi', 'Incheon']
  params.set('region', regionFilter.join('|'))

  const url = `${LOCALDATA_API_BASE}?${params.toString()}`

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error(
        `[localdata] API HTTP ${response.status} for "${target.keyword}" page ${page}`
      )
      return null
    }

    const data = (await response.json()) as LocalDataResponse<LocalDataPlace>

    if (!data.data || !data.data.items) {
      return []
    }

    return data.data.items
  } catch (err) {
    console.error('[localdata] Fetch error:', err)
    return null
  }
}

// Utility: Coordinate conversion (if needed)

/**
 * Converts LOCALDATA coordinates to WGS84 if needed.
 * For now, assumes LOCALDATA returns WGS84 (lat/lng).
 */
function ensureWGS84(lat: number, lng: number): { lat: number; lng: number } {
  return { lat, lng }
}
