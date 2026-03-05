/**
 * One-time fix script for BabyGo data quality:
 *   1. Category correction via regex (immediate, no Kakao quota needed)
 *   2. Cross-source duplicate deactivation (babygo side → is_active=false, other side → source_count++)
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_fix_babygo_duplicates.ts
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { similarity, normalizePlaceName } from '../matchers/similarity'

// ─── Category correction rules ──────────────────────────────────────────────

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /전시|박물관|미술관|체험|과학관|궁$|궁궐|문화회관|문화원|기념관/, category: '전시/체험' },
  { pattern: /공원|숲|자연|생태|수목원|식물원/, category: '공원/놀이터' },
  { pattern: /놀이터|어린이공원/, category: '공원/놀이터' },
  { pattern: /동물원|아쿠아|수족관|농장|목장/, category: '동물/자연' },
  { pattern: /식당|카페|레스토랑|뷔페|맛집|베이커리|빵집/, category: '식당/카페' },
  { pattern: /도서관|북카페|서점|교보문고|영풍문고/, category: '도서관' },
  { pattern: /수영|워터|물놀이/, category: '수영/물놀이' },
  { pattern: /수유실|기저귀|육아.*센터|지원센터|보육.*센터|보건소|소아과/, category: '편의시설' },
  { pattern: /호텔|리조트|펜션|캠핑|글램핑/, category: '놀이' },
  { pattern: /공연|극장|인형극|뮤지컬/, category: '공연' },
  { pattern: /키즈카페|놀이카페|키즈파크|실내놀이|트램폴린|볼풀/, category: '놀이' },
]

async function fixCategories(): Promise<{ fixed: number; before: Record<string, number>; after: Record<string, number> }> {
  // Fetch all babygo places
  const all: Array<{ id: number; name: string; category: string }> = []
  let from = 0
  while (true) {
    const { data } = await supabaseAdmin
      .from('places')
      .select('id, name, category')
      .eq('source', 'babygo')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    all.push(...data)
    from += 1000
  }

  // Count before
  const before: Record<string, number> = {}
  for (const p of all) before[p.category] = (before[p.category] || 0) + 1

  // Apply rules to places currently in '놀이' (the fallback)
  let fixed = 0
  for (const place of all) {
    if (place.category !== '놀이') continue

    let newCategory: string | null = null
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(place.name) && rule.category !== '놀이') {
        newCategory = rule.category
        break
      }
    }

    if (newCategory) {
      const { error } = await supabaseAdmin
        .from('places')
        .update({ category: newCategory })
        .eq('id', place.id)
      if (!error) {
        place.category = newCategory  // update local copy for after count
        fixed++
      }
    }
  }

  // Count after
  const after: Record<string, number> = {}
  for (const p of all) after[p.category] = (after[p.category] || 0) + 1

  return { fixed, before, after }
}

async function fixDuplicates(): Promise<{ deactivated: number; examples: string[] }> {
  // Fetch all babygo places
  const bgPages: Array<{ id: number; name: string; lat: number; lng: number }> = []
  let from = 0
  while (true) {
    const { data } = await supabaseAdmin
      .from('places')
      .select('id, name, lat, lng')
      .eq('source', 'babygo')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    bgPages.push(...data)
    from += 1000
  }

  // Fetch non-babygo active places
  const otherPages: Array<{ id: number; name: string; lat: number; lng: number }> = []
  from = 0
  while (true) {
    const { data } = await supabaseAdmin
      .from('places')
      .select('id, name, lat, lng')
      .neq('source', 'babygo')
      .eq('is_active', true)
      .range(from, from + 999)
    if (!data || data.length === 0) break
    otherPages.push(...data)
    from += 1000
  }

  // Build spatial index
  const grid = new Map<string, typeof otherPages>()
  for (const o of otherPages) {
    const key = `${Math.floor(o.lat * 100)}_${Math.floor(o.lng * 100)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(o)
  }

  let deactivated = 0
  const examples: string[] = []

  for (const b of bgPages) {
    const bLat100 = Math.floor(b.lat * 100)
    const bLng100 = Math.floor(b.lng * 100)
    const candidates: typeof otherPages = []
    for (let dl = -1; dl <= 1; dl++) {
      for (let dn = -1; dn <= 1; dn++) {
        const k = `${bLat100 + dl}_${bLng100 + dn}`
        if (grid.has(k)) candidates.push(...grid.get(k)!)
      }
    }

    for (const o of candidates) {
      const dLat = Math.abs(b.lat - o.lat)
      const dLng = Math.abs(b.lng - o.lng)
      if (dLat < 0.001 && dLng < 0.001) {
        const sim = similarity(normalizePlaceName(b.name), normalizePlaceName(o.name))
        if (sim >= 0.6) {
          // Deactivate babygo side, bump other side
          const { error: e1 } = await supabaseAdmin
            .from('places')
            .update({ is_active: false })
            .eq('id', b.id)
          const { error: e2 } = await supabaseAdmin
            .rpc('increment_source_count', { p_place_id: o.id })

          if (!e1 && !e2) {
            deactivated++
            if (examples.length < 20) {
              examples.push(`sim=${sim.toFixed(2)} | babygo[${b.id}] "${b.name}" → deactivated, other[${o.id}] "${o.name}" → source_count++`)
            }
          }
          break // one match per babygo place is enough
        }
      }
    }
  }

  return { deactivated, examples }
}

async function main() {
  console.log('=== BabyGo Data Fix ===\n')

  // Step 1: Category correction
  console.log('--- Step 1: Category Correction ---')
  const catResult = await fixCategories()
  console.log(`Fixed: ${catResult.fixed} places`)
  console.log('Before:', catResult.before)
  console.log('After:', catResult.after)

  // Step 2: Duplicate deactivation
  console.log('\n--- Step 2: Cross-source Duplicate Deactivation ---')
  const dupResult = await fixDuplicates()
  console.log(`Deactivated: ${dupResult.deactivated} babygo duplicates`)
  for (const ex of dupResult.examples) console.log(`  ${ex}`)

  console.log('\n=== Done ===')
}

main().catch(console.error)
