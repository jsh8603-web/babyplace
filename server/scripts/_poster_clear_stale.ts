/**
 * R9: Clear poster URLs containing years before current year.
 * Then re-run backfill to find 2026+ posters.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

function hasStaleYear(url: string): boolean {
  const currentYear = new Date().getFullYear()
  const yearMatches = url.match(/\/(20[12]\d)\//g)
  if (!yearMatches) return false
  return yearMatches.some(m => {
    const year = parseInt(m.replace(/\//g, ''))
    return year < currentYear
  })
}

async function main() {
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, name, poster_url, source')
    .not('poster_url', 'is', null)
    .order('id')

  if (!data) return

  const stale = data.filter(e => hasStaleYear(e.poster_url!))
  console.log(`Posters with stale year in URL: ${stale.length}`)

  if (stale.length > 0) {
    const ids = stale.map(e => e.id)
    const { error } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', ids)

    console.log(`Cleared: ${error ? error.message : ids.length}`)
    for (const e of stale) {
      console.log(`  [${e.id}] ${e.name}`)
    }
  }

  // Final stats
  const { data: all } = await supabaseAdmin
    .from('events')
    .select('id, poster_url, source')

  if (all) {
    const withPoster = all.filter(e => e.poster_url)
    console.log(`\nAfter cleanup: ${withPoster.length}/${all.length} with poster (${Math.round(withPoster.length/all.length*100)}%)`)
  }
}

main().catch(console.error)
