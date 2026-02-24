/**
 * KOPIS 공연정보나루 collector
 *
 * Collects kids/family performances from the Korean Performance Information System.
 * Endpoint: GET http://www.kopis.or.kr/openApi/restful/pblprfr
 *
 * Query parameters:
 *   - service: API key (from KOPIS_API_KEY env)
 *   - stdate: start date (YYYYMMDD)
 *   - eddate: end date (YYYYMMDD)
 *   - shcate: AAAB (뮤지컬/공연), kid state filter
 *   - kidstate: Y (아동 공연만)
 * Response: XML parsed by xml2js
 */

import { parseStringPromise } from 'xml2js'
import { supabaseAdmin } from '../lib/supabase-admin'

interface KOPISPerformance {
  mt10id: [string] // performance id
  prfnm: [string] // performance name
  prfpdfrom: [string] // start date (YYYY.MM.DD)
  prfpdto: [string] // end date (YYYY.MM.DD)
  fcltynm: [string] // venue name
  prfstate: [string] // performance state (공연중, 공연예정 등)
  genrenm: [string] // genre
  prfcast?: [string] // cast
  prfruntime?: [string] // runtime
  pcseguidance?: [string] // ticket info
  poster?: [string] // poster image URL
  sty?: [string] // style/description
}

interface KOPISResponse {
  Dbtable?: {
    Row?: KOPISPerformance[]
  }
}

const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful/pblprfr'
const DAYS_LOOKBACK = 7
const DAYS_LOOKAHEAD = 90

export interface KOPISCollectorResult {
  totalFetched: number
  newEvents: number
  duplicates: number
  errors: number
}

/**
 * Run KOPIS collector.
 * Fetches performances within the next 90 days (and lookback 7 days for any missed).
 */
export async function runKOPISCollector(): Promise<KOPISCollectorResult> {
  const result: KOPISCollectorResult = {
    totalFetched: 0,
    newEvents: 0,
    duplicates: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    // Date range: 7 days ago to 90 days from now
    const stdate = formatDateForAPI(new Date(Date.now() - DAYS_LOOKBACK * 24 * 60 * 60 * 1000))
    const eddate = formatDateForAPI(new Date(Date.now() + DAYS_LOOKAHEAD * 24 * 60 * 60 * 1000))

    console.log(`[kopis] Fetching performances from ${stdate} to ${eddate}`)

    const performances = await fetchKOPISPerformances(stdate, eddate)
    result.totalFetched = performances.length

    for (const perf of performances) {
      try {
        await processKOPISPerformance(perf, result)
      } catch (err) {
        console.error('[kopis] Error processing performance:', err, perf.mt10id?.[0])
        result.errors++
      }
    }

    // Log to collection_logs
    await supabaseAdmin.from('collection_logs').insert({
      collector: 'kopis',
      results_count: result.totalFetched,
      new_events: result.newEvents,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[kopis] Fatal error:', err)
    result.errors++

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'kopis',
      status: 'error',
      error: String(err),
      duration_ms: Date.now() - startedAt,
    })
  }

  return result
}

/**
 * Fetch all performances from KOPIS API.
 */
async function fetchKOPISPerformances(stdate: string, eddate: string): Promise<KOPISPerformance[]> {
  if (!process.env.KOPIS_API_KEY) {
    throw new Error('Missing env: KOPIS_API_KEY')
  }

  const params = new URLSearchParams({
    service: process.env.KOPIS_API_KEY,
    stdate,
    eddate,
    shcate: 'AAAB', // 뮤지컬/공연
    kidstate: 'Y', // 아동 공연만
  })

  const url = `${KOPIS_API_BASE}?${params.toString()}`

  // Set up abort controller for timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000) // 10 second timeout

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from KOPIS`)
    }

    const xml = await response.text()
    const parsed = (await parseStringPromise(xml)) as KOPISResponse

    if (!parsed.Dbtable?.Row) {
      console.log('[kopis] No performances found in response')
      return []
    }

    // Ensure Row is always an array
    const rows = Array.isArray(parsed.Dbtable.Row)
      ? parsed.Dbtable.Row
      : [parsed.Dbtable.Row]

    return rows
  } catch (err) {
    console.error('[kopis] Fetch error:', err)
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Process a single KOPIS performance.
 */
async function processKOPISPerformance(
  perf: KOPISPerformance,
  result: KOPISCollectorResult
): Promise<void> {
  const perfId = perf.mt10id?.[0]
  if (!perfId) return

  const name = perf.prfnm?.[0] || 'Unknown'
  const venueName = perf.fcltynm?.[0] || null
  const startDate = parseKOPISDate(perf.prfpdfrom?.[0])
  const endDate = parseKOPISDate(perf.prfpdto?.[0])

  if (!startDate) {
    console.warn('[kopis] Skipping performance with invalid start date:', perfId)
    return
  }

  // Check for duplicate
  const { data: existing } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('source', 'kopis')
    .eq('source_id', perfId)
    .maybeSingle()

  if (existing) {
    result.duplicates++
    return
  }

  // Build event data
  const eventData = {
    name,
    category: extractCategory(perf.genrenm?.[0]),
    venue_name: venueName,
    venue_address: null, // KOPIS doesn't provide venue address
    lat: null, // Would need reverse geocoding from venue name
    lng: null,
    start_date: startDate,
    end_date: endDate,
    time_info: perf.prfruntime?.[0] || null,
    price_info: perf.pcseguidance?.[0] || null,
    age_range: 'kids', // KOPIS kidstate=Y
    source: 'kopis',
    source_id: perfId,
    source_url: `http://www.kopis.or.kr/por/db/pblprfr/pblprfrView?experiencedate=&productnm=&areaCd=&rejectkidstate=&gcode=&shcate=AAAB&startDate=&endDate=&kidstate=Y&mt10id=${perfId}`,
    poster_url: perf.poster?.[0] || null,
    description: perf.sty?.[0] || null,
  }

  const { error } = await supabaseAdmin.from('events').insert(eventData)

  if (error) {
    if (error.code === '23505') {
      // Unique constraint on source_id
      result.duplicates++
    } else {
      console.error('[kopis] Insert error:', error.message, perfId)
      throw error
    }
  } else {
    result.newEvents++
  }
}

/**
 * Parse KOPIS date format: "YYYY.MM.DD" → ISO date string "YYYY-MM-DD"
 */
function parseKOPISDate(dateStr?: string): string | null {
  if (!dateStr) return null

  // Format: YYYY.MM.DD
  const match = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (!match) {
    console.warn('[kopis] Invalid date format:', dateStr)
    return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * Format date for KOPIS API: YYYYMMDD
 */
function formatDateForAPI(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * Extract category from KOPIS genre.
 * Examples: 뮤지컬, 연극, 인형극, 마술 등
 */
function extractCategory(genre?: string): string {
  if (!genre) return '공연'

  const genreLower = genre.toLowerCase()

  if (genreLower.includes('뮤지컬')) return '뮤지컬'
  if (genreLower.includes('연극')) return '연극'
  if (genreLower.includes('인형') || genreLower.includes('인형극')) return '인형극'
  if (genreLower.includes('마술')) return '마술'
  if (genreLower.includes('음악')) return '음악'
  if (genreLower.includes('무용')) return '무용'
  if (genreLower.includes('콘서트')) return '콘서트'

  return '공연'
}
