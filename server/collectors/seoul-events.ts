/**
 * Seoul Cultural Events API collector
 *
 * Collects cultural events from Seoul Open Data Portal (data.seoul.go.kr).
 * Endpoint: http://openapi.seoul.go.kr:8088/{key}/json/culturalEventInfo/1/1000
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { prefetchIds } from '../lib/prefetch'
import {
  classifySeoulEvent,
  isBlacklisted,
  isWhitelisted,
  classifyEventsWithLLM,
} from '../utils/event-classifier'

export interface SeoulEventItem {
  CODENAME: string       // category: "전시/미술", "축제-시민화합", "클래식" etc.
  GUNAME: string         // district: "강남구"
  TITLE: string          // event title
  DATE: string           // date range: "2026-03-01~2026-03-31"
  PLACE: string          // venue name
  ORG_NAME: string       // organizer
  USE_TRGT: string       // target audience
  USE_FEE: string        // price info
  INQUIRY: string        // contact
  ORG_LINK: string       // organizer website
  MAIN_IMG: string       // poster image URL
  RGSTDATE: string       // registration date
  STRTDATE: string       // start datetime: "2026-03-01 00:00:00.0"
  END_DATE: string       // end datetime: "2026-03-31 00:00:00.0"
  THEMECODE: string      // theme code
  LOT: string            // longitude (named LOT in API)
  LAT: string            // latitude
  IS_FREE: string        // "무료" or "유료"
  HMPG_ADDR: string      // culture portal URL
  PRO_TIME?: string      // time info
}

interface SeoulEventResponse {
  culturalEventInfo?: {
    row?: SeoulEventItem[]
    list_total_count?: number
    RESULT?: { CODE: string; MESSAGE: string }
  }
}

const SEOUL_API_BASE = 'http://openapi.seoul.go.kr:8088'
const SEOUL_SERVICE = 'culturalEventInfo'
const PAGE_SIZE = 1000

export interface SeoulEventsCollectorResult {
  totalFetched: number
  filtered: number
  llmClassified: number
  newEvents: number
  duplicates: number
  postersRestored: number
  errors: number
}

/**
 * Pre-fetch known Seoul event source_ids from DB to skip LLM classification.
 * Reuses the children-facility.ts prefetch pattern.
 */
async function prefetchKnownSourceIds(): Promise<Set<string>> {
  return prefetchIds({
    table: 'events',
    column: 'source_id',
    filters: [{ op: 'eq', column: 'source', value: 'seoul_events' }],
  })
}

/**
 * Run Seoul Events collector.
 */
