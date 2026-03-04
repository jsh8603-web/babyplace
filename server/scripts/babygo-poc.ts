/**
 * BabyGo (애기야가자) PoC Collector
 *
 * Collects place data from api.babygo.kr and checks overlap with existing DB.
 * Default: dry-run (report only). Pass --fix to actually INSERT new places.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/babygo-poc.ts
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/babygo-poc.ts --fix
 *
 * API notes:
 *   - List API returns correct UTF-8 name/address
 *   - Detail API returns lat/lng, phone_number, note (description has encoding issues)
 *   - We use list name/address as primary, detail only for coordinates + phone
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { checkDuplicate } from '../matchers/duplicate'
import { checkPlaceGate } from '../matchers/place-gate'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.babygo.kr/api/v1'
const PAGES_PER_GRID = 5
const DELAY_MS = 500 // 2 req/sec

const GRID_POINTS = [
  // Seoul (6)
  { label: '강남', lat: 37.498, lng: 127.028 },
  { label: '홍대', lat: 37.557, lng: 126.924 },
  { label: '잠실', lat: 37.513, lng: 127.100 },
  { label: '여의도', lat: 37.525, lng: 126.926 },
  { label: '종로', lat: 37.572, lng: 126.979 },
  { label: '노원', lat: 37.654, lng: 127.056 },
  // Gyeonggi (6)
  { label: '분당', lat: 37.382, lng: 127.119 },
  { label: '일산', lat: 37.659, lng: 126.770 },
  { label: '수원', lat: 37.264, lng: 127.000 },
  { label: '하남', lat: 37.539, lng: 127.214 },
  { label: '김포', lat: 37.615, lng: 126.716 },
  { label: '용인', lat: 37.241, lng: 127.178 },
]

// ─── Types ───────────────────────────────────────────────────────────────────

interface BabygoListItem {
  id: string
  name: string
  address: string
  thumbnail: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
  is_advertising: boolean
  babypass: unknown
}

interface BabygoDetailRaw {
  id: string
  lat: number
  lng: number
  phone_number: string | null
  note: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
}

/** Merged place: list name/address + detail lat/lng/phone */
interface BabygoPlace {
  id: string
  name: string       // from list API (correct UTF-8)
  address: string    // from list API (correct UTF-8)
  lat: number
  lng: number
  phone: string | null
  likers_count: number
  score: number | null
  event_starts_at: string | null
  event_ends_at: string | null
}

interface Stats {
  totalRaw: number
  uniqueCount: number
  detailFetched: number
  outOfArea: number
  dbDuplicate: number
  placeGateBlocked: number
  inserted: number
  insertErrors: number
  eventCount: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`  HTTP ${res.status} for ${url}`)
      return null
    }
    return (await res.json()) as T
  } catch (err) {
    console.error(`  Fetch error: ${(err as Error).message}`)
    return null
  }
}

/**
 * Infer BabyPlace category from place name.
 * BabyGo doesn't expose categories via API, so we pattern-match the name.
 */
function inferCategory(name: string): {
  category: string
  subCategory: string | null
} {
  if (/키즈카페|놀이카페|키즈파크|실내놀이/.test(name))
    return { category: '놀이', subCategory: '키즈카페' }
  if (/놀이터|어린이공원/.test(name))
    return { category: '공원/놀이터', subCategory: '놀이터' }
  if (/공원|숲|자연|생태/.test(name))
    return { category: '공원/놀이터', subCategory: '공원' }
  if (/전시|박물관|미술관|체험|과학관/.test(name))
    return { category: '전시/체험', subCategory: null }
  if (/공연|극장|인형극|뮤지컬/.test(name))
    return { category: '공연', subCategory: null }
  if (/동물원|아쿠아|수족관|농장/.test(name))
    return { category: '동물/자연', subCategory: null }
  if (/식당|카페|레스토랑|뷔페|맛집/.test(name))
    return { category: '식당/카페', subCategory: null }
  if (/도서관|북카페|서점/.test(name))
    return { category: '도서관', subCategory: null }
  if (/수영|워터|물놀이|풀/.test(name))
    return { category: '수영/물놀이', subCategory: null }
  if (/수유실|기저귀/.test(name))
    return { category: '편의시설', subCategory: null }

  // Default for kids-oriented places
  return { category: '놀이', subCategory: null }
}

// ─── Step 1: Fetch list pages from grid coordinates ──────────────────────────

async function fetchListPages(): Promise<Map<string, BabygoListItem>> {
  const seen = new Map<string, BabygoListItem>()
  let totalFetched = 0

  for (const point of GRID_POINTS) {
    console.log(`[Grid] ${point.label} (${point.lat}, ${point.lng})`)

    for (let page = 1; page <= PAGES_PER_GRID; page++) {
      const url = `${API_BASE}/places?lat=${point.lat}&lng=${point.lng}&page=${page}`
      const data = await fetchJson<{ places: BabygoListItem[]; next: string | null }>(url)

      if (!data?.places || data.places.length === 0) {
        console.log(`  Page ${page}: empty, stopping`)
        break
      }

      let newInPage = 0
      for (const item of data.places) {
        if (!seen.has(item.id)) {
          seen.set(item.id, item)
          newInPage++
        }
      }
      totalFetched += data.places.length
      console.log(`  Page ${page}: ${data.places.length} items (${newInPage} new)`)
      await sleep(DELAY_MS)
    }
  }

  console.log(`\n[Step 1] Total fetched: ${totalFetched}, Unique: ${seen.size}`)
  return seen
}

// ─── Step 2: Fetch details for lat/lng ──────────────────────────────────────

