/**
 * Round 5-6: Manual review cleanup based on direct URL inspection.
 * Remove posters identified as incorrect through domain/URL analysis.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

// IDs to remove based on manual URL inspection
const REMOVE_IDS = [
  8529, // YouTube thumbnail (img.youtube.com)
  8534, // ruliweb.com gaming community (2022)
  8536, // dealbada.com deal/shopping
  8539, // 10x10.co.kr shopping mall
  8541, // gukjenews 2019 old photo
  8545, // gettyimagesbank stock photo
  8559, // reportworld.co.kr document site
  8560, // changwon library (different city)
  8561, // imgnews 2009 very old
  8563, // kyobobook book cover
  8569, // lovepik stock template
  8572, // naver place random photo
  8573, // ksponco.or.kr sports promotion (unrelated)
  8576, // idus.com handmade marketplace
  8577, // extmovie.com movie community
  8585, // yt3.ggpht.com YouTube thumbnail
  8591, // ruliweb.com gaming community (2022)
  8594, // jinju.go.kr wrong region
  8596, // imgnews 2009 very old
  8598, // thesegye.com generic news
  8613, // youthnavi.net 2016 old
  8616, // taean.go.kr wrong region
  8621, // getyourguide.com travel booking
  8632, // inven.co.kr gaming community
  8635, // mania.kr community
  8636, // cu.ac.kr university unrelated
  8638, // brunch heic blog thumbnail
  8649, // ibric.org biology research center
  8661, // istockphoto.com stock vector
  8662, // data.ad.co.kr ad image
  8665, // theqoo.net entertainment community
  8673, // sema.seoul.go.kr 2019 different exhibition
  8679, // behance.net design portfolio
  8680, // daumcdn news 2023 old
  8681, // ctnews.kr 2023 old
  8682, // asiae.co.kr 2020 old
  8683, // naver blog personal photo
  8685, // dmitory.com community
  8690, // asiatoday 2015 very old
  8696, // chulsa.kr community photo
]

async function main() {
  console.log(`Removing ${REMOVE_IDS.length} incorrect posters...\n`)

  // Verify these events exist and have posters
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

  // Final stats
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
