/**
 * One-time script: refresh poster images for all blog_discovery/exhibition_extraction events
 * - Multiple query strategies with Gemini validation + URL year check
 * - Portrait-oriented image preference (posters are tall, scene photos are wide)
 * - Scene-photo domain/keyword blocklist
 * - If no relevant poster found after all retries → set poster_url to null
 *
 * Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/refresh-event-posters.ts
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { fetchNaverSearch } from '../collectors/naver-blog'
import { classifyWithGemini } from '../lib/gemini'

const NAVER_IMAGE_URL = 'https://openapi.naver.com/v1/search/image'

interface NaverImageItem {
  title: string
  link: string
  thumbnail: string
  sizeheight: string
  sizewidth: string
}

const BAD_URL_PATTERNS = [
  'search.pstatic.net',
  'type=b150',
  'thumb_crop_resize',
  'dthumb-phinf',
  'thumb=Y',
]

/** Domains that typically serve scene photos, not posters */
const SCENE_PHOTO_DOMAINS = [
  'cdn.getyourguide.com',
  'cdn.klook.com',
  'dynamic-media-cdn.tripadvisor.com',
  'i.ytimg.com',         // YouTube thumbnails
  'crowdpic.net',        // Stock photos
  'thumbnail.10x10.co.kr', // Product thumbnails
  'image.yes24.com',     // Book covers
]

/** Title keywords that indicate scene photos / reviews */
const SCENE_TITLE_KEYWORDS = [
  '현장', '후기', '리뷰', '방문기', '체험기', '다녀왔', '다녀와',
  '브이로그', 'vlog', '일상',
]

function isGoodUrl(url: string): boolean {
  if (BAD_URL_PATTERNS.some((p) => url.includes(p))) return false
  if (SCENE_PHOTO_DOMAINS.some((d) => url.includes(d))) return false
  return true
}

