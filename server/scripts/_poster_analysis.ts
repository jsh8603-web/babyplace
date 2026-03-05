import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  // Overall stats
  const { data: all } = await supabaseAdmin
    .from('events')
    .select('id, name, source, poster_url, venue_name')

  if (!all) return

  const withPoster = all.filter(e => e.poster_url)
  const withoutPoster = all.filter(e => !e.poster_url)

  console.log(`Total events: ${all.length}`)
  console.log(`With poster: ${withPoster.length}`)
  console.log(`Without poster: ${withoutPoster.length}`)

  // By source
  const sources = new Map<string, { total: number; withPoster: number }>()
  for (const e of all) {
    const s = sources.get(e.source) || { total: 0, withPoster: 0 }
    s.total++
    if (e.poster_url) s.withPoster++
    sources.set(e.source, s)
  }
  console.log('\nBy source:')
  for (const [src, stats] of sources) {
    console.log(`  ${src}: ${stats.withPoster}/${stats.total} (${Math.round(stats.withPoster/stats.total*100)}%)`)
  }

  // Events without poster - list them
  console.log(`\n--- Events WITHOUT poster (${withoutPoster.length}) ---`)
  for (const e of withoutPoster) {
    console.log(`  [${e.source}] ${e.name} | venue: ${e.venue_name || 'N/A'}`)
  }
}

main().catch(console.error)
