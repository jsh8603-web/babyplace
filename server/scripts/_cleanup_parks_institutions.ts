/**
 * DB cleanup: fix park names, broken text, and institutional places.
 * Run: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_cleanup_parks_institutions.ts
 */
import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  // 1. Fix short park names (prefix only → append 어린이공원)
  const { data: parks, error: e1 } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .eq('source', 'public-data-go.kr')
    .eq('sub_category', '어린이공원')
    .eq('is_active', true)
    .not('name', 'like', '%공원%')

  if (e1) {
    console.error('Query error:', e1)
    return
  }
  console.log('Short park names found:', parks?.length)

  let parkFixed = 0
  for (const p of parks || []) {
    const { error } = await supabaseAdmin
      .from('places')
      .update({ name: p.name + ' 어린이공원' })
      .eq('id', p.id)
    if (!error) parkFixed++
  }
  console.log('Park names fixed:', parkFixed)

  // 2. Find and delete broken text entries (mojibake)
  const { data: broken } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .or('name.like.%��%,name.like.%◆◆%')

  console.log(
    'Broken text entries:',
    broken?.length,
    broken?.map((b) => b.name)
  )

  if (broken && broken.length > 0) {
    const ids = broken.map((b) => b.id)
    const { error } = await supabaseAdmin.from('places').delete().in('id', ids)
    console.log('Deleted broken:', error ? error.message : ids.length)
  }

  // 3. Deactivate institutional places by name
  const instPatterns = [
    '물류센터',
    '데이터센터',
    '행정복지센터',
    '관광안내소',
    '무인민원발급',
    '자전거인증센터',
    '국방벤처',
    '미디어센터',
    '삼성전자서비스',
    'LG전자서비스',
    '한국건강관리협회',
    '사이즈코리아',
  ]

  const babyRe = /키즈|어린이|유아|베이비|아기|아동|육아|키움|돌봄|놀이/

  let instDeactivated = 0
  for (const pat of instPatterns) {
    const { data: matches } = await supabaseAdmin
      .from('places')
      .select('id, name')
      .eq('is_active', true)
      .like('name', `%${pat}%`)

    if (!matches || matches.length === 0) continue
    const toDeactivate = matches.filter((m) => !babyRe.test(m.name))

    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map((m) => m.id)
      await supabaseAdmin.from('places').update({ is_active: false }).in('id', ids)
      instDeactivated += toDeactivate.length
      console.log(
        `Deactivated ${pat}:`,
        toDeactivate.length,
        toDeactivate.map((m) => m.name)
      )
    }
  }
  console.log('Total institutional deactivated:', instDeactivated)

  // 4. Deactivate by sub_category (단체,협회 etc.)
  const catPatterns = ['단체,협회', '협회,단체', '사회단체', '시민단체']
  let catDeactivated = 0
  for (const cat of catPatterns) {
    const { data: matches } = await supabaseAdmin
      .from('places')
      .select('id, name')
      .eq('is_active', true)
      .eq('sub_category', cat)

    if (!matches || matches.length === 0) continue
    const toDeactivate = matches.filter((m) => !babyRe.test(m.name))

    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map((m) => m.id)
      await supabaseAdmin.from('places').update({ is_active: false }).in('id', ids)
      catDeactivated += toDeactivate.length
      console.log(
        `Deactivated sub_category=${cat}:`,
        toDeactivate.length,
        toDeactivate.map((m) => m.name)
      )
    }
  }
  console.log('Total category deactivated:', catDeactivated)

  // 5. Deactivate 연구소 (except baby-relevant)
  const { data: labMatches } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .eq('is_active', true)
    .eq('sub_category', '연구소')

  if (labMatches && labMatches.length > 0) {
    const toDeactivate = labMatches.filter((m) => !babyRe.test(m.name))
    if (toDeactivate.length > 0) {
      const ids = toDeactivate.map((m) => m.id)
      await supabaseAdmin.from('places').update({ is_active: false }).in('id', ids)
      console.log(
        'Deactivated 연구소:',
        toDeactivate.length,
        toDeactivate.map((m) => m.name)
      )
    }
  }

  console.log('\nDone!')
}

main().catch(console.error)
