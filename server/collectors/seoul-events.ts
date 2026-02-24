/**
 * Seoul Cultural Events API collector
 *
 * Collects cultural events from Seoul Open Data Portal (data.seoul.go.kr).
 * This collector uses the Seoul city's public API for cultural events and performances.
 *
 * Endpoint: GET http://openapi.seoul.go.kr/json/{APIkey}/1/1000
 * Service: CulturalEventInfo
 */

import { supabaseAdmin } from '../lib/supabase-admin'

interface SeoulEventItem {
  CODENAME: string // event code
  TITLE: string // event title
  DATE: string // date info (e.g. "2024.01.01 ~ 2024.01.31")
  PLACE: string // venue name
  AREA: string // area/district
  PROGRAM_COST?: string // price
  ORG_LINK?: string // organizer website
  MAIN_IMG?: string // main image URL
  PROGRAM_ID?: string // program ID
}

interface SeoulEventResponse {
  CulturalEventInfo?: {
    row?: SeoulEventItem[]
    list_total_count?: number
  }
}

const SEOUL_API_BASE = 'http://openapi.seoul.go.kr/json'
const SEOUL_SERVICE = 'CulturalEventInfo'
const PAGE_SIZE = 1000

export interface SeoulEventsCollectorResult {
  totalFetched: number
  newEvents: number
  duplicates: number
  errors: number
}

/**
 * Run Seoul Events collector.
 */
export async function runSeoulEventsCollector(): Promise<SeoulEventsCollectorResult> {
  const result: SeoulEventsCollectorResult = {
    totalFetched: 0,
    newEvents: 0,
    duplicates: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    if (!process.env.SEOUL_API_KEY) {
      console.warn('[seoul-events] Missing env: SEOUL_API_KEY, skipping Seoul events collector')
      return result
    }

    console.log('[seoul-events] Fetching cultural events from Seoul API')

    const events = await fetchSeoulEvents()
    result.totalFetched = events.length

    for (const event of events) {
      try {
        await processSeoulEvent(event, result)
      } catch (err) {
        console.error('[seoul-events] Error processing event:', err, event.CODENAME)
        result.errors++
      }
    }

    // Log to collection_logs
    await supabaseAdmin.from('collection_logs').insert({
      collector: 'seoul-events',
      results_count: result.totalFetched,
      new_events: result.newEvents,
      status: result.errors > 0 ? 'partial' : 'success',
      duration_ms: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[seoul-events] Fatal error:', err)
    result.errors++

    await supabaseAdmin.from('collection_logs').insert({
      collector: 'seoul-events',
      status: 'error',
      error: String(err),
      duration_ms: Date.now() - startedAt,
    })
  }

  return result
}

/**
 * Fetch all events from Seoul API.
 */
async function fetchSeoulEvents(): Promise<SeoulEventItem[]> {
  if (!process.env.SEOUL_API_KEY) {
    return []
  }

  const url = `${SEOUL_API_BASE}/${process.env.SEOUL_API_KEY}/1/${PAGE_SIZE}/${SEOUL_SERVICE}`

  // Set up abort controller for timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000) // 10 second timeout

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Seoul API`)
    }

    const parsed = (await response.json()) as SeoulEventResponse

    if (!parsed.CulturalEventInfo?.row) {
      console.log('[seoul-events] No events found in response')
      return []
    }

    // Ensure row is always an array
    const rows = Array.isArray(parsed.CulturalEventInfo.row)
      ? parsed.CulturalEventInfo.row
      : [parsed.CulturalEventInfo.row]

    return rows
  } catch (err) {
    console.error('[seoul-events] Fetch error:', err)
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Process a single Seoul event.
 */
async function processSeoulEvent(
  event: SeoulEventItem,
  result: SeoulEventsCollectorResult
): Promise<void> {
  const eventCode = event.CODENAME
  if (!eventCode) return

  // Check for duplicate
  const { data: existing } = await supabaseAdmin
    .from('events')
    .select('id')
    .eq('source', 'seoul_events')
    .eq('source_id', eventCode)
    .maybeSingle()

  if (existing) {
    result.duplicates++
    return
  }

  // Parse date range from DATE field (format: "YYYY.MM.DD ~ YYYY.MM.DD")
  const { startDate, endDate } = parseSeoulDateRange(event.DATE)

  if (!startDate) {
    console.warn('[seoul-events] Skipping event with invalid date:', eventCode, event.DATE)
    return
  }

  // Build event data
  const eventData = {
    name: event.TITLE,
    category: '문화행사', // Seoul events are cultural events by default
    venue_name: event.PLACE || null,
    venue_address: null, // Seoul API doesn't provide venue address
    lat: null, // Would need reverse geocoding
    lng: null,
    start_date: startDate,
    end_date: endDate,
    time_info: null,
    price_info: event.PROGRAM_COST || null,
    age_range: null, // Assume family-friendly unless specified
    source: 'seoul_events',
    source_id: eventCode,
    source_url: event.ORG_LINK || null,
    poster_url: event.MAIN_IMG || null,
    description: null,
  }

  const { error } = await supabaseAdmin.from('events').insert(eventData)

  if (error) {
    if (error.code === '23505') {
      // Unique constraint on source_id
      result.duplicates++
    } else {
      console.error('[seoul-events] Insert error:', error.message, eventCode)
      throw error
    }
  } else {
    result.newEvents++
  }
}

/**
 * Parse Seoul date range: "YYYY.MM.DD ~ YYYY.MM.DD" → { startDate, endDate }
 */
function parseSeoulDateRange(dateStr: string): {
  startDate: string | null
  endDate: string | null
} {
  if (!dateStr) return { startDate: null, endDate: null }

  const parts = dateStr.split('~').map((s) => s.trim())
  if (parts.length !== 2) {
    return { startDate: null, endDate: null }
  }

  const startDate = convertSeoulDate(parts[0])
  const endDate = convertSeoulDate(parts[1])

  return { startDate, endDate }
}

/**
 * Convert Seoul date format: "YYYY.MM.DD" → "YYYY-MM-DD"
 */
function convertSeoulDate(dateStr: string): string | null {
  if (!dateStr) return null

  const match = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  if (!match) {
    console.warn('[seoul-events] Invalid date format:', dateStr)
    return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}
