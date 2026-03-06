/**
 * Mention audit CLI — review blog ↔ place matching quality.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --sample
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --summary
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --correct 123
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --wrong-match 123
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/mention-audit.ts --exclude 456
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { computePostRelevanceDetailed, parseAddressComponents } from '../utils/relevance'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'mention-relevance-config.json')


function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return { version: 0 }
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function sampleMentions(count = 30): Promise<void> {
  const config = loadConfig()

  // Stratified sampling: high≥0.7 20%, medium 0.5~0.7 40%, border 0.4~0.5 30%, low<0.4 10%
  const strata = [
    { label: 'high (≥0.7)', gte: 0.7, lt: undefined as number | undefined, ratio: 0.2 },
    { label: 'medium (0.5~0.7)', gte: 0.5, lt: 0.7, ratio: 0.4 },
    { label: 'border (0.4~0.5)', gte: 0.4, lt: 0.5, ratio: 0.3 },
    { label: 'low (<0.4)', gte: undefined as number | undefined, lt: 0.4, ratio: 0.1 },
  ]

  let sampled = 0

  for (const stratum of strata) {
    const stratumCount = Math.max(1, Math.round(count * stratum.ratio))

    let query = supabase
      .from('blog_mentions')
      .select('id, place_id, title, url, snippet, relevance_score, source_type, post_date, places!inner(id, name, address, is_common_name)')
      .eq('mention_locked', false)

    if (stratum.gte !== undefined) query = query.gte('relevance_score', stratum.gte)
    if (stratum.lt !== undefined) query = query.lt('relevance_score', stratum.lt)

    const { data, error } = await query
      .order('id', { ascending: false })
      .limit(stratumCount)

    if (error) { console.error(`Error sampling ${stratum.label}:`, error.message); continue }
    if (!data || data.length === 0) continue

    // Check which mentions already have audit entries
    const mentionIds = data.map((d: any) => d.id)
    const { data: existingAudits } = await supabase
      .from('mention_audit_log')
      .select('mention_id')
      .in('mention_id', mentionIds)

    const existingSet = new Set((existingAudits || []).map((a: any) => a.mention_id))

    for (const row of data) {
      if (existingSet.has(row.id)) continue

      const place = (row as any).places
      // Compute relevance breakdown for audit context
      let relevanceBreakdown = null
      let penaltyFlags: string[] = []
      try {
        const addrParts = parseAddressComponents(null, place?.address || '')
        const detailed = computePostRelevanceDetailed(
          place?.name || '',
          addrParts,
          !!place?.is_common_name,
          row.title || '',
          row.snippet || ''
        )
        relevanceBreakdown = detailed.breakdown
        penaltyFlags = detailed.penalties
      } catch { /* ignore — breakdown is best-effort */ }

      const { error: insertErr } = await supabase.from('mention_audit_log').insert({
        mention_id: row.id,
        place_id: row.place_id,
        place_name: place?.name ?? '(unknown)',
        mention_title: row.title,
        mention_url: row.url,
        mention_snippet: row.snippet?.slice(0, 200),
        relevance_score: row.relevance_score,
        audit_verdict: stratum.label,
        config_version: config.version,
        relevance_breakdown: relevanceBreakdown,
        penalty_flags: penaltyFlags.length > 0 ? penaltyFlags : null,
        source_type: row.source_type || null,
        post_date: row.post_date || null,
      })

      if (!insertErr) sampled++
    }
  }

  console.log(`Sampled ${sampled} mentions for audit (config v${config.version})`)
}

async function listPending(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('mention_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('mention_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Mention Audit — Pending (${count ?? data?.length ?? 0}건) ===\n`)

  for (const row of data || []) {
    console.log(`[${row.audit_verdict?.toUpperCase() ?? 'PENDING'}] audit_id=${row.id} mention=${row.mention_id}`)
    console.log(`  Place: "${row.place_name}" (place_id=${row.place_id})`)
    console.log(`  Title: ${row.mention_title || '(none)'}`)
    console.log(`  URL: ${row.mention_url || '(none)'}`)
    console.log(`  Score: ${row.relevance_score?.toFixed(3) ?? '?'}  Source: ${row.source_type || '?'}  Date: ${row.post_date || '?'}`)
    if (row.relevance_breakdown) {
      const bd = row.relevance_breakdown as Record<string, number>
      const positives = Object.entries(bd).filter(([k, v]) => v > 0).map(([k, v]) => `${k}:+${v.toFixed(2)}`).join(', ')
      const negatives = Object.entries(bd).filter(([k, v]) => v < 0).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(', ')
      if (positives) console.log(`  + ${positives}`)
      if (negatives) console.log(`  - ${negatives}`)
    }
    if (row.penalty_flags?.length) {
      console.log(`  Penalties: ${row.penalty_flags.join(', ')}`)
    }
    console.log(`  Snippet: ${row.mention_snippet?.slice(0, 100) || ''}...`)
    console.log('')
  }
}

async function showSummary(): Promise<void> {
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected', 'flagged']) {
    const { count } = await supabase
      .from('mention_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Mention Audit Summary ===`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}, Flagged: ${statusCounts.flagged}`)

  // Verdict distribution
  const { data: verdictRows } = await supabase
    .from('mention_audit_log')
    .select('audit_verdict, audit_status')
    .neq('audit_status', 'pending')

  if (verdictRows && verdictRows.length > 0) {
    const verdictCounts: Record<string, number> = {}
    for (const r of verdictRows) {
      const v = r.audit_verdict || 'unknown'
      verdictCounts[v] = (verdictCounts[v] || 0) + 1
    }
    console.log('\nVerdict distribution:')
    for (const [verdict, cnt] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${verdict}: ${cnt}`)
    }
  }
  console.log('')
}

