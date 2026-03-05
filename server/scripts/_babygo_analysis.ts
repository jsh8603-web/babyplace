import { supabaseAdmin } from '../lib/supabase-admin'
import { similarity, normalizePlaceName } from '../matchers/similarity'

async function main() {
  // 1. Total babygo
  const { count } = await supabaseAdmin.from('places').select('*', { count: 'exact', head: true }).eq('source', 'babygo')
  console.log('Total babygo:', count)

  // 2. Category distribution
  const { data: all } = await supabaseAdmin.from('places').select('category').eq('source', 'babygo')
  const cats: Record<string, number> = {}
  for (const r of all || []) cats[r.category] = (cats[r.category] || 0) + 1
  console.log('\nCategory distribution:')
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`))

  // 3. Check specific duplicates from screenshot
  for (const term of ['역사박물관', '광화문', '세종문화회관']) {
    const { data } = await supabaseAdmin.from('places').select('id, name, source, category, address').ilike('name', `%${term}%`).eq('is_active', true)
    console.log(`\n"${term}" matches:`)
    for (const r of data || []) console.log(`  id=${r.id} [${r.source}] ${r.category} | ${r.name} | ${(r.address || '').slice(0, 50)}`)
  }

  // 4. 놀이 category samples — likely miscategorized
  const { data: nori } = await supabaseAdmin.from('places').select('name').eq('source', 'babygo').eq('category', '놀이').order('name').limit(60)
  console.log('\n=== Babygo 놀이 samples (60) ===')
  for (const r of nori || []) console.log(`  ${r.name}`)

  // 5. Cross-source duplicate detection
  // Fetch all babygo places
  const bgPages: Array<{id: number, name: string, lat: number, lng: number}> = []
  let from = 0
  while (true) {
    const { data } = await supabaseAdmin.from('places').select('id, name, lat, lng').eq('source', 'babygo').range(from, from + 999)
    if (!data || data.length === 0) break
    bgPages.push(...data)
    from += 1000
  }

  // Fetch non-babygo active places
  const otherPages: Array<{id: number, name: string, lat: number, lng: number}> = []
  from = 0
  while (true) {
    const { data } = await supabaseAdmin.from('places').select('id, name, lat, lng').neq('source', 'babygo').eq('is_active', true).range(from, from + 999)
    if (!data || data.length === 0) break
    otherPages.push(...data)
    from += 1000
  }

  console.log(`\nBabygo: ${bgPages.length}, Others: ${otherPages.length}`)

  // Build spatial index for others (simple grid)
  const grid = new Map<string, typeof otherPages>()
  for (const o of otherPages) {
    const key = `${Math.floor(o.lat * 100)}_${Math.floor(o.lng * 100)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(o)
  }

  let dupCount = 0
  const dupExamples: string[] = []
  for (const b of bgPages) {
    const bKey = `${Math.floor(b.lat * 100)}_${Math.floor(b.lng * 100)}`
    // Check surrounding cells
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
          dupCount++
          if (dupExamples.length < 30) {
            dupExamples.push(`  sim=${sim.toFixed(2)} | babygo[${b.id}] "${b.name}" ↔ [${o.id}] "${o.name}"`)
          }
        }
      }
    }
  }
  console.log(`\n=== Cross-source duplicates (100m + sim>=0.6): ${dupCount} ===`)
  for (const d of dupExamples) console.log(d)
}
main().catch(console.error)
