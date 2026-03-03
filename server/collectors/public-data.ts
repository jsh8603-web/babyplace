/**
 * Public Data Collectors — data.go.kr 표준데이터 API integration
 *
 * Covers plan.md sections 18-15, 18-6 (public data).
 *
 * Three data sources (playgrounds handled by children-facility collector):
 *   1. City parks — 전국도시공원정보표준데이터 (15012890)
 *   2. Libraries — 전국도서관표준데이터 (15013109)
 *   3. Museums/galleries — 전국박물관미술관정보표준데이터 (15017323)
 *
 * API base: http://api.data.go.kr/openapi/{service}
 * Auth: DATA_GO_KR_API_KEY (shared key)
 *
 * Flow:
 *   - Fetch paginated results from 표준데이터 APIs
 *   - Filter to Seoul/Gyeonggi service area
 *   - Check for duplicates
 *   - Insert into places table
 *   - Log results to collection_logs
 */

import * as http from 'node:http'
import * as https from 'node:https'
import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { PlaceCategory } from '../../src/types/index'
import { checkPlaceGate } from '../matchers/place-gate'

// ─── Standard Data API response format ───────────────────────────────────────

interface StandardDataResponse {
  response: {
    header: {
      resultCode: string
      resultMsg: string
      type?: string
    }
    body: {
      items: Record<string, string>[] | { item: Record<string, string>[] }
      totalCount: string | number
      pageNo: string | number
      numOfRows: string | number
    }
  }
}

/**
 * Extract items array from response, handling both formats:
 *   - items: [ ... ]          (표준데이터 format)
 *   - items: { item: [ ... ]} (legacy format)
 */
function extractItems(data: StandardDataResponse): Record<string, string>[] {
  const items = data?.response?.body?.items
  if (!items) return []
  if (Array.isArray(items)) return items
  if (items && typeof items === 'object' && 'item' in items) {
    const inner = (items as { item: Record<string, string>[] }).item
    return Array.isArray(inner) ? inner : []
  }
  return []
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface PublicDataResult {
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
    parks: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    libraries: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    museums: { fetched: 0, new: 0, duplicates: 0, errors: 0 },
    totalFetched: 0,
    totalNew: 0,
    totalDuplicates: 0,
    totalErrors: 0,
  }

  // Run Tue/Fri only — data changes slowly, saves ~71% API calls
  const dayOfWeek = new Date().getUTCDay() // 0=Sun, ..., 2=Tue, 5=Fri
  const isCollectionDay = dayOfWeek === 2 || dayOfWeek === 5
  if (!isCollectionDay && process.argv[2] !== 'manual') {
    console.log(`[public-data] Skipping — runs Tue/Fri only (today: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`)
    return result
  }

  const startedAt = Date.now()

  // Prefetch existing source_ids to skip known items without DB query
  const existingSourceIds = await prefetchPublicDataSourceIds()
  console.log(`[public-data] Pre-fetched ${existingSourceIds.size} existing source_ids`)

  try {
    console.log('[public-data] Fetching parks...')
    await fetchParks(result.parks, existingSourceIds)
    await delay(60000) // 60s cooldown between APIs to avoid WAF IP block

    console.log('[public-data] Fetching libraries...')
    await fetchLibraries(result.libraries, existingSourceIds)
    await delay(3000)

    console.log('[public-data] Fetching museums...')
    await fetchMuseums(result.museums, existingSourceIds)
  } catch (err) {
    console.error('[public-data] Fatal error:', err)
    result.totalErrors++
  }

  // Calculate totals (preserve any fatal errors already counted)
  const fatalErrors = result.totalErrors
  result.totalFetched =
    result.parks.fetched +
    result.libraries.fetched +
    result.museums.fetched
  result.totalNew =
    result.parks.new +
    result.libraries.new +
    result.museums.new
  result.totalDuplicates =
    result.parks.duplicates +
    result.libraries.duplicates +
    result.museums.duplicates
  result.totalErrors =
    fatalErrors +
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

// ─── Prefetch helpers ────────────────────────────────────────────────────────

async function prefetchPublicDataSourceIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  const batchSize = 1000
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('places')
      .select('source_id')
      .eq('source', 'public-data-go.kr')
      .range(offset, offset + batchSize - 1)
    if (error || !data || data.length === 0) break
    for (const row of data) {
      if (row.source_id) ids.add(row.source_id)
    }
    if (data.length < batchSize) break
    offset += batchSize
  }
  return ids
}

