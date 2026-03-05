import { supabaseAdmin } from '../lib/supabase-admin'

async function check() {
  // 1. broken text - search for replacement characters
  const { data: broken } = await supabaseAdmin.from('places').select('id, name, source, category').like('name', '%◆%').eq('is_active', true)
  console.log('=== BROKEN TEXT ===')
  if (broken) for (const p of broken) console.log(p.id, p.name, '|', p.source, '|', p.category)
  if (!broken?.length) console.log('(none found with ◆)')

  // 2. short park names
  const { data: allParks } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').in('category', ['공원/놀이터']).eq('is_active', true)
  const short = (allParks || []).filter((p: any) => p.name.length <= 3)
  console.log('\n=== SHORT PARK NAMES (<=3 chars) ===')
  for (const p of short) console.log(p.id, JSON.stringify(p.name), '|', p.source, '|', p.sub_category)

  // Also check 4 chars to catch "직녀", "견우" etc
  const shortish = (allParks || []).filter((p: any) => p.name.length <= 4 && !p.name.includes('공원') && !p.name.includes('놀이'))
  console.log('\n=== SHORT-ISH PARK NAMES (<=4 chars, no 공원/놀이) ===')
  for (const p of shortish) console.log(p.id, JSON.stringify(p.name), '|', p.source, '|', p.sub_category)

  // 3. institutional names  
  const { data: o1 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%협회%')
  const { data: o2 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%연구소%')
  const { data: o3 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%연구원%')
  const { data: o4 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%학회%')
  const { data: o5 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%사이즈코리아%')
  const { data: o6 } = await supabaseAdmin.from('places').select('id, name, source, category, sub_category').eq('is_active', true).like('name', '%센터%')
  const orgs = [...(o1||[]), ...(o2||[]), ...(o3||[]), ...(o4||[]), ...(o5||[])]
  console.log('\n=== INSTITUTIONAL (협회/연구소/연구원/학회/사이즈코리아) ===')
  for (const p of orgs) console.log(p.id, p.name, '|', p.source, '|', p.category, '|', p.sub_category)
  
  // 센터 names - only show non-baby ones
  const centers = (o6||[]).filter((p: any) => !/키즈|어린이|유아|베이비|아기|아동|육아|보육|장난감|놀이|도서/i.test(p.name))
  console.log('\n=== CENTERS (non-baby-related) ===')
  for (const p of centers) console.log(p.id, p.name, '|', p.source, '|', p.category, '|', p.sub_category)
}
check().then(() => process.exit(0))