/** Extract year from URL path/filename */
function extractUrlYear(url: string): number | null {
  // Pattern 1: /2025/ (exact 4-digit year between slashes)
  const pathMatch = url.match(/\/(20\d{2})\//)
  if (pathMatch) return parseInt(pathMatch[1])

  // Pattern 2: /YYYYMMDD_ or /YYYYMM/ (pstatic, news photo paths)
  const ymMatch = url.match(/\/(20\d{2})\d{2,6}[_\-\/]/)
  if (ymMatch) return parseInt(ymMatch[1])

  // Pattern 3: _20240301 or -20250101 in filename
  const fileMatch = url.match(/[_\-\.](20\d{2})\d{4,}/)
  if (fileMatch) return parseInt(fileMatch[1])

  return null
}

/** Check if URL year is acceptable (2025 or 2026, or unknown) */
function isAcceptableYear(url: string): boolean {
  const year = extractUrlYear(url)
  if (year === null) return true // Unknown year is OK
  return year >= 2025
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

function isScenePhotoTitle(title: string): boolean {
  const clean = stripHtmlTags(title).toLowerCase()
  return SCENE_TITLE_KEYWORDS.some((kw) => clean.includes(kw))
}

async function searchPosters(query: string): Promise<NaverImageItem[]> {
  const imgUrl = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=10&sort=sim`
  const results = await fetchNaverSearch<NaverImageItem>(imgUrl)
  return (results || []).filter((img) => {
    const w = parseInt(img.sizewidth) || 0
    const h = parseInt(img.sizeheight) || 0
    if (w < 300 || h < 300) return false
    if (!isGoodUrl(img.link)) return false
    if (!isAcceptableYear(img.link)) return false
    if (isScenePhotoTitle(img.title)) return false
    return true
  })
}

/** Sort candidates: portrait images first (posters are typically portrait) */
function sortByPosterLikelihood(candidates: NaverImageItem[]): NaverImageItem[] {
  return [...candidates].sort((a, b) => {
    const ratioA = parseInt(a.sizeheight) / Math.max(parseInt(a.sizewidth), 1)
    const ratioB = parseInt(b.sizeheight) / Math.max(parseInt(b.sizewidth), 1)
    // Higher h/w ratio = more portrait = more poster-like
    return ratioB - ratioA
  })
}

async function validateWithGemini(
  eventName: string,
  venueName: string | null,
  venueAddress: string | null,
  candidates: NaverImageItem[]
): Promise<NaverImageItem | null> {
  if (candidates.length === 0) return null

  // Sort: portrait images first
  const sorted = sortByPosterLikelihood(candidates)

  const items = sorted.slice(0, 5).map((c, i) => {
    const year = extractUrlYear(c.link)
    const yearInfo = year ? ` [URL연도: ${year}]` : ''
    const w = parseInt(c.sizewidth)
    const h = parseInt(c.sizeheight)
    const orientation = h > w ? '세로형' : h === w ? '정방형' : '가로형'
    return {
      idx: i + 1,
      title: stripHtmlTags(c.title),
      w: c.sizewidth,
      h: c.sizeheight,
      yearInfo,
      orientation,
    }
  })

  // Extract region from venue address
  const region = venueAddress ? venueAddress.split(' ').slice(0, 2).join(' ') : null

  const prompt = `이벤트: "${eventName}"
장소: ${venueName || '미상'}
지역: ${region || '미상'}

아래 이미지 검색결과 중 이 이벤트의 **공식 포스터**를 골라주세요.

=== 부적합 (반드시 0 반환) ===
- 가로형(landscape) 이미지 = 현장 사진일 가능성 높음 → 제목에 "포스터"가 명시되지 않으면 부적합
- 제목에 다른 지역명 포함 (이벤트 지역: ${region || '서울/경기/인천'}) → 부적합
- 제목에 2024 이하 연도 포함 → 부적합
- 같은 공연이지만 다른 극장/시즌/회차 포스터 → 부적합
- 책 표지, 상품 사진, 인물 사진, YouTube 썸네일 → 부적합

=== 적합 ===
- 세로형(portrait) 디자인물: 텍스트+그래픽이 배치된 포스터/전단지/배너
- 이벤트명이 이미지 제목에 포함되어야 함

${items.map((i) => `${i.idx}. "${i.title}" (${i.w}x${i.h}, ${i.orientation})${i.yearInfo}`).join('\n')}

번호 하나만 답하세요 (없으면 0):`

  try {
    const response = await classifyWithGemini(prompt)
    const num = parseInt(response.trim())
    if (num >= 1 && num <= items.length) {
      return sorted[num - 1]
    }
    return null
  } catch {
    return null
  }
}

function buildQueries(name: string, venueName: string | null): string[] {
  const queries = [
    `${name} 2025 포스터`,
    `${name} 2026 포스터`,
    `${name} ${venueName || ''} 포스터`.trim(),
    `${name} 공식 포스터`,
  ]
  if (venueName) {
    queries.push(`${venueName} ${name}`)
  }
  return queries
}

async function main() {
  const { data: blogEvents } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, venue_address, poster_url, source')
    .eq('source', 'blog_discovery')
    .order('id', { ascending: true })

  const { data: exhibEvents } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, venue_address, poster_url, source')
    .eq('source', 'exhibition_extraction')
    .order('id', { ascending: true })

  const allEvents = [...(blogEvents || []), ...(exhibEvents || [])]
  console.log(`[poster-refresh] ${allEvents.length} events to process`)

  let updated = 0
  let cleared = 0
  let kept = 0

  for (const event of allEvents) {
    try {
      const queries = buildQueries(event.name, event.venue_name)
      let bestPoster: NaverImageItem | null = null

      for (const query of queries) {
        const candidates = await searchPosters(query)
        await new Promise((r) => setTimeout(r, 200))

        if (candidates.length === 0) continue

        bestPoster = await validateWithGemini(event.name, event.venue_name, event.venue_address, candidates)
        await new Promise((r) => setTimeout(r, 500))

        if (bestPoster) break
      }

      if (bestPoster?.link) {
        if (bestPoster.link === event.poster_url) {
          kept++
          console.log(`  [${event.id}] ${event.name} → kept`)
        } else {
          await supabaseAdmin
            .from('events')
            .update({ poster_url: bestPoster.link })
            .eq('id', event.id)
          updated++
          console.log(`  [${event.id}] ${event.name} → UPDATED: ${bestPoster.link}`)
        }
      } else {
        if (event.poster_url) {
          await supabaseAdmin
            .from('events')
            .update({ poster_url: null })
            .eq('id', event.id)
          cleared++
          console.log(`  [${event.id}] ${event.name} → CLEARED (no match)`)
        } else {
          console.log(`  [${event.id}] ${event.name} → already null`)
        }
      }

      await new Promise((r) => setTimeout(r, 200))
    } catch (err) {
      console.error(`  [${event.id}] Error:`, err)
    }
  }

  console.log(`\n[poster-refresh] Done: ${updated} updated, ${kept} kept, ${cleared} cleared to null`)
}

main()
