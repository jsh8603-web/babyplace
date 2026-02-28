/**
 * Children Play Facility Collector (행안부 전국어린이놀이시설정보서비스)
 *
 * API: https://apis.data.go.kr/1741000/pfc3/getPfctInfo3
 * Docs: https://www.data.go.kr/data/15124519/openapi.do
 * Key: DATA_GO_KR_API_KEY (shared with other data.go.kr collectors)
 *
 * Collects registered children's play facilities including:
 *   - A004 식품접객업소 (kids cafes with play equipment)
 *   - A013 놀이제공영업소 (indoor play facilities)
 *   - A003 도시공원 (city park playgrounds)
 *   - A008 대규모점포 (department store/mart play areas)
 *   - A092 육아종합지원센터
 *
 * Coordinates: latCrtsVl=latitude, lotCrtsVl=longitude (WGS84)
 *   Note: data.go.kr docs have lat/lot descriptions swapped, but
 *   cpf.go.kr source code confirms: latCrtsVl=lat, lotCrtsVl=lng.
 *   We validate at runtime by checking value ranges (lat~37, lng~126-127).
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'

// ─── API types ──────────────────────────────────────────────────────────────

interface PfcResponse {
  response: {
    header: {
      resultCode: string
      resultMsg: string
    }
    body: {
      items: PfcItem[]
      pageIndex: string
      recordCountPerPage: string
      totalCnt: string
      totalPageCnt: string
    }
  }
}

interface PfcItem {
  pfctSn: string // 놀이시설 일련번호 (unique ID)
  pfctNm: string // 놀이시설명
  lotnoAddr?: string // 지번주소
  ronaAddr?: string // 도로명주소
  latCrtsVl?: string // 위도 (37.xx)
  lotCrtsVl?: string // 경도 (126~127.xx)
  instlPlaceCd?: string // 설치장소코드
  instlPlaceCdNm?: string // 설치장소코드명
  idrodrCd?: string // 실내외구분코드
  idrodrCdNm?: string // 실내외구분코드명 ("실내"/"실외")
  operYnCdNm?: string // 시설운영구분명 ("운영"/"미운영"/"폐쇄")
  prvtPblcYnCdNm?: string // 민간공공구분명 ("민간"/"공공")
  fcar?: string // 시설면적
  exfcYn?: string // 우수시설여부 Y/N
  wowaStylRideCdNm?: string // 물놀이유형 포함여부
  rgnCdNm?: string // 지역분류코드명
}

// ─── Target facility types ──────────────────────────────────────────────────

interface FacilityTarget {
  instlPlaceCd: string
  label: string
  babyCategory: PlaceCategory
  isIndoor: boolean | null // null = determined by idrodrCdNm field
  subCategory: string
}

const FACILITY_TARGETS: FacilityTarget[] = [
  {
    instlPlaceCd: 'A004',
    label: '식품접객업소 (키즈카페)',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: '키즈카페',
  },
  {
    instlPlaceCd: 'A013',
    label: '놀이제공영업소 (실내놀이터)',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: '실내놀이터',
  },
  {
    instlPlaceCd: 'A003',
    label: '도시공원',
    babyCategory: '공원/놀이터',
    isIndoor: false,
    subCategory: '어린이놀이터',
  },
  {
    instlPlaceCd: 'A008',
    label: '대규모점포 (백화점/마트)',
    babyCategory: '놀이',
    isIndoor: true,
    subCategory: '대형점포 놀이시설',
  },
  {
    instlPlaceCd: 'A092',
    label: '육아종합지원센터',
    babyCategory: '전시/체험',
    isIndoor: true,
    subCategory: '육아지원센터',
  },
  {
    instlPlaceCd: 'A005',
    label: '아동복지시설',
    babyCategory: '전시/체험',
    isIndoor: null,
    subCategory: '아동복지시설',
  },
]

const API_BASE = 'https://apis.data.go.kr/1741000/pfc3/getPfctInfo3'
const PAGE_SIZE = 1000
const MAX_PAGES = 100

// ─── Main export ────────────────────────────────────────────────────────────

export interface ChildrenFacilityResult {
  totalFetched: number
  newPlaces: number
  duplicates: number
  skippedOutOfArea: number
  skippedClosed: number
  errors: number
}

export async function runChildrenFacility(): Promise<ChildrenFacilityResult> {
  const apiKey = process.env.DATA_GO_KR_API_KEY
  if (!apiKey) {
    console.warn('[children-facility] DATA_GO_KR_API_KEY not set, skipping')
    return {
      totalFetched: 0,
      newPlaces: 0,
      duplicates: 0,
      skippedOutOfArea: 0,
      skippedClosed: 0,
      errors: 0,
    }
  }

  const result: ChildrenFacilityResult = {
    totalFetched: 0,
    newPlaces: 0,
    duplicates: 0,
    skippedOutOfArea: 0,
    skippedClosed: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  for (const target of FACILITY_TARGETS) {
    try {
      console.log(`[children-facility] Fetching: ${target.label}`)
      await processTarget(apiKey, target, result)
    } catch (err) {
      console.error(`[children-facility] Error for ${target.label}:`, err)
      result.errors++
    }
  }

  await supabaseAdmin.from('collection_logs').insert({
    collector: 'children-facility',
    results_count: result.totalFetched,
    new_places: result.newPlaces,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  console.log(`[children-facility] Done: ${JSON.stringify(result)}`)
  return result
}

// ─── Processing ─────────────────────────────────────────────────────────────

async function processTarget(
  apiKey: string,
  target: FacilityTarget,
  result: ChildrenFacilityResult
): Promise<void> {
  let page = 1

  while (page <= MAX_PAGES) {
    const data = await fetchPage(apiKey, target.instlPlaceCd, page)
    if (!data) break

    const items = data.response?.body?.items
    if (!items || items.length === 0) break

    result.totalFetched += items.length

    for (const item of items) {
      try {
        await processItem(item, target, result)
      } catch (err) {
        console.error('[children-facility] Item error:', err, item.pfctSn)
        result.errors++
      }
    }

    const totalPages = parseInt(data.response?.body?.totalPageCnt || '1', 10)
    if (page >= totalPages) break
    page++
  }
}

async function processItem(
  item: PfcItem,
  target: FacilityTarget,
  result: ChildrenFacilityResult
): Promise<void> {
  // Skip closed/non-operating facilities
  if (item.operYnCdNm && item.operYnCdNm !== '운영') {
    result.skippedClosed++
    return
  }

  // Parse coordinates — validate by range to handle potential field swap
  let lat = parseFloat(item.latCrtsVl || '')
  let lng = parseFloat(item.lotCrtsVl || '')

  if (isNaN(lat) || isNaN(lng)) return

  // Safety: if values are swapped (lat should be ~37, lng should be ~126-128)
  if (lat > 120 && lng < 40) {
    const temp = lat
    lat = lng
    lng = temp
  }

  if (lat < 33 || lat > 43 || lng < 124 || lng > 132) return

  const address = item.ronaAddr || item.lotnoAddr || ''

  if (!isInServiceRegion(lat, lng, address)) {
    result.skippedOutOfArea++
    return
  }

  const dup = await checkDuplicate({
    kakaoPlaceId: `pfc_${item.pfctSn}`,
    name: item.pfctNm,
    address,
    lat,
    lng,
  })

  if (dup.isDuplicate && dup.existingId) {
    result.duplicates++
    return
  }

  const districtCode = await getDistrictCode(lat, lng, address)
  const isIndoor =
    target.isIndoor !== null
      ? target.isIndoor
      : item.idrodrCdNm === '실내'

  const { error } = await supabaseAdmin.from('places').insert({
    name: item.pfctNm,
    category: target.babyCategory,
    sub_category: item.instlPlaceCdNm || target.subCategory,
    address,
    road_address: item.ronaAddr || null,
    lat,
    lng,
    district_code: districtCode,
    source: 'children-facility',
    source_id: item.pfctSn,
    is_indoor: isIndoor,
    is_active: true,
  })

  if (error) {
    if (error.code === '23505') {
      result.duplicates++
    } else {
      console.error('[children-facility] Insert error:', error.message, item.pfctSn)
      result.errors++
    }
  } else {
    result.newPlaces++
  }
}

// ─── API fetch ──────────────────────────────────────────────────────────────

async function fetchPage(
  apiKey: string,
  instlPlaceCd: string,
  page: number
): Promise<PfcResponse | null> {
  const params = new URLSearchParams({
    serviceKey: apiKey,
    pageIndex: String(page),
    recordCountPerPage: String(PAGE_SIZE),
    instlPlaceCd,
  })

  const url = `${API_BASE}?${params.toString()}`

  try {
    const response = await fetch(url)

    if (!response.ok) {
      console.error(`[children-facility] HTTP ${response.status} for ${instlPlaceCd} page ${page}`)
      return null
    }

    const json = (await response.json()) as PfcResponse

    if (json.response?.header?.resultCode !== '00') {
      console.error(`[children-facility] API error: ${json.response?.header?.resultMsg}`)
      return null
    }

    return json
  } catch (err) {
    console.error('[children-facility] Fetch error:', err)
    return null
  }
}
