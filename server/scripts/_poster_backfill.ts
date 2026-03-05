/**
 * Poster backfill: search posters for events that don't have one.
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_poster_backfill.ts
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

async function fetchNaverImages(query: string, display = 20): Promise<NaverImageItem[]> {
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

const POSTER_BLOCKED_DOMAINS = [
  'i.pinimg.com', 'pinimg.com', 'dcimg', 'dcinside.com',
  'instiz.net', 'postfiles.pstatic.net', 'yt3.googleusercontent.com',
  'aladin.co.kr', 'woodo.kr', 'muscache.com', 'coupangcdn.com',
  'fimg5.pann.com', 'momsdiary.co.kr', 'khidi.or.kr', 'anewsa.com',
  // R4: added based on LLM verification
  'i.ytimg.com',              // YouTube thumbnails
  'img.youtube.com',          // YouTube thumbnails
  'yt3.ggpht.com',            // YouTube channel thumbnails
  'clipartkorea.co.kr',       // stock images
  'mangoboard.net',           // template images
  'miricanvas.com',           // template images
  'shop-phinf.pstatic.net',   // Naver shopping
  'shop1.phinf.naver.net',    // Naver shopping
  'dprime.kr',                // community
  'bric.postech.ac.kr',       // unrelated institution
  // R7: added based on manual URL inspection
  'i1.ruliweb.com', 'i2.ruliweb.com', 'ruliweb.com',  // gaming community
  'cdn.dealbada.com',         // deal/shopping
  'thumbnail.10x10.co.kr',    // shopping mall
  'preview.gettyimagesbank.com', // stock photos
  'media.istockphoto.com',    // stock photos
  'img.lovepik.com',          // stock templates
  'cdn.getyourguide.com',     // travel booking
  'upload3.inven.co.kr',      // gaming community
  'cdn.mania.kr',             // community
  'img.extmovie.com',         // movie community
  'img-cdn.theqoo.net',       // entertainment community
  'img.dmitory.com',          // community
  'image.idus.com',           // handmade marketplace
  'data.ad.co.kr',            // advertising
  'mir-s3-cdn-cf.behance.net', // design portfolio
  'cphoto.asiae.co.kr',       // generic news archive
  'img.asiatoday.co.kr',      // generic news archive
  'www.reportworld.co.kr',    // report/document
  'www.ibric.org',            // biology research
  'www.ksponco.or.kr',        // sports promotion (unrelated)
  'contents.kyobobook.co.kr', // book covers
  'chulsa.kr',                // community
  'ldb-phinf.pstatic.net',    // Naver place random photos
  // R9: added based on manual URL inspection
  'img.freepik.com',          // stock templates
  'png.pngtree.com',          // stock templates
  'pds.saramin.co.kr',        // job site
  'ai.esmplus.com',           // esmplus shopping
  'item.ssgcdn.com',          // SSG shopping mall
  'shopping.phinf.naver.net', // Naver shopping
  'is1-ssl.mzstatic.com',     // Apple Music
  'cdnweb01.wikitree.co.kr',  // wikitree community
  'fimg6.pann.com',           // pann community
  'img.theqoo.net',           // theqoo community
  'extmovie.maxmovie.com',    // movie community
  'pds.joins.com',            // old news archive
  'edgio.clien.net',          // Clien community
  'scontent-nrt1-2.cdninstagram.com', // Instagram CDN
  'scontent-nrt1-1.cdninstagram.com', // Instagram CDN
  'imgssl.ezday.co.kr',       // ezday community
  'lh7-rt.googleusercontent.com', // Google Docs images
  'www.momq.co.kr',           // mom community
  'www.e-redpoint.com',       // product page
  'overseas.mofa.go.kr',      // government unrelated
  'www.theteams.kr',          // job ads
  'www.woorinews.co.kr',      // old news
  'www.ctnews.kr',            // old news
  'www.bodonews.com',         // generic news
  'thesegye.com',             // generic news
  'www.gukjenews.com',        // old generic news
  'www.kns.tv',               // old news
  'kr.news.cn',               // Chinese news
  // R9: wrong region domains
  'www.jinju.go.kr', 'jinju.go.kr',       // 진주
  'taean.go.kr',                           // 태안
  'lib.changwon.go.kr',                    // 창원
  'www.yeonggwang.go.kr',                  // 영광
  'www.bonghwa.go.kr',                     // 봉화
  'www.naju.go.kr',                        // 나주
  'www.jje.go.kr',                         // 제주
  'www.gjartcenter.kr',                    // 광주
  'www.cu.ac.kr',                          // 대구 대학
  'www.youthnavi.net',                     // old youth portal
  'www.traveli.co.kr',                     // old travel photo
  // R10: final additions
  'image.msscdn.net',           // 무신사 fashion shopping
  'marketplace.canva.com',      // stock templates
  'img-store.theqoo.net',       // theqoo variant
  'imgfiles.plaync.com',        // gaming site
  'partybungbung.com',          // party shopping
  'dbscthumb-phinf.pstatic.net', // old Naver photos
  'inaturalist-open-data.s3.amazonaws.com', // nature photos
  'thumb2.gettyimageskorea.com', // stock photos
  'i1.sndcdn.com',              // SoundCloud
  'image.genie.co.kr',          // Genie music
  'file.kinolights.com',        // movie review
  'cdn.socialfocus.co.kr',      // old news
  'cdn.autoherald.co.kr',       // car news
  'cdn.imweb.me',               // generic website builder
  'd7hftxdivxxvm.cloudfront.net', // Artsy
  // R10: wrong regions
  'www.cng.go.kr',              // 창녕
  'www.jj.ac.kr',               // 전주대
  'www.uiryeong.go.kr',        // 의령
]

const POSTER_TRUSTED_DOMAINS = [
  'culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr',
  'sejongpac.or.kr', 'og-data.s3.amazonaws.com',
  'gwanak.go.kr', 'incheon.go.kr',
  // R2: official portals
  'ticket.melon.com', 'ticketlink.co.kr', 'interpark.com',
  'yes24.com', 'cjcgv.co.kr', 'megabox.co.kr',
  'museum.go.kr', 'mmca.go.kr', 'sema.seoul.go.kr',
]

// R9: Check if URL contains a year before current year (2026+ only)
function hasStaleYear(url: string): boolean {
  const currentYear = new Date().getFullYear()
  const yearMatches = url.match(/\/(20[0-2]\d)\//g)
  if (!yearMatches) return false
  return yearMatches.some(m => {
    const year = parseInt(m.replace(/\//g, ''))
    return year < currentYear
  })
}

function selectBestPoster(images: NaverImageItem[], eventName: string, venueName: string): string | null {
  const normalizedEvent = eventName.replace(/[[\]<>()「」『』""'']/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const eventTokens = normalizedEvent.split(/[\s,.:;·\-~]+/).filter((t) => t.length >= 2)

  // Also extract venue tokens for matching
  const venueTokens = (venueName || '').replace(/[[\]<>()]/g, '').toLowerCase()
    .split(/[\s,.:;·\-~]+/).filter((t) => t.length >= 2)

  const candidates = images
    .filter((img) => {
      const url = img.link.toLowerCase()
      if (POSTER_BLOCKED_DOMAINS.some((d) => url.includes(d))) return false
      // R4: filter stale years in URL
      if (hasStaleYear(url)) return false
      const w = parseInt(img.sizewidth) || 0
      const h = parseInt(img.sizeheight) || 0
      if (w < 200 || h < 200) return false
      return true
    })
    .map((img) => {
      const title = stripHtml(img.title).toLowerCase()
      const w = parseInt(img.sizewidth) || 1
      const h = parseInt(img.sizeheight) || 1
      const aspectRatio = h / w
      let score = 0

      // Event name token matching
      const matchedTokens = eventTokens.filter((t) => title.includes(t))
      const titleRelevance = eventTokens.length > 0 ? matchedTokens.length / eventTokens.length : 0
      score += titleRelevance * 50

      // Venue name matching bonus
      const venueMatched = venueTokens.filter((t) => title.includes(t))
      if (venueMatched.length > 0) score += 10

      // Trusted domain bonus
      if (POSTER_TRUSTED_DOMAINS.some((d) => img.link.includes(d))) score += 20

      // Poster-like aspect ratio
      if (aspectRatio >= 0.8 && aspectRatio <= 2.5) score += 10
      if (aspectRatio >= 1.2 && aspectRatio <= 1.8) score += 5

      // R7: News image CDN — stricter: need title match AND recent year
      if (img.link.includes('imgnews.naver.net') || img.link.includes('NISI')) {
        const urlYearMatch = img.link.match(/\/(20\d{2})\//)
        const urlYear = urlYearMatch ? parseInt(urlYearMatch[1]) : 0
        const currentYear = new Date().getFullYear()
        if (titleRelevance >= 0.5 && urlYear >= currentYear - 1) {
          score += 5  // relevant + recent news article
        } else if (titleRelevance >= 0.3 && urlYear >= currentYear - 1) {
          score += 0  // neutral — title matches but not strongly
        } else {
          score -= 15  // old or generic news photo
        }
      }

      // Official keywords
      if (/공식|포스터|메인|키비주얼|대표/.test(title)) score += 10
      // R4: Performance/exhibition specific keywords (weaker bonus)
      if (/전시|공연|뮤지컬|축제|페스티벌|팝업/.test(title)) score += 5

      // Penalty: scene/review photos
      if (/현장|후기|방문|리뷰|체험기|블로그|스냅|사진찍/.test(title)) score -= 15
      // R4: Penalty for generic news article indicators in URL
      if (/\/article\/|\/news\/|NISI\d/.test(img.link)) score -= 5

      return { img, score, titleRelevance }
    })
    .filter((c) => {
      // Must have meaningful title relevance OR be from trusted domain
      return c.titleRelevance >= 0.3 || c.score >= 20
    })
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (best && best.score >= 15) {
    return best.img.link
  }

  return null
}

async function main() {
  const { data: events } = await supabaseAdmin
    .from('events')
    .select('id, name, source, venue_name')
    .is('poster_url', null)
    .order('id')

  if (!events || events.length === 0) {
    console.log('No events without poster')
    return
  }

  console.log(`Events without poster: ${events.length}\n`)

  let found = 0
  let notFound = 0
  const notFoundList: string[] = []

  for (const ev of events) {
    // Try multiple search strategies, use first hit
    const queries = [
      `${ev.name} 포스터`,
      `${ev.name} ${ev.venue_name || ''}`,
      ev.name,
    ]

    let posterUrl: string | null = null

    for (const query of queries) {
      const images = await fetchNaverImages(query, 20)
      posterUrl = selectBestPoster(images, ev.name, ev.venue_name || '')
      if (posterUrl) break
      await new Promise((r) => setTimeout(r, 150))
    }

    if (posterUrl) {
      const { error } = await supabaseAdmin
        .from('events')
        .update({ poster_url: posterUrl })
        .eq('id', ev.id)
      if (!error) {
        found++
        console.log(`✅ [${ev.id}] ${ev.name}`)
      }
    } else {
      notFound++
      notFoundList.push(`[${ev.source}] ${ev.name}`)
    }

    await new Promise((r) => setTimeout(r, 200))
  }

  console.log(`\n=== Result ===`)
  console.log(`Found: ${found}/${events.length} (${Math.round(found/events.length*100)}%)`)
  console.log(`Not found: ${notFound}`)

  if (notFoundList.length > 0 && notFoundList.length <= 30) {
    console.log(`\n--- Still without poster ---`)
    for (const name of notFoundList) {
      console.log(`  ${name}`)
    }
  }
}

main().catch(console.error)
