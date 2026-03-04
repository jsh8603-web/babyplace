import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // 1. Check all events (without is_active filter)
  const { data: allEvents, error: e1 } = await supabase
    .from('events')
    .select('id, name, venue_name, venue_address, lat, lng, source, source_id, start_date, end_date, sub_category, is_active, created_at')
    .eq('source', 'blog_discovery')
    .order('created_at', { ascending: false })
    .limit(80)

  if (e1) console.error('Error:', e1)
  console.log(`=== blog_discovery 이벤트 (${allEvents?.length || 0}건) ===`)
  let wishcatFound = false
  for (const e of allEvents || []) {
    const marker = (e.name || '').includes('위시캣') || (e.venue_name || '').includes('인사센트럴') ? ' ★★★' : ''
    if (marker) wishcatFound = true
    console.log(`${e.id} | active:${e.is_active} | ${(e.name||'').substring(0,40)} | ${(e.venue_name||'').substring(0,25)} | ${e.sub_category} | ${e.start_date}~${e.end_date} | lat:${e.lat}${marker}`)
  }

  if (!wishcatFound) {
    console.log('\n★ 위시캣/인사센트럴 관련 이벤트 발견 안됨!')
  }

  // 2. Check place 2507
  const { data: place } = await supabase
    .from('places')
    .select('*')
    .eq('id', 2507)
    .single()

  console.log('\n=== Place #2507 ===')
  console.log(JSON.stringify(place, null, 2))

  // 3. Check events table columns
  const { data: sample, error: e3 } = await supabase
    .from('events')
    .select('*')
    .limit(1)

  if (sample && sample.length > 0) {
    console.log('\n=== events 테이블 컬럼 ===')
    console.log(Object.keys(sample[0]).join(', '))
  } else {
    console.log('\n=== events 테이블 빈 상태, 에러:', e3)
  }

  // 4. Count by is_active
  const { count: activeCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const { count: inactiveCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', false)

  const { count: totalCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })

  console.log(`\n=== 이벤트 통계 ===`)
  console.log(`total: ${totalCount}, active: ${activeCount}, inactive: ${inactiveCount}`)

  // 5. Check if 위시캣 exists in any keyword search results
  const { data: wishcatEvents } = await supabase
    .from('events')
    .select('id, name, venue_name, source')
    .or('name.ilike.%위시캣%,venue_name.ilike.%인사센트럴%,name.ilike.%인사센트럴%')

  console.log(`\n=== 위시캣/인사센트럴 이벤트 검색: ${wishcatEvents?.length || 0}건 ===`)
  for (const e of wishcatEvents || []) {
    console.log(`  ${e.id} | ${e.name} | ${e.venue_name} | ${e.source}`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