// ─── HTTP helpers for data.go.kr anti-bot challenge ─────────────────────────

function httpGet(
  url: string,
  opts?: { timeout?: number; headers?: Record<string, string> }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const transport = isHttps ? https : http
    const reqOpts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      timeout: opts?.timeout ?? 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        ...opts?.headers,
      },
    }
    const req = transport.get(reqOpts, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => (body += chunk.toString()))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

/**
 * Parse data.go.kr anti-bot JS challenge and extract redirect path.
 * Pattern A: x={o:'...',t:'...',h:'...'} → t + h + o
 * Pattern B: x={o:'...',c:N},z=M → o.substr(0,c) + o.substr(c+z)
 */
function parseJsChallenge(html: string): string | null {
  const tMatch = html.match(/t:'([^']+)'/)
  const hMatch = html.match(/h:'([^']+)'/)
  const oMatch = html.match(/o:'([^']+)'/)

  if (tMatch && hMatch && oMatch) {
    return tMatch[1] + hMatch[1] + oMatch[1]
  }

  if (oMatch) {
    const cMatch = html.match(/c:(\d+)/)
    const zMatch = html.match(/z=(\d+)/)
    if (cMatch && zMatch) {
      const o = oMatch[1]
      const c = parseInt(cMatch[1])
      const z = parseInt(zMatch[1])
      return o.substring(0, c) + o.substring(c + z)
    }
  }

  return null
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Fetch with data.go.kr anti-bot JS challenge handling + retry.
 *
 * The WAF sometimes returns JS challenges, sometimes JSON directly.
 * Challenge flow: original URL → HTML challenge → token URL (302) → original URL → JSON.
 * Retries up to 3 times with 2s delay between attempts.
 */
async function fetchWithChallenge(url: string, label: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(2000 * attempt)

    try {
      const res = await httpGet(url, { timeout: 12000 })

      // Direct JSON response — no challenge
      if (res.body.trimStart().startsWith('{') || res.body.trimStart().startsWith('[')) {
        return res.body
      }

      // HTML challenge — parse and follow redirect
      if (res.body.includes('<script>') && res.body.includes('rsu')) {
        const redirectPath = parseJsChallenge(res.body)
        if (!redirectPath) {
          console.error(`[public-data] ${label}: failed to parse JS challenge (attempt ${attempt + 1})`)
          continue
        }

        const parsed = new URL(url)
        let redirectUrl = `${parsed.protocol}//${parsed.host}${redirectPath}`

        const rawCookies = res.headers['set-cookie']
        const cookieHeader = rawCookies
          ? (Array.isArray(rawCookies) ? rawCookies : [rawCookies]).map(c => c.split(';')[0]).join('; ')
          : ''
        const headers: Record<string, string> = cookieHeader ? { Cookie: cookieHeader } : {}

        // Follow redirect chain (up to 3 hops)
        let resolved = false
        for (let hop = 0; hop < 3; hop++) {
          const r = await httpGet(redirectUrl, { headers, timeout: 12000 })

          if (r.status === 301 || r.status === 302) {
            const location = r.headers['location']
            if (!location) break
            redirectUrl = location.startsWith('http')
              ? location
              : `${parsed.protocol}//${parsed.host}${location}`
            continue
          }

          if (r.body.trimStart().startsWith('{') || r.body.trimStart().startsWith('[')) {
            return r.body
          }

          // Non-JSON from redirect (404 etc) — break and retry from scratch
          resolved = true
          break
        }

        if (!resolved) {
          console.error(`[public-data] ${label}: challenge redirect failed (attempt ${attempt + 1})`)
        }
        continue
      }

      // Unknown response — retry
      console.error(`[public-data] ${label}: unexpected response (attempt ${attempt + 1}):`, res.body.slice(0, 200))
    } catch (err) {
      console.error(`[public-data] ${label}: fetch error (attempt ${attempt + 1}):`, (err as Error).message)
    }
  }

  console.error(`[public-data] ${label}: all 3 attempts failed`)
  return null
}

