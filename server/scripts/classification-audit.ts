/**
 * Classification audit CLI — review event baby-relevance classification.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/classification-audit.ts --sample-included
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/classification-audit.ts --sample-excluded
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/classification-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/classification-audit.ts --summary
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { getBlacklistMatch, getWhitelistMatch } from '../utils/event-classifier'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'classifier-config.json')

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return { version: 0 }
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function sampleIncluded(count = 20): Promise<void> {
  const config = loadConfig()

  // Sample active events (included by classifier — currently in DB)
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('events')
    .select('id, name, source, age_range')
    .or(`end_date.gte.${today},end_date.is.null`)
    .order('created_at', { ascending: false })
    .limit(count * 2)

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) { console.log('No active events found.'); return }

  // Check existing audits
  const eventIds = data.map((d: any) => d.id)
  const { data: existing } = await supabase
    .from('classification_audit_log')
    .select('event_id')
    .in('event_id', eventIds)

  const existingSet = new Set((existing || []).map((a: any) => a.event_id))

  let sampled = 0
  for (const ev of data) {
    if (existingSet.has(ev.id)) continue
    if (sampled >= count) break

    // Determine classifier step (heuristic — check patterns)
    const { step, matchedPattern } = detectClassifierStep(ev.name, ev.age_range)

    const { error: insertErr } = await supabase.from('classification_audit_log').insert({
      event_id: ev.id,
      event_name: ev.name,
      event_source: ev.source,
      use_target: ev.age_range,
      classifier_step: step,
      classifier_decision: 'included',
      prompt_version: config.version,
      matched_pattern: matchedPattern,
    })

    if (!insertErr) sampled++
  }

  console.log(`Sampled ${sampled} included events for classification audit`)
}

async function sampleExcluded(count = 20): Promise<void> {
  const config = loadConfig()

  // Sample events from excluded_events table (events that were filtered out by classifier)
  const { data: excludedData, error: excludedErr } = await supabase
    .from('excluded_events')
    .select('id, name, source, use_target, classifier_step, matched_pattern')
    .order('created_at', { ascending: false })
    .limit(count * 2)

  if (!excludedErr && excludedData && excludedData.length > 0) {
    const eventIds = excludedData.map((d: any) => d.id)
    const { data: existing } = await supabase
      .from('classification_audit_log')
      .select('event_id')
      .in('event_id', eventIds)

    const existingSet = new Set((existing || []).map((a: any) => a.event_id))

    let sampled = 0
    for (const ev of excludedData) {
      if (existingSet.has(ev.id)) continue
      if (sampled >= count) break

      const { error: insertErr } = await supabase.from('classification_audit_log').insert({
        event_id: ev.id,
        event_name: ev.name,
        event_source: ev.source,
        use_target: ev.use_target,
        classifier_step: ev.classifier_step || 'unknown',
        classifier_decision: 'excluded',
        prompt_version: config.version,
        matched_pattern: ev.matched_pattern || null,
      })

      if (!insertErr) sampled++
    }

    if (sampled > 0) {
      console.log(`Sampled ${sampled} excluded events from excluded_events table`)
      return
    }
  }

  // Fallback: sample expired events from events table
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('events')
    .select('id, name, source, age_range')
    .lt('end_date', today)
    .order('created_at', { ascending: false })
    .limit(count * 2)

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) { console.log('No excluded events found.'); return }

  const eventIds = data.map((d: any) => d.id)
  const { data: existing } = await supabase
    .from('classification_audit_log')
    .select('event_id')
    .in('event_id', eventIds)

  const existingSet = new Set((existing || []).map((a: any) => a.event_id))

  let sampled = 0
  for (const ev of data) {
    if (existingSet.has(ev.id)) continue
    if (sampled >= count) break

    const { step, matchedPattern } = detectClassifierStep(ev.name, ev.age_range)

    const { error: insertErr } = await supabase.from('classification_audit_log').insert({
      event_id: ev.id,
      event_name: ev.name,
      event_source: ev.source,
      use_target: ev.age_range,
      classifier_step: step,
      classifier_decision: 'excluded',
      prompt_version: config.version,
      matched_pattern: matchedPattern,
    })

    if (!insertErr) sampled++
  }

  console.log(`Sampled ${sampled} excluded events for classification audit`)
}

function detectClassifierStep(name: string, useTarget?: string): { step: string; matchedPattern: string | null } {
  const blMatch = getBlacklistMatch(useTarget || '', name)
  if (blMatch) return { step: 'blacklist', matchedPattern: blMatch }

  const wlMatch = getWhitelistMatch(useTarget || '', name)
  if (wlMatch) return { step: 'whitelist', matchedPattern: wlMatch }

  return { step: 'llm', matchedPattern: null }
}

async function listPending(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('classification_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('classification_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Classification Audit — Pending (${count ?? data?.length ?? 0}건) ===\n`)

  for (const row of data || []) {
    const tag = row.classifier_decision === 'included' ? 'INCLUDED' : 'EXCLUDED'
    console.log(`[${tag}] audit_id=${row.id} event=${row.event_id} (${row.event_source})`)
    console.log(`  Name: "${row.event_name}"`)
    console.log(`  Target: ${row.use_target || '(none)'}`)
    console.log(`  Step: ${row.classifier_step}${row.matched_pattern ? ` — ${row.matched_pattern}` : ''}`)
    console.log('')
  }
}

async function showSummary(): Promise<void> {
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected']) {
    const { count } = await supabase
      .from('classification_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Classification Audit Summary ===`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}`)

  // Verdict distribution
  const { data: verdictRows } = await supabase
    .from('classification_audit_log')
    .select('audit_verdict, classifier_step, classifier_decision')
    .neq('audit_status', 'pending')

  if (verdictRows && verdictRows.length > 0) {
    const stats: Record<string, Record<string, number>> = {}
    for (const r of verdictRows) {
      const key = `${r.classifier_decision}/${r.classifier_step}`
      if (!stats[key]) stats[key] = {}
      const v = r.audit_verdict || 'unknown'
      stats[key][v] = (stats[key][v] || 0) + 1
    }
    console.log('\nBy decision/step:')
    for (const [key, counts] of Object.entries(stats)) {
      console.log(`  ${key}: ${JSON.stringify(counts)}`)
    }
  }
  console.log('')
}

async function setVerdict(auditId: number, verdict: string, note?: string): Promise<void> {
  const update: Record<string, any> = { audit_verdict: verdict, audit_status: 'approved' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('classification_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Set audit #${auditId} → ${verdict}${note ? ` (${note})` : ''}`)
}

async function showPatterns(): Promise<void> {
  const { data: fpRows } = await supabase
    .from('classification_audit_log')
    .select('event_name, classifier_step, use_target')
    .eq('audit_verdict', 'false_positive')

  const { data: fnRows } = await supabase
    .from('classification_audit_log')
    .select('event_name, classifier_step, use_target')
    .eq('audit_verdict', 'false_negative')

  console.log(`\n=== Classification Error Patterns ===\n`)

  if (fpRows && fpRows.length > 0) {
    console.log(`False Positives (${fpRows.length}건 — 잘못 포함):`)
    for (const r of fpRows.slice(0, 10)) {
      console.log(`  "${r.event_name}" (step=${r.classifier_step}, target=${r.use_target || 'none'})`)
    }
    console.log('')
  }

  if (fnRows && fnRows.length > 0) {
    console.log(`False Negatives (${fnRows.length}건 — 잘못 제외):`)
    for (const r of fnRows.slice(0, 10)) {
      console.log(`  "${r.event_name}" (step=${r.classifier_step}, target=${r.use_target || 'none'})`)
    }
    console.log('')
  }

  if ((!fpRows || fpRows.length === 0) && (!fnRows || fnRows.length === 0)) {
    console.log('No error patterns found yet.')
  }
}

function showConfig(): void {
  const config = loadConfig()
  console.log(`\n=== Classifier Config ===`)
  console.log(`Version: ${config.version}`)
  console.log(`Updated: ${config.updated_at}`)
  console.log(`Blacklist patterns: ${config.blacklist_patterns?.length ?? 0}`)
  console.log(`Whitelist patterns: ${config.whitelist_title_patterns?.length ?? 0}`)
  console.log(`\nChangelog:`)
  for (const entry of config.changelog || []) {
    console.log(`  v${entry.version} (${entry.date}): ${entry.change}`)
  }
  console.log('')
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--sample-included')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 20 : 20
    await sampleIncluded(count)
  } else if (args.includes('--sample-excluded')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 20 : 20
    await sampleExcluded(count)
  } else if (args.includes('--list')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listPending(limit)
  } else if (args.includes('--summary')) {
    await showSummary()
  } else if (args.includes('--correct')) {
    const idx = args.indexOf('--correct')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --correct <audit_id>'); return }
    await setVerdict(id, 'correct')
  } else if (args.includes('--false-positive')) {
    const idx = args.indexOf('--false-positive')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --false-positive <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'false_positive', note)
  } else if (args.includes('--false-negative')) {
    const idx = args.indexOf('--false-negative')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --false-negative <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'false_negative', note)
  } else if (args.includes('--patterns')) {
    await showPatterns()
  } else if (args.includes('--config')) {
    showConfig()
  } else {
    console.log(`
Classification Audit CLI

Commands:
  --sample-included [--count N]  Sample included events for false positive check
  --sample-excluded [--count N]  Sample excluded events for false negative check
  --list [--limit N]             Pending audit entries
  --summary                      Statistics
  --correct <audit_id>           Mark classification as correct
  --false-positive <audit_id>    Incorrectly included (should be excluded)
  --false-negative <audit_id>    Incorrectly excluded (should be included)
  --patterns                     Analyze error patterns
  --config                       Show classifier config
`)
  }

  process.exit(0)
}

main()
