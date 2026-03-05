/**
 * Round 9: Manual cleanup based on URL domain/path inspection.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

// IDs to remove with reasons
const REMOVE_IDS = [
  8537, // ldb-phinf.pstatic.net — Naver place random photo (already blocked domain)
  8539, // img.freepik.com — stock template
  8540, // pds.saramin.co.kr — job site logo
  8541, // gukjenews.com/2019 — 2019 old news photo
  8544, // ai.esmplus.com — esmplus shopping
  8556, // wikitree.co.kr/2024 — 2024 old
  8559, // traveli.co.kr — old travel photo
  8560, // lib.changwon.go.kr — 창원 (wrong city)
  8561, // imgnews.naver.net/2009 — 2009 very old
  8563, // fimg6.pann.com — pann community
  8568, // momq.co.kr — mom community product
  8569, // img.freepik.com — stock template
  8573, // scontent Instagram CDN
  8576, // e-redpoint.com — product page
  8577, // extmovie.maxmovie.com — movie community
  8581, // item.ssgcdn.com — SSG shopping mall
  8585, // is1-ssl.mzstatic.com — Apple Music
  8587, // overseas.mofa.go.kr — 외교부 unrelated
  8589, // extmovie.maxmovie.com — movie community
  8590, // yeonggwang.go.kr — 영광군 (wrong region)
  8594, // jinju.go.kr — 진주 (wrong region)
  8596, // gjartcenter.kr — 광주 (wrong city), different show
  8598, // jje.go.kr — 제주 (wrong region)
  8608, // kns.tv/2012 — 2012 old news
  8613, // youthnavi.net/2016 — 2016 old
  8614, // shopping.phinf.naver.net — Naver shopping
  8615, // bodonews.com — generic news
  8616, // taean.go.kr — 태안 (wrong region)
  8624, // edgio.clien.net — Clien community
  8629, // kr.news.cn/2023 — 2023 old news
  8632, // scontent Instagram CDN
  8635, // bonghwa.go.kr — 봉화 (wrong region)
  8636, // cu.ac.kr — 대구 대학 (wrong region)
  8649, // gukjenews.com/2017 — 2017 old
  8660, // theteams.kr — job ad
  8661, // d2v80xjmx68n4w.cloudfront.net — portfolio image
  8662, // t1.daumcdn.net/tvpot — old TV thumbnail
  8663, // naju.go.kr — 나주 (wrong region)
  8665, // png.pngtree.com — stock template
  8668, // is1-ssl.mzstatic.com — Apple Music
  8673, // sema.seoul.go.kr/2019 — 2019 different exhibition
  8680, // t1.daumcdn.net/news/2023 — 2023 old
  8681, // ctnews.kr/2023 — 2023 old
  8682, // woorinews.co.kr/2023 — 2023 old
  8685, // img.theqoo.net — theqoo community
  8688, // lh7-rt.googleusercontent.com — Google Docs image
  8689, // pds.joins.com/2019 — 2019 old
  8694, // ezday.co.kr/2009 — 2009 very old
  8696, // daumcdn.net/kakaotv — 2020 old kakaotv
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
    console.log(`\n=== After R9 Cleanup ===`)
    console.log(`Total: ${all.length}, With poster: ${withPoster.length} (${Math.round(withPoster.length/all.length*100)}%)`)
    for (const [src, stats] of bySource) {
      console.log(`  ${src}: ${stats.with}/${stats.total} (${Math.round(stats.with/stats.total*100)}%)`)
    }
  }
}

main().catch(console.error)
