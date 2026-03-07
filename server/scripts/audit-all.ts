/**
 * Audit orchestrator — run all audit types in sequence.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --full
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --quick
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --report
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function loadConfigVersion(configFile: string): number {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', configFile), 'utf-8'))
    return config.version ?? 0
  } catch { return 0 }
}

const AUDIT_TABLES = [
  { name: 'poster', table: 'poster_audit_log' },
  { name: 'mention', table: 'mention_audit_log' },
  { name: 'classification', table: 'classification_audit_log' },
  { name: 'place', table: 'place_accuracy_audit_log' },
  { name: 'event-dedup', table: 'event_dedup_audit_log' },
  { name: 'candidate', table: 'candidate_promotion_audit_log' },
] as const

async function getSummary(table: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected', 'flagged']) {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    counts[status] = count ?? 0
  }
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0)
  return counts
}

async function runReport(): Promise<void> {
  console.log('\n=== Comprehensive Audit Report ===\n')
  const today = new Date().toISOString().split('T')[0]
  console.log(`Date: ${today}\n`)

  let totalPending = 0
  let totalAll = 0

  const auditData: Record<string, Record<string, number>> = {}

  for (const audit of AUDIT_TABLES) {
    const counts = await getSummary(audit.table)
    totalPending += counts.pending
    totalAll += counts.total
    auditData[audit.name] = counts

    const reviewed = counts.approved + counts.rejected + counts.flagged
    const reviewRate = counts.total > 0 ? Math.round(reviewed / counts.total * 100) : 0

    console.log(`${audit.name.padEnd(16)} total=${String(counts.total).padStart(4)}  pending=${String(counts.pending).padStart(4)}  approved=${String(counts.approved).padStart(4)}  rejected=${String(counts.rejected).padStart(4)}  review=${reviewRate}%`)
  }

  console.log(`${'─'.repeat(80)}`)
  console.log(`${'TOTAL'.padEnd(16)} total=${String(totalAll).padStart(4)}  pending=${String(totalPending).padStart(4)}`)

  // #15: Cross-audit analysis — detect systemic quality issues
  console.log('\n=== Cross-Audit Quality Signals ===\n')

  // Check: mention rejection rate
  const mentionCounts = auditData['mention'] || {}
  if (mentionCounts.total > 0) {
    const mentionRejectRate = Math.round((mentionCounts.rejected || 0) / mentionCounts.total * 100)
    if (mentionRejectRate > 40) {
      console.log(`⚠ mention rejection rate ${mentionRejectRate}% (>40%) → relevance scoring or place-gate may need adjustment`)
    }
  }

  // Check: poster rejection rate by prompt version
  const { data: posterByVersion } = await supabase
    .from('poster_audit_log')
    .select('prompt_version, audit_status')
    .in('audit_status', ['approved', 'rejected'])

  if (posterByVersion && posterByVersion.length > 0) {
    const versionStats: Record<number, { approved: number; rejected: number }> = {}
    for (const r of posterByVersion) {
      const v = r.prompt_version || 0
      if (!versionStats[v]) versionStats[v] = { approved: 0, rejected: 0 }
      versionStats[v][r.audit_status as 'approved' | 'rejected']++
    }
    for (const [v, stats] of Object.entries(versionStats)) {
      const total = stats.approved + stats.rejected
      const rejectRate = total > 0 ? Math.round(stats.rejected / total * 100) : 0
      if (rejectRate > 20) {
        console.log(`⚠ poster prompt v${v} rejection rate ${rejectRate}% (${stats.rejected}/${total}) → prompt improvement needed`)
      }
    }
  }

  // Check: candidate audit with null kakao_similarity
  const { data: candidateNulls } = await supabase
    .from('candidate_promotion_audit_log')
    .select('id', { count: 'exact', head: true })
    .is('kakao_similarity', null)

  if (candidateNulls) {
    const { count: candidateTotal } = await supabase
      .from('candidate_promotion_audit_log')
      .select('id', { count: 'exact', head: true })
    if (candidateTotal && candidateTotal > 0) {
      const nullRate = Math.round(((candidateNulls as any) / candidateTotal) * 100)
      if (nullRate > 50) {
        console.log(`⚠ candidate audit: ${nullRate}% have null kakao_similarity → auto-promote.ts recording issue`)
      }
    }
  }

  // #8: Source quality dashboard — rejection rate by source
  console.log('\n--- Source Quality Dashboard (#8) ---\n')

  // Mention by source_type
  const { data: mentionBySource } = await supabase
    .from('mention_audit_log')
    .select('source_type, audit_status')
    .in('audit_status', ['approved', 'rejected'])
    .not('source_type', 'is', null)

  if (mentionBySource && mentionBySource.length > 0) {
    const srcStats: Record<string, { approved: number; rejected: number }> = {}
    for (const r of mentionBySource) {
      const src = r.source_type || 'unknown'
      if (!srcStats[src]) srcStats[src] = { approved: 0, rejected: 0 }
      srcStats[src][r.audit_status as 'approved' | 'rejected']++
    }
    console.log('Mention rejection rate by source:')
    for (const [src, stats] of Object.entries(srcStats).sort((a, b) => b[1].rejected - a[1].rejected)) {
      const total = stats.approved + stats.rejected
      const rate = total > 0 ? Math.round(stats.rejected / total * 100) : 0
      const warn = rate > 50 ? ' ⚠' : ''
      console.log(`  ${src}: ${rate}% rejected (${stats.rejected}/${total})${warn}`)
    }
    console.log('')
  }

  // Poster by event_source
  const { data: posterBySource } = await supabase
    .from('poster_audit_log')
    .select('event_source, audit_status')
    .in('audit_status', ['approved', 'rejected'])

  if (posterBySource && posterBySource.length > 0) {
    const srcStats: Record<string, { approved: number; rejected: number }> = {}
    for (const r of posterBySource) {
      const src = r.event_source || 'unknown'
      if (!srcStats[src]) srcStats[src] = { approved: 0, rejected: 0 }
      srcStats[src][r.audit_status as 'approved' | 'rejected']++
    }
    console.log('Poster rejection rate by event source:')
    for (const [src, stats] of Object.entries(srcStats).sort((a, b) => b[1].rejected - a[1].rejected)) {
      const total = stats.approved + stats.rejected
      const rate = total > 0 ? Math.round(stats.rejected / total * 100) : 0
      const warn = rate > 50 ? ' ⚠' : ''
      console.log(`  ${src}: ${rate}% rejected (${stats.rejected}/${total})${warn}`)
    }
    console.log('')
  }

  // Place by place_source
  const { data: placeBySource } = await supabase
    .from('place_accuracy_audit_log')
    .select('place_source, audit_status')
    .in('audit_status', ['approved', 'rejected'])
    .not('place_source', 'is', null)

  if (placeBySource && placeBySource.length > 0) {
    const srcStats: Record<string, { approved: number; rejected: number }> = {}
    for (const r of placeBySource) {
      const src = r.place_source || 'unknown'
      if (!srcStats[src]) srcStats[src] = { approved: 0, rejected: 0 }
      srcStats[src][r.audit_status as 'approved' | 'rejected']++
    }
    console.log('Place rejection rate by source:')
    for (const [src, stats] of Object.entries(srcStats).sort((a, b) => b[1].rejected - a[1].rejected)) {
      const total = stats.approved + stats.rejected
      const rate = total > 0 ? Math.round(stats.rejected / total * 100) : 0
      const warn = rate > 50 ? ' ⚠' : ''
      console.log(`  ${src}: ${rate}% rejected (${stats.rejected}/${total})${warn}`)
    }
    console.log('')
  }

  // Check: place audit inaccuracy patterns
  const { data: placeVerdicts } = await supabase
    .from('place_accuracy_audit_log')
    .select('audit_verdict')
    .neq('audit_status', 'pending')

  if (placeVerdicts && placeVerdicts.length > 0) {
    const inaccCount = placeVerdicts.filter(r => r.audit_verdict === 'inaccurate').length
    const inaccRate = Math.round(inaccCount / placeVerdicts.length * 100)
    if (inaccRate > 10) {
      console.log(`⚠ place inaccuracy rate ${inaccRate}% (${inaccCount}/${placeVerdicts.length}) → collector quality or place-gate needs review`)
    }
  }

  console.log('')
}

// #11: Round-over-round change tracking
async function compareRounds(): Promise<void> {
  console.log('\n=== Round-over-Round Change Tracking ===\n')

  for (const audit of AUDIT_TABLES) {
    // Get counts by week for the last 4 weeks
    const weeks: { week: string; approved: number; rejected: number; total: number }[] = []

    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(Date.now() - (w + 1) * 7 * 24 * 60 * 60 * 1000).toISOString()
      const weekEnd = new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000).toISOString()

      const { count: approved } = await supabase
        .from(audit.table)
        .select('id', { count: 'exact', head: true })
        .eq('audit_status', 'approved')
        .gte('created_at', weekStart)
        .lt('created_at', weekEnd)

      const { count: rejected } = await supabase
        .from(audit.table)
        .select('id', { count: 'exact', head: true })
        .eq('audit_status', 'rejected')
        .gte('created_at', weekStart)
        .lt('created_at', weekEnd)

      const total = (approved ?? 0) + (rejected ?? 0)
      if (total > 0) {
        weeks.push({
          week: new Date(Date.now() - w * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          approved: approved ?? 0,
          rejected: rejected ?? 0,
          total,
        })
      }
    }

    if (weeks.length > 0) {
      console.log(`${audit.name}:`)
      for (const w of weeks.reverse()) {
        const rejectRate = w.total > 0 ? Math.round(w.rejected / w.total * 100) : 0
        console.log(`  ~${w.week}: ${w.total} reviewed, ${rejectRate}% rejected`)
      }

      // Trend: compare latest vs oldest week
      if (weeks.length >= 2) {
        const latest = weeks[weeks.length - 1]
        const oldest = weeks[0]
        const latestRate = latest.total > 0 ? latest.rejected / latest.total : 0
        const oldestRate = oldest.total > 0 ? oldest.rejected / oldest.total : 0
        const diff = Math.round((latestRate - oldestRate) * 100)
        if (Math.abs(diff) > 5) {
          console.log(`  Trend: rejection rate ${diff > 0 ? '+' : ''}${diff}pp`)
        }
      }
      console.log('')
    }
  }
}

async function runFull(): Promise<void> {
  console.log('[audit-all] Starting full audit cycle (6 types)\n')

  const { execSync } = await import('child_process')
  const env = { ...process.env }

  const audits = [
    { name: 'poster', cmd: 'server/scripts/poster-audit.ts --summary' },
    { name: 'mention', cmd: 'server/scripts/mention-audit.ts --sample --count 30' },
    { name: 'classification', cmd: 'server/scripts/classification-audit.ts --sample-included --count 20' },
    { name: 'place', cmd: 'server/scripts/place-accuracy-audit.ts --sample --count 15' },
    { name: 'event-dedup', cmd: 'server/scripts/event-dedup-audit.ts --list --limit 20' },
    { name: 'candidate', cmd: 'server/scripts/candidate-audit.ts --sample --count 10' },
  ]

  for (const audit of audits) {
    console.log(`\n── ${audit.name} ──────────────────────────────────`)
    try {
      const output = execSync(
        `npx tsx -r dotenv/config ${audit.cmd}`,
        { env, encoding: 'utf-8', timeout: 60000, cwd: process.cwd() }
      )
      console.log(output)
    } catch (err: any) {
      console.error(`[${audit.name}] Error:`, err.message?.slice(0, 200))
    }
  }

  // Final report
  await runReport()
}

async function runQuick(): Promise<void> {
  console.log('[audit-all] Quick audit (poster + mention)\n')

  const { execSync } = await import('child_process')
  const env = { ...process.env }

  const audits = [
    { name: 'poster', cmd: 'server/scripts/poster-audit.ts --summary' },
    { name: 'mention', cmd: 'server/scripts/mention-audit.ts --sample --count 10' },
  ]

  for (const audit of audits) {
    console.log(`\n── ${audit.name} ──────────────────────────────────`)
    try {
      const output = execSync(
        `npx tsx -r dotenv/config ${audit.cmd}`,
        { env, encoding: 'utf-8', timeout: 60000, cwd: process.cwd() }
      )
      console.log(output)
    } catch (err: any) {
      console.error(`[${audit.name}] Error:`, err.message?.slice(0, 200))
    }
  }

  // Quick summary
  for (const audit of AUDIT_TABLES.slice(0, 2)) {
    const counts = await getSummary(audit.table)
    console.log(`${audit.name}: ${counts.pending} pending / ${counts.total} total`)
  }
}

// #6: Save audit metadata snapshot
async function saveSnapshot(auditType: string = 'full'): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const round = `${today}-${auditType}`

  const snapshot: Record<string, any> = {
    audit_round: round,
    audit_type: auditType,
    completed_at: new Date().toISOString(),
    mention_config_version: loadConfigVersion('mention-relevance-config.json'),
    classifier_config_version: loadConfigVersion('classifier-config.json'),
    poster_prompt_version: loadConfigVersion('poster-prompt.json'),
  }

  // Count each audit table
  for (const audit of AUDIT_TABLES) {
    const prefix = audit.name.replace('-', '_')
    for (const status of ['pending', 'approved', 'rejected']) {
      const { count } = await supabase
        .from(audit.table)
        .select('id', { count: 'exact', head: true })
        .eq('audit_status', status)
      if (prefix === 'poster') {
        if (status === 'pending') snapshot.poster_pending = count ?? 0
        else if (status === 'approved') snapshot.poster_approved = count ?? 0
        else snapshot.poster_rejected = count ?? 0
      } else if (prefix === 'mention') {
        if (status === 'pending') snapshot.mention_pending = count ?? 0
        else if (status === 'approved') snapshot.mention_approved = count ?? 0
        else snapshot.mention_rejected = count ?? 0
      }
    }
    const { count: total } = await supabase
      .from(audit.table)
      .select('id', { count: 'exact', head: true })
    if (prefix === 'poster') snapshot.poster_total = total ?? 0
    else if (prefix === 'mention') snapshot.mention_total = total ?? 0
    else if (prefix === 'classification') snapshot.classification_total = total ?? 0
    else if (prefix === 'place') snapshot.place_total = total ?? 0
    else if (prefix === 'event_dedup') snapshot.event_dedup_total = total ?? 0
    else if (prefix === 'candidate') snapshot.candidate_total = total ?? 0
  }

  // Inter-audit gap: count new entries since last snapshot
  const { data: lastSnap } = await supabase
    .from('audit_metadata')
    .select('completed_at')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastSnap?.completed_at) {
    const since = lastSnap.completed_at
    const { count: newMentions } = await supabase
      .from('blog_mentions')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)
    snapshot.new_mentions_since_last = newMentions ?? 0

    const { count: newEvents } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)
    snapshot.new_events_since_last = newEvents ?? 0

    const { count: newPlaces } = await supabase
      .from('places')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', since)
    snapshot.new_places_since_last = newPlaces ?? 0
  }

  const { error } = await supabase.from('audit_metadata').insert(snapshot)
  if (error) {
    console.error('Error saving snapshot:', error.message)
  } else {
    console.log(`\n[audit-all] Snapshot saved: ${round}`)
    if (snapshot.new_mentions_since_last !== undefined) {
      console.log(`  Since last audit: ${snapshot.new_mentions_since_last} mentions, ${snapshot.new_events_since_last} events, ${snapshot.new_places_since_last} places`)
    }
  }
}

// #1: Enhanced compare — show config version changes
async function compareWithConfig(): Promise<void> {
  await compareRounds()

  // Show config version changes between snapshots
  const { data: snapshots } = await supabase
    .from('audit_metadata')
    .select('audit_round, mention_config_version, classifier_config_version, poster_prompt_version, mention_rejected, mention_total')
    .order('completed_at', { ascending: false })
    .limit(5)

  if (snapshots && snapshots.length >= 2) {
    console.log('\n--- Config Version Changes ---\n')
    for (let i = 0; i < snapshots.length - 1; i++) {
      const curr = snapshots[i]
      const prev = snapshots[i + 1]
      const changes: string[] = []
      if (curr.mention_config_version !== prev.mention_config_version) {
        changes.push(`mention-config v${prev.mention_config_version}→v${curr.mention_config_version}`)
      }
      if (curr.classifier_config_version !== prev.classifier_config_version) {
        changes.push(`classifier-config v${prev.classifier_config_version}→v${curr.classifier_config_version}`)
      }
      if (curr.poster_prompt_version !== prev.poster_prompt_version) {
        changes.push(`poster-prompt v${prev.poster_prompt_version}→v${curr.poster_prompt_version}`)
      }
      if (changes.length > 0) {
        console.log(`${prev.audit_round} → ${curr.audit_round}: ${changes.join(', ')}`)
      }
    }
    console.log('')
  }
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--full')) {
    await runFull()
    await saveSnapshot('full')
  } else if (args.includes('--quick')) {
    await runQuick()
    await saveSnapshot('quick')
  } else if (args.includes('--report')) {
    await runReport()
  } else if (args.includes('--compare')) {
    await compareWithConfig()
  } else if (args.includes('--snapshot')) {
    const typeIdx = args.indexOf('--type')
    const type = typeIdx >= 0 ? args[typeIdx + 1] || 'manual' : 'manual'
    await saveSnapshot(type)
  } else {
    console.log(`
Audit Orchestrator CLI

Commands:
  --full      Run all 6 audit types (sample + report) + save snapshot
  --quick     Poster + mention only (daily check) + save snapshot
  --report    Summary report + cross-audit quality signals + source dashboard
  --compare   Round-over-round change tracking + config version changes
  --snapshot  Save audit metadata snapshot manually
`)
  }

  process.exit(0)
}

main()
