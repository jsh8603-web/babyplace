/**
 * Daily poster enrichment for events without official poster sources.
 *
 * Skips events from sources that provide their own posters:
 *   - tour_api (공공데이터 공식 포스터)
 *   - interpark (CDN 포스터)
 *   - babygo (BabyGo API 썸네일)
 *   - seoul_events (서울시 공식 API 포스터)
 *
 * Runs multi-source image collection + Gemini LLM selection for:
 *   - blog_discovery
 *   - exhibition_extraction
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { logCollection } from '../lib/collection-log'
import { extractWithGemini } from '../lib/gemini'
import * as fs from 'fs'
import * as path from 'path'

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID!
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET!
const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'
const NAVER_WEB_URL = 'https://openapi.naver.com/v1/search/webkr'

// Sources that already have official posters — skip enrichment
const OFFICIAL_POSTER_SOURCES = ['tour_api', 'interpark', 'babygo', 'seoul_events']

interface ImageCandidate {
  title: string
  link: string
  width: number
  height: number
  source: 'og:image' | 'naver_image' | 'web_og:image' | 'current'
}

interface NaverImageItem {
  title: string
  link: string
  thumbnail: string
  sizeheight: string
  sizewidth: string
}

export interface PosterEnrichmentResult {
  processed: number
  updated: number
  skipped: number
  errors: number
}

// ─── Blocked/Trusted Domains (shared with _poster_llm_iterate.ts) ──────────

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
  'dthumb-phinf.pstatic.net', 'blog.kakaocdn.net',
  'lh7-rt.googleusercontent.com',
  'cdninstagram.com', 'inaturalist-open-data.s3.amazonaws.com',
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
  'www.forest.go.kr', 't1.daumcdn.net/cafeattach', 't1.daumcdn.net/brunch',
  'search.pstatic.net/common', 'www.idfac.or.kr',
  'kakaotv/kakaoaccount', 'img.tumblbug.com', 'www.gokseong.go.kr',
  'st3.depositphotos.com', 'st2.depositphotos.com', 'st.depositphotos.com',
  'previews.123rf.com', 'us.123rf.com',
  'thumbs.dreamstime.com', 'www.shutterstock.com',
  'image.shutterstock.com', 'thumb.ac-illust.com',
  'img.designhouse.co.kr', 'e7.pngegg.com', 'pngegg.com',
  'play-lh.googleusercontent.com', 'lh3.googleusercontent.com',
  'bbscdn.df.nexon.com', 'kream-phinf.pstatic.net',
  'd3kxs6kpbh59hp.cloudfront.net', 'down.humoruniv.com',
  'images.unsplash.com', 'page-images.kakaoentcdn.com',
  'imgnews.naver.net', 'res.klook.com', 'item.kakaocdn.net',
  'imgprism.ehyundai.com',
  'cdn3.wadiz.kr', 'cdn.wadiz.kr',
  'cdn.maily.so',
  'image2.1004gundam.com', '1004gundam.com',
  'img.gigglehd.com',
  'bookmouse.co.kr',
  'image6.yanolja.com', 'image.yanolja.com',
  'contents.lotteon.com',
  'cdn.crowdpic.net',
]

const POSTER_TRUSTED_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr', 'sejongpac.or.kr',
  'og-data.s3.amazonaws.com', 'gwanak.go.kr', 'incheon.go.kr',
  'ticket.melon.com', 'ticketlink.co.kr', 'interpark.com',
  'yes24.com', 'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'museum.seoul.go.kr', 'visitkorea.or.kr', 'mediahub.seoul.go.kr',
]

const OG_TRUSTED_PAGE_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'museum.seoul.go.kr',
  'tickets.interpark.com', 'ticket.yes24.com', 'ticketlink.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
  'visitkorea.or.kr', 'korean.visitseoul.net', 'mediahub.seoul.go.kr',
  'lottemuseum.com', 'sac.or.kr', 'sejongpac.or.kr',
]

const OG_IMAGE_BLOCKLIST = [
  'culturePotalImg', 'mainUX/main.png', 'og_noImage', 'kakaobanner',
  'default_og', 'logo', 'Logo', 'favicon', '/common/img/',
  'share_img', 'shareImg', 'back_img', '/images/common/',
  'ticketlink_rebranding', 'defaultMobileBanner', 'defaultBanner',
  'tketlink.dn.toastoven.net/static',
  'og_image', 'og_img', 'ogimage', 'meta_img', 'sns_sImg', '_meta2',
  '/templete/', '/include/image/common/',
]

// ─── Prompt Version Management ──────────────────────────────────────────────

interface PosterPromptConfig {
  version: number
  updated_at: string
  prompt: string
  changelog: { version: number; date: string; change: string }[]
}

function loadPromptConfig(): PosterPromptConfig {
  const configPath = path.join(__dirname, '..', 'config', 'poster-prompt.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as PosterPromptConfig
  } catch {
    return { version: 0, updated_at: '', prompt: '', changelog: [] }
  }
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

interface AuditLogEntry {
  event_id: number
  event_name: string
  event_source: string
  before_url: string | null
  after_url: string | null
  candidates: { title: string; link: string; domain: string; source: string }[]
  llm_reason: string
  action: 'updated' | 'kept' | 'removed' | 'no_candidates' | 'search_only' | 'recovery' | 'recovery_failed'
  prompt_version: number
  source_url?: string | null
  venue_name?: string | null
  event_dates?: { start_date?: string | null; end_date?: string | null } | null
}

async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await supabaseAdmin.from('poster_audit_log').insert({
      event_id: entry.event_id,
      event_name: entry.event_name,
      event_source: entry.event_source,
      before_url: entry.before_url,
      after_url: entry.after_url,
      candidates: entry.candidates,
      llm_reason: entry.llm_reason,
      action: entry.action,
      prompt_version: entry.prompt_version,
      source_url: entry.source_url ?? null,
      venue_name: entry.venue_name ?? null,
      event_dates: entry.event_dates ?? null,
    })
  } catch (err) {
    console.error(`[poster-enrich] Audit log write error:`, err)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim()
}

export function cleanEventName(name: string): string {
  return name
    .replace(/<[^>]+>/g, ' ')
    .replace(/[「」『』《》<>〈〉]/g, ' ')
    .replace(/[·•:：\-\|\/]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractCoreKeywords(name: string): string {
  const cleaned = cleanEventName(name)
  const tokens = cleaned.split(' ').filter(t =>
    t.length >= 2 &&
    !['체험', '무료', '기념', '특가', '프로그램', '이벤트', '전시', '공연', '축제', '팝업', '뮤지컬'].includes(t)
  )
  return tokens.slice(0, 3).join(' ')
}

export function hasStaleYear(url: string): boolean {
  const currentYear = new Date().getFullYear()
  // Match /YYYY/ or /YYYYMM/ or /YYYYMMDD/ patterns in URL paths
  const yearMatches = url.match(/\/(20[0-2]\d)(?:\d{0,4})\//g)
  if (!yearMatches) return false
  return yearMatches.some((m) => {
    const digits = m.replace(/\//g, '')
    const year = parseInt(digits.slice(0, 4))
    return year < currentYear - 1
  })
}

export function isBlocked(url: string): boolean {
  const lower = url.toLowerCase()
  return POSTER_BLOCKED_DOMAINS.some((d) => lower.includes(d))
}

export function isTrusted(url: string): boolean {
  return POSTER_TRUSTED_DOMAINS.some((d) => url.includes(d))
}

function isPageTrusted(url: string): boolean {
  return OG_TRUSTED_PAGE_DOMAINS.some((d) => url.includes(d))
}

// ─── Image Fetchers ─────────────────────────────────────────────────────────

async function fetchNaverImages(query: string, display = 20): Promise<NaverImageItem[]> {
  const url = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`
  try {
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
    })
    if (!res.ok) return []
    const json = await res.json() as { items?: NaverImageItem[] }
    return json.items || []
  } catch { return [] }
}

async function fetchNaverWebSearch(query: string, display = 10): Promise<{ title: string; link: string }[]> {
  const url = `${NAVER_WEB_URL}?query=${encodeURIComponent(query)}&display=${display}`
  try {
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': NAVER_CLIENT_ID, 'X-Naver-Client-Secret': NAVER_CLIENT_SECRET },
    })
    if (!res.ok) return []
    const json = await res.json() as { items?: { title: string; link: string }[] }
    return json.items || []
  } catch { return [] }
}

async function fetchOgImage(pageUrl: string): Promise<{ url: string; title: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BabyPlacePosterBot/1.0)' },
      signal: controller.signal, redirect: 'follow',
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const html = await res.text()
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i)
    if (!ogMatch) return null
    let imgUrl = ogMatch[1]
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl
    else if (imgUrl.startsWith('/')) {
      const base = new URL(pageUrl)
      imgUrl = base.origin + imgUrl
    }
    if (OG_IMAGE_BLOCKLIST.some(p => imgUrl.includes(p))) return null
    const titleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']/i)
      || html.match(/<title>([^<]+)<\/title>/i)
    const title = titleMatch ? stripHtml(titleMatch[1]) : ''
    return { url: imgUrl, title }
  } catch { return null }
}

export function preFilter(images: NaverImageItem[]): ImageCandidate[] {
  return images
    .filter((img) => {
      if (isBlocked(img.link)) return false
      if (hasStaleYear(img.link)) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 200 || h < 200) return false
      // Extreme aspect ratio filter (e.g., very tall editor-uploaded images)
      if (w > 0 && h > 0) {
        const ratio = h / w
        if (ratio > 5 || ratio < 0.1) return false
      }
      return true
    })
    .map(img => ({
      title: stripHtml(img.title), link: img.link,
      width: parseInt(img.sizewidth) || 0, height: parseInt(img.sizeheight) || 0,
      source: 'naver_image' as const,
    }))
}

// ─── Multi-source Collection ────────────────────────────────────────────────

async function collectImages(eventName: string, venueName: string, sourceUrl: string | null): Promise<ImageCandidate[]> {
  const candidates: ImageCandidate[] = []

  // Source 1: og:image from source_url
  if (sourceUrl && !sourceUrl.includes('blog.naver.com')) {
    const ogResult = await fetchOgImage(sourceUrl)
    if (ogResult && ogResult.url && !isBlocked(ogResult.url) && !hasStaleYear(ogResult.url)) {
      candidates.push({ title: ogResult.title || '[source og:image]', link: ogResult.url, width: 0, height: 0, source: 'og:image' })
    }
    await new Promise(r => setTimeout(r, 300))
  }

  // Source 2: Naver Image Search (5-step fallback)
  const cleaned = cleanEventName(eventName)
  const coreKw = extractCoreKeywords(eventName)
  const queries = [
    `${cleaned} 포스터`,
    venueName ? `${cleaned} ${venueName}` : null,
    cleaned,
    coreKw !== cleaned ? coreKw : null,
    venueName ? `${venueName} ${coreKw}` : null,
  ].filter(Boolean) as string[]

  let naverHits = 0
  for (const q of [...new Set(queries)]) {
    const imgs = await fetchNaverImages(q, 20)
    if (imgs.length > 0) {
      const filtered = preFilter(imgs)
      if (filtered.length > 0) {
        candidates.push(...filtered)
        naverHits++
        if (naverHits >= 2) break
      }
    }
    await new Promise(r => setTimeout(r, 150))
  }

  // Source 3: Naver Web Search → og:image from trusted pages
  const hasTrustedCandidate = candidates.some(c => isTrusted(c.link))
  if (!hasTrustedCandidate) {
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
        candidates.push({ title: ogResult.title || stripHtml(page.title), link: ogResult.url, width: 0, height: 0, source: 'web_og:image' })
      }
      await new Promise(r => setTimeout(r, 300))
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  return candidates.filter(c => { if (seen.has(c.link)) return false; seen.add(c.link); return true })
}

// ─── LLM Selection ──────────────────────────────────────────────────────────

async function selectPosterWithLLM(
  candidates: ImageCandidate[],
  eventName: string,
  venueName: string,
  currentPosterUrl?: string | null
): Promise<{ url: string | null; reason: string; candidatesSummary: { title: string; link: string; domain: string; source: string }[] }> {
  const allInput = [...candidates]
  if (currentPosterUrl && !candidates.some(c => c.link === currentPosterUrl)) {
    let domain = ''
    try { domain = new URL(currentPosterUrl).hostname } catch { /* */ }
    allInput.unshift({
      title: `[현재 DB 포스터] ${domain}`, link: currentPosterUrl,
      width: 0, height: 0, source: 'current' as ImageCandidate['source'],
    })
  }

  const items = allInput.slice(0, 15).map((img, i) => {
    let domain = ''
    try { domain = new URL(img.link).hostname } catch { domain = 'unknown' }
    const trusted = isTrusted(img.link)
    const tag = img.source === 'current' ? '[현재]' : img.source === 'og:image' ? '[공식]' : trusted ? '[신뢰]' : ''
    const size = img.width > 0 ? ` (${img.width}x${img.height})` : ''
    return { idx: i + 1, line: `${i + 1}. ${tag} [${domain}] "${img.title}"${size}`, link: img.link, source: img.source, domain }
  })

  const candidatesSummary = items.map(c => ({
    title: c.line.replace(/^\d+\.\s*/, ''),
    link: c.link,
    domain: c.domain,
    source: c.source,
  }))

  if (items.length === 0) return { url: null, reason: 'no candidates', candidatesSummary }

  // Auto-select: single og:image from trusted page
  if (items.length === 1 && items[0].source === 'og:image' && isPageTrusted(items[0].link)) {
    return { url: items[0].link, reason: 'auto: og:image from trusted source', candidatesSummary }
  }

  const promptConfig = loadPromptConfig()
  const venueSuffix = venueName ? ` (장소: ${venueName})` : ''
  const candidateLines = items.map(c => c.line).join('\n')

  const prompt = promptConfig.version > 0
    ? promptConfig.prompt
        .replace('{name}', eventName)
        .replace('${venueSuffix}', venueSuffix)
        .replace('{candidateLines}', candidateLines)
    : `이벤트 "${eventName}"${venueSuffix}의 포스터를 선택하세요.

판단 순서:
1. [현재] → 현재 DB 포스터. 다른 후보가 명확히 더 나은 경우에만 교체.
2. [공식] → 공식 페이지 이벤트 전용 이미지. 사이트 로고 제외.
3. [신뢰] → 예매/문화포털 공식 포스터. 도서·음반 표지 제외.
4. 이벤트명 핵심 키워드 포함 이미지.
5. 같은 IP/브랜드 다른 행사도 허용.
6. 모두 무관하면 → 0.

금지: 다른 IP 포스터, 다른 지역 유사 행사, 블로그 셀카/스냅, 도서/스톡

후보:
${candidateLines}

JSON만 응답: {"pick": 번호, "reason": "이유"}`

  try {
    const text = await extractWithGemini(prompt)
    const parsed = JSON.parse(text) as { pick: number; reason: string }
    if (parsed.pick > 0 && parsed.pick <= items.length) {
      return { url: items[parsed.pick - 1].link, reason: parsed.reason, candidatesSummary }
    }
    return { url: null, reason: parsed.reason || 'LLM chose none', candidatesSummary }
  } catch (err) {
    return { url: null, reason: `LLM error: ${err}`, candidatesSummary }
  }
}

