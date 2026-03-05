/**
 * Round 3: LLM verification of newly backfilled posters.
 * Check if poster URL domain/path matches the event.
 */
import { supabaseAdmin } from '../lib/supabase-admin'
import { extractWithGemini } from '../lib/gemini'

async function main() {
  // Get all events with poster (excluding seoul_events which are official)
  const { data } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
    .not('poster_url', 'is', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])
    .order('id')

  if (!data || data.length === 0) {
    console.log('No events to verify')
    return
  }
  console.log(`Verifying ${data.length} posters...\n`)

  // Batch LLM verification
  const BATCH = 25
  const toRemove: number[] = []
  const kept: number[] = []

  for (let i = 0; i < data.length; i += BATCH) {
    const batch = data.slice(i, i + BATCH)

    const items = batch.map((ev, idx) => {
      let domain = ''
      let path = ''
      try {
        const u = new URL(ev.poster_url!)
        domain = u.hostname
        path = u.pathname.slice(0, 100)
      } catch {
        domain = ev.poster_url!.slice(0, 60)
      }
      return {
        n: idx + 1,
        event: ev.name,
        venue: ev.venue_name || '',
        domain,
        path: path.slice(0, 80),
      }
    })

    const prompt = `이벤트별 포스터 URL(도메인+경로)이 해당 이벤트의 공식 포스터/홍보물인지 엄격하게 판단.

판단 기준:
- "keep": 이벤트와 직접 관련된 이미지로 확신 (공식 포스터, 공연/전시 홍보물, 뉴스 보도 이미지)
- "remove": 아래 하나라도 해당 시 제거
  (a) 이벤트명과 URL 경로/도메인 간 연관 없음 (다른 이벤트 포스터일 가능성)
  (b) 현장사진/후기/블로그 개인사진
  (c) 범용 상품/쇼핑 이미지
  (d) 전혀 다른 이벤트나 연도의 포스터
  (e) 이벤트와 연관 없는 뉴스 기사 삽화
- 이벤트명의 핵심 키워드가 URL 경로에 포함되어 있으면 "keep" 가능성 높음
- 확신 없으면 "remove"

${JSON.stringify(items, null, 0)}

JSON만: [{"n":1,"v":"keep"|"remove","r":"한줄이유"}, ...]`

    try {
      const text = await extractWithGemini(prompt)
      const parsed = JSON.parse(text) as { n: number; v: string; r: string }[]

      for (const r of parsed) {
        const ev = batch[r.n - 1]
        if (!ev) continue
        if (r.v === 'remove') {
          toRemove.push(ev.id)
          console.log(`❌ REMOVE [${ev.id}] ${ev.name} — ${r.r}`)
        } else {
          kept.push(ev.id)
          console.log(`✅ KEEP   [${ev.id}] ${ev.name}`)
        }
      }
    } catch (err) {
      console.error('LLM batch error:', err)
    }

    await new Promise((r) => setTimeout(r, 2000))
  }

  console.log(`\n=== Verification Result ===`)
  console.log(`Keep: ${kept.length}`)
  console.log(`Remove: ${toRemove.length}`)
  console.log(`Accuracy: ${Math.round(kept.length / data.length * 100)}%`)

  if (toRemove.length > 0) {
    const { error } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', toRemove)
    console.log(`\nCleared ${toRemove.length} posters:`, error ? error.message : 'OK')
  }
}

main().catch(console.error)
