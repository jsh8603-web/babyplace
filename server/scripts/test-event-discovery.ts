/**
 * Test script: Naver blog search + blog-event-discovery dry-run
 *
 * 1. Search Naver blogs for specific exhibition keywords
 * 2. Run the full blog-event-discovery pipeline
 */
import { supabaseAdmin } from '../lib/supabase-admin'
import { fetchNaverSearch, stripHtml } from '../collectors/naver-blog'
import { runBlogEventDiscovery } from '../collectors/blog-event-discovery'

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog'

interface NaverBlogItem {
  title: string
  link: string
  description: string
  bloggername: string
  postdate?: string
}

async function searchBlogs(query: string, display = 10) {
  const url = `${NAVER_BLOG_URL}?query=${encodeURIComponent(query)}&display=${display}&sort=date`
  const items = await fetchNaverSearch<NaverBlogItem>(url)
  return items || []
}

async function main() {
  console.log('=== 1. 네이버 블로그 검색 테스트 ===\n')

  // Test search queries related to exhibition events
  const testQueries = [
    '인사센트럴뮤지엄',
    '위시캣 테마파크',
    '어린이 전시 서울 2026',
    '키즈 테마파크 서울',
    '캐릭터 전시 서울',
    '아기 팝업스토어 서울',
  ]

  for (const q of testQueries) {
    console.log(`\n--- 검색: "${q}" ---`)
    const items = await searchBlogs(q, 5)
    if (items.length === 0) {
      console.log('  (결과 없음)')
    }
    for (const item of items) {
      console.log(`  [${item.postdate}] ${stripHtml(item.title).substring(0, 70)}`)
      console.log(`    ${stripHtml(item.description).substring(0, 100)}`)
    }
  }

  // Check active events before
  const { data: eventsBefore } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, source, start_date, end_date')
    .eq('is_active', true)

  console.log(`\n\n=== 2. 현재 활성 이벤트: ${eventsBefore?.length || 0}건 ===`)
  for (const e of eventsBefore || []) {
    console.log(`  ${e.id} | ${e.name} | ${e.venue_name} | ${e.source}`)
  }

  console.log('\n\n=== 3. Blog Event Discovery 실행 ===\n')
  const result = await runBlogEventDiscovery()
  console.log('\n=== 실행 결과 ===')
  console.log(JSON.stringify(result, null, 2))

  // Check active events after
  const { data: eventsAfter } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, source, start_date, end_date, sub_category')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(30)

  console.log(`\n\n=== 4. 실행 후 활성 이벤트: ${eventsAfter?.length || 0}건 ===`)
  for (const e of eventsAfter || []) {
    console.log(`  ${e.id} | ${(e.name||'').substring(0,40)} | ${(e.venue_name||'').substring(0,20)} | ${e.source} | ${e.sub_category} | ${e.start_date}~${e.end_date}`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
