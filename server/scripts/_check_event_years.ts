import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('id, name, start_date, end_date, source')
    .order('id')

  if (error) { console.error(error); return }
  if (!data) { console.log('no data'); return }

  const cy = new Date().getFullYear()
  const past = data.filter(e => e.start_date && parseInt(e.start_date.substring(0, 4)) < cy)

  console.log(`Past year events (start_date year < ${cy}): ${past.length}`)
  for (const e of past) {
    console.log(`  [${e.id}] ${e.source} | ${e.start_date} ~ ${e.end_date || 'null'} | ${e.name}`)
  }

  const noDate = data.filter(e => !e.start_date)
  console.log(`\nEvents without start_date: ${noDate.length}`)
  for (const e of noDate.slice(0, 10)) {
    console.log(`  [${e.id}] ${e.source} | ${e.name}`)
  }

  console.log(`\nTotal: ${data.length}`)
}
main().catch(console.error)
