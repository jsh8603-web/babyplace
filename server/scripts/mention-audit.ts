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

async function sampleMentions(randomCount = 10): Promise<void> {
  const config = loadConfig()
  const SELECT = 'id, place_id, title, url, snippet, relevance_score, source_type, post_date, places!inner(id, name, address, is_common_name)'

  // Find the highest mention_id already audited — everything above is "new"
  const { data: maxRow } = await supabase
    .from('mention_audit_log')
    .select('mention_id')
    .order('mention_id', { ascending: false })
    .limit(1)
  const lastAuditedId = maxRow?.[0]?.mention_id ?? 0

  // --- 1) New mentions (전수 배치): id > lastAuditedId ---
  let newSampled = 0
  const BATCH = 500

  // Use keyset pagination (cursor-based) — no ORDER BY sort on full table
  let cursor = lastAuditedId
  while (true) {
    const { data: batch, error } = await supabase
      .from('blog_mentions')
      .select(SELECT)
      .eq('mention_locked', false)
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(BATCH)

    if (error) { console.error('Error fetching new mentions:', error.message); break }
    if (!batch || batch.length === 0) break

    // Batch insert with onConflict ignore (skip already-audited)
    const toInsert: any[] = []
    for (const row of batch) {
      const entry = buildAuditEntry(row, config, 'new')
      if (entry) toInsert.push(entry)
      cursor = row.id
    }
    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from('mention_audit_log').insert(toInsert)
      if (insertErr) {
        // On duplicate, fall back to individual inserts (rare: only if re-run mid-batch)
        if (insertErr.message.includes('duplicate') || insertErr.message.includes('unique')) {
          let inserted = 0
          for (const entry of toInsert) {
            const { error: singleErr } = await supabase.from('mention_audit_log').insert(entry)
            if (!singleErr) inserted++
          }
          newSampled += inserted
        } else {
          console.error('Batch insert error:', insertErr.message)
        }
      } else {
        newSampled += toInsert.length
      }
    }

    if (batch.length < BATCH) break
  }

  // --- 2) Existing mentions (기존 랜덤 샘플): stratified random from id <= lastAuditedId ---
  // Already-audited mentions are excluded by the existingSet check in insertAuditEntry
  let existingSampled = 0
  if (randomCount > 0 && lastAuditedId > 0) {
    const strata = [
      { label: 'high (≥0.7)', gte: 0.7, lt: undefined as number | undefined, ratio: 0.2 },
      { label: 'medium (0.5~0.7)', gte: 0.5, lt: 0.7, ratio: 0.4 },
      { label: 'border (0.4~0.5)', gte: 0.4, lt: 0.5, ratio: 0.3 },
      { label: 'low (<0.4)', gte: undefined as number | undefined, lt: 0.4, ratio: 0.1 },
    ]

    for (const stratum of strata) {
      const stratumCount = Math.max(1, Math.round(randomCount * stratum.ratio))

      // Get total in this stratum (existing only)
      let cq = supabase
        .from('blog_mentions')
        .select('id', { count: 'exact', head: true })
        .eq('mention_locked', false)
        .lte('id', lastAuditedId)
      if (stratum.gte !== undefined) cq = cq.gte('relevance_score', stratum.gte)
      if (stratum.lt !== undefined) cq = cq.lt('relevance_score', stratum.lt)
      const { count: total } = await cq

      if (!total || total === 0) continue

      // Pick random offsets
      const offsets = new Set<number>()
      const attempts = stratumCount * 3 // over-sample to account for already-audited
      while (offsets.size < Math.min(attempts, total)) {
        offsets.add(Math.floor(Math.random() * total))
      }

      let added = 0
      for (const offset of Array.from(offsets)) {
        if (added >= stratumCount) break
        let rq = supabase
          .from('blog_mentions')
          .select(SELECT)
          .eq('mention_locked', false)
          .lte('id', lastAuditedId)
        if (stratum.gte !== undefined) rq = rq.gte('relevance_score', stratum.gte)
        if (stratum.lt !== undefined) rq = rq.lt('relevance_score', stratum.lt)
        const { data: rRow } = await rq.order('id', { ascending: false }).range(offset, offset).limit(1)
        if (rRow && rRow.length > 0) {
          const inserted = await insertAuditEntry(rRow[0], config, stratum.label)
          if (inserted) { added++; existingSampled++ }
        }
      }
    }
  }

  console.log(`Mention audit: ${newSampled} new (전수) + ${existingSampled} existing (랜덤) = ${newSampled + existingSampled} total (config v${config.version})`)
}