async function fetchDetailsAndMerge(
  items: Map<string, BabygoListItem>
): Promise<BabygoPlace[]> {
  const places: BabygoPlace[] = []
  let i = 0
  const total = items.size

  for (const [id, listItem] of items) {
    i++
    if (i % 50 === 0) console.log(`[Detail] ${i}/${total}...`)

    const url = `${API_BASE}/places/${id}`
    const detail = await fetchJson<BabygoDetailRaw>(url)

    if (detail?.lat && detail?.lng) {
      places.push({
        id: listItem.id,
        name: listItem.name,        // from list (correct UTF-8)
        address: listItem.address,   // from list (correct UTF-8)
        lat: detail.lat,
        lng: detail.lng,
        phone: detail.phone_number || null,
        likers_count: detail.likers_count ?? listItem.likers_count,
        score: detail.score ?? listItem.score,
        event_starts_at: detail.event_starts_at ?? listItem.event_starts_at,
        event_ends_at: detail.event_ends_at ?? listItem.event_ends_at,
      })
    }
    await sleep(DELAY_MS)
  }

  console.log(`[Step 2] Details merged: ${places.length}/${total}`)
  return places
}

// ─── Steps 3-7: Filter, dedup, insert ───────────────────────────────────────

async function processPlaces(
  places: BabygoPlace[],
  dryRun: boolean
): Promise<{
  stats: Stats
  preview: Array<{ name: string; address: string; likers: number; category: string }>
}> {
  const stats: Stats = {
    totalRaw: 0,
    uniqueCount: places.length,
    detailFetched: places.length,
    outOfArea: 0,
    dbDuplicate: 0,
    placeGateBlocked: 0,
    inserted: 0,
    insertErrors: 0,
    eventCount: 0,
  }

  const preview: Array<{
    name: string
    address: string
    likers: number
    category: string
  }> = []

  for (const place of places) {
    // Count events
    if (place.event_starts_at) stats.eventCount++

    // Step 3: Service area filter
    if (!isInServiceRegion(place.lat, place.lng, place.address || null)) {
      stats.outOfArea++
      continue
    }

    // Step 4: DB duplicate check
    const dup = await checkDuplicate({
      kakaoPlaceId: `babygo_${place.id}`,
      name: place.name,
      address: place.address || '',
      lat: place.lat,
      lng: place.lng,
    })

    if (dup.isDuplicate) {
      if (dup.existingId && !dryRun) {
        await supabaseAdmin.rpc('increment_source_count', {
          p_place_id: dup.existingId,
        })
      }
      stats.dbDuplicate++
      continue
    }

    // Step 5: Place Gate
    const { category, subCategory } = inferCategory(place.name)
    const gate = await checkPlaceGate({
      name: place.name,
      subCategory,
      source: 'babygo',
    })
    if (!gate.allowed) {
      stats.placeGateBlocked++
      continue
    }

    // Collect for preview
    preview.push({
      name: place.name,
      address: place.address,
      likers: place.likers_count,
      category,
    })

    // Step 7: INSERT (--fix mode only)
    if (!dryRun) {
      const districtCode = await getDistrictCode(
        place.lat,
        place.lng,
        place.address || ''
      )

      const { error } = await supabaseAdmin.from('places').insert({
        name: place.name,
        category,
        sub_category: subCategory,
        address: place.address || null,
        lat: place.lat,
        lng: place.lng,
        district_code: districtCode,
        phone: place.phone || null,
        source: 'babygo',
        source_id: place.id,
        is_active: true,
      })

      if (error) {
        if (error.code === '23505') {
          stats.dbDuplicate++
        } else {
          console.error(`[Insert Error] ${place.name}: ${error.message}`)
          stats.insertErrors++
        }
      } else {
        stats.inserted++
      }
    } else {
      stats.inserted++ // count as "would insert"
    }
  }

  // Sort preview by likers descending
  preview.sort((a, b) => b.likers - a.likers)

  return { stats, preview: preview.slice(0, 30) }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = !process.argv.includes('--fix')
  console.log(`\n========================================`)
  console.log(`  BabyGo PoC Collector (${dryRun ? 'DRY-RUN' : 'INSERT MODE'})`)
  console.log(`========================================\n`)

  // Step 1: Fetch list pages
  const listItems = await fetchListPages()
  const totalRaw = listItems.size

  if (totalRaw === 0) {
    console.log('No items fetched. Exiting.')
    return
  }

  // Step 2: Fetch details (for lat/lng)
  const places = await fetchDetailsAndMerge(listItems)

  // Steps 3-7: Process
  console.log(`\n[Processing] ${places.length} places...`)
  const { stats, preview } = await processPlaces(places, dryRun)
  stats.totalRaw = totalRaw

  // Step 6: Report
  console.log(`\n========================================`)
  console.log(`  RESULTS ${dryRun ? '(DRY-RUN)' : '(INSERTED)'}`)
  console.log(`========================================`)
  console.log(`  Unique from grid:        ${stats.totalRaw}`)
  console.log(`  With coordinates:        ${stats.detailFetched}`)
  console.log(`  Out of service area:     ${stats.outOfArea}`)
  console.log(`  DB duplicates:           ${stats.dbDuplicate}`)
  console.log(`  Place Gate blocked:      ${stats.placeGateBlocked}`)
  console.log(`  Insert errors:           ${stats.insertErrors}`)
  console.log(`  ★ New places${dryRun ? ' (would insert)' : ' inserted'}:  ${stats.inserted}`)
  console.log(`  event_starts_at != null: ${stats.eventCount}`)
  console.log(`========================================\n`)

  if (preview.length > 0) {
    console.log(`Top ${preview.length} new places (by likers_count):`)
    console.log('─'.repeat(80))
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]
      console.log(
        `  ${String(i + 1).padStart(2)}. [${p.category}] ${p.name} (❤ ${p.likers}) — ${p.address}`
      )
    }
    console.log('')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
