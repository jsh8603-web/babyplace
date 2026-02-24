/**
 * Pipeline A — Kakao category/keyword search → places upsert
 *
 * Covers plan.md sections 18-5, 18-6, 18-9.
 *
 * Flow:
 *   For each (category_code, keyword) pair in SEARCH_TARGETS:
 *     → Fetch all pages from Kakao Local API
 *     → Filter to Seoul/Gyeonggi service area
 *     → Check for duplicates (kakao_place_id first, then name+proximity)
 *     → Upsert into places table
 *     → Log result to collection_logs
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { kakaoLimiter } from '../rate-limiter'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'

// ─── Kakao API types ─────────────────────────────────────────────────────────

interface KakaoDocument {
  id: string
  place_name: string
  category_name: string
  category_group_code: string
  address_name: string
  road_address_name: string
  x: string // lng
  y: string // lat
  phone: string
  place_url: string
}

interface KakaoSearchResponse {
  documents: KakaoDocument[]
  meta: {
    is_end: boolean
    pageable_count: number
    total_count: number
  }
}

// ─── Category + keyword search targets ───────────────────────────────────────

interface SearchTarget {
  kakaoCategory?: string       // category_group_code (e.g. CE7, FD6, CT1, AT4)
  keyword?: string             // free-text keyword search
  babyCategory: PlaceCategory  // BabyPlace category mapping
  isIndoor: boolean | null
}

/**
 * Search targets based on plan.md 18-5.
 * Each entry triggers a full area scan.
 *
 * Seoul/Gyeonggi is divided into a grid of rect queries because the Kakao
 * category API returns max 45 pages × 15 items = 675 items per rect.
 * A 2-column × 3-row grid (6 rects) covers the full service area.
 */