// ─── Main Enrichment Job ────────────────────────────────────────────────────

export async function runPosterEnrichment(): Promise<PosterEnrichmentResult> {
  const result: PosterEnrichmentResult = { processed: 0, updated: 0, skipped: 0, errors: 0 }
  const startedAt = Date.now()

  try {
    console.log('[poster-enrich] Starting daily poster enrichment')

    // Fetch active events that need poster enrichment (unlocked + locked separately)
    const today = new Date().toISOString().split('T')[0]
    const allEvents: any[] = []
    const lockedEvents: any[] = []
    let offset = 0
    const PAGE = 1000

    // Fetch unlocked events (exclude official sources at DB level for efficiency)
    while (true) {
      let query = supabaseAdmin
        .from('events')
        .select('id, name, venue_name, poster_url, poster_hidden, poster_locked, source, source_url')
        .or(`end_date.gte.${today},end_date.is.null`)
        .eq('poster_hidden', false)
        .eq('poster_locked', false)
      for (const src of OFFICIAL_POSTER_SOURCES) {
        query = query.neq('source', src)
      }
      const { data, error } = await query.range(offset, offset + PAGE - 1)
      if (error) throw new Error(`Failed to fetch events: ${error.message}`)
      if (!data || data.length === 0) break
      allEvents.push(...data)
      if (data.length < PAGE) break
      offset += PAGE
    }

    // Fetch locked events (search_only mode — exclude official sources at DB level)
    offset = 0
    while (true) {
      let query = supabaseAdmin
        .from('events')
        .select('id, name, venue_name, poster_url, poster_hidden, poster_locked, source, source_url')
        .or(`end_date.gte.${today},end_date.is.null`)
        .eq('poster_hidden', false)
        .eq('poster_locked', true)
      for (const src of OFFICIAL_POSTER_SOURCES) {
        query = query.neq('source', src)
      }
      const { data, error } = await query.range(offset, offset + PAGE - 1)
      if (error) throw new Error(`Failed to fetch locked events: ${error.message}`)
      if (!data || data.length === 0) break
      lockedEvents.push(...data)
      if (data.length < PAGE) break
      offset += PAGE
    }

    // Filter: only non-official sources, and events without poster or needing re-evaluation
    const eligible = allEvents.filter(e => !OFFICIAL_POSTER_SOURCES.includes(e.source))
    const needsPoster = eligible.filter(e => !e.poster_url) // priority: no poster
    const hasPoster = eligible.filter(e => e.poster_url)
    const lockedEligible = lockedEvents.filter(e => !OFFICIAL_POSTER_SOURCES.includes(e.source))

    // Process no-poster events first, then existing posters for quality check
    const toProcess = [...needsPoster, ...hasPoster]

    const promptConfig = loadPromptConfig()
    console.log(`[poster-enrich] ${allEvents.length} active events, ${eligible.length} eligible (excl official), ${needsPoster.length} missing posters, ${lockedEligible.length} locked (search_only), prompt v${promptConfig.version}`)

    for (const ev of toProcess) {
      result.processed++

      try {
        const candidates = await collectImages(ev.name, ev.venue_name || '', ev.source_url || null)
        const llmResult = await selectPosterWithLLM(candidates, ev.name, ev.venue_name || '', ev.poster_url)

        let action: AuditLogEntry['action']
        if (llmResult.candidatesSummary.length === 0) {
          action = 'no_candidates'
        } else if (llmResult.url && llmResult.url !== ev.poster_url) {
          action = 'updated'
        } else if (!llmResult.url && ev.poster_url) {
          action = 'removed'
        } else {
          action = 'kept'
        }

        if (action === 'updated') {
          const { error: updateError } = await supabaseAdmin
            .from('events')
            .update({ poster_url: llmResult.url })
            .eq('id', ev.id)

          if (updateError) {
            console.error(`[poster-enrich] Update error for ${ev.id}:`, updateError.message)
            result.errors++
          } else {
            result.updated++
            console.log(`[poster-enrich] Updated ${ev.id} "${ev.name}" → ${llmResult.reason}`)
          }
        } else {
          result.skipped++
        }

        await writeAuditLog({
          event_id: ev.id,
          event_name: ev.name,
          event_source: ev.source,
          before_url: ev.poster_url || null,
          after_url: llmResult.url || null,
          candidates: llmResult.candidatesSummary,
          llm_reason: llmResult.reason,
          action,
          prompt_version: promptConfig.version,
          source_url: ev.source_url || null,
          venue_name: ev.venue_name || null,
          event_dates: { start_date: ev.start_date, end_date: ev.end_date },
        })
      } catch (err) {
        console.error(`[poster-enrich] Error processing ${ev.id}:`, err)
        result.errors++
      }

      // Rate limit: Gemini + Naver combined
      await new Promise(r => setTimeout(r, 2000))

      if (result.processed % 20 === 0) {
        console.log(`[poster-enrich] Progress: ${result.processed}/${toProcess.length} (updated: ${result.updated})`)
      }
    }

    // Process locked events in search_only mode (search + log, no DB update)
    if (lockedEligible.length > 0) {
      console.log(`[poster-enrich] Processing ${lockedEligible.length} locked events (search_only)`)
      for (const ev of lockedEligible) {
        try {
          const candidates = await collectImages(ev.name, ev.venue_name || '', ev.source_url || null)
          const llmResult = await selectPosterWithLLM(candidates, ev.name, ev.venue_name || '', ev.poster_url)

          await writeAuditLog({
            event_id: ev.id,
            event_name: ev.name,
            event_source: ev.source,
            before_url: ev.poster_url || null,
            after_url: llmResult.url || null,
            candidates: llmResult.candidatesSummary,
            llm_reason: llmResult.reason,
            action: 'search_only',
            prompt_version: promptConfig.version,
            source_url: ev.source_url || null,
            venue_name: ev.venue_name || null,
            event_dates: { start_date: ev.start_date, end_date: ev.end_date },
          })

          await new Promise(r => setTimeout(r, 2000))
        } catch (err) {
          console.error(`[poster-enrich] Error processing locked ${ev.id}:`, err)
        }
      }
      console.log(`[poster-enrich] Locked events search_only complete: ${lockedEligible.length}`)
    }

    console.log(`[poster-enrich] Complete: ${result.processed} processed, ${result.updated} updated, ${result.errors} errors`)

    await logCollection({
      collector: 'poster-enrichment',
      startedAt,
      resultsCount: result.processed,
      newEvents: result.updated,
    })
  } catch (err) {
    console.error('[poster-enrich] Fatal error:', err)
    result.errors++
  }

  return result
}