// ─── Shared fetch helper ─────────────────────────────────────────────────────

async function fetchStandardPage(
  apiUrl: string,
  serviceKey: string,
  page: number,
  pageSize: number,
  label: string
): Promise<{ items: Record<string, string>[]; totalCount: number } | null> {
  const params = new URLSearchParams({
    pageNo: String(page),
    numOfRows: String(pageSize),
    type: 'json',
  })
  const url = `${apiUrl}?serviceKey=${serviceKey}&${params.toString()}`

  // Delay between pages to avoid data.go.kr WAF rate limiting
  if (page > 1) await delay(5000)

  try {
    const text = await fetchWithChallenge(url, label)
    if (!text) return null

    let data: StandardDataResponse

    try {
      data = JSON.parse(text) as StandardDataResponse
    } catch {
      console.error(`[public-data] ${label}: non-JSON response:`, text.slice(0, 300))
      return null
    }

    if (data?.response?.header?.resultCode !== '00') {
      console.error(
        `[public-data] ${label} API error: ${data?.response?.header?.resultMsg} (code: ${data?.response?.header?.resultCode})`
      )
      return null
    }

    const items = extractItems(data)

    // Log first item's keys on first page for debugging field names
    if (page === 1 && items.length > 0) {
      console.log(`[public-data] ${label} fields:`, Object.keys(items[0]).join(', '))
      console.log(`[public-data] ${label} sample:`, JSON.stringify(items[0]).slice(0, 500))
    }

    const totalCount = parseInt(String(data?.response?.body?.totalCount || '0'), 10)
    return { items, totalCount }
  } catch (err) {
    console.error(`[public-data] ${label} fetch error:`, err)
    return null
  }
}

// ─── Data Source 1: Parks (전국도시공원정보표준데이터) ────────────────────────

// Confirmed fields from data.go.kr docs (15012890):
// MANAGE_NO, PARK_NM, PARK_SE, RDNMADR, LNMADR, LATITUDE, LONGITUDE,
// PARK_AR, MVM_FCLTY, AMSMT_FCLTY, CNVNNC_FCLTY, CLTR_FCLTY, ETC_FCLTY,
// APPN_NTFC_DATE, INSTITUTION_NM, PHONE_NUMBER, REFERENCE_DATE

const PARKS_API = 'http://api.data.go.kr/openapi/tn_pubr_public_cty_park_info_api'