const SEARCH_TARGETS: SearchTarget[] = [
  // Kakao category codes
  { kakaoCategory: 'CE7', babyCategory: '식당/카페', isIndoor: true },
  { kakaoCategory: 'FD6', babyCategory: '식당/카페', isIndoor: true },
  { kakaoCategory: 'CT1', babyCategory: '전시/체험', isIndoor: true },
  { kakaoCategory: 'AT4', babyCategory: '동물/자연', isIndoor: null },
  // Keyword searches (not covered by category codes)
  { keyword: '키즈카페', babyCategory: '놀이', isIndoor: true },
  { keyword: '실내놀이터', babyCategory: '놀이', isIndoor: true },
  { keyword: '볼풀', babyCategory: '놀이', isIndoor: true },
  { keyword: '어린이공원', babyCategory: '공원/놀이터', isIndoor: false },
  { keyword: '놀이터', babyCategory: '공원/놀이터', isIndoor: false },
  { keyword: '어린이도서관', babyCategory: '도서관', isIndoor: true },
  { keyword: '유아수영장', babyCategory: '수영/물놀이', isIndoor: true },
  { keyword: '키즈풀', babyCategory: '수영/물놀이', isIndoor: true },
  { keyword: '키즈존 식당', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '이유식카페', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '이유식', babyCategory: '식당/카페', isIndoor: true },
  { keyword: '어린이박물관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '과학관', babyCategory: '전시/체험', isIndoor: true },
  { keyword: '동물원', babyCategory: '동물/자연', isIndoor: false },
  { keyword: '아쿠아리움', babyCategory: '동물/자연', isIndoor: true },
]

/**
 * Grid of rect parameters (swLng,swLat,neLng,neLat) covering Seoul + Gyeonggi + Incheon.
 * 2 columns × 3 rows = 6 rectangles.
 */
const SERVICE_AREA_RECTS: string[] = [
  // Row 1 (south, lat 36.9–37.3)
  '126.5,36.9,127.2,37.3', // west
  '127.2,36.9,127.9,37.3', // east
  // Row 2 (middle, lat 37.3–37.65)
  '126.5,37.3,127.2,37.65',
  '127.2,37.3,127.9,37.65',
  // Row 3 (north, lat 37.65–38.0)
  '126.5,37.65,127.2,38.0',
  '127.2,37.65,127.9,38.0',
]

const KAKAO_API_BASE = 'https://dapi.kakao.com/v2/local/search'
const MAX_PAGES = 45
const PAGE_SIZE = 15

// ─── Main export ─────────────────────────────────────────────────────────────

export interface PipelineAResult {
  totalFetched: number
  newPlaces: number
  duplicates: number
  skippedOutOfArea: number
  errors: number
}

export async function runPipelineA(): Promise<PipelineAResult> {
  const result: PipelineAResult = {
    totalFetched: 0,
    newPlaces: 0,
    duplicates: 0,
    skippedOutOfArea: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  for (const target of SEARCH_TARGETS) {
    for (const rect of SERVICE_AREA_RECTS) {
      try {
        await processTarget(target, rect, result)
      } catch (err) {
        console.error(
          `[pipeline-a] Error processing target ${target.keyword ?? target.kakaoCategory} rect=${rect}:`,
          err
        )
        result.errors++
      }
    }
  }

  // Log summary to collection_logs
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'pipeline-a-kakao-category',
    results_count: result.totalFetched,
    new_places: result.newPlaces,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  return result
}

// ─── Per-target processing ────────────────────────────────────────────────────

async function processTarget(
  target: SearchTarget,
  rect: string,
  result: PipelineAResult
): Promise<void> {
  let page = 1

  while (page <= MAX_PAGES) {
    const docs = await fetchKakaoPage(target, rect, page)
    if (docs === null) break // rate limit error or empty
    if (docs.documents.length === 0) break

    result.totalFetched += docs.documents.length

    for (const doc of docs.documents) {
      const lat = parseFloat(doc.y)
      const lng = parseFloat(doc.x)
      const address = doc.road_address_name || doc.address_name

      if (!isInServiceRegion(lat, lng, address)) {
        result.skippedOutOfArea++
        continue
      }

      const dup = await checkDuplicate({
        kakaoPlaceId: doc.id,
        name: doc.place_name,
        address,
        lat,
        lng,
      })

      if (dup.isDuplicate && dup.existingId) {
        // Bump mention_count to record that Kakao still knows about this place
        await supabaseAdmin
          .from('places')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', dup.existingId)
        result.duplicates++
        continue
      }

      // New place → insert
      const districtCode = await getDistrictCode(lat, lng, address)
      const category = target.babyCategory
      const subCategory = normalizeSubCategory(doc.category_name)

      const { error } = await supabaseAdmin.from('places').insert({
        name: doc.place_name,
        category,
        sub_category: subCategory,
        address: doc.address_name || null,
        road_address: doc.road_address_name || null,
        district_code: districtCode,
        lat,
        lng,
        phone: doc.phone || null,
        source: 'kakao',
        source_id: doc.id,
        kakao_place_id: doc.id,
        is_indoor: target.isIndoor,
        is_active: true,
      })

      if (error) {
        // Unique constraint violation on kakao_place_id → already exists
        if (error.code === '23505') {
          result.duplicates++
        } else {
          console.error('[pipeline-a] Insert error:', error.message, doc.id)
          result.errors++
        }
      } else {
        result.newPlaces++
      }
    }

    if (docs.meta.is_end) break
    page++
  }
}

// ─── Kakao API fetch ──────────────────────────────────────────────────────────

async function fetchKakaoPage(
  target: SearchTarget,
  rect: string,
  page: number
): Promise<KakaoSearchResponse | null> {
  const params = new URLSearchParams({
    rect,
    page: String(page),
    size: String(PAGE_SIZE),
  })

  let endpoint: string
  if (target.kakaoCategory) {
    endpoint = `${KAKAO_API_BASE}/category`
    params.set('category_group_code', target.kakaoCategory)
  } else if (target.keyword) {
    endpoint = `${KAKAO_API_BASE}/keyword`
    params.set('query', target.keyword)
  } else {
    return null
  }

  const url = `${endpoint}?${params.toString()}`

  try {
    const response = await kakaoLimiter.throttle(() =>
      fetch(url, {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
        },
      })
    )

    if (!response.ok) {
      console.error(
        `[pipeline-a] Kakao API HTTP ${response.status} for ${target.keyword ?? target.kakaoCategory}`
      )
      return null
    }

    return (await response.json()) as KakaoSearchResponse
  } catch (err) {
    console.error('[pipeline-a] Fetch error:', err)
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts a sub-category label from Kakao's hierarchical category string.
 * Example: "음식점 > 카페 > 키즈카페" → "키즈카페"
 */
function normalizeSubCategory(categoryName: string): string | null {
  if (!categoryName) return null
  const parts = categoryName.split('>').map((p) => p.trim())
  return parts[parts.length - 1] || null
}
