/**
 * Poster improvement iteration script.
 * Tests selectBestPoster against events without posters to identify improvement areas.
 */
import { supabaseAdmin } from '../lib/supabase-admin'

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID!
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!
const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'

interface NaverImageItem {
  title: string
  link: string
  thumbnail: string
  sizeheight: string
  sizewidth: string
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim()
}

async function fetchNaverImages(query: string, display = 10): Promise<NaverImageItem[]> {
  const url = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
  })
  if (!res.ok) return []
  const data = await res.json() as { items: NaverImageItem[] }
  return data.items || []
}

// Current selectBestPoster logic
const POSTER_BLOCKED_DOMAINS = [
  'i.pinimg.com', 'pinimg.com', 'dcimg', 'dcinside.com',
  'instiz.net', 'postfiles.pstatic.net', 'yt3.googleusercontent.com',
  'aladin.co.kr', 'woodo.kr', 'muscache.com', 'coupangcdn.com',
  'fimg5.pann.com', 'momsdiary.co.kr', 'khidi.or.kr', 'anewsa.com',
]

const POSTER_TRUSTED_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr',
  'sejongpac.or.kr', 'og-data.s3.amazonaws.com',
  'gwanak.go.kr', 'incheon.go.kr',
]

function selectBestPosterV1(images: NaverImageItem[], eventName: string): { url: string | null; score: number; debug: string } {
  const normalizedEvent = eventName.replace(/[[\]<>()「」『』]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const eventTokens = normalizedEvent.split(/[\s,.:;·]+/).filter((t) => t.length >= 2)

  const candidates = images
    .filter((img) => {
      const url = img.link.toLowerCase()
      if (POSTER_BLOCKED_DOMAINS.some((d) => url.includes(d))) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 300 || h < 300) return false
      return true
    })
    .map((img) => {
      const title = stripHtml(img.title).toLowerCase()
      const w = parseInt(img.sizewidth) || 1
      const h = parseInt(img.sizeheight) || 1
      const aspectRatio = h / w
      let score = 0

      const matchedTokens = eventTokens.filter((t) => title.includes(t))
      const titleRelevance = eventTokens.length > 0 ? matchedTokens.length / eventTokens.length : 0
      score += titleRelevance * 50

      if (POSTER_TRUSTED_DOMAINS.some((d) => img.link.includes(d))) score += 20
      if (aspectRatio >= 0.8 && aspectRatio <= 2.5) score += 10
      if (aspectRatio >= 1.2 && aspectRatio <= 1.8) score += 5
      if (img.link.includes('imgnews.naver.net')) score += 5
      if (/공식|포스터|메인|키비주얼|대표/.test(title)) score += 10
      if (/현장|후기|방문|리뷰|체험기|블로그|스냅|사진|찍/.test(title)) score -= 20

      return { img, score, titleRelevance, title, matchedTokens }
    })
    .filter((c) => c.titleRelevance >= 0.3 || c.score >= 20)
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (best && best.score >= 15) {
    return { url: best.img.link, score: best.score, debug: `matched: [${best.matchedTokens.join(',')}] title: ${best.title.slice(0,60)}` }
  }

  // Debug: show what was available
  const allScored = images
    .filter((img) => {
      const url = img.link.toLowerCase()
      if (POSTER_BLOCKED_DOMAINS.some((d) => url.includes(d))) return false
      return true
    })
    .map((img) => {
      const title = stripHtml(img.title).toLowerCase()
      const matchedTokens = eventTokens.filter((t) => title.includes(t))
      const titleRelevance = eventTokens.length > 0 ? matchedTokens.length / eventTokens.length : 0
      return { title: title.slice(0, 50), rel: titleRelevance.toFixed(2), matched: matchedTokens }
    })
    .slice(0, 3)

  return { url: null, score: 0, debug: `no match. top3: ${JSON.stringify(allScored)}` }
}

async function main() {
  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, name, source, venue_name')
    .is('poster_url', null)
    .in('source', ['blog_discovery', 'exhibition_extraction'])
    .limit(30)

  if (!events || events.length === 0) {
    console.log('No events without poster')
    return
  }

  console.log(`Testing ${events.length} events without poster:\n`)

  // Test different query strategies
  const strategies = [
    { name: 'current: "{event} 공식 포스터"', fn: (e: string, v: string) => `${e} 공식 포스터` },
    { name: 'v2: "{event} 포스터"', fn: (e: string, v: string) => `${e} 포스터` },
    { name: 'v3: "{event}"', fn: (e: string, v: string) => e },
    { name: 'v4: "{event} {venue}"', fn: (e: string, v: string) => `${e} ${v}` },
  ]

  let results: Record<string, number> = {}
  for (const s of strategies) results[s.name] = 0

  for (const ev of events.slice(0, 15)) {
    console.log(`\n[${ev.id}] ${ev.name} (${ev.venue_name})`)

    for (const strategy of strategies) {
      const query = strategy.fn(ev.name, ev.venue_name || '')
      const images = await fetchNaverImages(query, 20)
      const result = selectBestPosterV1(images, ev.name)

      if (result.url) {
        results[strategy.name]++
        console.log(`  ✅ ${strategy.name}: score=${result.score} ${result.debug}`)
      } else {
        console.log(`  ❌ ${strategy.name}: ${result.debug.slice(0, 100)}`)
      }

      await new Promise((r) => setTimeout(r, 200))
    }
  }

  console.log('\n\n=== Summary ===')
  for (const [name, count] of Object.entries(results)) {
    console.log(`  ${name}: ${count}/15 (${Math.round(count/15*100)}%)`)
  }
}

main().catch(console.error)