export async function runSeoulEventsCollector(): Promise<SeoulEventsCollectorResult> {
  const result: SeoulEventsCollectorResult = {
    totalFetched: 0,
    filtered: 0,
    llmClassified: 0,
    newEvents: 0,
    duplicates: 0,
    postersRestored: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    if (!process.env.SEOUL_API_KEY) {
      console.warn('[seoul-events] Missing env: SEOUL_API_KEY, skipping Seoul events collector')
      return result
    }

    console.log('[seoul-events] Fetching cultural events from Seoul API')

    // Pre-fetch known source_ids to skip LLM for events already in DB
    const knownSourceIds = await prefetchKnownSourceIds()
    console.log(`[seoul-events] Pre-fetched ${knownSourceIds.size} known source_ids`)

    const allEvents = await fetchAllSeoulEvents()
    result.totalFetched = allEvents.length
    console.log(`[seoul-events] Fetched ${allEvents.length} events`)

    // Step 0: Filter out past events (past year or END_DATE < today) to avoid wasting LLM calls
    const currentYear = new Date().getFullYear()
    const today = new Date().toISOString().split('T')[0]
    const currentEvents = allEvents.filter((e) => {
      const startDate = parseSeoulDateTime(e.STRTDATE)
      if (startDate && parseInt(startDate.substring(0, 4)) < currentYear - 1) return false
      const endDate = parseSeoulDateTime(e.END_DATE)
      if (endDate && endDate < today) return false
      return true
    })
    const pastExcluded = allEvents.length - currentEvents.length
    console.log(`[seoul-events] Step 0 date filter: ${pastExcluded} past events excluded, ${currentEvents.length} current/future`)

    // Step 0.5: Skip events already in DB (avoid LLM calls for known events)
    const unknownEvents = currentEvents.filter((e) => {
      const sourceId = extractCultCode(e.HMPG_ADDR) || `${e.TITLE}_${e.DATE}`
      return !knownSourceIds.has(sourceId)
    })
    const knownSkipped = currentEvents.length - unknownEvents.length
    console.log(`[seoul-events] Step 0.5 known filter: ${knownSkipped} already in DB, ${unknownEvents.length} to classify`)

    // Step 0.6: Restore official posters for existing events whose poster_url was overwritten
    const knownApiEvents = currentEvents.filter((e) => {
      const sourceId = extractCultCode(e.HMPG_ADDR) || `${e.TITLE}_${e.DATE}`
      return knownSourceIds.has(sourceId) && e.MAIN_IMG
    })
    if (knownApiEvents.length > 0) {
      const sourceIds = knownApiEvents.map((e) => extractCultCode(e.HMPG_ADDR) || `${e.TITLE}_${e.DATE}`)
      const { data: dbEvents } = await supabaseAdmin
        .from('events')
        .select('id, source_id, poster_url')
        .eq('source', 'seoul_events')
        .in('source_id', sourceIds)
      if (dbEvents) {
        const dbMap = new Map(dbEvents.map((e) => [e.source_id, e]))
        for (const apiEvent of knownApiEvents) {
          const sourceId = extractCultCode(apiEvent.HMPG_ADDR) || `${apiEvent.TITLE}_${apiEvent.DATE}`
          const dbEvent = dbMap.get(sourceId)
          if (!dbEvent) continue
          const officialUrl = apiEvent.MAIN_IMG.replace(/[&?]thumb=Y/i, '')
          if (dbEvent.poster_url !== officialUrl) {
            const { error: updateErr } = await supabaseAdmin
              .from('events')
              .update({ poster_url: officialUrl })
              .eq('id', dbEvent.id)
            if (!updateErr) {
              result.postersRestored++
            }
          }
        }
        if (result.postersRestored > 0) {
          console.log(`[seoul-events] Step 0.6 poster restore: ${result.postersRestored} posters restored to official`)
        }
      }
    }

    // Step 1: Blacklist filter (immediate exclude)
    const afterBlacklist = unknownEvents.filter((e) => {
      if (isBlacklisted(e.USE_TRGT, e.TITLE)) {
        result.filtered++
        return false
      }
      return true
    })
    console.log(`[seoul-events] Step 1 blacklist: excluded ${result.filtered}`)

    // Step 2: Whitelist filter (immediate include)
    const whitelisted: SeoulEventItem[] = []
    const remaining: SeoulEventItem[] = []
    for (const event of afterBlacklist) {
      if (isWhitelisted(event.USE_TRGT, event.TITLE)) {
        whitelisted.push(event)
      } else {
        remaining.push(event)
      }
    }
    console.log(`[seoul-events] Step 2 whitelist: ${whitelisted.length} included, ${remaining.length} remaining`)

    // Step 3: LLM classification for remaining events
    const llmIncludedIndices = await classifyEventsWithLLM(
      remaining.map((e) => ({
        TITLE: e.TITLE,
        USE_TRGT: e.USE_TRGT,
        CODENAME: e.CODENAME,
        PLACE: e.PLACE,
      }))
    )
    const llmIncluded = remaining.filter((_, i) => llmIncludedIndices.has(i))
    result.llmClassified = llmIncluded.length
    console.log(`[seoul-events] Step 3 LLM: ${llmIncluded.length}/${remaining.length} included`)

    // Combine whitelisted + LLM-included events
    const eventsToProcess = [...whitelisted, ...llmIncluded]
    console.log(`[seoul-events] Total to process: ${eventsToProcess.length}`)

    for (const event of eventsToProcess) {
      try {
        await processSeoulEvent(event, result, knownSourceIds)
      } catch (err) {
        console.error('[seoul-events] Error processing event:', err, event.TITLE)
        result.errors++
      }
    }

    // Log to collection_logs
    await logCollection({
      collector: 'seoul-events',
      startedAt,
      resultsCount: result.totalFetched,
      newEvents: result.newEvents,
      errors: result.errors,
    })
  } catch (err) {
    console.error('[seoul-events] Fatal error:', err)
    result.errors++

    await logCollection({
      collector: 'seoul-events',
      startedAt,
      error: String(err),
    })
  }

  return result
}

/**
 * Fetch all events with pagination (1000 per page).
 */
