/**
 * Poster audit CLI — terminal tool for reviewing poster enrichment decisions.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --summary
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --approve 123
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --reject 123 --note "블로그 이미지"
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --update-prompt
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PROMPT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'poster-prompt.json')

interface AuditRow {
  id: number
  event_id: number
  event_name: string
  event_source: string
  before_url: string | null
  after_url: string | null
  candidates: { title: string; link: string; domain: string; source: string }[] | null
  llm_reason: string | null
  action: string
  audit_status: string
  audit_notes: string | null
  prompt_version: number
  created_at: string
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function listPending(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('poster_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }
  const rows = (data || []) as AuditRow[]

  const { count } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Poster Audit — Pending (${count ?? rows.length}건) ===\n`)

  for (const row of rows) {
    const candidateCount = row.candidates?.length ?? 0
    const sources = row.candidates
      ? [...new Set(row.candidates.map(c => c.source))].join(', ')
      : ''

    switch (row.action) {
      case 'updated':
        console.log(`[UPDATED] id=${row.event_id} "${row.event_name}" (${row.event_source})`)
        console.log(`  Before: ${row.before_url || '(none)'}`)
        console.log(`  After:  ${row.after_url}`)
        console.log(`  Reason: ${row.llm_reason}`)
        console.log(`  Candidates: ${candidateCount}개 (${sources})`)
        console.log(`  audit_id: ${row.id}`)
        break

      case 'no_candidates':
        console.log(`[NO_CANDIDATES] id=${row.event_id} "${row.event_name}" (${row.event_source})`)
        console.log(`  Current: ${row.before_url || '(none)'}`)
        console.log(`  audit_id: ${row.id}`)
        break

      case 'kept':
        console.log(`[KEPT] id=${row.event_id} "${row.event_name}" (${row.event_source})`)
        console.log(`  Current: ${row.before_url || '(none)'}`)
        console.log(`  Candidates: ${candidateCount}개 → LLM이 유지`)
        console.log(`  Reason: ${row.llm_reason}`)
        console.log(`  audit_id: ${row.id}`)
        break

      case 'removed':
        console.log(`[REMOVED] id=${row.event_id} "${row.event_name}" (${row.event_source})`)
        console.log(`  Before: ${row.before_url}`)
        console.log(`  Reason: ${row.llm_reason}`)
        console.log(`  Candidates: ${candidateCount}개 (${sources})`)
        console.log(`  audit_id: ${row.id}`)
        break
    }
    console.log('')
  }
}

async function showSummary(): Promise<void> {
  // Get date range
  const { data: latestRow } = await supabase
    .from('poster_audit_log')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: earliestRow } = await supabase
    .from('poster_audit_log')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!latestRow) { console.log('No audit logs found.'); return }

  const from = earliestRow?.created_at?.split('T')[0] ?? '?'
  const to = latestRow?.created_at?.split('T')[0] ?? '?'

  // Count by status
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected', 'flagged']) {
    const { count } = await supabase
      .from('poster_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Poster Audit Summary ===`)
  console.log(`Period: ${from} ~ ${to}`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}, Flagged: ${statusCounts.flagged}`)

  // Count by action per prompt version
  const { data: actionRows } = await supabase
    .from('poster_audit_log')
    .select('action, prompt_version, audit_status')

  if (actionRows) {
    const versions = [...new Set(actionRows.map(r => r.prompt_version))].sort()
    for (const v of versions) {
      const vRows = actionRows.filter(r => r.prompt_version === v)
      const actionCounts: Record<string, number> = {}
      for (const r of vRows) {
        actionCounts[r.action] = (actionCounts[r.action] || 0) + 1
      }

      const updatedApproved = vRows.filter(r => r.action === 'updated' && r.audit_status === 'approved').length
      const updatedTotal = actionCounts['updated'] || 0
      const approvalRate = updatedTotal > 0 ? Math.round(updatedApproved / updatedTotal * 100) : 0

      console.log(`\nPrompt v${v}:`)
      console.log(`  updated: ${updatedTotal}${updatedTotal > 0 ? ` (approval rate: ${approvalRate}%)` : ''}`)
      console.log(`  kept: ${actionCounts['kept'] || 0}`)
      console.log(`  no_candidates: ${actionCounts['no_candidates'] || 0}`)
      console.log(`  removed: ${actionCounts['removed'] || 0}`)
    }
  }

  // Top rejected patterns
  const { data: rejectedRows } = await supabase
    .from('poster_audit_log')
    .select('audit_notes')
    .eq('audit_status', 'rejected')
    .not('audit_notes', 'is', null)

  if (rejectedRows && rejectedRows.length > 0) {
    const noteCounts: Record<string, number> = {}
    for (const r of rejectedRows) {
      const note = (r.audit_notes || '').toLowerCase().trim()
      if (note) noteCounts[note] = (noteCounts[note] || 0) + 1
    }
    const sorted = Object.entries(noteCounts).sort((a, b) => b[1] - a[1])
    if (sorted.length > 0) {
      console.log('\nTop rejected patterns:')
      for (const [note, count] of sorted.slice(0, 10)) {
        console.log(`  - ${note} (${count}건)`)
      }
    }
  }

  console.log('')
}

async function approveAudit(auditId: number): Promise<void> {
  const { error } = await supabase
    .from('poster_audit_log')
    .update({ audit_status: 'approved' })
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Approved audit #${auditId}`)
}

async function rejectAudit(auditId: number, note?: string): Promise<void> {
  const update: Record<string, string> = { audit_status: 'rejected' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('poster_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Rejected audit #${auditId}${note ? ` (note: ${note})` : ''}`)
}

async function flagAudit(auditId: number, note?: string): Promise<void> {
  const update: Record<string, string> = { audit_status: 'flagged' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('poster_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Flagged audit #${auditId}${note ? ` (note: ${note})` : ''}`)
}

async function bulkApprove(action?: string): Promise<void> {
  let query = supabase
    .from('poster_audit_log')
    .update({ audit_status: 'approved' })
    .eq('audit_status', 'pending')

  if (action) query = query.eq('action', action)

  const { error, count } = await query

  if (error) console.error('Error:', error.message)
  else console.log(`Bulk approved ${count ?? '?'} pending${action ? ` (action=${action})` : ''} audits`)
}

function showPromptInfo(): void {
  try {
    const raw = fs.readFileSync(PROMPT_CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    console.log(`\n=== Poster Prompt Config ===`)
    console.log(`Version: ${config.version}`)
    console.log(`Updated: ${config.updated_at}`)
    console.log(`\nPrompt:\n${config.prompt}`)
    console.log(`\nChangelog:`)
    for (const entry of config.changelog) {
      console.log(`  v${entry.version} (${entry.date}): ${entry.change}`)
    }
    console.log('')
  } catch (err) {
    console.error('Failed to read prompt config:', err)
  }
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--list')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listPending(limit)
  } else if (args.includes('--summary')) {
    await showSummary()
  } else if (args.includes('--approve')) {
    const idx = args.indexOf('--approve')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --approve <audit_id>'); return }
    await approveAudit(id)
  } else if (args.includes('--reject')) {
    const idx = args.indexOf('--reject')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --reject <audit_id> [--note "reason"]'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await rejectAudit(id, note)
  } else if (args.includes('--flag')) {
    const idx = args.indexOf('--flag')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --flag <audit_id> [--note "reason"]'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await flagAudit(id, note)
  } else if (args.includes('--bulk-approve')) {
    const actionIdx = args.indexOf('--action')
    const action = actionIdx >= 0 ? args[actionIdx + 1] : undefined
    await bulkApprove(action)
  } else if (args.includes('--prompt')) {
    showPromptInfo()
  } else {
    console.log(`
Poster Audit CLI

Commands:
  --list [--limit N]           Pending audit entries (default: 50)
  --summary                    Statistics and pattern analysis
  --approve <audit_id>         Approve a poster decision
  --reject <audit_id> [--note] Reject with optional reason
  --flag <audit_id> [--note]   Flag for further review
  --bulk-approve [--action X]  Approve all pending (optionally filter by action)
  --prompt                     Show current prompt config

Examples:
  poster-audit.ts --list
  poster-audit.ts --summary
  poster-audit.ts --approve 123
  poster-audit.ts --reject 123 --note "블로그 이미지"
  poster-audit.ts --bulk-approve --action kept
  poster-audit.ts --prompt
`)
  }

  process.exit(0)
}

main()
