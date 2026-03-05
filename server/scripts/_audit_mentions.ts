import { createClient } from '@supabase/supabase-js'

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

async function main() {
  // 1. 청기와타운 왕십리점 blog_mentions 확인
  const { data: places } = await s.from('places').select('id, name, address, road_address').ilike('name', '%청기와타운%')
  console.log('=== 청기와타운 places ===')
  for (const p of places || []) console.log(`id:${p.id} | ${p.name} | ${p.address}`)

  if (!places || places.length === 0) return

  for (const place of places) {
    const { data: mentions } = await s.from('blog_mentions')
      .select('id, title, url, relevance_score, post_date')
      .eq('place_id', place.id)
      .order('post_date', { ascending: false })

    console.log(`\n=== ${place.name} (id:${place.id}) — ${(mentions||[]).length} mentions ===`)
    for (const m of mentions || []) {
      console.log(`  [${m.relevance_score?.toFixed(2)}] ${m.title?.slice(0,60)} | ${m.post_date}`)
    }
  }
}
main()
