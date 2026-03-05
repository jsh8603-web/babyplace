/**
 * Interpark Ticket Family Genre Collector
 *
 * Collects "HOT" events from Interpark Tickets family genre page.
 * Data source: https://tickets.interpark.com/contents/genre/family
 * Extracts __NEXT_DATA__ JSON → hotItem array.
 *
 * For "전국투어" events, fetches detail page to find Seoul/Gyeonggi venues.
 * Each venue becomes a separate event card.
 *
 * Schedule: daily (via runEventsJob in run.ts)
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { prefetchIds } from '../lib/prefetch'
import { logCollection } from '../lib/collection-log'
import { searchKakaoPlaceDetailed } from '../lib/kakao-search'
import { isInServiceArea, isValidServiceAddress } from '../enrichers/region'
import { classifyEventByTitle } from '../utils/event-classifier'
import { kakaoSearchLimiter } from '../rate-limiter'
import * as crypto from 'crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterparkHotItem {
  goodsCode: string
  goodsName: string
  placeName: string
  playStartDate: string // YYYYMMDD
  playEndDate: string   // YYYYMMDD
  startDate: string     // YYYYMMDDHHmm (ticket sale start, more accurate for runs)
  endDate: string       // YYYYMMDDHHmm
  imageUrl: string
  link: string
}

export interface InterparkResult {
  hotItems: number
  skipped: number
  outOfArea: number
  inserted: number
  tourVenues: number
  errors: number
}

// ─── Config ──────────────────────────────────────────────────────────────────

const FAMILY_GENRE_URL = 'https://tickets.interpark.com/contents/genre/family'
const DETAIL_URL_BASE = 'https://tickets.interpark.com/goods'
const DELAY_MS = 1000

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Parse YYYYMMDD or YYYYMMDDHHmm to YYYY-MM-DD */
function parseDate(raw: string): string | null {
  if (!raw || raw.length < 8) return null
  const y = raw.substring(0, 4)
  const m = raw.substring(4, 6)
  const d = raw.substring(6, 8)
  return `${y}-${m}-${d}`
}

function venueHash(venueName: string): string {
  return crypto.createHash('md5').update(venueName).digest('hex').substring(0, 8)
}

// ─── Page Fetching ───────────────────────────────────────────────────────────

async function fetchNextData(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    if (!res.ok) {
      console.error(`[interpark] HTTP ${res.status} for ${url}`)
      return null
    }
    const html = await res.text()
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
    if (!match) {
      console.error('[interpark] __NEXT_DATA__ not found')
      return null
    }
    return JSON.parse(match[1])
  } catch (err) {
    console.error('[interpark] Fetch error:', err)
    return null
  }
}

async function fetchHotItems(): Promise<InterparkHotItem[]> {
  const data = await fetchNextData(FAMILY_GENRE_URL)
  if (!data) return []

  // hotItem is nested under banner in pageProps
  const hotItem = data?.props?.pageProps?.banner?.hotItem
  if (!Array.isArray(hotItem)) {
    console.error('[interpark] hotItem not found in pageProps.banner')
    return []
  }

  console.log(`[interpark] Found ${hotItem.length} hot items`)
  return hotItem.map((item: any) => ({
    goodsCode: item.goodsCode,
    goodsName: item.goodsName || item.title,
    placeName: item.placeName || '',
    playStartDate: item.playStartDate,
    playEndDate: item.playEndDate,
    startDate: item.startDate || '',
    endDate: item.endDate || '',
    // Prefer posterImageUrl, fallback to imageUrl; upgrade http to https
    imageUrl: (item.posterImageUrl || item.imageUrl || '').replace(/^http:/, 'https:'),
    link: item.link || '',
  }))
}

interface SearchResultGoods {
  goodsName: string
  goodsCode: string
  placeName: string
  startDate: string // YYYYMMDD
  endDate: string   // YYYYMMDD
  imagePath: string
}

/**
 * For "전국투어" events, search by name to find individual venue listings.
 * Returns all individual venue listings found via search page __NEXT_DATA__.
 */