interface ParkStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchParks(stats: ParkStats, existingSourceIds: Set<string>): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping parks')
    stats.errors++
    return
  }

  let pageNo = 1
  let consecutiveFails = 0
  const pageSize = 1000

  while (true) {
    try {
      const result = await fetchStandardPage(PARKS_API, serviceKey, pageNo, pageSize, 'Parks')
      if (!result) {
        if (++consecutiveFails >= 2) { console.warn('[public-data] Parks: 2 consecutive failures, stopping'); break }
        pageNo++; continue
      }
      consecutiveFails = 0
      if (result.items.length === 0) break
      console.log(`[public-data] Parks page ${pageNo}: processing ${result.items.length} items`)

      for (const item of result.items) {
        try {
          const name = item.PARK_NM || item.parkNm || ''
          if (!name) continue

          // Filter: children's parks (어린이/유아/키즈/꿈나무 등)
          const parkType = item.PARK_SE || item.parkSe || ''
          const parkChildFilter = /어린이|유아|아이숲|아이들|키즈|꿈나무/
          if (!parkChildFilter.test(name) && !parkChildFilter.test(parkType)) continue

          const lat = parseFloat(item.LATITUDE || item.latitude || '')
          const lng = parseFloat(item.LONGITUDE || item.longitude || '')
          const address = item.RDNMADR || item.LNMADR || item.rdnmadr || item.lnmadr || ''

          if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue
          if (!isInServiceRegion(lat, lng, address)) continue

          const sourceId = item.MANAGE_NO || `park_${name}`.replace(/\s+/g, '_')

          // Fast in-memory duplicate check
          if (existingSourceIds.has(sourceId)) {
            stats.duplicates++
            continue
          }

          const dup = await checkDuplicate({
            kakaoPlaceId: `park_${sourceId}`,
            name,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            await supabaseAdmin.rpc('increment_source_count', { p_place_id: dup.existingId })
            stats.duplicates++
            continue
          }

          const gate = await checkPlaceGate({ name, source: 'public-data-go.kr' })
          if (!gate.allowed) continue

          const districtCode = await getDistrictCode(lat, lng, address)

          const { error } = await supabaseAdmin.from('places').insert({
            name,
            category: '공원/놀이터' as PlaceCategory,
            sub_category: parkType || '어린이공원',
            address,
            road_address: item.RDNMADR || item.rdnmadr || null,
            lat,
            lng,
            district_code: districtCode,
            phone: item.PHONE_NUMBER || item.phoneNumber || null,
            source: 'public-data-go.kr',
            source_id: sourceId,
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

      console.log(`[public-data] Parks page ${pageNo} done: fetched=${stats.fetched} new=${stats.new} dup=${stats.duplicates}`)
      if (result.items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Parks fetch error:', err)
      stats.errors++
      break
    }
  }
}

// ─── Data Source 2: Libraries (전국도서관표준데이터) ──────────────────────────

// Expected fields (15013109):
// LBRRY_NM, CTPRVN_NM, SIGNGU_NM, LBRRY_SE_NM, CLOSE_DAY,
// WEEKDAY_OPER_OPEN_HHMM, WEEKDAY_OPER_CLOSE_HHMM,
// SAT_OPER_OPEN_HHMM, SAT_OPER_CLOSE_HHMM,
// HOLIDAY_OPER_OPEN_HHMM, HOLIDAY_OPER_CLOSE_HHMM,
// SEAT_CO, BOOK_CO, PBLICTN_CO, NONBOOK_CO, LON_CO, LONDAY_CNT,
// RDNMADR, LNMADR, LATITUDE, LONGITUDE,
// HOMEPG_URL, TEL_NO, INSTITUTION_NM, REFERENCE_DATE

const LIBRARIES_API = 'http://api.data.go.kr/openapi/tn_pubr_public_lbrry_api'

interface LibraryStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchLibraries(stats: LibraryStats, existingSourceIds: Set<string>): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping libraries')
    stats.errors++
    return
  }

  let pageNo = 1
  let consecutiveFails = 0
  const pageSize = 1000

  while (true) {
    try {
      const result = await fetchStandardPage(LIBRARIES_API, serviceKey, pageNo, pageSize, 'Libraries')
      if (!result) {
        if (++consecutiveFails >= 2) { console.warn('[public-data] Libraries: 2 consecutive failures, stopping'); break }
        pageNo++; continue
      }
      consecutiveFails = 0
      if (result.items.length === 0) break

      for (const item of result.items) {
        try {
          const name = item.LBRRY_NM || item.lbrryNm || ''
          if (!name) continue

          // Filter: children's libraries (어린이/유아/영유아/키즈/꿈나무/그림책 등)
          const libraryType = item.LBRRY_SE_NM || item.lbrrySeNm || item.lbrryTyNm || ''
          const libChildFilter = /어린이|유아|영유아|아기|키즈|꿈나무|그림책/
          if (!libChildFilter.test(name) && !libChildFilter.test(libraryType)) continue

          const lat = parseFloat(item.LATITUDE || item.latitude || '')
          const lng = parseFloat(item.LONGITUDE || item.longitude || '')
          const address = item.RDNMADR || item.LNMADR || item.rdnmadr || item.lnmadr || item.addr || ''

          if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue
          if (!isInServiceRegion(lat, lng, address)) continue

          const sourceId = `library_${name}`.replace(/\s+/g, '_')

          if (existingSourceIds.has(sourceId)) {
            stats.duplicates++
            continue
          }

          const dup = await checkDuplicate({
            kakaoPlaceId: sourceId,
            name,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            await supabaseAdmin.rpc('increment_source_count', { p_place_id: dup.existingId })
            stats.duplicates++
            continue
          }

          const gate = await checkPlaceGate({ name, source: 'public-data-go.kr' })
          if (!gate.allowed) continue

          const districtCode = await getDistrictCode(lat, lng, address)

          const { error } = await supabaseAdmin.from('places').insert({
            name,
            category: '도서관' as PlaceCategory,
            sub_category: libraryType || '어린이도서관',
            address,
            road_address: item.RDNMADR || item.rdnmadr || null,
            lat,
            lng,
            district_code: districtCode,
            phone: item.TEL_NO || item.telNo || null,
            source: 'public-data-go.kr',
            source_id: sourceId,
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

      if (result.items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Libraries fetch error:', err)
      stats.errors++
      break
    }
  }
}

// ─── Data Source 3: Museums (전국박물관미술관정보표준데이터) ───────────────────

// Expected fields (15017323):
// FCLTY_NM, CTPRVN_NM, SIGNGU_NM, FCLTY_SE_NM (박물관/미술관),
// RDNMADR, LNMADR, LATITUDE, LONGITUDE,
// OPER_INSTT_TELNO, OPER_INSTT_NM, HOMEPG_URL,
// ENTRC_FEE, REST_DAY, REFERENCE_DATE

const MUSEUMS_API = 'http://api.data.go.kr/openapi/tn_pubr_public_museum_artgr_info_api'

interface MuseumStats {
  fetched: number
  new: number
  duplicates: number
  errors: number
}

async function fetchMuseums(stats: MuseumStats, existingSourceIds: Set<string>): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY
  if (!serviceKey) {
    console.warn('[public-data] DATA_GO_KR_API_KEY not set, skipping museums')
    stats.errors++
    return
  }

  let pageNo = 1
  let consecutiveFails = 0
  const pageSize = 1000

  while (true) {
    try {
      const result = await fetchStandardPage(MUSEUMS_API, serviceKey, pageNo, pageSize, 'Museums')
      if (!result) {
        if (++consecutiveFails >= 2) { console.warn('[public-data] Museums: 2 consecutive failures, stopping'); break }
        pageNo++; continue
      }
      consecutiveFails = 0
      if (result.items.length === 0) break

      for (const item of result.items) {
        try {
          const name = item.FCLTY_NM || item.fcltyNm || item.mnmusNm || ''
          if (!name) continue

          const lat = parseFloat(item.LATITUDE || item.latitude || '')
          const lng = parseFloat(item.LONGITUDE || item.longitude || '')
          const address = item.RDNMADR || item.LNMADR || item.rdnmadr || item.lnmadr || item.addr || ''

          if (isNaN(lat) || isNaN(lng) || !lat || !lng) continue
          if (!isInServiceRegion(lat, lng, address)) continue

          const sourceId = `museum_${name}`.replace(/\s+/g, '_')

          if (existingSourceIds.has(sourceId)) {
            stats.duplicates++
            continue
          }

          const dup = await checkDuplicate({
            kakaoPlaceId: sourceId,
            name,
            address,
            lat,
            lng,
          })

          if (dup.isDuplicate && dup.existingId) {
            await supabaseAdmin.rpc('increment_source_count', { p_place_id: dup.existingId })
            stats.duplicates++
            continue
          }

          const gate = await checkPlaceGate({ name, source: 'public-data-go.kr' })
          if (!gate.allowed) continue

          const districtCode = await getDistrictCode(lat, lng, address)
          const facilityType = item.FCLTY_SE_NM || item.fcltySeNm || ''
          const category = '전시/체험' as PlaceCategory

          const { error } = await supabaseAdmin.from('places').insert({
            name,
            category,
            sub_category: facilityType.includes('미술관') || name.includes('미술관')
              ? '미술관'
              : '박물관',
            address,
            road_address: item.RDNMADR || item.rdnmadr || null,
            lat,
            lng,
            district_code: districtCode,
            phone: item.OPER_INSTT_TELNO || item.operInsttTelno || item.telNo || null,
            source: 'public-data-go.kr',
            source_id: sourceId,
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

      if (result.items.length < pageSize) break
      pageNo++
    } catch (err) {
      console.error('[public-data] Museums fetch error:', err)
      stats.errors++
      break
    }
  }
}
