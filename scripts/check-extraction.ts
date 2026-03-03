import { supabaseAdmin } from '../server/lib/supabase-admin'

async function main() {
  // Check extraction results
  const { count, error } = await supabaseAdmin
    .from('llm_extraction_results')
    .select('*', { count: 'exact', head: true })
  console.log('llm_extraction_results count:', count, error?.message ?? '')

  if (count && count > 0) {
    const { data } = await supabaseAdmin
      .from('llm_extraction_results')
      .select('batch_id')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    console.log('Latest batch_id:', data?.batch_id)
  }

  // DB match score distribution from logs
  console.log('\n--- DB match score distribution (from v2 log) ---')

  // Kakao similarity distribution on recent candidates
  const { data: candidates } = await supabaseAdmin
    .from('place_candidates')
    .select('kakao_similarity, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  if (candidates) {
    const scores = candidates.map(c => c.kakao_similarity).filter(Boolean) as number[]
    const ranges: Record<string, number> = {
      '0.70-0.75': 0, '0.75-0.80': 0, '0.80-0.85': 0, '0.85-0.90': 0, '0.90-1.00': 0
    }
    for (const s of scores) {
      if (s < 0.75) ranges['0.70-0.75']++
      else if (s < 0.80) ranges['0.75-0.80']++
      else if (s < 0.85) ranges['0.80-0.85']++
      else if (s < 0.90) ranges['0.85-0.90']++
      else ranges['0.90-1.00']++
    }
    console.log('Kakao similarity (latest 500 candidates):', JSON.stringify(ranges, null, 2))
  }
}

main().catch(console.error)
