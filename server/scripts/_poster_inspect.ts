/**
 * Inspect poster URLs for manual review.
 * Shows event name + poster URL for direct visual inspection.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  // Get all events with poster (blog_discovery + exhibition_extraction only)
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
    .not('poster_url', 'is', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])
    .order('id')

  if (!data) return

  console.log(`Total events with poster: ${data.length}\n`)

  for (const ev of data) {
    let domain = ''
    try {
      domain = new URL(ev.poster_url!).hostname
    } catch {
      domain = 'invalid'
    }
    console.log(`[${ev.id}] ${ev.name}`)
    console.log(`  venue: ${ev.venue_name || 'N/A'}`)
    console.log(`  domain: ${domain}`)
    console.log(`  url: ${ev.poster_url}`)
    console.log()
  }

  // Also show events without poster
  const { data: noPoster } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, source')
    .is('poster_url', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])
    .order('id')

  console.log(`\n--- Events WITHOUT poster (${noPoster?.length || 0}) ---`)
  for (const ev of noPoster || []) {
    console.log(`  [${ev.id}] ${ev.name} | ${ev.venue_name || 'N/A'}`)
  }
}

main().catch(console.error)
