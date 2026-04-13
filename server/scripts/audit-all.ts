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
  const startTime = Date.now()
  console.log('[audit-all] Starting integrated full audit pipeline\n')

  const { execSync } = await import('child_process')
  const env = { ...process.env }
  const tsx = (cmd: string, timeout = 180000) => {
    try {
      return execSync(`npx tsx -r dotenv/config ${cmd}`, { env, encoding: 'utf-8', timeout, cwd: process.cwd() })
    } catch (err: any) {
      console.error(`  Error:`, err.message?.slice(0, 200))
      return ''
    }
  }

  // Phase 1: Sample & Register — all new data gets audit entries
  console.log('── Phase 1: Sample & Register ──────────────────────────')

  console.log('\n[mention] Registering new mentions + 30 random existing...')
  console.log(tsx('server/scripts/mention-audit.ts --sample --random 30', 600000))

  console.log('[poster] Summary...')
  console.log(tsx('server/scripts/poster-audit.ts --summary'))

  console.log('[classification] Sampling included + excluded...')
  console.log(tsx('server/scripts/classification-audit.ts --sample-included --count 20'))
  console.log(tsx('server/scripts/classification-audit.ts --sample-excluded --count 10'))

  console.log('[place] Sampling...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --sample --count 15', 300000))

  console.log('[event-dedup] Listing...')
  console.log(tsx('server/scripts/event-dedup-audit.ts --list --limit 20'))

  console.log('[candidate] Sampling...')
  console.log(tsx('server/scripts/candidate-audit.ts --sample --count 10'))

  // Phase 1.5: Proactive scans
  console.log('\n── Phase 1.5: Proactive Scans ─────────────────────────')

  console.log('\n[event-dedup] Scanning for missed duplicates...')
  console.log(tsx('server/scripts/event-dedup-audit.ts --missed-dupes --count 20'))

  console.log('[event-dedup] Flagging low-similarity merges...')
  console.log(tsx('server/scripts/event-dedup-audit.ts --flag-low-sim'))

  console.log('[place] Checking for duplicate suspects...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --check-dupes --count 20'))

  console.log('[place] Batch revalidating old places via Kakao...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --batch-revalidate --count 10', 180000))

  console.log('[poster] Expiring old locks on ended events...')
  console.log(tsx('server/scripts/poster-audit.ts --expire-locks'))

  // Phase 2: Automated Judging — bulk-judge + vision-check
  console.log('\n── Phase 2: Automated Judging ──────────────────────────')

  console.log('\n[poster] Bulk-approving clear poster actions...')
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action kept'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action removed'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action no_candidates'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action recovery_failed'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action search_only'))

  console.log('\n[mention] Running bulk-judge on all pending...')
  console.log(tsx('server/scripts/mention-audit.ts --bulk-judge', 1200000))

  console.log('[place] Running bulk-judge on pending places...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --bulk-judge'))

  console.log('[poster] Running vision-check on UPDATED posters...')
  console.log(tsx('server/scripts/poster-audit.ts --vision-check --limit 20', 180000))

  // Phase 2.5: Auto-flag candidates with null kakao_similarity (#14)
  console.log('\n[candidate] Auto-flagging null kakao_similarity...')
  const { count: flaggedCandidates } = await supabase
    .from('candidate_promotion_audit_log')
    .update({ audit_status: 'flagged', audit_notes: 'auto: kakao_similarity null' })
    .eq('audit_status', 'pending')
    .is('kakao_similarity', null)
  console.log(`[candidate] Flagged ${flaggedCandidates ?? 0} candidates with null kakao_similarity`)

  // Phase 2.7: Cleanup — delete flagged/rejected audit + score=0 mentions + JSONB trim
  await runCleanup('full')

  // Phase 2.8: Validation — check bulk-judge accuracy
  console.log('\n── Phase 2.6: Validation ──────────────────────────────')

  console.log('\n[mention] Validating bulk-judge accuracy...')
  console.log(tsx('server/scripts/mention-audit.ts --validate-bulk --count 10'))

  console.log('[place] Validating bulk-judge accuracy...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --validate-bulk --count 5'))

  // Phase 3: Report (analysis separated to --analysis for egress optimization)
  console.log('\n── Phase 3: Report ────────────────────────────────────')
  await runReport()
  await runCrossAudit()

  // Phase 3.5: Pattern analysis
  console.log('\n── Phase 3.5: Pattern Analysis ────────────────────────')

  console.log('\n[mention] Analyzing flagged mention patterns...')
  console.log(tsx('server/scripts/mention-audit.ts --analyze-flagged', 600000))

  console.log('[classification] Analyzing FP/FN patterns...')
  console.log(tsx('server/scripts/classification-audit.ts --patterns'))

  const elapsedMs = Date.now() - startTime
  const elapsedMin = Math.floor(elapsedMs / 60000)
  const elapsedSec = Math.round((elapsedMs % 60000) / 1000)
  console.log(`\n[audit-all] 총 소요시간: ${elapsedMin}분 ${elapsedSec}초`)
}