// ─── Hidden Poster Recovery ─────────────────────────────────────────────────

export interface HiddenPosterRecoveryResult {
  processed: number
  recovered: number
  failed: number
  errors: number
}

export async function runHiddenPosterRecovery(): Promise<HiddenPosterRecoveryResult> {
  const result: HiddenPosterRecoveryResult = { processed: 0, recovered: 0, failed: 0, errors: 0 }

  try {
    const today = new Date().toISOString().split('T')[0]
    const hiddenEvents: any[] = []
    let offset = 0
    const PAGE = 1000

    while (true) {
      const { data, error } = await supabaseAdmin
        .from('events')
        .select('id, name, venue_name, poster_url, source, source_url, start_date, end_date, recovery_attempts')
        .eq('poster_hidden', true)
        .or(`end_date.gte.${today},end_date.is.null`)
        .range(offset, offset + PAGE - 1)
      if (error) throw new Error(`Failed to fetch hidden events: ${error.message}`)
      if (!data || data.length === 0) break
      hiddenEvents.push(...data)
      if (data.length < PAGE) break
      offset += PAGE
    }

    const MAX_RECOVERY_ATTEMPTS = 3
    const eligible = hiddenEvents.filter(e =>
      !OFFICIAL_POSTER_SOURCES.includes(e.source) &&
      (e.recovery_attempts ?? 0) < MAX_RECOVERY_ATTEMPTS
    )
    const promptConfig = loadPromptConfig()

    console.log(`[poster-recovery] ${eligible.length} hidden events eligible for recovery (prompt v${promptConfig.version})`)

    for (const ev of eligible) {
      result.processed++

      try {
        const candidates = await collectImages(ev.name, ev.venue_name || '', ev.source_url || null)
        // Pass null as currentPosterUrl — hidden poster should not appear as [현재]
        const llmResult = await selectPosterWithLLM(candidates, ev.name, ev.venue_name || '', null)

        const action: AuditLogEntry['action'] = llmResult.url ? 'recovery' : 'recovery_failed'

        if (llmResult.url) {
          result.recovered++
          console.log(`[poster-recovery] Found candidate for #${ev.id} "${ev.name}" → ${llmResult.url}`)
        } else {
          result.failed++
        }

        // Increment recovery_attempts counter
        await supabaseAdmin
          .from('events')
          .update({ recovery_attempts: (ev.recovery_attempts ?? 0) + 1 })
          .eq('id', ev.id)

        // Log to audit table — DB is NOT updated (approval required)
        await writeAuditLog({
          event_id: ev.id,
          event_name: ev.name,
          event_source: ev.source,
          before_url: ev.poster_url || null,
          after_url: llmResult.url || null,
          candidates: llmResult.candidatesSummary,
          llm_reason: llmResult.reason,
          action,
          prompt_version: promptConfig.version,
          source_url: ev.source_url || null,
          venue_name: ev.venue_name || null,
          event_dates: { start_date: ev.start_date, end_date: ev.end_date },
        })
      } catch (err) {
        console.error(`[poster-recovery] Error processing #${ev.id}:`, err)
        result.errors++
      }

      await new Promise(r => setTimeout(r, 2000))
    }

    console.log(`[poster-recovery] Complete: ${result.processed} processed, ${result.recovered} recovered, ${result.failed} failed, ${result.errors} errors`)
  } catch (err) {
    console.error('[poster-recovery] Fatal error:', err)
    result.errors++
  }

  return result
}
