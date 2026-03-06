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

async function lockPoster(eventId: number, posterUrl?: string): Promise<void> {
  const update: Record<string, any> = { poster_locked: true }
  if (posterUrl) update.poster_url = posterUrl

  const { error } = await supabase
    .from('events')
    .update(update)
    .eq('id', eventId)

  if (error) { console.error('Error:', error.message); return }

  // Also approve any pending audit logs for this event
  await supabase
    .from('poster_audit_log')
    .update({ audit_status: 'approved', audit_notes: 'poster_locked' })
    .eq('event_id', eventId)
    .eq('audit_status', 'pending')

  console.log(`Locked poster for event #${eventId}${posterUrl ? ` → ${posterUrl}` : ''}`)
}

async function unlockPoster(eventId: number): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ poster_locked: false })
    .eq('id', eventId)

  if (error) console.error('Error:', error.message)
  else console.log(`Unlocked poster for event #${eventId}`)
}

async function listSearchOnly(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('poster_audit_log')
    .select('*')
    .eq('action', 'search_only')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }
  const rows = (data || []) as AuditRow[]

  const { count } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'search_only')
    .eq('audit_status', 'pending')

  console.log(`\n=== Search-Only Results for Locked Events (${count ?? rows.length}건) ===`)
  console.log('These events have poster_locked=true. LLM searched but did not replace.\n')

  for (const row of rows) {
    const candidateCount = row.candidates?.length ?? 0
    const llmPick = row.after_url
    const current = row.before_url
    const different = llmPick && llmPick !== current

    console.log(`[SEARCH_ONLY] event #${row.event_id} "${row.event_name}" (${row.event_source})`)
    console.log(`  Current (locked): ${current || '(none)'}`)
    if (different) {
      console.log(`  LLM would pick:   ${llmPick}`)
      console.log(`  Reason: ${row.llm_reason}`)
    } else {
      console.log(`  LLM agrees with current poster`)
    }
    console.log(`  Candidates: ${candidateCount}개`)
    console.log(`  audit_id: ${row.id}`)
    console.log('')
  }

  // Summary: how many have a better candidate vs agree
  const agreeCount = rows.filter(r => !r.after_url || r.after_url === r.before_url).length
  const betterCount = rows.filter(r => r.after_url && r.after_url !== r.before_url).length
  console.log(`Summary: ${agreeCount} agree with current, ${betterCount} found potentially better`)
}

async function reviewUpdated(limit = 50, offset = 0): Promise<void> {
  // Fetch UPDATED entries for Opus visual review
  // Output format matches iteration script: event info + all candidate URLs for inspection
  const { data, error } = await supabase
    .from('poster_audit_log')
    .select('*')
    .eq('action', 'updated')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) { console.error('Error:', error.message); return }
  const rows = (data || []) as AuditRow[]

  const { count } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'updated')
    .eq('audit_status', 'pending')

  console.log(`\n=== Poster Review — UPDATED (${count ?? 0}건 pending, showing ${offset + 1}~${offset + rows.length}) ===`)
  console.log('Review each entry: check if LLM selection is the best poster for this event.')
  console.log('Actions: --approve <id> | --reject <id> | --lock <event_id> --poster <url>\n')

  for (const row of rows) {
    const candidates = row.candidates || []

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`#${row.event_id} "${row.event_name}" [${row.event_source}]`)
    console.log(`audit_id: ${row.id}`)
    console.log(``)
    console.log(`  이전: ${row.before_url || '(없음)'}`)
    console.log(`  선택: ${row.after_url}`)
    console.log(`  이유: ${row.llm_reason}`)
    console.log(``)
    console.log(`  후보 (${candidates.length}개):`)
    for (const [i, c] of candidates.entries()) {
      const url = c.link || ''
      const title = c.title || ''
      const domain = c.domain || ''
      const source = c.source || ''
      const tag = source === 'current' ? '[현재]'
        : source === 'og:image' ? '[공식]'
        : ['culture.seoul.go.kr', 'kopis.or.kr', 'sac.or.kr', 'sejongpac.or.kr',
           'ticketlink.co.kr', 'interpark.com', 'yes24.com', 'museum.go.kr',
           'mmca.go.kr', 'sema.seoul.go.kr', 'visitkorea.or.kr', 'mediahub.seoul.go.kr'
          ].some(d => url.includes(d)) ? '[신뢰]' : ''
      const selected = url === row.after_url ? ' ← LLM선택' : ''
      console.log(`    ${i + 1}. ${tag} [${domain}] "${title}"${selected}`)
      console.log(`       ${url}`)
    }
    console.log('')
  }

  if (rows.length > 0) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`\n다음 페이지: --review --offset ${offset + limit}`)
  }
}

async function listLocked(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, poster_url, source')
    .eq('poster_locked', true)
    .order('id', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('poster_locked', true)

  console.log(`\n=== Locked Posters (${count ?? data?.length ?? 0}건) ===\n`)
  for (const ev of data || []) {
    console.log(`  event #${ev.id} "${ev.name}" (${ev.source}) → ${ev.poster_url || '(none)'}`)
  }
  console.log('')
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
  } else if (args.includes('--lock')) {
    const idx = args.indexOf('--lock')
    const eventId = parseInt(args[idx + 1])
    if (isNaN(eventId)) { console.error('Usage: --lock <event_id> --poster <url>'); return }
    const posterIdx = args.indexOf('--poster')
    const posterUrl = posterIdx >= 0 ? args[posterIdx + 1] : undefined
    await lockPoster(eventId, posterUrl)
  } else if (args.includes('--unlock')) {
    const idx = args.indexOf('--unlock')
    const eventId = parseInt(args[idx + 1])
    if (isNaN(eventId)) { console.error('Usage: --unlock <event_id>'); return }
    await unlockPoster(eventId)
  } else if (args.includes('--review')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 10 : 10
    const offsetIdx = args.indexOf('--offset')
    const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) || 0 : 0
    await reviewUpdated(limit, offset)
  } else if (args.includes('--search-only')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listSearchOnly(limit)
  } else if (args.includes('--locked')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listLocked(limit)
  } else if (args.includes('--prompt')) {
    showPromptInfo()
  } else {
    console.log(`
Poster Audit CLI

Commands:
  --list [--limit N]           Pending audit entries (default: 50)
  --review [--limit N] [--offset N]  Opus visual review: UPDATED entries with all candidate URLs (default: 10)
  --summary                    Statistics and pattern analysis
  --approve <audit_id>         Approve a poster decision
  --reject <audit_id> [--note] Reject with optional reason
  --flag <audit_id> [--note]   Flag for further review
  --bulk-approve [--action X]  Approve all pending (optionally filter by action)
  --search-only [--limit N]    Show LLM search results for locked events
  --lock <event_id> [--poster <url>]  Lock poster (set URL + lock + approve)
  --unlock <event_id>          Unlock poster for re-enrichment
  --locked [--limit N]         List locked events
  --prompt                     Show current prompt config

Examples:
  poster-audit.ts --list
  poster-audit.ts --summary
  poster-audit.ts --approve 123
  poster-audit.ts --reject 123 --note "블로그 이미지"
  poster-audit.ts --bulk-approve --action kept
  poster-audit.ts --lock 456 --poster "https://example.com/poster.jpg"
  poster-audit.ts --unlock 456
  poster-audit.ts --prompt
`)
  }

  process.exit(0)
}

main()