async function runQuick(): Promise<void> {
  const startTime = Date.now()
  console.log('[audit-all] Quick audit (6종 lightweight)\n')

  const { execSync } = await import('child_process')
  const env = { ...process.env }
  const tsx = (cmd: string, timeout = 180000) => {
    try {
      return execSync(`npx tsx -r dotenv/config ${cmd}`, { env, encoding: 'utf-8', timeout, cwd: process.cwd() })
    } catch (err: any) {
      console.error(`  Error:`, err.message?.slice(0, 200))
      return ''
    }
  }

  // Phase 1: Sample all 6 audit types (lightweight)
  console.log('── Phase 1: Sample & Register ──────────────────────────')

  console.log('\n[poster] Summary + bulk-approve clear actions...')
  console.log(tsx('server/scripts/poster-audit.ts --summary'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action kept'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action removed'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action no_candidates'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action recovery_failed'))
  console.log(tsx('server/scripts/poster-audit.ts --bulk-approve --action search_only'))

  console.log('[mention] Sampling new + 10 random...')
  console.log(tsx('server/scripts/mention-audit.ts --sample --count 10', 600000))

  console.log('[classification] Sampling included + excluded...')
  console.log(tsx('server/scripts/classification-audit.ts --sample-included --count 5'))
  console.log(tsx('server/scripts/classification-audit.ts --sample-excluded --count 5'))

  console.log('[place] Sampling...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --sample --count 5', 300000))

  console.log('[event-dedup] Listing + missed-dupes scan...')
  console.log(tsx('server/scripts/event-dedup-audit.ts --list --limit 5'))
  console.log(tsx('server/scripts/event-dedup-audit.ts --missed-dupes --count 10'))

  console.log('[candidate] Sampling...')
  console.log(tsx('server/scripts/candidate-audit.ts --sample --count 5'))

  // Phase 1.5: Proactive scans (lightweight)
  console.log('\n── Phase 1.5: Proactive Scans ─────────────────────────')

  console.log('\n[place] Checking for duplicate suspects...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --check-dupes --count 10'))

  console.log('[poster] Expiring old locks on ended events...')
  console.log(tsx('server/scripts/poster-audit.ts --expire-locks'))

  // Phase 2: Automated judging (lightweight)
  console.log('\n── Phase 2: Automated Judging ──────────────────────────')

  console.log('\n[mention] Running bulk-judge...')
  console.log(tsx('server/scripts/mention-audit.ts --bulk-judge', 1200000))

  console.log('[place] Running bulk-judge...')
  console.log(tsx('server/scripts/place-accuracy-audit.ts --bulk-judge'))

  console.log('[poster] Running vision-check (limit 10)...')
  console.log(tsx('server/scripts/poster-audit.ts --vision-check --limit 10', 120000))

  // Auto-flag candidates with null kakao_similarity
  console.log('\n[candidate] Auto-flagging null kakao_similarity...')
  const { count: flaggedCandidates } = await supabase
    .from('candidate_promotion_audit_log')
    .update({ audit_status: 'flagged', audit_notes: 'auto: kakao_similarity null' })
    .eq('audit_status', 'pending')
    .is('kakao_similarity', null)
  console.log(`[candidate] Flagged ${flaggedCandidates ?? 0} candidates with null kakao_similarity`)

  // Phase 2.7: Cleanup — delete flagged/rejected audit + score=0 mentions
  await runCleanup('quick')

  // Phase 3: Quick summary + cross-audit
  console.log('\n── Phase 3: Summary ───────────────────────────────────')

  for (const audit of AUDIT_TABLES) {
    const counts = await getSummary(audit.table)
    console.log(`${audit.name.padEnd(16)} pending=${String(counts.pending).padStart(4)}  approved=${String(counts.approved).padStart(4)}  rejected=${String(counts.rejected).padStart(4)}  total=${String(counts.total).padStart(5)}`)
  }

  // Cross-audit check (catch stale mentions daily)
  await runCrossAudit()

  const elapsedMs = Date.now() - startTime
  const elapsedMin = Math.floor(elapsedMs / 60000)
  const elapsedSec = Math.round((elapsedMs % 60000) / 1000)
  console.log(`\n[audit-all] 총 소요시간: ${elapsedMin}분 ${elapsedSec}초`)
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