async function fetchTourVenueListings(goodsName: string): Promise<SearchResultGoods[]> {
  await sleep(DELAY_MS)

  // Clean the goods name for search (remove special chars, keep core name)
  const cleanName = goodsName.replace(/[〈〉\[\]()（）]/g, ' ').replace(/\s+/g, ' ').trim()
  const searchUrl = `https://tickets.interpark.com/contents/search?keyword=${encodeURIComponent(cleanName)}&sort=BUY_COUNT_DESC`

  const data = await fetchNextData(searchUrl)
  if (!data) return []

  try {
    const goods = data?.props?.pageProps?.searchResult?.goods
    const docs = goods?.docs
    if (!Array.isArray(docs)) return []

    return docs.map((d: any) => ({
      goodsName: d.goodsName || '',
      goodsCode: d.goodsCode || '',
      placeName: d.placeName || '',
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      imagePath: (d.imagePath || '').replace(/^http:/, 'https:'),
    }))
  } catch (err) {
    console.warn(`[interpark] Search parse error for "${goodsName}":`, err)
  }

  return []
}

// ─── Location Resolution ─────────────────────────────────────────────────────

async function resolveVenueLocation(
  venueName: string,
  _eventName: string
): Promise<{ lat: number; lng: number; address: string; resolvedName: string } | null> {
  try {
    const result = await kakaoSearchLimiter.throttle(() =>
      searchKakaoPlaceDetailed(venueName, null, { size: 5 })
    )
    if (result.match && result.bestScore >= 0.5) {
      const m = result.match
      const addr = m.roadAddress || m.address
      if (isInServiceArea(m.lat, m.lng) || (addr && isValidServiceAddress(addr))) {
        return { lat: m.lat, lng: m.lng, address: addr, resolvedName: m.name }
      }
    }
  } catch (err) {
    console.warn(`[interpark] Kakao search error for "${venueName}":`, err)
  }

  return null
}

