/**
 * Audit orchestrator — run all audit types in sequence.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --full
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --quick
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --report
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
  console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`)

  let totalPending = 0
  let totalAll = 0

  for (const audit of AUDIT_TABLES) {
    const counts = await getSummary(audit.table)
    totalPending += counts.pending
    totalAll += counts.total

    const reviewed = counts.approved + counts.rejected + counts.flagged
    const reviewRate = counts.total > 0 ? Math.round(reviewed / counts.total * 100) : 0

    console.log(`${audit.name.padEnd(16)} total=${String(counts.total).padStart(4)}  pending=${String(counts.pending).padStart(4)}  approved=${String(counts.approved).padStart(4)}  rejected=${String(counts.rejected).padStart(4)}  review=${reviewRate}%`)
  }

  console.log(`${'─'.repeat(80)}`)
  console.log(`${'TOTAL'.padEnd(16)} total=${String(totalAll).padStart(4)}  pending=${String(totalPending).padStart(4)}`)
  console.log('')
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

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--full')) {
    await runFull()
  } else if (args.includes('--quick')) {
    await runQuick()
  } else if (args.includes('--report')) {
    await runReport()
  } else {
    console.log(`
Audit Orchestrator CLI

Commands:
  --full      Run all 6 audit types (sample + report)
  --quick     Poster + mention only (daily check)
  --report    Summary report for all audit types
`)
  }

  process.exit(0)
}

main()