// #13: Automated 4th-stage analysis — systemic quality insights
async function runAnalysis(): Promise<void> {
  console.log('\n=== Automated Analysis (#13) ===\n')

  // 1. Penalty flags distribution (mention) — sample 10K rows max to limit egress
  console.log('--- Mention Penalty Flags Distribution ---')
  const BATCH = 1000
  const MAX_SCAN = 10000
  let cursor = 0
  const flagDist: Record<string, number> = {}
  let totalWithFlags = 0
  let totalNull = 0
  let scanned = 0

  while (scanned < MAX_SCAN) {
    const { data, error } = await supabase
      .from('mention_audit_log')
      .select('id, penalty_flags')
      .order('id', { ascending: true })
      .gt('id', cursor)
      .limit(BATCH)
    if (error || !data || data.length === 0) break
    for (const row of data) {
      cursor = row.id
      scanned++
      const flags = (row.penalty_flags || []) as string[]
      if (flags.length === 0) { totalNull++; continue }
      totalWithFlags++
      for (const f of flags) flagDist[f] = (flagDist[f] || 0) + 1
    }
    if (data.length < BATCH) break
  }

  console.log(`  Total with flags: ${totalWithFlags}, without: ${totalNull}`)
  const sortedFlags = Object.entries(flagDist).sort((a, b) => b[1] - a[1])
  for (const [flag, cnt] of sortedFlags.slice(0, 10)) {
    const pct = totalWithFlags > 0 ? Math.round(cnt / totalWithFlags * 100) : 0
    console.log(`  ${flag}: ${cnt} (${pct}%)`)
  }

  // 2. Mention coverage
  console.log('\n--- Mention Audit Coverage ---')
  const { count: totalMentions } = await supabase
    .from('blog_mentions')
    .select('id', { count: 'exact', head: true })
  const { count: auditedMentions } = await supabase
    .from('mention_audit_log')
    .select('id', { count: 'exact', head: true })
  const coverage = totalMentions && totalMentions > 0
    ? Math.round((auditedMentions ?? 0) / totalMentions * 100)
    : 0
  console.log(`  Total mentions: ${totalMentions ?? 0}`)
  console.log(`  Audited: ${auditedMentions ?? 0} (${coverage}%)`)

  // 3. Place audit coverage
  const { count: totalPlaces } = await supabase
    .from('places')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
  const { count: auditedPlaces } = await supabase
    .from('place_accuracy_audit_log')
    .select('id', { count: 'exact', head: true })
  const placeCoverage = totalPlaces && totalPlaces > 0
    ? Math.round((auditedPlaces ?? 0) / totalPlaces * 100)
    : 0
  console.log(`\n--- Place Audit Coverage ---`)
  console.log(`  Active places: ${totalPlaces ?? 0}`)
  console.log(`  Audited: ${auditedPlaces ?? 0} (${placeCoverage}%)`)

  // 4. Vision check usage
  console.log('\n--- Poster Vision Check Usage ---')
  const { count: visionApproved } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .like('audit_notes', 'vision:%')
    .eq('audit_status', 'approved')
  const { count: visionRejected } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .like('audit_notes', 'vision:%')
    .eq('audit_status', 'rejected')
  console.log(`  Vision approved: ${visionApproved ?? 0}`)
  console.log(`  Vision rejected: ${visionRejected ?? 0}`)
  console.log(`  Total vision-checked: ${(visionApproved ?? 0) + (visionRejected ?? 0)}`)

  // 5. Score accuracy check — how many audit_log scores diverge from blog_mentions
  console.log('\n--- Score Divergence (audit_log vs blog_mentions) ---')
  let divergeCount = 0
  let checkCount = 0
  let scoreCursor = 2147483647 // PostgreSQL INT max
  while (checkCount < 500) {
    const { data, error } = await supabase
      .from('mention_audit_log')
      .select('id, mention_id, relevance_score')
      .lt('id', scoreCursor)
      .order('id', { ascending: false })
      .limit(200)
    if (error || !data || data.length === 0) break
    scoreCursor = data[data.length - 1].id

    const ids = data.map(r => r.mention_id)
    const { data: mentions } = await supabase
      .from('blog_mentions')
      .select('id, relevance_score')
      .in('id', ids)
    const currentMap = new Map<number, number>()
    for (const m of mentions || []) currentMap.set(m.id, m.relevance_score ?? 0)

    for (const row of data) {
      checkCount++
      const current = currentMap.get(row.mention_id)
      if (current !== undefined && Math.abs(current - (row.relevance_score ?? 0)) > 0.05) {
        divergeCount++
      }
    }
    if (data.length < 200) break
  }
  const divergePct = checkCount > 0 ? Math.round(divergeCount / checkCount * 100) : 0
  console.log(`  Checked: ${checkCount}, diverged (>0.05): ${divergeCount} (${divergePct}%)`)

  // 6. Category-level accuracy (place) — use place_category column
  console.log('\n--- Place Category Accuracy ---')
  const { data: catData } = await supabase
    .from('place_accuracy_audit_log')
    .select('place_category, audit_status')
    .in('audit_status', ['approved', 'rejected'])

  if (catData && catData.length > 0) {
    const catStats: Record<string, { approved: number; rejected: number }> = {}
    for (const r of catData) {
      const cat = (r as any).place_category || 'unknown'
      if (!catStats[cat]) catStats[cat] = { approved: 0, rejected: 0 }
      catStats[cat][r.audit_status as 'approved' | 'rejected']++
    }
    const sortedCats = Object.entries(catStats).sort((a, b) => (b[1].rejected / (b[1].approved + b[1].rejected)) - (a[1].rejected / (a[1].approved + a[1].rejected)))
    for (const [cat, stats] of sortedCats) {
      const total = stats.approved + stats.rejected
      if (total < 3) continue
      const rate = Math.round(stats.rejected / total * 100)
      const warn = rate > 30 ? ' ⚠' : ''
      console.log(`  ${cat}: ${rate}% rejected (${stats.rejected}/${total})${warn}`)
    }
  }

  console.log('')
}

