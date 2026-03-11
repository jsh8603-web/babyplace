/**
 * One-time bulk cleanup — reduce Supabase DB size (~59MB savings after VACUUM).
 *
 * Targets:
 * 1. blog_mentions: 0 < score < 0.2 (90K rows, ~25MB)
 * 2. mention_audit_log: approved relevance_breakdown → NULL (116K rows, ~30MB)
 * 3. poster_audit_log: non-pending candidates → NULL (2.4K rows, ~2MB)
 * 4. place_accuracy_audit_log: non-pending check_result → NULL (2.8K rows, ~0.4MB)
 * 5. keyword_logs: >30d (2.5K rows)
 * 6. excluded_events: >60d (1.3K rows)
 * 7. collection_logs: >30d (300 rows)
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_bulk-cleanup.ts
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_bulk-cleanup.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n=== Bulk DB Cleanup ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`)

  // ── 1. blog_mentions: score > 0 AND score < 0.2 ──────────────────────
  // These are never shown in frontend (min filter 0.3) and have no info value.
  // Must delete FK children (mention_audit_log) first.
  console.log('── 1. blog_mentions 0 < score < 0.2 ──')

  // Count first
  const { count: lowScoreCount } = await supabase
    .from('blog_mentions')
    .select('id', { count: 'exact', head: true })
    .gt('relevance_score', 0)
    .lt('relevance_score', 0.2)
  console.log(`  Target: ${lowScoreCount ?? 0} rows`)

  let bmDeleted = 0
  if (!DRY_RUN && (lowScoreCount ?? 0) > 0) {
    while (true) {
      // Step 1: Get batch of IDs
      const { data: idBatch } = await supabase
        .from('blog_mentions')
        .select('id')
        .gt('relevance_score', 0)
        .lt('relevance_score', 0.2)
        .limit(100)
      if (!idBatch || idBatch.length === 0) break
      const ids = idBatch.map(r => r.id)

      // Step 2: Delete FK children first
      await supabase.from('mention_audit_log').delete().in('mention_id', ids)

      // Step 3: Delete blog_mentions
      const { error } = await supabase.from('blog_mentions').delete().in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      bmDeleted += ids.length
      if (bmDeleted % 5000 === 0) console.log(`  Progress: ${bmDeleted} deleted...`)
    }
  }
  console.log(`  Result: ${bmDeleted} deleted\n`)

  // ── 2. mention_audit_log: approved relevance_breakdown → NULL ─────────
  // Approved entries don't need breakdown data anymore (already processed).
  console.log('── 2. mention_audit_log approved JSONB trim ──')

  const { count: approvedJsonbCount } = await supabase
    .from('mention_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'approved')
    .not('relevance_breakdown', 'is', null)
  console.log(`  Target: ${approvedJsonbCount ?? 0} rows`)

  let jsonbTrimmed = 0
  if (!DRY_RUN && (approvedJsonbCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('mention_audit_log')
        .select('id')
        .eq('audit_status', 'approved')
        .not('relevance_breakdown', 'is', null)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase
        .from('mention_audit_log')
        .update({ relevance_breakdown: null, penalty_flags: null })
        .in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      jsonbTrimmed += ids.length
      if (jsonbTrimmed % 10000 === 0) console.log(`  Progress: ${jsonbTrimmed} trimmed...`)
    }
  }
  console.log(`  Result: ${jsonbTrimmed} trimmed\n`)

  // ── 3. poster_audit_log: non-pending candidates → NULL ────────────────
  console.log('── 3. poster_audit_log candidates JSONB trim ──')

  const { count: posterJsonbCount } = await supabase
    .from('poster_audit_log')
    .select('id', { count: 'exact', head: true })
    .neq('audit_status', 'pending')
    .not('candidates', 'is', null)
  console.log(`  Target: ${posterJsonbCount ?? 0} rows`)

  let posterTrimmed = 0
  if (!DRY_RUN && (posterJsonbCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('poster_audit_log')
        .select('id')
        .neq('audit_status', 'pending')
        .not('candidates', 'is', null)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase
        .from('poster_audit_log')
        .update({ candidates: null })
        .in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      posterTrimmed += ids.length
    }
  }
  console.log(`  Result: ${posterTrimmed} trimmed\n`)

  // ── 4. place_accuracy_audit_log: non-pending check_result → NULL ──────
  console.log('── 4. place_accuracy_audit_log check_result JSONB trim ──')

  const { count: placeJsonbCount } = await supabase
    .from('place_accuracy_audit_log')
    .select('id', { count: 'exact', head: true })
    .neq('audit_status', 'pending')
    .not('check_result', 'is', null)
  console.log(`  Target: ${placeJsonbCount ?? 0} rows`)

  let placeTrimmed = 0
  if (!DRY_RUN && (placeJsonbCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('place_accuracy_audit_log')
        .select('id')
        .neq('audit_status', 'pending')
        .not('check_result', 'is', null)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase
        .from('place_accuracy_audit_log')
        .update({ check_result: null })
        .in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      placeTrimmed += ids.length
    }
  }
  console.log(`  Result: ${placeTrimmed} trimmed\n`)

  // ── 5. keyword_logs >30d ──────────────────────────────────────────────
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  console.log('── 5. keyword_logs >30d ──')

  const { count: kwCount } = await supabase
    .from('keyword_logs')
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff30d)
  console.log(`  Target: ${kwCount ?? 0} rows`)

  let kwDeleted = 0
  if (!DRY_RUN && (kwCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('keyword_logs')
        .select('id')
        .lt('created_at', cutoff30d)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase.from('keyword_logs').delete().in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      kwDeleted += ids.length
    }
  }
  console.log(`  Result: ${kwDeleted} deleted\n`)

  // ── 6. excluded_events >60d ───────────────────────────────────────────
  const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  console.log('── 6. excluded_events >60d ──')

  const { count: exclCount } = await supabase
    .from('excluded_events')
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff60d)
  console.log(`  Target: ${exclCount ?? 0} rows`)

  let exclDeleted = 0
  if (!DRY_RUN && (exclCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('excluded_events')
        .select('id')
        .lt('created_at', cutoff60d)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase.from('excluded_events').delete().in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      exclDeleted += ids.length
    }
  }
  console.log(`  Result: ${exclDeleted} deleted\n`)

  // ── 7. collection_logs >30d ───────────────────────────────────────────
  console.log('── 7. collection_logs >30d ──')

  const { count: clCount } = await supabase
    .from('collection_logs')
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff30d)
  console.log(`  Target: ${clCount ?? 0} rows`)

  let clDeleted = 0
  if (!DRY_RUN && (clCount ?? 0) > 0) {
    while (true) {
      const { data: batch } = await supabase
        .from('collection_logs')
        .select('id')
        .lt('created_at', cutoff30d)
        .limit(500)
      if (!batch || batch.length === 0) break
      const ids = batch.map(r => r.id)
      const { error } = await supabase.from('collection_logs').delete().in('id', ids)
      if (error) { console.error('  Error:', error.message); break }
      clDeleted += ids.length
    }
  }
  console.log(`  Result: ${clDeleted} deleted\n`)

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('=== Summary ===')
  console.log(`  blog_mentions (score<0.2): ${bmDeleted} deleted`)
  console.log(`  mention_audit_log JSONB:   ${jsonbTrimmed} trimmed`)
  console.log(`  poster_audit_log JSONB:    ${posterTrimmed} trimmed`)
  console.log(`  place_audit_log JSONB:     ${placeTrimmed} trimmed`)
  console.log(`  keyword_logs:              ${kwDeleted} deleted`)
  console.log(`  excluded_events:           ${exclDeleted} deleted`)
  console.log(`  collection_logs:           ${clDeleted} deleted`)
  console.log(`\nNote: DB size reduction visible after auto-VACUUM (1-2 hours on Free Plan)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
