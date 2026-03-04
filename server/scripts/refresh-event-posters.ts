/**
 * One-time script: fetch poster images for events missing poster_url
 * Uses Naver Image Search API (same logic as blog-event-discovery enrichEvents)
 *
 * Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/refresh-event-posters.ts
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { fetchNaverSearch } from '../collectors/naver-blog'

const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'

interface NaverImageItem {
  title: string
  link: string
  thumbnail: string
  sizeheight: string
  sizewidth: string
}

async function main() {
  // Fetch events missing poster
  const { data: events, error } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name')
    .is('poster_url', null)
    .order('id', { ascending: true })

  if (error || !events) {
    console.error('Failed to fetch events:', error)
    return
  }

  console.log(`[poster-refresh] ${events.length} events without poster`)

  let updated = 0
  let failed = 0

  for (const event of events) {
    try {
      const imgQuery = encodeURIComponent(`${event.name} 공식 포스터`)
      const imgUrl = `${NAVER_IMAGE_URL}?query=${imgQuery}&display=10&sort=sim`
      const imgResults = await fetchNaverSearch<NaverImageItem>(imgUrl)

      const bestPoster = (imgResults || [])
        .filter((img) => {
          const w = parseInt(img.sizewidth) || 0
          const h = parseInt(img.sizeheight) || 0
          return w >= 300 && h >= 300
        })
        .sort((a, b) => {
          const ratioA = (parseInt(a.sizeheight) || 0) / (parseInt(a.sizewidth) || 1)
          const ratioB = (parseInt(b.sizeheight) || 0) / (parseInt(b.sizewidth) || 1)
          return ratioB - ratioA
        })[0]

      if (bestPoster?.link) {
        const { error: updateErr } = await supabaseAdmin
          .from('events')
          .update({ poster_url: bestPoster.link })
          .eq('id', event.id)

        if (updateErr) {
          console.error(`  [${event.id}] Update error:`, updateErr.message)
          failed++
        } else {
          updated++
          console.log(`  [${event.id}] ${event.name} → poster found`)
        }
      } else {
        console.log(`  [${event.id}] ${event.name} → no poster found`)
        failed++
      }

      // Rate limit: 200ms between requests
      await new Promise((r) => setTimeout(r, 200))
    } catch (err) {
      console.error(`  [${event.id}] Error:`, err)
      failed++
    }
  }

  console.log(`\n[poster-refresh] Done: ${updated} updated, ${failed} no poster found`)
}

main()
