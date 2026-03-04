/**
 * One-time script: refresh poster images for all blog_discovery/exhibition_extraction events
 * - Multiple query strategies with Gemini validation + URL year check
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

function isGoodUrl(url: string): boolean {
  return !BAD_URL_PATTERNS.some((p) => url.includes(p))
}

/** Extract year from URL path/filename */
function extractUrlYear(url: string): number | null {
  // Pattern 1: /2025/ in path
  const pathMatch = url.match(/\/(20\d{2})\//)
  if (pathMatch) return parseInt(pathMatch[1])

  // Pattern 2: /20250301_ or /20250301_ (pstatic format: /YYYYMMDD_/)
  const pstaticMatch = url.match(/\/(20\d{2})\d{4}[_\-]/)
  if (pstaticMatch) return parseInt(pstaticMatch[1])

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

async function searchPosters(query: string): Promise<NaverImageItem[]> {
  const imgUrl = `${NAVER_IMAGE_URL}?query=${encodeURIComponent(query)}&display=10&sort=sim`
  const results = await fetchNaverSearch<NaverImageItem>(imgUrl)
  return (results || []).filter((img) => {
    const w = parseInt(img.sizewidth) || 0
    const h = parseInt(img.sizeheight) || 0
    return w >= 300 && h >= 300 && isGoodUrl(img.link) && isAcceptableYear(img.link)
  })
}

async function validateWithGemini(
  eventName: string,
  venueName: string | null,
  candidates: NaverImageItem[]
): Promise<NaverImageItem | null> {
  if (candidates.length === 0) return null

  const items = candidates.slice(0, 5).map((c, i) => {
    const year = extractUrlYear(c.link)
    const yearInfo = year ? ` [URL연도: ${year}]` : ''
    return {
      idx: i + 1,
      title: stripHtmlTags(c.title),
      w: c.sizewidth,
      h: c.sizeheight,
      yearInfo,
    }
  })

  const prompt = `이벤트: "${eventName}"${venueName ? ` (장소: ${venueName})` : ''}

아래 이미지 검색결과 중 이 이벤트의 공식 포스터/홍보 이미지로 가장 적합한 것을 골라주세요.

판단 기준 (엄격하게 적용):
1. 이벤트명이 이미지 제목에 직접 포함되거나 매우 유사해야 함
2. 2025~2026년 이벤트만 허용 — 제목이나 URL에 2024 이하 연도가 포함되면 부적합
3. 같은 이름이지만 다른 회차/시즌(예: "2024 포켓몬런" vs "2026 포켓몬런")은 부적합
4. 뉴스 기사 썸네일, 일반 사진, 블로그 스크린샷은 부적합
5. 포스터/전단지/홍보 배너 형태의 이미지만 적합
6. 관련 없는 캐릭터/제품/다른 행사 이미지는 부적합
7. 적합한 이미지가 하나도 없으면 반드시 0을 반환

${items.map((i) => `${i.idx}. "${i.title}" (${i.w}x${i.h})${i.yearInfo}`).join('\n')}

가장 적합한 번호만 답하세요 (숫자 하나, 없으면 0):`

  try {
    const response = await classifyWithGemini(prompt)
    const num = parseInt(response.trim())
    if (num >= 1 && num <= items.length) {
      return candidates[num - 1]
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
  // For events with venue, try venue-specific query
  if (venueName) {
    queries.push(`${venueName} ${name}`)
  }
  return queries
}

async function main() {
  const { data: blogEvents } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
    .eq('source', 'blog_discovery')
    .order('id', { ascending: true })

  const { data: exhibEvents } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, poster_url, source')
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

        bestPoster = await validateWithGemini(event.name, event.venue_name, candidates)
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
        // No valid poster found → clear to null (better than wrong image)
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
