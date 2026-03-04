import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // 1. 전체 blog_discovery 이벤트
  const { data: events } = await supabase
    .from('events')
    .select('id, name, venue_name, venue_address, lat, lng, sub_category, start_date, end_date, source, source_id')
    .eq('source', 'blog_discovery')
    .order('id', { ascending: false })

  console.log(`=== blog_discovery 이벤트 전체 (${events?.length || 0}건) ===`)
  const subCategoryCounts: Record<string, number> = {}
  for (const e of events || []) {
    const sc = e.sub_category || 'null'
    subCategoryCounts[sc] = (subCategoryCounts[sc] || 0) + 1
    console.log(`${e.id} | ${(e.name||'').padEnd(35)} | ${(e.venue_name||'').padEnd(20)} | ${sc} | ${e.start_date}~${e.end_date} | lat:${e.lat ? 'Y' : 'N'} | ${(e.venue_address||'').substring(0,30)}`)
  }
  console.log('\n--- sub_category 분포 ---')
  for (const [k, v] of Object.entries(subCategoryCounts)) {
    console.log(`  ${k}: ${v}건`)
  }

  // 2. 전시/체험 장소 중 blog_mentions 많은 곳 + 해당 이벤트 존재 여부
  const { data: exhibPlaces } = await supabase
    .from('places')
    .select('id, name, category, mention_count, address')
    .or('category.eq.전시/체험,name.ilike.%뮤지엄%,name.ilike.%박물관%,name.ilike.%미술관%,name.ilike.%전시관%')
    .eq('is_active', true)
    .gte('mention_count', 5)
    .order('mention_count', { ascending: false })
    .limit(20)

  console.log(`\n=== 전시/체험 장소 (mention>=5, ${exhibPlaces?.length || 0}건) ===`)
  for (const p of exhibPlaces || []) {
    // Check if any event mentions this place
    const matchingEvents = (events || []).filter(e =>
      e.venue_name && (
        e.venue_name.includes(p.name) ||
        p.name.includes(e.venue_name) ||
        (p.address && e.venue_address && e.venue_address.includes(p.address.substring(0, 10)))
      )
    )
    const eventStatus = matchingEvents.length > 0
      ? `✅ ${matchingEvents.length}건 (${matchingEvents.map(e => e.name.substring(0, 15)).join(', ')})`
      : '❌ 이벤트 없음'
    console.log(`  ${p.id} | ${p.name.padEnd(20)} | mentions:${p.mention_count} | ${eventStatus}`)
  }

  // 3. 전시 관련 장소의 최근 blog_mentions 샘플 (이벤트 정보 포함된 포스팅 확인)
  if (exhibPlaces && exhibPlaces.length > 0) {
    const topIds = exhibPlaces.slice(0, 5).map(p => p.id)
    console.log(`\n=== 상위 전시 장소 최근 포스팅 (${topIds.join(',')}) ===`)
    for (const pid of topIds) {
      const place = exhibPlaces.find(p => p.id === pid)!
      const { data: mentions } = await supabase
        .from('blog_mentions')
        .select('title, snippet, relevance_score, post_date')
        .eq('place_id', pid)
        .order('post_date', { ascending: false, nullsFirst: false })
        .limit(5)

      console.log(`\n  --- ${place.name} (id:${pid}, mentions:${place.mention_count}) ---`)
      for (const m of mentions || []) {
        const hasEventKeywords = /전시|체험|축제|공연|이벤트|팝업|테마파크|페스티벌|뮤지컬|인형극/.test(m.title + ' ' + m.snippet)
        console.log(`  ${hasEventKeywords ? '🎪' : '  '} [rel:${m.relevance_score}] ${(m.title||'').substring(0,50)} | ${m.post_date || 'null'}`)
      }
    }
  }

  // 4. venue_name 기준으로 실제 places에 매칭 안되는 이벤트 (orphan events)
  const eventsWithoutPlace = (events || []).filter(e => !e.lat)
  console.log(`\n=== Kakao 좌표 없는 이벤트: ${eventsWithoutPlace.length}건 ===`)
  for (const e of eventsWithoutPlace.slice(0, 15)) {
    console.log(`  ${e.id} | ${e.name} | ${e.venue_name} | ${e.venue_address || 'addr없음'}`)
  }

  // 5. 모든 source별 이벤트 수
  const { data: allEvents } = await supabase
    .from('events')
    .select('source')

  const sourceCounts: Record<string, number> = {}
  for (const e of allEvents || []) {
    sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1
  }
  console.log(`\n=== 전체 이벤트 source별 분포 ===`)
  for (const [k, v] of Object.entries(sourceCounts)) {
    console.log(`  ${k}: ${v}건`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