async function setVerdict(auditId: number, verdict: string, note?: string): Promise<void> {
  const update: Record<string, any> = { audit_verdict: verdict, audit_status: 'approved' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('mention_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Set audit #${auditId} → ${verdict}${note ? ` (${note})` : ''}`)
}

async function excludeMention(mentionId: number): Promise<void> {
  // Set relevance_score to 0 and lock
  const { error: lockErr } = await supabase
    .from('blog_mentions')
    .update({ relevance_score: 0, mention_locked: true })
    .eq('id', mentionId)

  if (lockErr) { console.error('Error locking mention:', lockErr.message); return }

  // Update any pending audit entries
  await supabase
    .from('mention_audit_log')
    .update({ audit_verdict: 'wrong_match', audit_status: 'rejected', audit_notes: 'excluded via CLI' })
    .eq('mention_id', mentionId)
    .eq('audit_status', 'pending')

  console.log(`Excluded mention #${mentionId} (score=0, locked=true)`)
}

async function showPatterns(): Promise<void> {
  // Analyze wrong_match patterns from rejected audits
  const { data } = await supabase
    .from('mention_audit_log')
    .select('place_name, mention_title, relevance_score, audit_notes')
    .eq('audit_verdict', 'wrong_match')

  if (!data || data.length === 0) {
    console.log('No wrong_match patterns found yet. Run --sample and review first.')
    return
  }

  console.log(`\n=== Wrong Match Patterns (${data.length}건) ===\n`)

  // Group by score ranges
  const byRange: Record<string, any[]> = { 'high(≥0.7)': [], 'medium(0.5-0.7)': [], 'low(<0.5)': [] }
  for (const r of data) {
    const s = r.relevance_score ?? 0
    if (s >= 0.7) byRange['high(≥0.7)'].push(r)
    else if (s >= 0.5) byRange['medium(0.5-0.7)'].push(r)
    else byRange['low(<0.5)'].push(r)
  }

  for (const [range, items] of Object.entries(byRange)) {
    if (items.length === 0) continue
    console.log(`${range}: ${items.length}건`)
    for (const item of items.slice(0, 5)) {
      console.log(`  "${item.place_name}" ← "${item.mention_title}" (score=${item.relevance_score?.toFixed(3)})`)
      if (item.audit_notes) console.log(`    Note: ${item.audit_notes}`)
    }
    console.log('')
  }
}

function showConfig(): void {
  const config = loadConfig()
  console.log(`\n=== Mention Relevance Config ===`)
  console.log(`Version: ${config.version}`)
  console.log(`Updated: ${config.updated_at}`)
  console.log(`\nWeights:`, JSON.stringify(config.weights, null, 2))
  console.log(`Thresholds:`, JSON.stringify(config.thresholds, null, 2))
  console.log(`\nChangelog:`)
  for (const entry of config.changelog || []) {
    console.log(`  v${entry.version} (${entry.date}): ${entry.change}`)
  }
  console.log('')
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--sample')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 30 : 30
    await sampleMentions(count)
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
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'correct', note)
  } else if (args.includes('--wrong-match')) {
    const idx = args.indexOf('--wrong-match')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --wrong-match <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'wrong_match', note)
  } else if (args.includes('--wrong-place')) {
    const idx = args.indexOf('--wrong-place')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --wrong-place <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'wrong_place', note)
  } else if (args.includes('--borderline')) {
    const idx = args.indexOf('--borderline')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --borderline <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'borderline', note)
  } else if (args.includes('--exclude')) {
    const idx = args.indexOf('--exclude')
    const mentionId = parseInt(args[idx + 1])
    if (isNaN(mentionId)) { console.error('Usage: --exclude <mention_id>'); return }
    await excludeMention(mentionId)
  } else if (args.includes('--patterns')) {
    await showPatterns()
  } else if (args.includes('--config')) {
    showConfig()
  } else {
    console.log(`
Mention Audit CLI

Commands:
  --sample [--count N]          Stratified sampling (default: 30)
  --list [--limit N]            Pending audit entries
  --summary                     Statistics
  --correct <audit_id> [--note] Mark as correct match
  --wrong-match <audit_id>      Mark as wrong match
  --wrong-place <audit_id>      Mark as wrong place
  --borderline <audit_id>       Mark as borderline
  --exclude <mention_id>        Score=0 + lock (pipeline exclusion)
  --patterns                    Analyze wrong-match patterns
  --config                      Show relevance config
`)
  }

  process.exit(0)
}

main()