function isSeoulGyeonggiVenue(venueName: string): boolean {
  // Quick pattern check for known Seoul/Gyeonggi venue prefixes
  const seoulPatterns = /서울|강남|송파|마포|용산|종로|영등포|잠실|세종문화|예술의전당|국립극장|대학로|블루스퀘어|LG아트|충무아트|예스24.*라이브|코엑스/
  const gyeonggiPatterns = /고양|성남|수원|용인|안양|부천|일산|분당|하남|광명/
  return seoulPatterns.test(venueName) || gyeonggiPatterns.test(venueName)
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runInterparkCollector(): Promise<InterparkResult> {
  const result: InterparkResult = {
    hotItems: 0,
    skipped: 0,
    outOfArea: 0,
    inserted: 0,
    tourVenues: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  try {
    // Step 1: Fetch hot items
    const hotItems = await fetchHotItems()
    result.hotItems = hotItems.length
    if (hotItems.length === 0) return result

    // Step 2: Prefetch existing interpark source_ids
    const existingIds = await prefetchIds({
      table: 'events',
      column: 'source_id',
      filters: [{ op: 'eq', column: 'source', value: 'interpark' }],
    })
    console.log(`[interpark] Existing interpark events: ${existingIds.size}`)

    const currentYear = new Date().getFullYear()
    const today = new Date().toISOString().split('T')[0]

    // Step 3: Process each item
    for (const item of hotItems) {
      try {
        // Prefer startDate/endDate (more accurate run period) over playStartDate/playEndDate
        const startDate = parseDate(item.startDate) || parseDate(item.playStartDate)
        const endDate = parseDate(item.endDate) || parseDate(item.playEndDate)

        // Date filters
        if (startDate && parseInt(startDate.substring(0, 4)) < currentYear - 1) {
          result.skipped++
          continue
        }
        if (endDate && endDate < today) {
          result.skipped++
          continue
        }

        if (item.placeName === '전국투어' || !item.placeName) {
          // Fetch detail page for specific venues
          await processNationwideTour(item, startDate, endDate, existingIds, result)
        } else {
          // Single venue
          await processSingleVenue(item, startDate, endDate, existingIds, result)
        }
      } catch (err) {
        console.error(`[interpark] Error processing ${item.goodsCode}:`, err)
        result.errors++
      }
    }

    console.log(`[interpark] Done: ${result.inserted} inserted, ${result.outOfArea} out-of-area, ${result.skipped} skipped, ${result.errors} errors`)
  } catch (err) {
    console.error('[interpark] Fatal error:', err)
    result.errors++
  }

  await logCollection({
    collector: 'interpark',
    startedAt,
    resultsCount: result.hotItems,
    newEvents: result.inserted,
    errors: result.errors,
  })

  return result
}

async function processSingleVenue(
  item: InterparkHotItem,
  startDate: string | null,
  endDate: string | null,
  existingIds: Set<string>,
  result: InterparkResult
): Promise<void> {
  const sourceId = `interpark_${item.goodsCode}`
  if (existingIds.has(sourceId)) {
    result.skipped++
    return
  }

  const location = await resolveVenueLocation(item.placeName, item.goodsName)
  if (!location) {
    result.outOfArea++
    return
  }

  const sourceUrl = item.link?.startsWith('https://tickets.interpark.com/goods/')
    ? item.link
    : `${DETAIL_URL_BASE}/${item.goodsCode}`

  await insertEvent({
    name: item.goodsName,
    venueName: location.resolvedName || item.placeName,
    venueAddress: location.address,
    lat: location.lat,
    lng: location.lng,
    startDate,
    endDate,
    sourceId,
    sourceUrl,
    posterUrl: item.imageUrl,
  }, existingIds, result)
}

async function processNationwideTour(
  item: InterparkHotItem,
  _startDate: string | null,
  _endDate: string | null,
  existingIds: Set<string>,
  result: InterparkResult
): Promise<void> {
  // Search for individual venue listings by name
  const listings = await fetchTourVenueListings(item.goodsName)

  if (listings.length === 0) {
    console.log(`[interpark] No search results for 전국투어: ${item.goodsName}`)
    result.skipped++
    return
  }

  result.tourVenues += listings.length
  console.log(`[interpark] Found ${listings.length} venue listings for: ${item.goodsName}`)

  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  for (const listing of listings) {
    // Each listing has its own goodsCode, dates, and venue
    const sourceId = `interpark_${listing.goodsCode}`
    if (existingIds.has(sourceId)) continue

    const listingStart = parseDate(listing.startDate)
    const listingEnd = parseDate(listing.endDate)

    // Date filters per listing
    if (listingStart && parseInt(listingStart.substring(0, 4)) < currentYear - 1) continue
    if (listingEnd && listingEnd < today) continue

    // Resolve venue location
    const location = await resolveVenueLocation(listing.placeName, listing.goodsName)
    if (!location) {
      result.outOfArea++
      continue
    }

    await insertEvent({
      name: listing.goodsName,
      venueName: location.resolvedName || listing.placeName,
      venueAddress: location.address,
      lat: location.lat,
      lng: location.lng,
      startDate: listingStart,
      endDate: listingEnd,
      sourceId,
      sourceUrl: `${DETAIL_URL_BASE}/${listing.goodsCode}`,
      posterUrl: listing.imagePath || item.imageUrl,
    }, existingIds, result)
  }
}

interface EventInsertData {
  name: string
  venueName: string
  venueAddress: string
  lat: number
  lng: number
  startDate: string | null
  endDate: string | null
  sourceId: string
  sourceUrl: string
  posterUrl: string
}

async function insertEvent(
  data: EventInsertData,
  existingIds: Set<string>,
  result: InterparkResult
): Promise<void> {
  const { error } = await supabaseAdmin.from('events').insert({
    name: data.name,
    category: '문화행사',
    sub_category: classifyEventByTitle(data.name),
    venue_name: data.venueName,
    venue_address: data.venueAddress,
    lat: data.lat,
    lng: data.lng,
    start_date: data.startDate,
    end_date: data.endDate,
    source: 'interpark',
    source_id: data.sourceId,
    source_url: data.sourceUrl,
    poster_url: data.posterUrl,
  })

  if (error) {
    if (error.code === '23505') {
      result.skipped++
    } else {
      console.error(`[interpark] Insert error: ${error.message}`, data.name)
      result.errors++
    }
  } else {
    result.inserted++
    existingIds.add(data.sourceId)
  }
}
