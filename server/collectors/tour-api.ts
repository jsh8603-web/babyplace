/**
 * Tour API (관광공사) collector
 *
 * Collects family-friendly festivals, attractions, and events from Korean Tourism Organization.
 * Endpoint: GET http://apis.data.go.kr/B551011/KorService1/areaBasedList1
 *
 * Parameters:
 *   - serviceKey: API key (from TOUR_API_KEY env)
 *   - contentTypeId: 12(관광지), 14(문화시설), 15(축제)
 *   - areaCode: 1(서울), 31(경기)
 *   - cat1: A02(인문), A03(레포츠) for filtering
 *   - numOfRows, pageNo: pagination
 *
 * Response: JSON with items array
 */

import { supabaseAdmin } from '../lib/supabase-admin'

interface TourAPIItem {
  contentid: number
  title: string
  addr1: string // address
  addr2?: string
  areacode: number
  sigungucode?: number
  cat1?: string
  cat2?: string
  cat3?: string
  mapx?: number // longitude
  mapy?: number // latitude
  image?: string // image URL
  overview?: string // description
  contenttype?: number
  eventstartdate?: string // YYYYMMDD
  eventenddate?: string // YYYYMMDD
  eventplace?: string
  eventhomepage?: string
  firstimage?: string
  firstimage2?: string
}

interface TourAPIResponse {
  response?: {
    body?: {
      items?: {
        item?: TourAPIItem[] | TourAPIItem
      }
      totalCount?: number
    }
  }
}

const TOUR_API_BASE = 'http://apis.data.go.kr/B551011/KorService1/areaBasedList1'
const PAGE_SIZE = 100 // max items per page
const CONTENT_TYPES = [12, 14, 15] // 관광지, 문화시설, 축제
const AREA_CODES = [1, 31] // Seoul, Gyeonggi

export interface TourAPICollectorResult {
  totalFetched: number
  newEvents: number
  duplicates: number
  errors: number
}

/**
 * Run Tour API collector.
 */
export async function runTourAPICollector(): Promise<TourAPICollectorResult> {
  const result: TourAPICollectorResult = {
    totalFetched: 0,
    newEvents: 0,
    duplicates: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    if (!process.env.TOUR_API_KEY) {
      throw new Error('Missing env: TOUR_API_KEY')
    }

    // Fetch for each content type and area code
    for (const contentTypeId of CONTENT_TYPES) {
      for (const areaCode of AREA_CODES) {
        try {
          await fetchAndProcessTourAPI(contentTypeId, areaCode, result)
        } catch (err) {
          console.error(
            `[tour-api] Error fetching contentTypeId=${contentTypeId}, areaCode=${areaCode}:`,
            err
          )
          result.errors++
        }
      }
    }

    // Log to collection_logs
    await supabaseAdmin.from('collection_logs').insert({
      collector: 'tour-api',
      results_count: result.totalFetched,
      new_events: result.newEvents,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[tour-api] Fatal error:', err)
    result.errors++

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'tour-api',
      status: 'error',
      error: String(err),
      duration_ms: Date.now() - startedAt,
    })
  }

  return result
}

/**
 * Fetch all pages for a given content type and area code.
 */
async function fetchAndProcessTourAPI(
  contentTypeId: number,
  areaCode: number,
  result: TourAPICollectorResult
): Promise<void> {
  let pageNo = 1
  let totalCount = 0

  while (true) {
    const response = await fetchTourAPIPage(contentTypeId, areaCode, pageNo)

    if (!response.response?.body?.items?.item) {
      console.log(
        `[tour-api] No items for contentTypeId=${contentTypeId}, areaCode=${areaCode}, pageNo=${pageNo}`
      )
      break
    }

    const items = Array.isArray(response.response.body.items.item)
      ? response.response.body.items.item
      : [response.response.body.items.item]

    result.totalFetched += items.length
    totalCount = response.response.body.totalCount || 0

    for (const item of items) {
      try {
        await processTourAPIItem(item, result)
      } catch (err) {
        console.error('[tour-api] Error processing item:', err, item.contentid)
        result.errors++
      }
    }

    // Check if we've fetched all pages
    if (pageNo * PAGE_SIZE >= totalCount) {
      break
    }

    pageNo++
  }
}

