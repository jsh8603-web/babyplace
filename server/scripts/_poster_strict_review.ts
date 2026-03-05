/**
 * Round 3: Strict LLM review of remaining posters.
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_poster_strict_review.ts
 */
import { supabaseAdmin } from '../lib/supabase-admin'
import { extractWithGemini } from '../lib/gemini'

async function main() {
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
    .not('poster_url', 'is', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])

  if (!data || data.length === 0) {
    console.log('No remaining posters')
    return
  }
  console.log('Remaining for strict review:', data.length)

  const items = data.map((ev, i) => {
    let domain = ''
    let path = ''
    try {
      const u = new URL(ev.poster_url!)
      domain = u.hostname
      path = u.pathname.slice(0, 80)
    } catch {
      domain = ev.poster_url!.slice(0, 40)
    }
    return { n: i + 1, event: ev.name, venue: ev.venue_name || '', domain, path }
  })

  const prompt = `이벤트별 포스터 URL 도메인+경로로 공식 포스터인지 최종 엄격 판단.

판단 기준:
- "keep": 이벤트 주최사/공연장/전시관/예매플랫폼 공식 도메인이며 해당 이벤트 홍보물로 확신
- "remove": 아래 하나라도 해당 시 제거
  (a) 네이버 쇼핑 CDN shop1.phinf/shop-phinf — 상품사진 가능성
  (b) 뉴스 본문의 행사현장 사진 — 공식 포스터 아님
  (c) 이벤트명과 URL 도메인 간 연관 없음
  (d) 커뮤니티/블로그/개인 사이트
  (e) 범용 이미지CDN leisureq/cbimg/wadiz/thesegye/sedaily — 확인 불가
- 확신 없으면 "remove" (빈 포스터 > 무관 이미지)
- 공식기관 도메인 kopis.or.kr/sac.or.kr/sejongpac.or.kr/culture.seoul.go.kr/incheon.go.kr/gwanak.go.kr → "keep"

${JSON.stringify(items, null, 0)}

JSON만: [{"n":1,"v":"keep"|"remove","r":"한줄이유"}, ...]`

  const text = await extractWithGemini(prompt)
  const parsed = JSON.parse(text) as { n: number; v: string; r: string }[]

  const toRemove: number[] = []
  for (const r of parsed) {
    const ev = data[r.n - 1]
    if (!ev) continue
    if (r.v === 'remove') {
      toRemove.push(ev.id)
      console.log(`REMOVE [${ev.id}] ${ev.name} — ${r.r}`)
    } else {
      console.log(`KEEP   [${ev.id}] ${ev.name}`)
    }
  }

  if (toRemove.length > 0) {
    const { error } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', toRemove)
    console.log(`\nCleared ${toRemove.length}:`, error ? error.message : 'OK')
  }

  console.log(`\nFinal: ${data.length - toRemove.length} posters remaining`)
}

main().catch(console.error)