function buildAuditEntry(row: any, config: any, verdict: string): any | null {
  const place = (row as any).places
  let relevanceBreakdown = null
  let penaltyFlags: string[] = []
  try {
    const addrParts = parseAddressComponents(null, place?.address || '')
    const detailed = computePostRelevanceDetailed(
      place?.name || '',
      addrParts,
      place?.is_common_name ?? false,
      row.title || '',
      row.snippet || '',
      [],
      row.post_date || null
    )
    relevanceBreakdown = detailed.breakdown
    penaltyFlags = detailed.penalties
  } catch { /* ignore */ }

  return {
    mention_id: row.id,
    place_id: row.place_id,
    place_name: place?.name ?? '(unknown)',
    mention_title: row.title,
    mention_url: row.url,
    mention_snippet: row.snippet?.slice(0, 200),
    relevance_score: row.relevance_score,
    audit_verdict: verdict,
    config_version: config.version,
    relevance_breakdown: relevanceBreakdown && typeof relevanceBreakdown === 'object' ? relevanceBreakdown : null,
    penalty_flags: Array.isArray(penaltyFlags) && penaltyFlags.length > 0 ? penaltyFlags : null,
    source_type: row.source_type || null,
    post_date: row.post_date || null,
    blog_url: row.url || null,
  }
}

