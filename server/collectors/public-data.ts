/**
 * Public Data Collectors — data.go.kr API integration
 *
 * Covers plan.md sections 18-15, 18-6 (public data).
 *
 * Four separate data sources:
 *   1. Children playgrounds (divId=I)
 *   2. City parks (filter by children's parks)
 *   3. Libraries (filter by children's libraries)
 *   4. Museums/galleries (collect all then tag)
 *
 * Flow:
 *   - Fetch paginated results from data.go.kr APIs
 *   - Convert coordinates to WGS84 (lng, lat)
 *   - Filter to Seoul/Gyeonggi service area
 *   - Check for duplicates
 *   - Upsert into places table
 *   - Log results to collection_logs
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'

// API Response Types

interface DataGoKrResponse<T> {
  response: {
    header: {
      resultCode: string
      resultMsg: string
      type: string
    }
    body: {
      items: {
        item: T[]
      }
      numOfRows: number
      pageNo: number
      totalCount: number
    }
  }
}

interface PlaygroundItem {
  bizplcNm: string
  facilityNm: string
  addr: string
  lat: string
  lng: string
  telNo: string
}

interface ParkItem {
  parkNm: string
  parkAddr: string
  latitude: string
  longitude: string
  facilityDtls?: string
}

interface LibraryItem {
  lbrryNm: string
  lbrryTyNm: string
  addr: string
  latitude: string
  longitude: string
  telNo?: string
}

interface MuseumItem {
  mnmusNm: string
  addr: string
  latitude: string
  longitude: string
  telNo?: string
  admssnCharge?: string
}

// Main export

export interface PublicDataResult {
  playgrounds: { fetched: number; new: number; duplicates: number; errors: number }
  parks: { fetched: number; new: number; duplicates: number; errors: number }
  libraries: { fetched: number; new: number; duplicates: number; errors: number }
  museums: { fetched: number; new: number; duplicates: number; errors: number }
  totalFetched: number
  totalNew: number
  totalDuplicates: number
  totalErrors: number
}

export async function runPublicData(): Promise<PublicDataResult> {
  const result: PublicDataResult = {
    playgrounds: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    parks: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    libraries: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    museums: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    totalFetched: 0,
    totalNew: 0,
    totalDuplicates: 0,
    totalErrors: 0,
  }

  const startedAt = Date.now()

  try {
    console.log('[public-data] Fetching playgrounds...')
    await fetchPlaygrounds(result.playgrounds)

    console.log('[public-data] Fetching parks...')
    await fetchParks(result.parks)

    console.log('[public-data] Fetching libraries...')
    await fetchLibraries(result.libraries)

    console.log('[public-data] Fetching museums...')
    await fetchMuseums(result.museums)
  } catch (err) {
    console.error('[public-data] Fatal error:', err)
    result.totalErrors++
  }

  // Calculate totals
  result.totalFetched =
    result.playgrounds.fetched +
    result.parks.fetched +
    result.libraries.fetched +
    result.museums.fetched
  result.totalNew =
    result.playgrounds.new +
    result.parks.new +
    result.libraries.new +
    result.museums.new
  result.totalDuplicates =
    result.playgrounds.duplicates +
    result.parks.duplicates +
    result.libraries.duplicates +
    result.museums.duplicates
  result.totalErrors =
    result.playgrounds.errors +
    result.parks.errors +
    result.libraries.errors +
    result.museums.errors

  // Log to collection_logs
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'public-data-go.kr',
    results_count: result.totalFetched,
    new_places: result.totalNew,
    status: result.totalErrors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  return result
}

// Data Source 1: Playgrounds

interface PlaygroundStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchPlaygrounds(stats: PlaygroundStats): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping playgrounds')
    stats.errors++
    return
  }

  const baseUrl = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong'
  let pageNo = 1
  const pageSize = 100

  while (true) {
    try {
      const url = new URL(baseUrl)
      url.searchParams.set('serviceKey', serviceKey)
      url.searchParams.set('pageNo', String(pageNo))
      url.searchParams.set('numOfRows', String(pageSize))
      url.searchParams.set('type', 'json')
      url.searchParams.set('divId', 'I')

      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`[public-data] Playgrounds HTTP ${response.status}`)
        stats.errors++
        break
      }

      const data = (await response.json()) as DataGoKrResponse<PlaygroundItem>
      const items = data.response.body.items.item || []

      if (!items || items.length === 0) break

      for (const item of items) {
        try {
          const lat = parseFloat(item.lat)
          const lng = parseFloat(item.lng)
          const address = item.addr || ''

          if (!isInServiceRegion(lat, lng, address)) continue

          const name = item.bizplcNm || item.facilityNm
          const dup = await checkDuplicate({
            kakaoPlaceId: `playground_${item.bizplcNm}_${item.addr}`.replace(/\s+/g, '_'),
            name,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            stats.duplicates++
            continue
          }

          const districtCode = await getDistrictCode(lat, lng, address)

          const { error } = await supabaseAdmin.from('places').insert({
            name,
            category: '공원/놀이터' as PlaceCategory,
            sub_category: item.facilityNm || 'Children playground',
            address,
            lat,
            lng,
            district_code: districtCode,
            phone: item.telNo || null,
            source: 'public-data-go.kr',
            source_id: `playground_${item.bizplcNm}`,
            is_indoor: false,
            is_active: true,
          })

          if (error) {
            if (error.code === '23505') {
              stats.duplicates++
            } else {
              console.error('[public-data] Playground insert error:', error.message)
              stats.errors++
            }
          } else {
            stats.new++
          }

          stats.fetched++
        } catch (err) {
          console.error('[public-data] Playground item error:', err)
          stats.errors++
        }
      }

      if (items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Playgrounds fetch error:', err)
      stats.errors++
      break
    }
  }
}

// Data Source 2: Parks

interface ParkStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchParks(stats: ParkStats): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping parks')
    stats.errors++
    return
  }

  const baseUrl = 'https://apis.data.go.kr/B553881/CityParkInfoService/cityParkList'
  let pageNo = 1
  const pageSize = 100

  while (true) {
    try {
      const url = new URL(baseUrl)
      url.searchParams.set('serviceKey', serviceKey)
      url.searchParams.set('pageNo', String(pageNo))
      url.searchParams.set('numOfRows', String(pageSize))
      url.searchParams.set('type', 'json')

      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`[public-data] Parks HTTP ${response.status}`)
        stats.errors++
        break
      }

      const data = (await response.json()) as DataGoKrResponse<ParkItem>
      const items = data.response.body.items.item || []

      if (!items || items.length === 0) break

      for (const item of items) {
        try {
          if (!item.parkNm || !item.parkNm.includes('어린이')) continue

          const lat = parseFloat(item.latitude)
          const lng = parseFloat(item.longitude)
          const address = item.parkAddr || ''

          if (!isInServiceRegion(lat, lng, address)) continue

          const dup = await checkDuplicate({
            kakaoPlaceId: `park_${item.parkNm}`.replace(/\s+/g, '_'),
            name: item.parkNm,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            stats.duplicates++
            continue
          }

          const districtCode = await getDistrictCode(lat, lng, address)

          const { error } = await supabaseAdmin.from('places').insert({
            name: item.parkNm,
            category: '공원/놀이터' as PlaceCategory,
            sub_category: 'City park',
            address,
            lat,
            lng,
            district_code: districtCode,
            source: 'public-data-go.kr',
            source_id: `park_${item.parkNm}`,
            is_indoor: false,
            is_active: true,
          })

          if (error) {
            if (error.code === '23505') {
              stats.duplicates++
            } else {
              console.error('[public-data] Park insert error:', error.message)
              stats.errors++
            }
          } else {
            stats.new++
          }

          stats.fetched++
        } catch (err) {
          console.error('[public-data] Park item error:', err)
          stats.errors++
        }
      }

      if (items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Parks fetch error:', err)
      stats.errors++
      break
    }
  }
}

// Data Source 3: Libraries

interface LibraryStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchLibraries(stats: LibraryStats): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping libraries')
    stats.errors++
    return
  }

  const baseUrl = 'https://apis.data.go.kr/B553881/LibraryInfoService/libraryListOpenApi'
  let pageNo = 1
  const pageSize = 100

  while (true) {
    try {
      const url = new URL(baseUrl)
      url.searchParams.set('serviceKey', serviceKey)
      url.searchParams.set('pageNo', String(pageNo))
      url.searchParams.set('numOfRows', String(pageSize))
      url.searchParams.set('type', 'json')

      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`[public-data] Libraries HTTP ${response.status}`)
        stats.errors++
        break
      }

      const data = (await response.json()) as DataGoKrResponse<LibraryItem>
      const items = data.response.body.items.item || []

      if (!items || items.length === 0) break

      for (const item of items) {
        try {
          if (!item.lbrryTyNm || !item.lbrryTyNm.includes('어린이')) continue

          const lat = parseFloat(item.latitude)
          const lng = parseFloat(item.longitude)
          const address = item.addr || ''

          if (!isInServiceRegion(lat, lng, address)) continue

          const dup = await checkDuplicate({
            kakaoPlaceId: `library_${item.lbrryNm}`.replace(/\s+/g, '_'),
            name: item.lbrryNm,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            stats.duplicates++
            continue
          }

          const districtCode = await getDistrictCode(lat, lng, address)

          const { error } = await supabaseAdmin.from('places').insert({
            name: item.lbrryNm,
            category: '도서관' as PlaceCategory,
            sub_category: item.lbrryTyNm || 'Children library',
            address,
            lat,
            lng,
            district_code: districtCode,
            phone: item.telNo || null,
            source: 'public-data-go.kr',
            source_id: `library_${item.lbrryNm}`,
            is_indoor: true,
            is_active: true,
          })

          if (error) {
            if (error.code === '23505') {
              stats.duplicates++
            } else {
              console.error('[public-data] Library insert error:', error.message)
              stats.errors++
            }
          } else {
            stats.new++
          }

          stats.fetched++
        } catch (err) {
          console.error('[public-data] Library item error:', err)
          stats.errors++
        }
      }

      if (items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Libraries fetch error:', err)
      stats.errors++
      break
    }
  }
}

// Data Source 4: Museums

interface MuseumStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchMuseums(stats: MuseumStats): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping museums')
    stats.errors++
    return
  }

  const baseUrl = 'https://apis.data.go.kr/B553881/MuseumInfoService/museumListOpenApi'
  let pageNo = 1
  const pageSize = 100

  while (true) {
    try {
      const url = new URL(baseUrl)
      url.searchParams.set('serviceKey', serviceKey)
      url.searchParams.set('pageNo', String(pageNo))
      url.searchParams.set('numOfRows', String(pageSize))
      url.searchParams.set('type', 'json')

      const response = await fetch(url.toString())
      if (!response.ok) {
        console.error(`[public-data] Museums HTTP ${response.status}`)
        stats.errors++
        break
      }

      const data = (await response.json()) as DataGoKrResponse<MuseumItem>
      const items = data.response.body.items.item || []

      if (!items || items.length === 0) break

      for (const item of items) {
        try {
          const lat = parseFloat(item.latitude)
          const lng = parseFloat(item.longitude)
          const address = item.addr || ''

          if (!isInServiceRegion(lat, lng, address)) continue

          const dup = await checkDuplicate({
            kakaoPlaceId: `museum_${item.mnmusNm}`.replace(/\s+/g, '_'),
            name: item.mnmusNm,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            stats.duplicates++
            continue
          }

          const districtCode = await getDistrictCode(lat, lng, address)
          const category = '전시/체험' as PlaceCategory

          const { error } = await supabaseAdmin.from('places').insert({
            name: item.mnmusNm,
            category,
            sub_category: item.mnmusNm.includes('미술관') ? 'Art gallery' : 'Museum',
            address,
            lat,
            lng,
            district_code: districtCode,
            phone: item.telNo || null,
            source: 'public-data-go.kr',
            source_id: `museum_${item.mnmusNm}`,
            is_indoor: true,
            is_active: true,
          })

          if (error) {
            if (error.code === '23505') {
              stats.duplicates++
            } else {
              console.error('[public-data] Museum insert error:', error.message)
              stats.errors++
            }
          } else {
            stats.new++
          }

          stats.fetched++
        } catch (err) {
          console.error('[public-data] Museum item error:', err)
          stats.errors++
        }
      }

      if (items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Museums fetch error:', err)
      stats.errors++
      break
    }
  }
}
