/**
 * S2-3: Refine classification FP/FN staging → classifier-config.json
 *
 *   --collect [--threshold N]   Gather unprocessed FP/FN staging (≥N) → Qwen input JSON
 *   --apply <qwen-output.json>  Merge refined patterns → config (version++ + changelog)
 *
 * Mirrors the S1 flow: this script only collects input / applies output —
 * the Qwen call itself uses scripts/qwen-prompts/classification-pattern-refine.txt.
 */
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const CONFIG_PATH = path.join(process.cwd(), 'server/config/classifier-config.json')
const QWEN_INPUT = path.join(process.cwd(), 'scripts/qwen-input/classification-patterns.json')

async function collect(threshold: number): Promise<void> {
  const { data, error } = await supabase
    .from('classification_blacklist_staging')
    .select('id, pattern, verdict, event_name, classifier_step')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
  if (error) { console.error('Error:', error.message); return }

  const rows = data || []
  if (rows.length < threshold) {
    console.log(`Unprocessed staging ${rows.length} < threshold ${threshold} — skip Qwen refine.`)
    return
  }

  const fp = rows.filter(r => r.verdict === 'fp')
  const fn = rows.filter(r => r.verdict === 'fn')
  fs.mkdirSync(path.dirname(QWEN_INPUT), { recursive: true })
  fs.writeFileSync(QWEN_INPUT, JSON.stringify({
    generated_at: new Date().toISOString().split('T')[0],
    total: rows.length,
    staging_ids: rows.map(r => r.id),
    fp_patterns: fp.map(r => ({ pattern: r.pattern, event_name: r.event_name, step: r.classifier_step })),
    fn_patterns: fn.map(r => ({ pattern: r.pattern, event_name: r.event_name, step: r.classifier_step })),
  }, null, 2))
  console.log(`Collected ${rows.length} staging rows (fp=${fp.length}, fn=${fn.length})`)
  console.log(`→ ${QWEN_INPUT}`)
  console.log('Next: run Qwen w/ scripts/qwen-prompts/classification-pattern-refine.txt, then --apply <output.json>')
}

interface QwenOutput {
  staging_ids?: number[]
  add_blacklist?: string[]
  add_whitelist?: string[]
}

async function apply(outputFile: string): Promise<void> {
  if (!fs.existsSync(outputFile)) { console.error(`Not found: ${outputFile}`); return }
  const out: QwenOutput = JSON.parse(fs.readFileSync(outputFile, 'utf-8'))
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

  const blSet = new Set<string>(cfg.blacklist_patterns)
  const wlSet = new Set<string>(cfg.whitelist_title_patterns)
  const addedBl = (out.add_blacklist || []).filter(p => p && !blSet.has(p))
  const addedWl = (out.add_whitelist || []).filter(p => p && !wlSet.has(p))

  if (addedBl.length === 0 && addedWl.length === 0) {
    console.log('No new patterns to merge (all duplicates or empty).')
  } else {
    cfg.blacklist_patterns.push(...addedBl)
    cfg.whitelist_title_patterns.push(...addedWl)
    cfg.version = (cfg.version || 0) + 1
    const today = new Date().toISOString().split('T')[0]
    cfg.updated_at = today
    cfg.changelog.unshift({
      version: cfg.version,
      date: today,
      change: `S2-3 자동 정제: blacklist +${addedBl.length}, whitelist +${addedWl.length} (staging ${out.staging_ids?.length || 0}건)`,
    })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n')
    console.log(`Config v${cfg.version}: +${addedBl.length} blacklist, +${addedWl.length} whitelist`)
    if (addedBl.length) console.log(`  blacklist: ${addedBl.join(', ')}`)
    if (addedWl.length) console.log(`  whitelist: ${addedWl.join(', ')}`)
  }

  if (out.staging_ids?.length) {
    const { error } = await supabase
      .from('classification_blacklist_staging')
      .update({ processed_at: new Date().toISOString() })
      .in('id', out.staging_ids)
    if (error) console.error('Staging update error:', error.message)
    else console.log(`Marked ${out.staging_ids.length} staging rows processed.`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const thIdx = args.indexOf('--threshold')
  const threshold = thIdx >= 0 ? parseInt(args[thIdx + 1]) || 50 : 50

  if (args.includes('--apply')) {
    const f = args[args.indexOf('--apply') + 1]
    if (!f) { console.error('Usage: --apply <qwen-output.json>'); return }
    await apply(f)
  } else if (args.includes('--collect')) {
    await collect(threshold)
  } else {
    console.log(`
S2-3 Classifier Pattern Refiner

  --collect [--threshold N]   Gather unprocessed FP/FN staging → Qwen input
  --apply <qwen-output.json>  Merge refined patterns → classifier-config.json
`)
  }
  setTimeout(() => process.exit(0), 50)
}

main()
