import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
async function main() {
  const today = new Date().toISOString().split('T')[0]
  const {data} = await supabase.from('events').select('name, source_url, source, poster_url').or(`end_date.gte.${today},end_date.is.null`).neq('source','seoul_events')
  console.log('Total non-seoul events:', data?.length)
  const withSrc = data?.filter(e => e.source_url)
  console.log('With source_url:', withSrc?.length)
  withSrc?.forEach(e => console.log('  ', e.name, '→', e.source_url?.substring(0, 100)))
  console.log('\n--- No source_url ---')
  data?.filter(e => !e.source_url).forEach(e => console.log('  ', e.name, '[' + e.source + ']'))
}
main()
