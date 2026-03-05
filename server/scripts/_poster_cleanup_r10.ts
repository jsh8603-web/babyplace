/**
 * Round 10: Final cleanup of problematic posters.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

const REMOVE_IDS = [
  8537, // image.msscdn.net — 무신사 fashion shopping
  8544, // cng.go.kr — 창녕 (wrong region)
  8559, // autoherald.co.kr/2019 — old car news
  8560, // jj.ac.kr — 전주대 (wrong region)
  8561, // imgnews/2009 — 2009 very old
  8569, // marketplace.canva.com — stock template
  8577, // img-store.theqoo.net — community
  8589, // imgfiles.plaync.com — gaming site
  8590, // uiryeong.go.kr — 의령 (wrong region)
  8594, // partybungbung.com — party shopping
  8596, // imgnews/2009 — 2009 very old
  8598, // dbscthumb-phinf.pstatic.net — old Naver
  8614, // inaturalist — nature photo unrelated
  8624, // gettyimageskorea.com — stock photo
  8632, // artsy cloudfront — art portfolio
  8649, // cdn.imweb.me — generic website
  8660, // daumcdn/cafeattach — cafe attachment
  8661, // socialfocus/2019 — 2019 old
  8662, // daumcdn/tvpot — old TV thumbnail
  8668, // sndcdn.com — SoundCloud
  8673, // sema.seoul.go.kr/2019 — 2019 different exhibition
  8680, // daumcdn/news/2023 — 2023 old
  8682, // genie.co.kr — music service
  8689, // kinolights.com — movie review
  8694, // daumcdn/kakaotv — old kakaotv
  8696, // daumcdn/kakaotv — old kakaotv
]

async function main() {
  console.log(`Removing ${REMOVE_IDS.length} incorrect posters...\n`)

  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, name, poster_url')
    .in('id', REMOVE_IDS)
    .not('poster_url', 'is', null)

  console.log(`Found ${events?.length || 0} events with posters to clear`)

  if (events && events.length > 0) {
    const { error } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', REMOVE_IDS)

    console.log(`Cleared: ${error ? error.message : events.length}`)
  }

  const { data: all } = await supabaseAdmin
    .from('events')
    .select('id, poster_url, source')

  if (all) {
    const withPoster = all.filter(e => e.poster_url)
    const bySource = new Map<string, { total: number; with: number }>()
    for (const e of all) {
      const s = bySource.get(e.source) || { total: 0, with: 0 }
      s.total++
      if (e.poster_url) s.with++
      bySource.set(e.source, s)
    }
    console.log(`\n=== Final Stats ===`)
    console.log(`Total: ${all.length}, With poster: ${withPoster.length} (${Math.round(withPoster.length/all.length*100)}%)`)
    for (const [src, stats] of bySource) {
      console.log(`  ${src}: ${stats.with}/${stats.total} (${Math.round(stats.with/stats.total*100)}%)`)
    }
  }
}

main().catch(console.error)
