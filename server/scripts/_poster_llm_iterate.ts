/**
 * Poster LLM Iteration Script — Phase 2: Multi-source image sourcing
 *
 * Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_poster_llm_iterate.ts [--round N] [--limit N] [--apply]
 *
 * Image sourcing pipeline:
 *   1. source_url og:image (if event has source_url)
 *   2. Naver Image Search (3-step fallback)
 *   3. Naver Web Search → find official page → og:image
 * Then: pre-filter → Gemini LLM selection
 */
import { createClient } from '@supabase/supabase-js'
import { extractWithGemini } from '../lib/gemini'
import * as fs from 'fs'

// ─── Setup ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID!
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!
const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'
const NAVER_WEB_URL = 'https://openapi.naver.com/v1/search/webkr'

interface ImageCandidate {
  title: string
  link: string
  width: number
  height: number
  source: 'og:image' | 'naver_image' | 'web_og:image'
}

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

// ─── Image Fetchers ─────────────────────────────────────────────────────────

async function fetchNaverImages(query: string, display = 20): Promise<NaverImageItem[]> {
  const url = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`
  try {
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    })
    if (!res.ok) return []
    const json = await res.json() as { items?: NaverImageItem[] }
    return json.items || []
  } catch {
    return []
  }
}

async function fetchNaverWebSearch(query: string, display = 5): Promise<{ title: string; link: string }[]> {
  const url = `${NAVER_WEB_URL}?query=${encodeURIComponent(query)}&display=${display}`
  try {
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
    })
    if (!res.ok) return []
    const json = await res.json() as { items?: { title: string; link: string }[] }
    return json.items || []
  } catch {
    return []
  }
}

/**
 * Fetch og:image from a URL using simple regex (no heavy HTML parser needed)
 */
async function fetchOgImage(pageUrl: string): Promise<{ url: string; title: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyPlacePosterBot/1.0)' },
      signal: controller.signal,
      redirect: 'follow',
    })
    clearTimeout(timeout)
    if (!res.ok) return null

    const html = await res.text()
    // Extract og:image
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)
    if (!ogMatch) return null

    let imgUrl = ogMatch[1]
    // Make absolute URL
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl
    else if (imgUrl.startsWith('/')) {
      const base = new URL(pageUrl)
      imgUrl = base.origin + imgUrl
    }

    // R8: Block site-wide default og:images (logos, placeholders, banners)
    const OG_IMAGE_BLOCKLIST = [
      'culturePotalImg',        // culture.seoul.go.kr default
      'mainUX/main.png',        // kopis.or.kr logo
      'og_noImage',             // interpark placeholder
      'kakaobanner',            // clipservice kakao banner
      'default_og',             // generic defaults
      'logo', 'Logo',           // logos
      'favicon',                // favicons
      '/common/img/',           // common assets
      'share_img', 'shareImg',  // generic share images
      'back_img',               // background images
      '/images/common/',        // common site assets
      'ticketlink_rebranding',  // ticketlink placeholder
      'defaultMobileBanner',    // nanta default banner
      'defaultBanner',          // generic default banners
      'tketlink.dn.toastoven.net/static', // ticketlink CDN statics
    ]
    if (OG_IMAGE_BLOCKLIST.some(p => imgUrl.includes(p))) return null

    // Extract og:title for context
    const titleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
      || html.match(/<title>([^<]+)<\/title>/i)
    const title = titleMatch ? stripHtml(titleMatch[1]) : ''

    return { url: imgUrl, title }
  } catch {
    return null
  }
}

// ─── Blocked/Trusted Domains ────────────────────────────────────────────────

const POSTER_BLOCKED_DOMAINS = [
  'i.pinimg.com', 'pinimg.com', 'dcimg', 'dcinside.com',
  'instiz.net', 'postfiles.pstatic.net', 'yt3.googleusercontent.com',
  'aladin.co.kr', 'woodo.kr', 'muscache.com', 'coupangcdn.com',
  'fimg5.pann.com', 'momsdiary.co.kr', 'khidi.or.kr', 'anewsa.com',
  'i.ytimg.com', 'img.youtube.com', 'yt3.ggpht.com',
  'clipartkorea.co.kr', 'mangoboard.net', 'miricanvas.com',
  'img.freepik.com', 'png.pngtree.com', 'marketplace.canva.com',
  'preview.gettyimagesbank.com', 'media.istockphoto.com', 'img.lovepik.com',
  'thumb2.gettyimageskorea.com',
  'shop-phinf.pstatic.net', 'shop1.phinf.naver.net', 'shopping.phinf.naver.net',
  'item.ssgcdn.com', 'ai.esmplus.com', 'image.msscdn.net',
  'cdn.dealbada.com', 'thumbnail.10x10.co.kr', 'image.idus.com',
  'partybungbung.com',
  'i1.ruliweb.com', 'i2.ruliweb.com', 'ruliweb.com',
  'upload3.inven.co.kr', 'cdn.mania.kr', 'img.extmovie.com',
  'img-cdn.theqoo.net', 'img.theqoo.net', 'img-store.theqoo.net',
  'img.dmitory.com', 'fimg6.pann.com', 'edgio.clien.net',
  'cdnweb01.wikitree.co.kr', 'imgssl.ezday.co.kr', 'www.momq.co.kr',
  'dprime.kr', 'chulsa.kr', 'imgfiles.plaync.com',
  'is1-ssl.mzstatic.com', 'i1.sndcdn.com', 'image.genie.co.kr',
  'file.kinolights.com',
  'cphoto.asiae.co.kr', 'img.asiatoday.co.kr', 'pds.joins.com',
  'cdn.socialfocus.co.kr', 'cdn.autoherald.co.kr',
  'www.gukjenews.com', 'www.kns.tv', 'www.ctnews.kr',
  'www.woorinews.co.kr', 'www.bodonews.com', 'thesegye.com', 'kr.news.cn',
  'www.jinju.go.kr', 'jinju.go.kr', 'taean.go.kr', 'lib.changwon.go.kr',
  'www.yeonggwang.go.kr', 'www.bonghwa.go.kr', 'www.naju.go.kr',
  'www.jje.go.kr', 'www.gjartcenter.kr', 'www.cu.ac.kr',
  'www.cng.go.kr', 'www.jj.ac.kr', 'www.uiryeong.go.kr',
  'data.ad.co.kr', 'mir-s3-cdn-cf.behance.net', 'd7hftxdivxxvm.cloudfront.net',
  'www.reportworld.co.kr', 'www.ibric.org', 'bric.postech.ac.kr',
  'www.ksponco.or.kr', 'contents.kyobobook.co.kr', 'cdn.getyourguide.com',
  'cdn.imweb.me', 'www.e-redpoint.com', 'www.theteams.kr',
  'overseas.mofa.go.kr', 'www.traveli.co.kr', 'www.youthnavi.net',
  'pds.saramin.co.kr', 'ldb-phinf.pstatic.net', 'dbscthumb-phinf.pstatic.net',
  'lh7-rt.googleusercontent.com',
  'scontent-nrt1-2.cdninstagram.com', 'scontent-nrt1-1.cdninstagram.com',
  'inaturalist-open-data.s3.amazonaws.com',
  'gall-img.com', '3.gall-img.com',
  'image.slidesharecdn.com', 'cdn.class101.net', 'cdn.crowdpic.net',
  'static.leisureq.io', 'd2ur7st6jjikze.cloudfront.net',
  'ak-d.tripcdn.com', 'media.triple.guide',
  'www.all-con.co.kr', 'cdn.wikiwiki.jp',
  'image.ohou.se', 'image.ohousecdn.com',
  'www.gc.go.kr', 'dimg.donga.com', 'www.kgeu.org',
  'i.namu.wiki', 'www.wevity.com',
  'naverbooking-phinf.pstatic.net', 'www.archives.go.kr',
  'influencer-phinf.pstatic.net', 'www.bucheonphil.or.kr',
  'www.forest.go.kr', 't1.daumcdn.net/cafeattach',
  'search.pstatic.net/common', 'www.idfac.or.kr',
  // R18: kakaotv thumbnails, tumblbug, gokseong
  'kakaotv/kakaoaccount', 'img.tumblbug.com', 'www.gokseong.go.kr',
  // R10: additional stock photo sites
  'st3.depositphotos.com', 'st2.depositphotos.com', 'st.depositphotos.com',
  'previews.123rf.com', 'us.123rf.com',
  'thumbs.dreamstime.com', 'www.shutterstock.com',
  'image.shutterstock.com', 'thumb.ac-illust.com',
]

const POSTER_TRUSTED_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr', 'sejongpac.or.kr',
  'og-data.s3.amazonaws.com', 'gwanak.go.kr', 'incheon.go.kr',
  'ticket.melon.com', 'ticketlink.co.kr', 'interpark.com',
  'yes24.com', 'cjcgv.co.kr', 'megabox.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'museum.seoul.go.kr', 'visitkorea.or.kr', 'mediahub.seoul.go.kr',
]

// ─── Source URL trust domains (og:image from these → high confidence) ───
const OG_TRUSTED_PAGE_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'museum.seoul.go.kr',
  'tickets.interpark.com', 'ticket.yes24.com', 'ticketlink.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'visitkorea.or.kr', 'korean.visitseoul.net', 'mediahub.seoul.go.kr',
  'lottemuseum.com', 'sac.or.kr', 'sejongpac.or.kr',
]

function cleanEventName(name: string): string {
  return name
    .replace(/<[^>]+>/g, ' ')
    .replace(/[「」『』《》<>〈〉]/g, ' ')
    .replace(/[·•:：\-\|\/]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractCoreKeywords(name: string): string {
  const cleaned = cleanEventName(name)
  const tokens = cleaned.split(' ').filter(t =>
    t.length >= 2 &&
    !['체험', '무료', '기념', '특가', '프로그램', '이벤트', '전시', '공연', '축제', '팝업', '뮤지컬'].includes(t)
  )
  return tokens.slice(0, 3).join(' ')
}

function hasStaleYear(url: string): boolean {
  const currentYear = new Date().getFullYear()
  const yearMatches = url.match(/\/(20[0-2]\d)\//g)
  if (!yearMatches) return false
  return yearMatches.some((m) => {
    const year = parseInt(m.replace(/\//g, ''))
    return year < currentYear
  })
}

function isBlocked(url: string): boolean {
  const lower = url.toLowerCase()
  return POSTER_BLOCKED_DOMAINS.some((d) => lower.includes(d))
}

function isTrusted(url: string): boolean {
  return POSTER_TRUSTED_DOMAINS.some((d) => url.includes(d))
}

function isPageTrusted(url: string): boolean {
  return OG_TRUSTED_PAGE_DOMAINS.some((d) => url.includes(d))
}

function preFilter(images: NaverImageItem[]): ImageCandidate[] {
  return images
    .filter((img) => {
      if (isBlocked(img.link)) return false
      if (hasStaleYear(img.link)) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 200 || h < 200) return false
      return true
    })
    .map(img => ({
      title: stripHtml(img.title),
      link: img.link,
      width: parseInt(img.sizewidth) || 0,
      height: parseInt(img.sizeheight) || 0,
      source: 'naver_image' as const,
    }))
}

// ─── Multi-source Image Collection ──────────────────────────────────────────

async function collectImages(
  eventName: string,
  venueName: string,
  sourceUrl: string | null
): Promise<{ candidates: ImageCandidate[]; sources: string[] }> {
  const candidates: ImageCandidate[] = []
  const sources: string[] = []

  // ─── Source 1: og:image from source_url ─────────────────────────────────
  if (sourceUrl && !sourceUrl.includes('blog.naver.com')) {
    const ogResult = await fetchOgImage(sourceUrl)
    if (ogResult && ogResult.url && !isBlocked(ogResult.url) && !hasStaleYear(ogResult.url)) {
      candidates.push({
        title: ogResult.title || `[source_url og:image]`,
        link: ogResult.url,
        width: 0, height: 0,
        source: 'og:image',
      })
      sources.push('source_url_og')
    }
    await new Promise(r => setTimeout(r, 300))
  }

  // ─── Source 2: Naver Image Search (5-step fallback) ─────────────────────
  const cleaned = cleanEventName(eventName)
  const coreKw = extractCoreKeywords(eventName)
  const queries = [
    `${cleaned} 포스터`,
    venueName ? `${cleaned} ${venueName}` : null,
    cleaned,
    coreKw !== cleaned ? coreKw : null,
    // R11: try venue-focused query for niche events
    venueName ? `${venueName} ${coreKw}` : null,
  ].filter(Boolean) as string[]
  const uniqueQueries = [...new Set(queries)]

  // R14: collect from up to 2 successful queries to expand candidate pool
  let naverHits = 0
  for (const q of uniqueQueries) {
    const imgs = await fetchNaverImages(q, 20)
    if (imgs && imgs.length > 0) {
      const filtered = preFilter(imgs)
      if (filtered.length > 0) {
        candidates.push(...filtered)
        sources.push(`naver_img:${q}`)
        naverHits++
        if (naverHits >= 2) break
      }
    }
    await new Promise(r => setTimeout(r, 150))
  }

  // ─── Source 3: Naver Web Search → og:image from official pages ──────────
  // R12: Always try web search, broader query
  const hasTrustedCandidate = candidates.some(c => isTrusted(c.link))
  if (!hasTrustedCandidate) {
    // Try two queries: specific then broad
    const webQueries = [`${cleaned} 포스터`, cleaned]
    let trustedPages: { title: string; link: string }[] = []
    for (const wq of webQueries) {
      const webResults = await fetchNaverWebSearch(wq, 10)
      trustedPages = webResults.filter(r => isPageTrusted(r.link))
      if (trustedPages.length > 0) break
      await new Promise(r => setTimeout(r, 150))
    }

    for (const page of trustedPages.slice(0, 3)) {
      const ogResult = await fetchOgImage(page.link)
      if (ogResult && ogResult.url && !isBlocked(ogResult.url) && !hasStaleYear(ogResult.url)) {
        candidates.push({
          title: ogResult.title || stripHtml(page.title),
          link: ogResult.url,
          width: 0, height: 0,
          source: 'web_og:image',
        })
        sources.push(`web_og:${new URL(page.link).hostname}`)
      }
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = candidates.filter(c => {
    if (seen.has(c.link)) return false
    seen.add(c.link)
    return true
  })

  return { candidates: deduped, sources }
}

// ─── LLM Poster Selection ───────────────────────────────────────────────────

function buildLLMPrompt(
  eventName: string,
  venueName: string,
  candidates: { idx: number; domain: string; title: string; w: number; h: number; trusted: boolean; source: string }[]
): string {
  return `이벤트 "${eventName}"${venueName ? ` (장소: ${venueName})` : ''}의 포스터를 선택하세요.

후보에서 이 이벤트의 **공식 포스터 또는 대표 홍보 이미지**를 1개 선택하세요.

판단 순서:
1. [공식] 표시 후보 → source_url 또는 공식 페이지에서 직접 가져온 이미지. 최우선 선택.
2. [신뢰] 표시 후보 → 예매/문화포털 공식 포스터. 이벤트 키워드 하나라도 매칭되면 선택.
   단, yes24/interpark 상품이 도서·음반 표지인 경우 제외 (공연 포스터만 허용).
3. 이벤트명 핵심 키워드가 제목에 포함된 이미지 (뉴스 보도 허용).
4. 같은 IP/브랜드의 다른 행사 포스터도 허용.
5. 후보 모두 이벤트명과 완전히 무관하면 → 0.

중요: 같은 제목/IP의 공연·전시가 다른 공연장에서도 열리면 허용 (순회공연, 전국투어).
단, 완전히 다른 행사(다른 지역의 유사 테마 행사)는 제외.
예: "뮤지컬 A" 서울공연 포스터 → 부산공연 포스터 OK (같은 작품)
예: "용인 문화공연" 검색 → "목포 문화공연" 이미지 → 제외 (다른 행사)

금지:
- 완전히 다른 IP/작품의 포스터
- 다른 지역의 유사 테마 행사 포스터 (같은 작품 순회공연은 예외)
- 개인 블로그의 방문 후기, 셀카, 스냅 사진
- 상품/책/앨범/도서 표지, 스톡/템플릿

후보:
${candidates.map((c) => {
  const tag = c.source === 'og:image' ? '[공식]' : c.trusted ? '[신뢰]' : ''
  const size = c.w > 0 ? ` (${c.w}×${c.h})` : ''
  return `${c.idx}. ${tag} [${c.domain}] "${c.title}"${size}`
}).join('\n')}

JSON만 응답: {"pick": 번호, "reason": "이유"}`
}

async function selectPosterWithLLM(
  candidates: ImageCandidate[],
  eventName: string,
  venueName: string
): Promise<{ url: string | null; reason: string; candidateCount: number; candidates: { title: string; link: string; domain: string; source: string }[] }> {
  const allCandidates = candidates.slice(0, 15).map((img, i) => {
    let domain = ''
    try { domain = new URL(img.link).hostname } catch { domain = 'unknown' }
    const trusted = isTrusted(img.link)
    return {
      idx: i + 1,
      title: img.title,
      link: img.link,
      domain,
      w: img.width,
      h: img.height,
      trusted,
      source: img.source,
    }
  })

  if (allCandidates.length === 0) {
    return { url: null, reason: 'no candidates after filter', candidateCount: 0, candidates: [] }
  }

  // Auto-select: if only 1 candidate and it's from og:image of a trusted page → skip LLM
  if (allCandidates.length === 1 && allCandidates[0].source === 'og:image' && isPageTrusted(allCandidates[0].link)) {
    return {
      url: allCandidates[0].link,
      reason: 'auto-selected: og:image from trusted source_url',
      candidateCount: 1,
      candidates: allCandidates.map(c => ({ title: c.title, link: c.link, domain: c.domain, source: c.source })),
    }
  }

  const prompt = buildLLMPrompt(eventName, venueName, allCandidates)

  try {
    const text = await extractWithGemini(prompt)
    const parsed = JSON.parse(text) as { pick: number; reason: string }
    if (parsed.pick > 0 && parsed.pick <= allCandidates.length) {
      const chosen = allCandidates[parsed.pick - 1]
      return {
        url: chosen.link,
        reason: parsed.reason,
        candidateCount: allCandidates.length,
        candidates: allCandidates.map(c => ({ title: c.title, link: c.link, domain: c.domain, source: c.source })),
      }
    }
    return {
      url: null,
      reason: parsed.reason || 'LLM chose none',
      candidateCount: allCandidates.length,
      candidates: allCandidates.map(c => ({ title: c.title, link: c.link, domain: c.domain, source: c.source })),
    }
  } catch (err) {
    return {
      url: null,
      reason: `LLM error: ${err}`,
      candidateCount: allCandidates.length,
      candidates: allCandidates.map(c => ({ title: c.title, link: c.link, domain: c.domain, source: c.source })),
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface EventResult {
  id: number
  name: string
  venue: string
  source: string
  sourceUrl: string | null
  currentPoster: string | null
  llmPoster: string | null
  llmReason: string
  imageSources: string[]
  candidateCount: number
  candidates: { title: string; link: string; domain: string; source: string }[]
  status: 'match' | 'new_poster' | 'different' | 'llm_removed' | 'both_empty' | 'skipped'
}

async function main() {
  const args = process.argv.slice(2)
  const roundNum = parseInt(args[args.indexOf('--round') + 1]) || 1
  const limit = parseInt(args[args.indexOf('--limit') + 1]) || 0
  const apply = args.includes('--apply')
  const sourceFilter = args.includes('--source') ? args[args.indexOf('--source') + 1] : null

  console.log(`=== Poster LLM Iteration — Round ${roundNum} (Phase 2: Multi-source) ===`)
  console.log(`Limit: ${limit || 'all'}, Apply: ${apply}, Source: ${sourceFilter || 'all'}\n`)

  // Load events with source_url
  const today = new Date().toISOString().split('T')[0]
  let query = supabase
    .from('events')
    .select('id, name, venue_name, poster_url, source, source_url')
    .or(`end_date.gte.${today},end_date.is.null`)
    .order('name')

  if (sourceFilter) {
    query = query.eq('source', sourceFilter)
  }
  if (limit) {
    query = query.limit(limit)
  }

  const { data: events, error } = await query
  if (error || !events) {
    console.error('Failed to load events:', error)
    return
  }

  const toProcess = events.filter((e) => e.source !== 'seoul_events')
  console.log(`Events: ${events.length} total, ${toProcess.length} to process (excluding seoul_events)\n`)

  const results: EventResult[] = []
  let processed = 0

  for (const ev of toProcess) {
    processed++

    // Multi-source image collection
    const { candidates, sources } = await collectImages(
      ev.name,
      ev.venue_name || '',
      ev.source_url || null
    )

    // LLM selection
    const llmResult = await selectPosterWithLLM(candidates, ev.name, ev.venue_name || '')

    let status: EventResult['status'] = 'both_empty'
    if (llmResult.url) {
      if (llmResult.url === ev.poster_url) status = 'match'
      else if (!ev.poster_url) status = 'new_poster'
      else status = 'different'
    } else {
      status = ev.poster_url ? 'llm_removed' : 'both_empty'
    }

    results.push({
      id: ev.id,
      name: ev.name,
      venue: ev.venue_name || '',
      source: ev.source,
      sourceUrl: ev.source_url || null,
      currentPoster: ev.poster_url,
      llmPoster: llmResult.url,
      llmReason: llmResult.reason,
      imageSources: sources,
      candidateCount: llmResult.candidateCount,
      candidates: llmResult.candidates,
      status,
    })

    if (processed % 10 === 0 || processed === toProcess.length) {
      console.log(`  [${processed}/${toProcess.length}] ${ev.name} → ${status} (sources: ${sources.join(', ')})`)
    }

    // Rate limit: Gemini + Naver combined
    await new Promise((r) => setTimeout(r, 2000))
  }

  // ─── Output ─────────────────────────────────────────────────────────────

  const statusCounts: Record<string, number> = {}
  results.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1 })

  console.log('\n=== Round Summary ===')
  console.log(`Processed: ${results.length}`)
  for (const [s, c] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c} (${(c / results.length * 100).toFixed(1)}%)`)
  }

  const llmSelected = results.filter((r) => r.llmPoster).length
  console.log(`\nLLM selection rate: ${llmSelected}/${results.length} (${(llmSelected / results.length * 100).toFixed(1)}%)`)

  // Source analysis
  const sourceUsage: Record<string, number> = {}
  results.forEach(r => r.imageSources.forEach(s => { sourceUsage[s.split(':')[0]] = (sourceUsage[s.split(':')[0]] || 0) + 1 }))
  console.log('\n=== Image Source Usage ===')
  for (const [s, c] of Object.entries(sourceUsage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${c}`)
  }

  // Save detailed results
  const outputPath = `test-output/poster-round-${roundNum}.json`
  fs.writeFileSync(outputPath, JSON.stringify({ round: roundNum, timestamp: new Date().toISOString(), results }, null, 2))
  console.log(`\nDetailed results saved to: ${outputPath}`)

  // Print interesting cases
  const printCases = (status: string, label: string, maxPrint = 25) => {
    const cases = results.filter((r) => r.status === status)
    if (cases.length === 0) return
    console.log(`\n=== ${label} (${cases.length}) ===`)
    cases.slice(0, maxPrint).forEach((r) => {
      console.log(`  "${r.name}" [${r.source}] sources: ${r.imageSources.join(', ')}`)
      if (r.currentPoster) console.log(`    현재: ${r.currentPoster}`)
      if (r.llmPoster) console.log(`    LLM:  ${r.llmPoster}`)
      console.log(`    사유: ${r.llmReason}`)
    })
  }

  printCases('new_poster', 'New — LLM found poster (was empty)')
  printCases('different', 'Different — LLM chose different poster')
  printCases('llm_removed', 'Removed — LLM rejected current poster')
  printCases('both_empty', 'Empty — No poster found')

  // Apply if requested
  if (apply) {
    console.log('\n=== Applying changes ===')
    let updated = 0
    for (const r of results) {
      if (r.status === 'new_poster' || r.status === 'different') {
        const { error } = await supabase
          .from('events')
          .update({ poster_url: r.llmPoster })
          .eq('id', r.id)
        if (!error) updated++
      }
    }
    console.log(`Updated ${updated} events`)
  }
}

main().catch(console.error)
