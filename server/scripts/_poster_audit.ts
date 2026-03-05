/**
 * Poster relevance audit — check and clean irrelevant event posters.
 *
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_poster_audit.ts
 *
 * Phases:
 *   1. Domain blocklist filter (immediate clear)
 *   2. LLM-based relevance validation (Gemini Flash)
 */
import { supabaseAdmin } from '../lib/supabase-admin'
import { extractWithGemini } from '../lib/gemini'
import { stripHtml } from '../collectors/naver-blog'

// Domain blocklist: sources that almost never provide official event posters
const BLOCKED_DOMAINS = [
  'i.pinimg.com', 'pinimg.com',
  'dcimg', 'dcinside.com', 'dcinside.co.kr',
  'instiz.net',
  'postfiles.pstatic.net',
  'yt3.googleusercontent.com',
  'aladin.co.kr',
  'woodo.kr',
  'muscache.com',
  'coupangcdn.com',
  'fimg5.pann.com', 'pann.com',
  'momsdiary.co.kr',
  'khidi.or.kr',
  'anewsa.com',
]

// Trusted poster sources (skip LLM validation)
const TRUSTED_DOMAINS = [
  'culture.seoul.go.kr',
  'kopis.or.kr',
  'sac.or.kr',
  'sejongpac.or.kr',
]

async function main() {
  const mode = process.argv[2] || 'audit' // 'audit' | 'fix'
  const isDryRun = mode === 'audit'

  console.log(`\n=== Poster Audit (mode: ${mode}) ===\n`)

  // Fetch all events with poster_url
  const { data: events, error } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
    .not('poster_url', 'is', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])

  if (error || !events) {
    console.error('Query error:', error)
    return
  }

  console.log(`Total events with poster: ${events.length}`)

  // Phase 1: Domain blocklist
  const blocked: typeof events = []
  const trusted: typeof events = []
  const needsLLM: typeof events = []

  for (const ev of events) {
    const url = ev.poster_url!.toLowerCase()

    if (BLOCKED_DOMAINS.some((d) => url.includes(d))) {
      blocked.push(ev)
    } else if (TRUSTED_DOMAINS.some((d) => url.includes(d))) {
      trusted.push(ev)
    } else {
      needsLLM.push(ev)
    }
  }

  console.log(`\nPhase 1 — Domain filter:`)
  console.log(`  Blocked (will clear): ${blocked.length}`)
  console.log(`  Trusted (keep): ${trusted.length}`)
  console.log(`  Needs LLM review: ${needsLLM.length}`)

  // Show blocked
  console.log(`\n--- Blocked posters ---`)
  for (const ev of blocked) {
    console.log(`  [${ev.id}] ${ev.name} → ${ev.poster_url?.slice(0, 80)}`)
  }

  // Phase 2: LLM validation for remaining
  if (needsLLM.length > 0 && !isDryRun) {
    console.log(`\n--- LLM validation ---`)
    await llmValidatePosters(needsLLM)
  }

  // Apply fixes
  if (!isDryRun && blocked.length > 0) {
    const ids = blocked.map((e) => e.id)
    const { error: updateErr } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', ids)
    console.log(`\nCleared ${ids.length} blocked posters:`, updateErr ? updateErr.message : 'OK')
  }

  console.log('\nDone!')
}

async function llmValidatePosters(events: { id: number; name: string; venue_name: string | null; poster_url: string | null }[]): Promise<void> {
  const BATCH = 20
  const toClear: number[] = []

  for (let i = 0; i < events.length; i += BATCH) {
    const batch = events.slice(i, i + BATCH)

    const items = batch.map((ev, idx) => ({
      n: idx + 1,
      event: ev.name,
      venue: ev.venue_name || '',
      poster_url: ev.poster_url || '',
    }))

    const prompt = `이벤트별 포스터 URL이 해당 이벤트의 공식 포스터/홍보 이미지인지 판단하세요.

판단 기준 (엄격):
- "relevant": URL의 도메인/경로가 해당 이벤트의 공식 포스터, 공식 홍보물, 또는 공식 보도자료 이미지로 추정됨
- "irrelevant": 행사 현장 사진, 개인 블로그 사진, 무관한 뉴스 이미지, 상품 사진, 팬 커뮤니티 이미지, 2년 이상 된 뉴스 이미지
- URL 경로에 이벤트명과 무관한 키워드만 있으면 "irrelevant"
- 확신이 없으면 "irrelevant" (정합성이 낮은 것보다 비워두는 것이 좋음)

${JSON.stringify(items, null, 0)}

JSON 배열만 응답: [{"n":1,"verdict":"relevant"|"irrelevant","reason":"한줄이유"}, ...]`

    try {
      const text = await extractWithGemini(prompt)
      const parsed = JSON.parse(text) as { n: number; verdict: string; reason: string }[]

      for (const r of parsed) {
        const ev = batch[r.n - 1]
        if (!ev) continue
        if (r.verdict === 'irrelevant') {
          toClear.push(ev.id)
          console.log(`  IRRELEVANT [${ev.id}] ${ev.name} — ${r.reason}`)
        } else {
          console.log(`  OK [${ev.id}] ${ev.name}`)
        }
      }
    } catch (err) {
      console.error('LLM batch error:', err)
    }

    await new Promise((r) => setTimeout(r, 2000))
  }

  if (toClear.length > 0) {
    const { error } = await supabaseAdmin
      .from('events')
      .update({ poster_url: null })
      .in('id', toClear)
    console.log(`\nLLM cleared ${toClear.length} irrelevant posters:`, error ? error.message : 'OK')
  }
}

main().catch(console.error)