async function fetchAllSeoulEvents(): Promise<SeoulEventItem[]> {
  const allEvents: SeoulEventItem[] = []
  let start = 1

  while (true) {
    const end = start + PAGE_SIZE - 1
    const events = await fetchSeoulEventsPage(start, end)
    if (events.length === 0) break

    allEvents.push(...events)
    console.log(`[seoul-events] Page ${start}-${end}: ${events.length} events`)

    if (events.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return allEvents
}

/**
 * Fetch a single page of events from Seoul API.
 */
async function fetchSeoulEventsPage(start: number, end: number): Promise<SeoulEventItem[]> {
  if (!process.env.SEOUL_API_KEY) return []

  const url = `${SEOUL_API_BASE}/${process.env.SEOUL_API_KEY}/json/${SEOUL_SERVICE}/${start}/${end}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from Seoul API`)
    }

    const parsed = (await response.json()) as SeoulEventResponse

    if (!parsed.culturalEventInfo?.row) {
      return []
    }

    const rows = Array.isArray(parsed.culturalEventInfo.row)
      ? parsed.culturalEventInfo.row
      : [parsed.culturalEventInfo.row]

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
  result: SeoulEventsCollectorResult,
  knownSourceIds: Set<string>
): Promise<void> {
  // Use culture portal URL as unique ID (contains cultcode), fallback to TITLE+DATE
  const sourceId = extractCultCode(event.HMPG_ADDR) || `${event.TITLE}_${event.DATE}`
  if (!sourceId) return

  // Check for duplicate using prefetched Set (avoids N+1 DB query)
  if (knownSourceIds.has(sourceId)) {
    result.duplicates++
    return
  }

  // Parse dates from STRTDATE/END_DATE ("2026-03-01 00:00:00.0") or DATE ("2026-03-01~2026-03-31")
  const startDate = parseSeoulDateTime(event.STRTDATE) || parseSeoulDateRange(event.DATE).startDate
  const endDate = parseSeoulDateTime(event.END_DATE) || parseSeoulDateRange(event.DATE).endDate

  if (!startDate) {
    return
  }

  // Parse coordinates (API uses LOT for longitude, LAT for latitude)
  const lat = event.LAT ? parseFloat(event.LAT) : null
  const lng = event.LOT ? parseFloat(event.LOT) : null

  const eventData = {
    name: event.TITLE,
    category: '문화행사',
    sub_category: classifySeoulEvent(event.CODENAME, event.TITLE),
    venue_name: event.PLACE || null,
    venue_address: null,
    lat: lat && !isNaN(lat) ? lat : null,
    lng: lng && !isNaN(lng) ? lng : null,
    start_date: startDate,
    end_date: endDate,
    time_info: event.PRO_TIME || null,
    price_info: event.USE_FEE || null,
    age_range: event.USE_TRGT || null,
    source: 'seoul_events',
    source_id: sourceId,
    source_url: event.ORG_LINK || event.HMPG_ADDR || null,
    poster_url: event.MAIN_IMG ? event.MAIN_IMG.replace(/[&?]thumb=Y/i, '') : null,
    description: null,
  }

  const { error } = await supabaseAdmin.from('events').insert(eventData)

  if (error) {
    if (error.code === '23505') {
      result.duplicates++
    } else {
      console.error('[seoul-events] Insert error:', error.message, sourceId)
      result.errors++
    }
  } else {
    result.newEvents++
  }
}

/**
 * Extract cultcode from HMPG_ADDR URL.
 * Example: "https://culture.seoul.go.kr/.../view.do?cultcode=156698&menuNo=200009" → "156698"
 */
function extractCultCode(url: string): string | null {
  if (!url) return null
  const match = url.match(/cultcode=(\d+)/)
  return match ? match[1] : null
}

/**
 * Parse Seoul datetime: "2026-03-01 00:00:00.0" → "2026-03-01"
 */
function parseSeoulDateTime(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

/**
 * Parse Seoul date range: "2026-03-01~2026-03-31" → { startDate, endDate }
 */
function parseSeoulDateRange(dateStr: string): {
  startDate: string | null
  endDate: string | null
} {
  if (!dateStr) return { startDate: null, endDate: null }

  const parts = dateStr.split('~').map((s) => s.trim())
  if (parts.length !== 2) return { startDate: null, endDate: null }

  const startDate = parseSeoulDateTime(parts[0]) || convertDottedDate(parts[0])
  const endDate = parseSeoulDateTime(parts[1]) || convertDottedDate(parts[1])

  return { startDate, endDate }
}

/**
 * Convert dotted date format: "2026.03.01" → "2026-03-01"
 */
function convertDottedDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/^(\d{4})\.(\d{2})\.(\d{2})$/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}
