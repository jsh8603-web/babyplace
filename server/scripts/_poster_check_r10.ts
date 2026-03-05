import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  const ids = [8537,8541,8544,8556,8559,8560,8561,8563,8568,8569,8577,8581,8585,8587,8589,8590,8594,8596,8598,8608,8613,8614,8615,8616,8624,8632,8635,8636,8649,8660,8661,8662,8663,8665,8668,8673,8680,8681,8682,8685,8689,8694,8696]
  const { data } = await supabaseAdmin.from('events').select('id, name, poster_url').in('id', ids).order('id')
  if (!data) return
  for (const e of data) {
    if (!e.poster_url) continue
    let domain = ''
    try { domain = new URL(e.poster_url).hostname } catch { domain = 'invalid' }
    console.log(`[${e.id}] ${domain} | ${e.name}`)
    console.log(`  ${e.poster_url}`)
  }
}
main().catch(console.error)