/**
 * Fetch one page from Tour API.
 */
async function fetchTourAPIPage(
  contentTypeId: number,
  areaCode: number,
  pageNo: number
): Promise<TourAPIResponse> {
  const params = new URLSearchParams({
    serviceKey: process.env.TOUR_API_KEY!,
    contentTypeId: String(contentTypeId),
    areaCode: String(areaCode),
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
    MobileOS: 'ETC',
    MobileApp: 'BabyPlace',
    _type: 'json',
  })

  const url = `${TOUR_API_BASE}?${params.toString()}`

  // Set up abort controller for timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000) // 10 second timeout

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Tour API`)
    }

    return (await response.json()) as TourAPIResponse
  } catch (err) {
    console.error('[tour-api] Fetch error:', err)
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Process a single Tour API item.
 */
async function processTourAPIItem(
  item: TourAPIItem,
  result: TourAPICollectorResult
): Promise<void> {
  const contentId = item.contentid
  if (!contentId) return

  // Check for duplicate
  const { data: existing } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('source', 'tour_api')
    .eq('source_id', String(contentId))
    .maybeSingle()

  if (existing) {
    result.duplicates++
    return
  }

  // Parse dates if available
  const startDate = parseYYYYMMDD(item.eventstartdate)
  const endDate = parseYYYYMMDD(item.eventenddate)

  // For non-event items, use current date range
  const finalStartDate = startDate || new Date().toISOString().split('T')[0]
  const finalEndDate = endDate || null

  // Determine category based on content type and category codes
  const category = determineTourCategory(item.contenttype, item.cat1)

  // Extract coordinates if available
  const lat = item.mapy ? item.mapy / 10000000 : null // Tour API uses int coords
  const lng = item.mapx ? item.mapx / 10000000 : null

  // Build event data
  const eventData = {
    name: item.title,
    category,
    venue_name: item.eventplace || null,
    venue_address: item.addr1 || null,
    lat,
    lng,
    start_date: finalStartDate,
    end_date: finalEndDate,
    time_info: null, // Tour API doesn't provide detailed time info
    price_info: null,
    age_range: null, // Assume family-friendly
    source: 'tour_api',
    source_id: String(contentId),
    source_url: item.eventhomepage
      ? item.eventhomepage
      : `http://www.tour.go.kr/currencyd.tistory.com/tc/openapi/service?_type=json&contentId=${contentId}`,
    poster_url: item.firstimage || item.image || null,
    description: item.overview || null,
  }

  const { error } = await supabaseAdmin.from('events').insert(eventData)

  if (error) {
    if (error.code === '23505') {
      // Unique constraint on source_id
      result.duplicates++
    } else {
      console.error('[tour-api] Insert error:', error.message, contentId)
      throw error
    }
  } else {
    result.newEvents++
  }
}

/**
 * Parse Tour API date format: YYYYMMDD → YYYY-MM-DD
 */
function parseYYYYMMDD(dateStr?: string): string | null {
  if (!dateStr) return null

  if (dateStr.length !== 8) {
    console.warn('[tour-api] Invalid date format:', dateStr)
    return null
  }

  const y = dateStr.substring(0, 4)
  const m = dateStr.substring(4, 6)
  const d = dateStr.substring(6, 8)

  return `${y}-${m}-${d}`
}

/**
 * Determine event category based on Tour API content type.
 */
function determineTourCategory(
  contentType?: number,
  cat1?: string
): string {
  if (contentType === 15) {
    return '축제'
  }
  if (contentType === 12) {
    // 관광지
    if (cat1 === 'A03') return '레포츠'
    return '관광지'
  }
  if (contentType === 14) {
    // 문화시설
    if (cat1 === 'A02') return '인문'
    return '문화시설'
  }

  return '행사'
}
