/**
 * Event dedup audit CLI — review merge decisions.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/event-dedup-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/event-dedup-audit.ts --summary
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/event-dedup-audit.ts --correct 123
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Commands ────────────────────────────────────────────────────────────────

async function listRecent(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('event_dedup_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('event_dedup_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Event Dedup Audit — Pending (${count ?? data?.length ?? 0}건) ===\n`)

  for (const row of data || []) {
    console.log(`[${row.match_reason?.toUpperCase() ?? 'MERGE'}] audit_id=${row.id}`)
    console.log(`  Kept: #${row.kept_event_id} "${row.kept_event_name}"`)
    console.log(`  Removed: #${row.removed_event_id} "${row.removed_event_name}"`)
    console.log(`  Similarity: ${row.similarity_score?.toFixed(3) ?? '?'}`)
    console.log('')
  }
}

async function missedDupes(count = 10): Promise<void> {
  // Scan for potential missed duplicates in active events
  const { data, error } = await supabase
    .from('events')
    .select('id, name, venue_name, start_date, end_date, source')
    .or('end_date.gte.' + new Date().toISOString().split('T')[0] + ',end_date.is.null')
    .order('name', { ascending: true })

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) return

  const suspects: { e1: any; e2: any; sim: number }[] = []

  // Simple name-based scan
  for (let i = 0; i < data.length && suspects.length < count; i++) {
    for (let j = i + 1; j < data.length && suspects.length < count; j++) {
      if (data[i].source === data[j].source) continue

      // Quick Dice coefficient
      const n1 = data[i].name.toLowerCase().replace(/\s+/g, '')
      const n2 = data[j].name.toLowerCase().replace(/\s+/g, '')
      if (Math.abs(n1.length - n2.length) > 10) continue

      const bg1 = new Set<string>()
      const bg2 = new Set<string>()
      for (let k = 0; k < n1.length - 1; k++) bg1.add(n1.slice(k, k + 2))
      for (let k = 0; k < n2.length - 1; k++) bg2.add(n2.slice(k, k + 2))
      const intersection = [...bg1].filter(b => bg2.has(b)).length
      const sim = bg1.size + bg2.size > 0 ? (2 * intersection) / (bg1.size + bg2.size) : 0

      if (sim > 0.6 && sim < 0.8) {
        // Borderline — might have been missed
        suspects.push({ e1: data[i], e2: data[j], sim })
      }
    }
  }

  if (suspects.length === 0) {
    console.log('No missed duplicate suspects found.')
    return
  }

  let sampled = 0
  for (const s of suspects) {
    const { error: insertErr } = await supabase.from('event_dedup_audit_log').insert({
      kept_event_id: s.e1.id,
      removed_event_id: s.e2.id,
      kept_event_name: s.e1.name,
      removed_event_name: s.e2.name,
      similarity_score: s.sim,
      match_reason: 'missed_scan',
      audit_verdict: 'missed_dupe',
    })
    if (!insertErr) sampled++
  }

  console.log(`Found ${sampled} potential missed duplicates (similarity 0.6~0.8, cross-source)`)
}

async function showSummary(): Promise<void> {
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected']) {
    const { count } = await supabase
      .from('event_dedup_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Event Dedup Audit Summary ===`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}`)

  // By match_reason
  const { data: rows } = await supabase
    .from('event_dedup_audit_log')
    .select('match_reason, audit_verdict')

  if (rows && rows.length > 0) {
    const byReason: Record<string, number> = {}
    for (const r of rows) {
      const reason = r.match_reason || 'unknown'
      byReason[reason] = (byReason[reason] || 0) + 1
    }
    console.log('\nBy match reason:')
    for (const [reason, cnt] of Object.entries(byReason)) {
      console.log(`  ${reason}: ${cnt}`)
    }

    // Average similarity
    const sims = rows.filter(r => r.audit_verdict !== 'missed_dupe').map(r => (r as any).similarity_score).filter(Boolean)
    if (sims.length > 0) {
      const avg = sims.reduce((a: number, b: number) => a + b, 0) / sims.length
      console.log(`\nAvg similarity (merged): ${avg.toFixed(3)}`)
    }
  }
  console.log('')
}

async function setVerdict(auditId: number, verdict: string, note?: string): Promise<void> {
  const update: Record<string, any> = { audit_verdict: verdict, audit_status: 'approved' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('event_dedup_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Set audit #${auditId} → ${verdict}${note ? ` (${note})` : ''}`)
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--list')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listRecent(limit)
  } else if (args.includes('--missed-dupes')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await missedDupes(count)
  } else if (args.includes('--summary')) {
    await showSummary()
  } else if (args.includes('--correct')) {
    const idx = args.indexOf('--correct')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --correct <audit_id>'); return }
    await setVerdict(id, 'correct_merge')
  } else if (args.includes('--false-merge')) {
    const idx = args.indexOf('--false-merge')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --false-merge <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'false_merge', note)
  } else if (args.includes('--missed-dupe')) {
    const idx = args.indexOf('--missed-dupe')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --missed-dupe <audit_id>'); return }
    await setVerdict(id, 'missed_dupe')
  } else {
    console.log(`
Event Dedup Audit CLI

Commands:
  --list [--limit N]           Pending merge records
  --missed-dupes [--count N]   Scan for missed duplicates (sim 0.6~0.8)
  --summary                    Statistics
  --correct <audit_id>         Confirm correct merge
  --false-merge <audit_id>     Mark as false merge [--note]
  --missed-dupe <audit_id>     Mark as missed duplicate
`)
  }

  process.exit(0)
}

main()