// DB cleanup — delete low-value audit data to keep Supabase Free Plan under 0.5GB
async function runCleanup(mode: 'quick' | 'full' = 'quick'): Promise<void> {
  console.log('\n=== DB Cleanup (egress-aware) ===\n')
  const DEL_BATCH = 500

  async function batchDelete(table: string, filter: (q: any) => any, label: string): Promise<number> {
    let deleted = 0
    while (true) {
      const { data: batch } = await filter(supabase.from(table).select('id')).limit(DEL_BATCH)
      if (!batch || batch.length === 0) break
      const ids = batch.map((r: any) => r.id)
      const { error } = await supabase.from(table).delete().in('id', ids)
      if (error) { console.error(`  ${label} delete error:`, error.message); break }
      deleted += ids.length
      if (deleted % 5000 === 0) console.log(`  ${label}: ${deleted} deleted...`)
    }
    return deleted
  }

  // 1. mention_audit_log: flagged — 삭제하지 않음 (순환 샘플링 재검토 대상 보존)
  //    last_resampled_at을 갱신하여 다음 감사 대상으로 유지
  const flaggedDel = 0
  console.log(`[cleanup] mention_audit_log flagged: preserved (no delete)`)

  // 2. mention_audit_log: rejected (already processed, blog_mentions score=0)
  const rejectedDel = await batchDelete(
    'mention_audit_log',
    (q: any) => q.eq('audit_status', 'rejected'),
    'mention_audit rejected'
  )
  console.log(`[cleanup] mention_audit_log rejected: ${rejectedDel} deleted`)

  // 3. blog_mentions: score=0 + locked (rejected matches, never reused)
  //    FK cascade: mention_audit_log(mention_id) → blog_mentions(id) ON DELETE CASCADE
  //    Must delete audit_log entries first to avoid cascade timeout on Free Plan
  let bmDel = 0
  while (true) {
    const { data: idBatch } = await supabase
      .from('blog_mentions')
      .select('id')
      .eq('relevance_score', 0)
      .eq('mention_locked', true)
      .limit(100)
    if (!idBatch || idBatch.length === 0) break
    const ids = idBatch.map((r: any) => r.id)

    // Step 1: Delete FK children (mention_audit_log) first
    await supabase.from('mention_audit_log').delete().in('mention_id', ids)

    // Step 2: Delete blog_mentions (no cascade needed now)
    const { error } = await supabase.from('blog_mentions').delete().in('id', ids)
    if (error) { console.error('  blog_mentions delete error:', error.message); break }
    bmDel += ids.length
    if (bmDel % 2000 === 0) console.log(`  blog_mentions score=0+locked: ${bmDel} deleted...`)
  }
  console.log(`[cleanup] blog_mentions score=0+locked: ${bmDel} deleted`)

  // 4. Full mode only: extended cleanup
  if (mode === 'full') {
    // 4a. blog_mentions score=0 + unlocked older than 30 days
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    let bmOldDel = 0
    while (true) {
      const { data: idBatch } = await supabase
        .from('blog_mentions')
        .select('id')
        .eq('relevance_score', 0)
        .eq('mention_locked', false)
        .lt('created_at', cutoff30d)
        .limit(100)
      if (!idBatch || idBatch.length === 0) break
      const ids = idBatch.map((r: any) => r.id)
      await supabase.from('mention_audit_log').delete().in('mention_id', ids)
      const { error } = await supabase.from('blog_mentions').delete().in('id', ids)
      if (error) { console.error('  blog_mentions old delete error:', error.message); break }
      bmOldDel += ids.length
      if (bmOldDel % 2000 === 0) console.log(`  blog_mentions score=0+old: ${bmOldDel} deleted...`)
    }
    console.log(`[cleanup] blog_mentions score=0+unlocked(>30d): ${bmOldDel} deleted`)

    // 4b. blog_mentions 0 < score < 0.2 (not shown in frontend, no info value)
    let bmLowDel = 0
    while (true) {
      const { data: idBatch } = await supabase
        .from('blog_mentions')
        .select('id')
        .gt('relevance_score', 0)
        .lt('relevance_score', 0.2)
        .limit(100)
      if (!idBatch || idBatch.length === 0) break
      const ids = idBatch.map((r: any) => r.id)
      await supabase.from('mention_audit_log').delete().in('mention_id', ids)
      const { error } = await supabase.from('blog_mentions').delete().in('id', ids)
      if (error) { console.error('  blog_mentions low-score delete error:', error.message); break }
      bmLowDel += ids.length
      if (bmLowDel % 5000 === 0) console.log(`  blog_mentions score<0.2: ${bmLowDel} deleted...`)
    }
    console.log(`[cleanup] blog_mentions 0<score<0.2: ${bmLowDel} deleted`)

    // 5. mention_audit_log: approved relevance_breakdown → NULL (penalty_flags 보존)
    let mentionTrimmed = 0
    while (true) {
      const { data: batch } = await supabase
        .from('mention_audit_log')
        .select('id')
        .eq('audit_status', 'approved')
        .not('relevance_breakdown', 'is', null)
        .limit(DEL_BATCH)
      if (!batch || batch.length === 0) break
      const ids = batch.map((r: any) => r.id)
      const { error } = await supabase
        .from('mention_audit_log')
        .update({ relevance_breakdown: null })  // penalty_flags는 분석용으로 보존
        .in('id', ids)
      if (error) { console.error('  mention JSONB trim error:', error.message); break }
      mentionTrimmed += ids.length
      if (mentionTrimmed % 5000 === 0) console.log(`  mention JSONB trim: ${mentionTrimmed} rows...`)
    }
    console.log(`[cleanup] mention_audit_log JSONB trimmed: ${mentionTrimmed} rows (penalty_flags preserved)`)

    // 6. poster_audit_log: non-pending candidates → NULL
    let posterTrimmed = 0
    while (true) {
      const { data: batch } = await supabase
        .from('poster_audit_log')
        .select('id')
        .neq('audit_status', 'pending')
        .not('candidates', 'is', null)
        .limit(DEL_BATCH)
      if (!batch || batch.length === 0) break
      const ids = batch.map((r: any) => r.id)
      const { error } = await supabase
        .from('poster_audit_log')
        .update({ candidates: null })
        .in('id', ids)
      if (error) { console.error('  poster JSONB trim error:', error.message); break }
      posterTrimmed += ids.length
    }
    console.log(`[cleanup] poster_audit_log candidates trimmed: ${posterTrimmed} rows`)

    // 7. place_accuracy_audit_log: non-pending check_result → NULL
    let placeTrimmed = 0
    while (true) {
      const { data: batch } = await supabase
        .from('place_accuracy_audit_log')
        .select('id')
        .neq('audit_status', 'pending')
        .not('check_result', 'is', null)
        .limit(DEL_BATCH)
      if (!batch || batch.length === 0) break
      const ids = batch.map((r: any) => r.id)
      const { error } = await supabase
        .from('place_accuracy_audit_log')
        .update({ check_result: null })
        .in('id', ids)
      if (error) { console.error('  place JSONB trim error:', error.message); break }
      placeTrimmed += ids.length
    }
    console.log(`[cleanup] place_accuracy_audit_log check_result trimmed: ${placeTrimmed} rows`)

    // 8. Log tables cleanup
    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

    const kwDel = await batchDelete(
      'keyword_logs',
      (q: any) => q.lt('created_at', cutoff30d),
      'keyword_logs >30d'
    )
    console.log(`[cleanup] keyword_logs >30d: ${kwDel} deleted`)

    const exclDel = await batchDelete(
      'excluded_events',
      (q: any) => q.lt('created_at', cutoff60d),
      'excluded_events >60d'
    )
    console.log(`[cleanup] excluded_events >60d: ${exclDel} deleted`)

    const clDel = await batchDelete(
      'collection_logs',
      (q: any) => q.lt('created_at', cutoff30d),
      'collection_logs >30d'
    )
    console.log(`[cleanup] collection_logs >30d: ${clDel} deleted`)
  }

  const totalDel = flaggedDel + rejectedDel + bmDel
  console.log(`\n[cleanup] Total deleted: ${totalDel} rows (+ JSONB trims + log tables in full mode)`)
}