async function insertAuditEntry(row: any, config: any, verdict: string): Promise<boolean> {
  // Check if already audited
  const { data: exists } = await supabase
    .from('mention_audit_log')
    .select('id')
    .eq('mention_id', row.id)
    .limit(1)
  if (exists && exists.length > 0) return false

  const entry = buildAuditEntry(row, config, verdict)
  if (!entry) return false
  const { error } = await supabase.from('mention_audit_log').insert(entry)
  return !error
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

async function bulkJudge(): Promise<void> {
  // Auto-judge pending entries using documented criteria:
  // 1. name_title + score >= 0.45 → approve (correct)
  // 2. name_snippet (no name_title) + score >= 0.5 → approve (correct)
  // 3. name_absent_cap penalty (no name match) → reject (wrong_match) + exclude
  // 4. generic_suffix penalty + no name_title + score < 0.5 → reject (wrong_match) + exclude
  // 5. Everything else → flag (borderline)
  //
  // #1 improvement: uses current blog_mentions.relevance_score instead of
  // stale audit_log score (config changes may have altered actual scores)

  const BATCH = 200
  const UPDATE_BATCH = 100
  let approved = 0, rejected = 0, flagged = 0, excludedIds: number[] = []
  let rounds = 0

  console.log('Starting bulk judge...')
  while (true) {
    // Step 1: Get IDs only (no ORDER BY — avoid sort on 23K rows)
    const { data: idRows, error: idErr } = await supabase
      .from('mention_audit_log')
      .select('id')
      .eq('audit_status', 'pending')
      .limit(BATCH)

    if (idErr) { console.error('ID select error:', idErr.message); break }
    if (!idRows || idRows.length === 0) { console.log('No more pending rows'); break }

    const ids = idRows.map(r => r.id)
    console.log(`  Fetched ${ids.length} IDs: ${ids[0]}..${ids[ids.length-1]}`)

    // Step 2: Fetch full data by primary key IN (fast)
    const { data, error } = await supabase
      .from('mention_audit_log')
      .select('id, mention_id, relevance_score, relevance_breakdown, penalty_flags')
      .in('id', ids)

    if (error) { console.error('Data select error:', error.message); break }
    if (!data || data.length === 0) { console.log('No data for IDs'); break }
    console.log(`  Got ${data.length} rows with JSONB`)

    // Fetch current scores from blog_mentions for accurate judging
    const mentionIds = data.map(r => r.mention_id)
    const currentScores = new Map<number, number>()
    const { data: mentions, error: mErr } = await supabase
      .from('blog_mentions')
      .select('id, relevance_score')
      .in('id', mentionIds)
    if (mErr) { console.error('Mention score fetch error:', mErr.message) }
    for (const m of mentions || []) {
      currentScores.set(m.id, m.relevance_score ?? 0)
    }

    const approveRows: number[] = []
    const rejectRows: number[] = []
    const flagRows: number[] = []

    for (const row of data) {
      const bd = (row.relevance_breakdown || {}) as Record<string, number>
      const penalties = (row.penalty_flags || []) as string[]
      // Use current blog_mentions score, fallback to audit_log score
      const score = currentScores.get(row.mention_id) ?? row.relevance_score ?? 0
      const hasNameTitle = (bd.name_title ?? 0) > 0
      const hasNameSnippet = (bd.name_snippet ?? 0) > 0
      const hasNameAbsentCap = penalties.includes('name_absent_cap')
      const hasGenericSuffix = (bd.penalty_generic_suffix ?? 0) < 0

      const hasChainMismatch = penalties.includes('chain_region_mismatch')
      const hasCompetingBranch = penalties.includes('competing_branch')
      const hasCompetingLocation = penalties.includes('competing_location')
      const hasStalePost = penalties.includes('stale_post_3y')

      if (hasNameAbsentCap && !hasNameTitle) {
        rejectRows.push(row.id)
        excludedIds.push(row.mention_id)
      } else if (hasGenericSuffix && !hasNameTitle && score < 0.5) {
        rejectRows.push(row.id)
        excludedIds.push(row.mention_id)
      } else if (hasChainMismatch || hasCompetingLocation) {
        // #1/#10: chain/region mismatch → reject regardless of name match
        rejectRows.push(row.id)
        excludedIds.push(row.mention_id)
      } else if (hasNameTitle && score >= 0.45) {
        approveRows.push(row.id)
      } else if (hasNameSnippet && !hasNameTitle && score >= 0.5) {
        approveRows.push(row.id)
      } else {
        flagRows.push(row.id)
      }
    }

    // Batch updates — sub-batch to avoid Supabase statement_timeout
    for (let i = 0; i < approveRows.length; i += UPDATE_BATCH) {
      const batch = approveRows.slice(i, i + UPDATE_BATCH)
      await supabase.from('mention_audit_log').update({ audit_status: 'approved', audit_verdict: 'correct', audit_notes: 'bulk-judge: name match' }).in('id', batch)
    }
    approved += approveRows.length

    for (let i = 0; i < rejectRows.length; i += UPDATE_BATCH) {
      const batch = rejectRows.slice(i, i + UPDATE_BATCH)
      await supabase.from('mention_audit_log').update({ audit_status: 'rejected', audit_verdict: 'wrong_match', audit_notes: 'bulk-judge: no name match' }).in('id', batch)
    }
    rejected += rejectRows.length

    for (let i = 0; i < flagRows.length; i += UPDATE_BATCH) {
      const batch = flagRows.slice(i, i + UPDATE_BATCH)
      await supabase.from('mention_audit_log').update({ audit_status: 'flagged', audit_verdict: 'borderline', audit_notes: 'bulk-judge: uncertain' }).in('id', batch)
    }
    flagged += flagRows.length

    rounds++
    if (rounds % 20 === 0) {
      console.log(`  Progress: ${approved + rejected + flagged} processed (${approved} approved, ${rejected} rejected, ${flagged} flagged)`)
    }

    if (data.length < BATCH) break
  }

  // Exclude rejected mentions (score=0 + lock)
  if (excludedIds.length > 0) {
    const EXCL_BATCH = 200
    for (let i = 0; i < excludedIds.length; i += EXCL_BATCH) {
      const batch = excludedIds.slice(i, i + EXCL_BATCH)
      await supabase.from('blog_mentions').update({ relevance_score: 0, mention_locked: true }).in('id', batch)
    }
  }

  console.log(`\nBulk judge complete:`)
  console.log(`  Approved (correct): ${approved}`)
  console.log(`  Rejected (wrong_match): ${rejected} (${excludedIds.length} mentions excluded)`)
  console.log(`  Flagged (borderline): ${flagged}`)
  console.log(`  Total: ${approved + rejected + flagged}`)
}

// ─── #2: Analyze flagged mentions — penalty_flags distribution ────────────────

async function analyzeFlagged(): Promise<void> {
  const BATCH = 500
  let cursor = 0
  const flagCounts: Record<string, number> = {}
  const scoreBuckets: Record<string, number> = { 'low(<0.4)': 0, 'border(0.4-0.5)': 0, 'mid(0.5-0.7)': 0, 'high(≥0.7)': 0 }
  let total = 0

  while (true) {
    const { data, error } = await supabase
      .from('mention_audit_log')
      .select('id, mention_id, relevance_score, penalty_flags, relevance_breakdown')
      .eq('audit_status', 'flagged')
      .order('id', { ascending: true })
      .gt('id', cursor)
      .limit(BATCH)

    if (error) { console.error('Error:', error.message); break }
    if (!data || data.length === 0) break

    // #1: Fetch current scores from blog_mentions
    const mentionIds = data.map(r => r.mention_id)
    const currentScores = new Map<number, number>()
    for (let i = 0; i < mentionIds.length; i += 200) {
      const batch = mentionIds.slice(i, i + 200)
      const { data: mentions } = await supabase
        .from('blog_mentions')
        .select('id, relevance_score')
        .in('id', batch)
      for (const m of mentions || []) {
        currentScores.set(m.id, m.relevance_score ?? 0)
      }
    }

    for (const row of data) {
      cursor = row.id
      total++
      // Use current blog_mentions score, fallback to audit_log score
      const score = currentScores.get(row.mention_id) ?? row.relevance_score ?? 0
      if (score >= 0.7) scoreBuckets['high(≥0.7)']++
      else if (score >= 0.5) scoreBuckets['mid(0.5-0.7)']++
      else if (score >= 0.4) scoreBuckets['border(0.4-0.5)']++
      else scoreBuckets['low(<0.4)']++

      const penalties = (row.penalty_flags || []) as string[]
      for (const p of penalties) {
        flagCounts[p] = (flagCounts[p] || 0) + 1
      }
      if (penalties.length === 0) {
        flagCounts['(no_penalty)'] = (flagCounts['(no_penalty)'] || 0) + 1
      }
    }

    if (data.length < BATCH) break
  }

  console.log(`\n=== Flagged Mention Analysis (${total}건) ===\n`)

  console.log('Score distribution:')
  for (const [bucket, cnt] of Object.entries(scoreBuckets)) {
    const pct = total > 0 ? Math.round(cnt / total * 100) : 0
    console.log(`  ${bucket}: ${cnt} (${pct}%)`)
  }

  console.log('\nPenalty flag distribution:')
  const sorted = Object.entries(flagCounts).sort((a, b) => b[1] - a[1])
  for (const [flag, cnt] of sorted) {
    const pct = total > 0 ? Math.round(cnt / total * 100) : 0
    console.log(`  ${flag}: ${cnt} (${pct}%)`)
  }

  // Suggest rules for most common patterns
  console.log('\nSuggested auto-rules:')
  for (const [flag, cnt] of sorted.slice(0, 5)) {
    if (cnt > total * 0.1) {
      console.log(`  ${flag} (${cnt}건) → Consider adding to bulkJudge reject/approve rules`)
    }
  }
  console.log('')
}

// ─── #4: Verify blog content — check if place name actually appears ──────────

async function verifyMention(auditId: number): Promise<void> {
  const { data: audit } = await supabase
    .from('mention_audit_log')
    .select('id, mention_id, place_name, blog_url, mention_title, relevance_score')
    .eq('id', auditId)
    .maybeSingle()

  if (!audit) { console.error(`Audit #${auditId} not found`); return }
  if (!audit.blog_url) { console.log(`Audit #${auditId} has no blog_url`); return }

  console.log(`\nVerifying audit #${auditId}:`)
  console.log(`  Place: "${audit.place_name}"`)
  console.log(`  URL: ${audit.blog_url}`)
  console.log(`  Score: ${audit.relevance_score}`)

  try {
    const response = await fetch(audit.blog_url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      console.log(`  ⚠ HTTP ${response.status} — cannot verify`)
      return
    }
    const html = await response.text()
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

    // Check if place name appears in blog content
    const placeName = audit.place_name || ''
    const nameTokens = placeName.replace(/[^가-힣a-zA-Z0-9]/g, ' ').split(/\s+/).filter(t => t.length >= 2)

    let found = 0
    for (const token of nameTokens) {
      if (text.includes(token)) found++
    }

    const matchRate = nameTokens.length > 0 ? found / nameTokens.length : 0
    if (matchRate >= 0.5) {
      console.log(`  ✓ Place name found in blog (${found}/${nameTokens.length} tokens matched)`)
    } else {
      console.log(`  ✗ Place name NOT found in blog (${found}/${nameTokens.length} tokens matched)`)
      console.log(`  → Likely false match — consider rejecting`)
    }
  } catch (err: any) {
    console.log(`  ⚠ Fetch error: ${err.message}`)
  }
}

async function verifyRandomApproved(count = 5): Promise<void> {
  // Sample random high-score approved mentions for verification
  const { count: total } = await supabase
    .from('mention_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'approved')
    .gte('relevance_score', 0.6)

  if (!total || total === 0) { console.log('No approved high-score mentions to verify'); return }

  console.log(`\nVerifying ${count} random approved mentions (score ≥ 0.6)...\n`)

  const offsets = new Set<number>()
  while (offsets.size < Math.min(count * 2, total)) {
    offsets.add(Math.floor(Math.random() * total))
  }

  let verified = 0
  for (const offset of offsets) {
    if (verified >= count) break
    const { data } = await supabase
      .from('mention_audit_log')
      .select('id')
      .eq('audit_status', 'approved')
      .gte('relevance_score', 0.6)
      .order('id', { ascending: true })
      .range(offset, offset)
      .limit(1)

    if (data && data.length > 0) {
      await verifyMention(data[0].id)
      verified++
    }
  }
}

// ─── #7: Validate bulk judge rules — random sample check ─────────────────────

async function validateBulk(count = 10): Promise<void> {
  // Sample recent bulk-judged entries for manual verification
  const { data, error } = await supabase
    .from('mention_audit_log')
    .select('id, mention_id, place_name, mention_title, mention_url, relevance_score, penalty_flags, audit_verdict, audit_notes')
    .like('audit_notes', 'bulk-judge%')
    .order('id', { ascending: false })
    .limit(count * 3)

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) { console.log('No bulk-judged entries found'); return }

  // Random sample
  const shuffled = data.sort(() => Math.random() - 0.5).slice(0, count)

  console.log(`\n=== Bulk Judge Validation (${shuffled.length}건) ===`)
  console.log('Review each entry to check if the auto-judgment was correct.\n')

  const ruleStats: Record<string, number> = {}

  for (const row of shuffled) {
    const rule = (row.audit_notes || '').replace('bulk-judge: ', '')
    ruleStats[rule] = (ruleStats[rule] || 0) + 1

    console.log(`[${row.audit_verdict?.toUpperCase()}] audit_id=${row.id} (rule: ${rule})`)
    console.log(`  Place: "${row.place_name}"`)
    console.log(`  Title: ${row.mention_title || '(none)'}`)
    console.log(`  Score: ${row.relevance_score?.toFixed(3) ?? '?'}`)
    if (row.penalty_flags?.length) console.log(`  Penalties: ${(row.penalty_flags as string[]).join(', ')}`)
    console.log(`  URL: ${row.mention_url || '(none)'}`)
    console.log('')
  }

  console.log('Rule distribution in sample:')
  for (const [rule, cnt] of Object.entries(ruleStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${cnt}`)
  }
  console.log('')
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--analyze-flagged')) {
    await analyzeFlagged()
  } else if (args.includes('--verify')) {
    const idx = args.indexOf('--verify')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) {
      // No specific ID — verify random approved
      const countIdx = args.indexOf('--count')
      const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 5 : 5
      await verifyRandomApproved(count)
    } else {
      await verifyMention(id)
    }
  } else if (args.includes('--validate-bulk')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await validateBulk(count)
  } else if (args.includes('--sample')) {
    const countIdx = args.indexOf('--random')
    const randomCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await sampleMentions(randomCount)
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
  } else if (args.includes('--bulk-judge')) {
    await bulkJudge()
  } else if (args.includes('--patterns')) {
    await showPatterns()
  } else if (args.includes('--config')) {
    showConfig()
  } else {
    console.log(`
Mention Audit CLI

Commands:
  --sample [--random N]         New (전수) + existing random (default: 10)
  --list [--limit N]            Pending audit entries
  --summary                     Statistics
  --correct <audit_id> [--note] Mark as correct match
  --wrong-match <audit_id>      Mark as wrong match
  --wrong-place <audit_id>      Mark as wrong place
  --borderline <audit_id>       Mark as borderline
  --exclude <mention_id>        Score=0 + lock (pipeline exclusion)
  --bulk-judge                  Auto-judge pending by documented rules
  --patterns                    Analyze wrong-match patterns
  --analyze-flagged             Penalty distribution of flagged mentions (#2)
  --verify [<audit_id>]         Verify blog content for place name (#4)
  --verify [--count N]          Verify N random approved (score≥0.6)
  --validate-bulk [--count N]   Validate bulk-judge accuracy (#7)
  --config                      Show relevance config
`)
  }

  process.exit(0)
}

main()
