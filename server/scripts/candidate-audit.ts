/**
 * Candidate promotion audit CLI — review auto-promoted places.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/candidate-audit.ts --sample
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/candidate-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/candidate-audit.ts --summary
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/candidate-audit.ts --demote 123
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Commands ────────────────────────────────────────────────────────────────

async function sampleRecent(count = 10): Promise<void> {
  // Sample recently promoted places (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('candidate_promotion_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .gte('created_at', weekAgo)
    .order('created_at', { ascending: false })
    .limit(count)

  if (error) { console.error('Error:', error.message); return }

  if (!data || data.length === 0) {
    // No pending audits — check if there are recent promotions without audit entries
    const { data: recentPlaces } = await supabase
      .from('places')
      .select('id, name, category, source_count, created_at')
      .eq('source', 'auto_promoted')
      .eq('is_active', true)
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(count)

    if (!recentPlaces || recentPlaces.length === 0) {
      console.log('No recent promotions found in the last 7 days.')
      return
    }

    // Check which already have audit entries
    const placeIds = recentPlaces.map(p => p.id)
    const { data: existing } = await supabase
      .from('candidate_promotion_audit_log')
      .select('place_id')
      .in('place_id', placeIds)

    const existingSet = new Set((existing || []).map((a: any) => a.place_id))

    let sampled = 0
    for (const place of recentPlaces) {
      if (existingSet.has(place.id)) continue

      const { error: insertErr } = await supabase.from('candidate_promotion_audit_log').insert({
        place_id: place.id,
        place_name: place.name,
        place_category: place.category,
        source_count: place.source_count,
        promotion_reason: 'multi_blog',
      })
      if (!insertErr) sampled++
    }

    console.log(`Sampled ${sampled} recent promotions for audit`)
    return
  }

  console.log(`${data.length} pending promotion audits from last 7 days`)
}

async function listPending(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('candidate_promotion_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('candidate_promotion_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Candidate Promotion Audit — Pending (${count ?? data?.length ?? 0}건) ===\n`)

  for (const row of data || []) {
    console.log(`[${row.promotion_reason?.toUpperCase() ?? 'PROMOTED'}] audit_id=${row.id}`)
    console.log(`  Place: "${row.place_name}" (${row.place_category}) place_id=${row.place_id}`)
    console.log(`  Sources: ${row.source_count}, Kakao sim: ${row.kakao_similarity?.toFixed(3) ?? '?'}`)
    console.log(`  Candidate: ${row.candidate_id ?? '?'}`)
    console.log('')
  }
}

async function showSummary(): Promise<void> {
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected']) {
    const { count } = await supabase
      .from('candidate_promotion_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Candidate Promotion Audit Summary ===`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}`)

  // By verdict
  const { data: rows } = await supabase
    .from('candidate_promotion_audit_log')
    .select('audit_verdict, promotion_reason')
    .neq('audit_status', 'pending')

  if (rows && rows.length > 0) {
    const byVerdict: Record<string, number> = {}
    for (const r of rows) {
      const v = r.audit_verdict || 'unknown'
      byVerdict[v] = (byVerdict[v] || 0) + 1
    }
    console.log('\nBy verdict:')
    for (const [v, cnt] of Object.entries(byVerdict)) {
      console.log(`  ${v}: ${cnt}`)
    }
  }
  console.log('')
}

async function setVerdict(auditId: number, verdict: string, note?: string): Promise<void> {
  const update: Record<string, any> = { audit_verdict: verdict, audit_status: 'approved' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('candidate_promotion_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Set audit #${auditId} → ${verdict}${note ? ` (${note})` : ''}`)
}

async function demotePlace(placeId: number): Promise<void> {
  const { error } = await supabase
    .from('places')
    .update({ is_active: false })
    .eq('id', placeId)

  if (error) { console.error('Error:', error.message); return }

  // Update audit log
  await supabase
    .from('candidate_promotion_audit_log')
    .update({ audit_verdict: 'not_baby_friendly', audit_status: 'rejected', audit_notes: 'demoted via CLI' })
    .eq('place_id', placeId)
    .eq('audit_status', 'pending')

  console.log(`Demoted place #${placeId} (is_active=false)`)
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--sample')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await sampleRecent(count)
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
  } else if (args.includes('--not-baby')) {
    const idx = args.indexOf('--not-baby')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --not-baby <audit_id>'); return }
    await setVerdict(id, 'not_baby_friendly')
  } else if (args.includes('--bad-data')) {
    const idx = args.indexOf('--bad-data')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --bad-data <audit_id>'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'bad_data', note)
  } else if (args.includes('--duplicate')) {
    const idx = args.indexOf('--duplicate')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --duplicate <audit_id>'); return }
    await setVerdict(id, 'duplicate')
  } else if (args.includes('--demote')) {
    const idx = args.indexOf('--demote')
    const placeId = parseInt(args[idx + 1])
    if (isNaN(placeId)) { console.error('Usage: --demote <place_id>'); return }
    await demotePlace(placeId)
  } else {
    console.log(`
Candidate Promotion Audit CLI

Commands:
  --sample [--count N]         Recent 7-day promotions (default: 10)
  --list [--limit N]           Pending audit entries
  --summary                    Statistics
  --correct <audit_id>         Confirm correct promotion
  --not-baby <audit_id>        Not baby-friendly
  --bad-data <audit_id>        Bad data quality
  --duplicate <audit_id>       Duplicate of existing place
  --demote <place_id>          Deactivate place (is_active=false)
`)
  }

  setTimeout(() => process.exit(0), 50)
}

main()
