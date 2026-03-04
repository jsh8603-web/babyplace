import { supabaseAdmin } from '../lib/supabase-admin'

async function analyze() {
  // Get places with tag 식품접객업소
  const { data: food } = await supabaseAdmin
    .from('places')
    .select('id, name, category, sub_category, tags')
    .contains('tags', ['식품접객업소'])
    .limit(10)
  console.log('=== Places with 식품접객업소 tag ===')
  food?.forEach(p => console.log(p.id, p.name, 'cat:', p.category, 'sub:', p.sub_category, 'tags:', p.tags))

  // Get all distinct tags used
  const { data: all } = await supabaseAdmin
    .from('places')
    .select('tags')
    .not('tags', 'eq', '{}')
    .limit(500)

  const tagCounts: Record<string, number> = {}
  all?.forEach(p => {
    if (p.tags) {
      for (const t of p.tags) {
        tagCounts[t] = (tagCounts[t] || 0) + 1
      }
    }
  })

  // Sort by count
  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])
  console.log('\n=== Tag distribution (top 30) ===')
  sorted.slice(0, 30).forEach(([tag, count]) => console.log('  ' + tag + ': ' + count))

  // Category distribution for places with tags
  const catCounts: Record<string, number> = {}
  const { data: withTags } = await supabaseAdmin
    .from('places')
    .select('category, tags')
    .not('tags', 'eq', '{}')
    .limit(1000)
  withTags?.forEach(p => {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1
  })
  console.log('\n=== Category distribution for tagged places ===')
  Object.entries(catCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => console.log('  ' + cat + ': ' + count))

  // Also check sub_category distribution for 식품접객업소
  const { data: subCat, count: subCount } = await supabaseAdmin
    .from('places')
    .select('id, name, category, sub_category, source, tags', { count: 'exact' })
    .eq('sub_category', '식품접객업소')
    .limit(10)
  console.log(`\n=== Places with sub_category='식품접객업소' (total: ${subCount}) ===`)
  subCat?.forEach(p => console.log(p.id, p.name, 'cat:', p.category, 'source:', p.source, 'tags:', p.tags))

  // Full sub_category distribution for children-facility source
  const { data: cfPlaces } = await supabaseAdmin
    .from('places')
    .select('sub_category')
    .eq('source', 'children-facility')
    .limit(5000)
  const subCatCounts: Record<string, number> = {}
  cfPlaces?.forEach(p => {
    subCatCounts[p.sub_category || '(null)'] = (subCatCounts[p.sub_category || '(null)'] || 0) + 1
  })
  console.log('\n=== sub_category distribution for source=children-facility ===')
  Object.entries(subCatCounts).sort((a, b) => b[1] - a[1]).forEach(([sc, count]) => console.log('  ' + sc + ': ' + count))
}

analyze()
