import { supabaseAdmin } from '../server/lib/supabase-admin'

async function main() {
  // Count current rows
  const { count } = await supabaseAdmin
    .from('llm_analyzed_urls')
    .select('*', { count: 'exact', head: true })
  console.log(`llm_analyzed_urls: ${count} rows`)

  // Delete all rows (url is TEXT PK, use neq to match all)
  const { error } = await supabaseAdmin
    .from('llm_analyzed_urls')
    .delete()
    .neq('url', '')

  if (error) {
    console.error('Delete error:', error)
  } else {
    console.log('Cleared all rows from llm_analyzed_urls')
  }

  // Verify
  const { count: after } = await supabaseAdmin
    .from('llm_analyzed_urls')
    .select('*', { count: 'exact', head: true })
  console.log(`After: ${after} rows`)
}

main()