// #16: Cross-audit integrity check
async function runCrossAudit(): Promise<void> {
  console.log('\n=== Cross-Audit Integrity Check (#16) ===\n')

  // 1. Inactive places with high-score mentions
  const { data: inactivePlaces } = await supabase
    .from('places')
    .select('id')
    .eq('is_active', false)

  if (inactivePlaces && inactivePlaces.length > 0) {
    let staleCount = 0
    for (let i = 0; i < inactivePlaces.length; i += 100) {
      const batch = inactivePlaces.slice(i, i + 100).map(p => p.id)
      const { count } = await supabase
        .from('blog_mentions')
        .select('id', { count: 'exact', head: true })
        .in('place_id', batch)
        .gt('relevance_score', 0)
      staleCount += count ?? 0
    }
    if (staleCount > 0) {
      // Auto-fix: zero out scores for mentions linked to inactive places
      let cleaned = 0
      for (let i = 0; i < inactivePlaces.length; i += 50) {
        const batch = inactivePlaces.slice(i, i + 50).map(p => p.id)
        const { count } = await supabase
          .from('blog_mentions')
          .update({ relevance_score: 0, mention_locked: true })
          .in('place_id', batch)
          .gt('relevance_score', 0)
        cleaned += count ?? 0
      }
      console.log(`\u2713 Cleaned ${cleaned} stale mentions (score→0, locked) for inactive places`)
    } else {
      console.log('\u2713 No stale mentions for inactive places')
    }
  }

  // 2. Expired events with pending poster audits → auto-close
  const today = new Date().toISOString().split('T')[0]
  const { data: expiredPendingPosters } = await supabase
    .from('poster_audit_log')
    .select('id, event_id, events!inner(end_date)')
    .eq('audit_status', 'pending')
    .lt('events.end_date', today)

  const expiredCount = expiredPendingPosters?.length ?? 0
  if (expiredCount > 0) {
    // Auto-approve expired event posters (no point reviewing ended events)
    const expiredIds = expiredPendingPosters!.map((r: any) => r.id)
    for (let i = 0; i < expiredIds.length; i += 50) {
      const batch = expiredIds.slice(i, i + 50)
      await supabase
        .from('poster_audit_log')
        .update({ audit_status: 'approved', audit_notes: 'auto: event expired' })
        .in('id', batch)
    }
    console.log(`\u2713 Auto-closed ${expiredCount} pending poster audits for expired events`)
  } else {
    console.log('\u2713 No pending poster audits for expired events')
  }

  // 3. Candidates promoted to inactive places
  const { data: promotedToInactive } = await supabase
    .from('candidate_promotion_audit_log')
    .select('id, place_id, places!inner(is_active)')
    .eq('audit_status', 'approved')
    .eq('places.is_active', false)

  const demoteCount = promotedToInactive?.length ?? 0
  if (demoteCount > 0) {
    console.log(`\u26a0 ${demoteCount} approved candidates linked to now-inactive places`)
  } else {
    console.log('\u2713 No approved candidates for inactive places')
  }

  console.log('')
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
    await runCrossAudit()
  } else if (args.includes('--analysis')) {
    await runAnalysis()
  } else if (args.includes('--cross-audit')) {
    await runCrossAudit()
  } else if (args.includes('--cleanup')) {
    const fullMode = args.includes('--full-cleanup')
    await runCleanup(fullMode ? 'full' : 'quick')
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
  --full      Integrated pipeline: sample → proactive scans → bulk-judge → vision-check → pattern analysis → report + snapshot
  --quick     6종 lightweight: sample → bulk-judge → vision-check → cross-audit + snapshot
  --report    Summary report + cross-audit quality signals + source dashboard
  --analysis  Automated 4th-stage analysis (penalty distribution, coverage, divergence)
  --compare   Round-over-round change tracking + config version changes
  --cleanup   Delete flagged/rejected audit_log + score=0 mentions (quick mode)
  --cleanup --full-cleanup  + score<0.2 mentions + JSONB trim + log tables cleanup
  --cross-audit  Cross-audit integrity check (stale mentions, expired posters, inactive candidates)
  --snapshot  Save audit metadata snapshot manually
`)
  }

  setTimeout(() => process.exit(0), 50)
}

main()
