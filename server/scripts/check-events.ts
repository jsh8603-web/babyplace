import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // 1. 전시/체험 장소
  const { data: places, error: e1 } = await supabase
    .from('places')
    .select('id, name, category, sub_category, address, mention_count')
    .or('category.eq.전시/체험,name.ilike.%뮤지엄%,name.ilike.%전시%,name.ilike.%박물관%,name.ilike.%미술관%')
    .eq('is_active', true)
    .order('mention_count', { ascending: false })
    .limit(30)

  if (e1) console.error('places error:', e1)
  console.log('\n=== 전시/체험 장소 (' + (places?.length || 0) + '건) ===')
  for (const p of places || []) {
    console.log(`${p.id} | ${p.name} | ${p.category} | mentions:${p.mention_count} | ${(p.address || '').substring(0, 35)}`)
  }

  // 2. 활성 이벤트
  const { data: events, error: e2 } = await supabase
    .from('events')
    .select('id, name, venue, category, sub_category, source, start_date, end_date')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(30)

  if (e2) console.error('events error:', e2)
  console.log('\n=== 활성 이벤트 (' + (events?.length || 0) + '건) ===')
  for (const e of events || []) {
    console.log(`${e.id} | ${(e.name||'').substring(0,40)} | ${(e.venue||'').substring(0,20)} | ${e.source} | ${e.start_date}~${e.end_date}`)
  }

  // 3. 문화행사 키워드
  const { data: keywords, error: e3 } = await supabase
    .from('keywords')
    .select('id, keyword, status')
    .eq('keyword_group', '문화행사')
    .eq('provider', 'naver')

  if (e3) console.error('keywords error:', e3)
  console.log('\n=== 문화행사 키워드 (' + (keywords?.length || 0) + '건) ===')
  for (const k of keywords || []) {
    console.log(`${k.id} | ${k.keyword} | ${k.status}`)
  }

  // 4. 인사센트럴뮤지엄 관련 blog_mentions
  const { data: mentions, error: e4 } = await supabase
    .from('blog_mentions')
    .select('id, place_id, title, snippet, relevance_score, collected_at, post_date')
    .or('title.ilike.%인사센트럴%,title.ilike.%위시캣%,snippet.ilike.%인사센트럴%,snippet.ilike.%위시캣%')
    .order('collected_at', { ascending: false })
    .limit(20)

  if (e4) console.error('mentions error:', e4)
  console.log('\n=== 인사센트럴/위시캣 블로그 언급 (' + (mentions?.length || 0) + '건) ===')
  for (const m of mentions || []) {
    console.log(`${m.id} | place:${m.place_id} | rel:${m.relevance_score} | ${(m.title||'').substring(0,50)} | ${m.post_date || m.collected_at}`)
  }

  // 5. 전시 장소의 최근 blog_mentions (이벤트 추출 가능성 확인)
  if (places && places.length > 0) {
    const topPlaceIds = places.filter(p => p.mention_count > 0).slice(0, 10).map(p => p.id)
    if (topPlaceIds.length > 0) {
      const { data: recentMentions } = await supabase
        .from('blog_mentions')
        .select('id, place_id, title, snippet, relevance_score, post_date')
        .in('place_id', topPlaceIds)
        .gte('relevance_score', 0.3)
        .order('post_date', { ascending: false })
        .limit(30)

      console.log('\n=== 전시 장소 최근 블로그 포스팅 (rel>=0.3, ' + (recentMentions?.length || 0) + '건) ===')
      const placeMap = Object.fromEntries(places.map(p => [p.id, p.name]))
      for (const m of recentMentions || []) {
        console.log(`${placeMap[m.place_id] || m.place_id} | rel:${m.relevance_score} | ${(m.title||'').substring(0,55)} | ${m.post_date}`)
      }
    }
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
