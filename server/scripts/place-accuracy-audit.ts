/**
 * Place accuracy audit CLI — verify place data quality.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/place-accuracy-audit.ts --sample
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/place-accuracy-audit.ts --check-dupes
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/place-accuracy-audit.ts --list
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/place-accuracy-audit.ts --summary
 */

import { createClient } from '@supabase/supabase-js'
import { searchKakaoPlace } from '../lib/kakao-search'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Commands ────────────────────────────────────────────────────────────────

async function samplePlaces(randomCount = 10): Promise<void> {
  const SELECT = 'id, name, category, address, lat, lng, phone, source, kakao_place_id, created_at'

  // Find the highest place_id already audited — everything above is "new"
  const { data: maxRow } = await supabase
    .from('place_accuracy_audit_log')
    .select('place_id')
    .order('place_id', { ascending: false })
    .limit(1)
  const lastAuditedId = maxRow?.[0]?.place_id ?? 0

  // --- 1) New places (전수 배치): id > lastAuditedId ---
  let newSampled = 0
  const BATCH = 200

  // Pre-fetch already-audited place_ids for fast skip
  const auditedPlaceIds = new Set<number>()
  let aOffset = 0
  while (true) {
    const { data: aRows } = await supabase
      .from('place_accuracy_audit_log')
      .select('place_id')
      .gt('place_id', lastAuditedId)
      .range(aOffset, aOffset + 999)
    if (!aRows || aRows.length === 0) break
    for (const r of aRows) auditedPlaceIds.add(r.place_id)
    if (aRows.length < 1000) break
    aOffset += 1000
  }

  let page = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('places')
      .select(SELECT)
      .eq('is_active', true)
      .gt('id', lastAuditedId)
      .order('id', { ascending: true })
      .range(page * BATCH, (page + 1) * BATCH - 1)

    if (error) { console.error('Error fetching new places:', error.message); break }
    if (!batch || batch.length === 0) break

    const toInsert: any[] = []
    for (const place of batch) {
      if (auditedPlaceIds.has(place.id)) continue
      toInsert.push({
        place_id: place.id,
        place_name: place.name,
        place_category: place.category,
        check_type: 'data_accuracy',
        check_result: {
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          phone: place.phone,
          source: place.source,
          kakao_place_id: place.kakao_place_id,
        },
        place_source: place.source,
        place_created_at: place.created_at,
      })
    }
    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from('place_accuracy_audit_log').insert(toInsert)
      if (insertErr) console.error('Batch insert error:', insertErr.message)
      else newSampled += toInsert.length
    }

    if (batch.length < BATCH) break
    page++
  }

  // --- 2) Existing places (기존 랜덤 샘플): random from id <= lastAuditedId ---
  let existingSampled = 0
  if (randomCount > 0 && lastAuditedId > 0) {
    const { count: total } = await supabase
      .from('places')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .lte('id', lastAuditedId)

    if (total && total > 0) {
      const offsets = new Set<number>()
      const attempts = randomCount * 3
      while (offsets.size < Math.min(attempts, total)) {
        offsets.add(Math.floor(Math.random() * total))
      }

      for (const offset of Array.from(offsets)) {
        if (existingSampled >= randomCount) break
        const { data: rRow } = await supabase
          .from('places')
          .select(SELECT)
          .eq('is_active', true)
          .lte('id', lastAuditedId)
          .order('id', { ascending: false })
          .range(offset, offset)
          .limit(1)
        if (rRow && rRow.length > 0) {
          const inserted = await insertPlaceAuditEntry(rRow[0])
          if (inserted) existingSampled++
        }
      }
    }
  }

  console.log(`Place audit: ${newSampled} new (전수) + ${existingSampled} existing (랜덤) = ${newSampled + existingSampled} total`)
}

async function insertPlaceAuditEntry(place: any): Promise<boolean> {
  // Check if already audited
  const { data: exists } = await supabase
    .from('place_accuracy_audit_log')
    .select('id')
    .eq('place_id', place.id)
    .limit(1)
  if (exists && exists.length > 0) return false

  const { error } = await supabase.from('place_accuracy_audit_log').insert({
    place_id: place.id,
    place_name: place.name,
    place_category: place.category,
    check_type: 'data_accuracy',
    check_result: {
      address: place.address,
      lat: place.lat,
      lng: place.lng,
      phone: place.phone,
      source: place.source,
      kakao_place_id: place.kakao_place_id,
      },
      place_source: place.source,
      place_created_at: place.created_at,
    })
  return !error
}

async function checkDuplicates(count = 15): Promise<void> {
  // Find potential duplicates: same category, within ~100m, similar names
  const { data, error } = await supabase
    .from('places')
    .select('id, name, category, lat, lng, address')
    .eq('is_active', true)
    .order('id', { ascending: true })

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) return

  const suspects: { p1: any; p2: any; distance: number }[] = []

  // Simple O(n^2) check limited to count * 10 comparisons
  for (let i = 0; i < data.length && suspects.length < count; i++) {
    const p1 = data[i]
    if (!p1.lat || !p1.lng) continue

    for (let j = i + 1; j < data.length && suspects.length < count; j++) {
      const p2 = data[j]
      if (!p2.lat || !p2.lng) continue
      if (p1.category !== p2.category) continue

      // Approximate distance (meters)
      const dlat = (p1.lat - p2.lat) * 111000
      const dlng = (p1.lng - p2.lng) * 111000 * Math.cos(p1.lat * Math.PI / 180)
      const dist = Math.sqrt(dlat * dlat + dlng * dlng)

      if (dist < 100) {
        // Check name similarity (simple token overlap)
        const tokens1 = new Set(p1.name.replace(/[^가-힣a-zA-Z0-9]/g, ' ').toLowerCase().split(/\s+/))
        const tokens2 = new Set(p2.name.replace(/[^가-힣a-zA-Z0-9]/g, ' ').toLowerCase().split(/\s+/))
        const overlap = Array.from(tokens1).filter(t => tokens2.has(t)).length
        const maxLen = Math.max(tokens1.size, tokens2.size)
        if (maxLen > 0 && overlap / maxLen > 0.5) {
          suspects.push({ p1, p2, distance: Math.round(dist) })
        }
      }
    }
  }

  let sampled = 0
  for (const s of suspects) {
    const { error: insertErr } = await supabase.from('place_accuracy_audit_log').insert({
      place_id: s.p1.id,
      place_name: s.p1.name,
      place_category: s.p1.category,
      check_type: 'duplicate_suspect',
      check_result: {
        other_place_id: s.p2.id,
        other_name: s.p2.name,
        distance_m: s.distance,
        p1_address: s.p1.address,
        p2_address: s.p2.address,
      },
    })
    if (!insertErr) sampled++
  }

  console.log(`Found ${sampled} duplicate suspects (within 100m, similar names)`)
}

async function listPending(limit = 50): Promise<void> {
  const { data, error } = await supabase
    .from('place_accuracy_audit_log')
    .select('*')
    .eq('audit_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { console.error('Error:', error.message); return }

  const { count } = await supabase
    .from('place_accuracy_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('audit_status', 'pending')

  console.log(`\n=== Place Accuracy Audit — Pending (${count ?? data?.length ?? 0}건) ===\n`)

  for (const row of data || []) {
    console.log(`[${row.check_type.toUpperCase()}] audit_id=${row.id} place=${row.place_id}`)
    console.log(`  Name: "${row.place_name}" (${row.place_category})`)
    if (row.check_result) {
      const cr = row.check_result as Record<string, any>
      if (row.check_type === 'duplicate_suspect') {
        console.log(`  Suspect: place_id=${cr.other_place_id} "${cr.other_name}" (${cr.distance_m}m)`)
      } else {
        console.log(`  Address: ${cr.address || '(none)'}`)
        console.log(`  Source: ${cr.source || '?'}, Kakao: ${cr.kakao_place_id || 'none'}`)
      }
    }
    console.log('')
  }
}

async function showSummary(): Promise<void> {
  const statusCounts: Record<string, number> = {}
  for (const status of ['pending', 'approved', 'rejected']) {
    const { count } = await supabase
      .from('place_accuracy_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('audit_status', status)
    statusCounts[status] = count ?? 0
  }
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  console.log(`\n=== Place Accuracy Audit Summary ===`)
  console.log(`Total: ${total}, Pending: ${statusCounts.pending}, Approved: ${statusCounts.approved}, Rejected: ${statusCounts.rejected}`)

  // By check_type
  const { data: typeRows } = await supabase
    .from('place_accuracy_audit_log')
    .select('check_type, audit_verdict')
    .neq('audit_status', 'pending')

  if (typeRows && typeRows.length > 0) {
    const byType: Record<string, Record<string, number>> = {}
    for (const r of typeRows) {
      if (!byType[r.check_type]) byType[r.check_type] = {}
      const v = r.audit_verdict || 'unknown'
      byType[r.check_type][v] = (byType[r.check_type][v] || 0) + 1
    }
    console.log('\nBy check type:')
    for (const [type, counts] of Object.entries(byType)) {
      console.log(`  ${type}: ${JSON.stringify(counts)}`)
    }
  }
  console.log('')
}

async function revalidatePlace(placeId: number): Promise<void> {
  const { data: place, error } = await supabase
    .from('places')
    .select('id, name, category, address, road_address, lat, lng, phone, kakao_place_id')
    .eq('id', placeId)
    .single()

  if (error || !place) { console.error('Place not found:', error?.message); return }

  console.log(`\nRevalidating place #${placeId}: "${place.name}" (${place.category})`)
  console.log(`  DB address: ${place.address || place.road_address || '(none)'}`)
  console.log(`  DB phone: ${place.phone || '(none)'}`)

  const kakaoResult = await searchKakaoPlace(place.name, place.address)

  if (!kakaoResult) {
    console.log(`  Kakao: NOT FOUND — possibly closed or moved`)

    const { error: insertErr } = await supabase.from('place_accuracy_audit_log').insert({
      place_id: place.id,
      place_name: place.name,
      place_category: place.category,
      check_type: 'closed_moved',
      check_result: {
        kakao_status: 'not_found',
        db_address: place.address,
        db_phone: place.phone,
      },
      audit_verdict: 'closed',
    })
    if (insertErr) console.error('  Audit log error:', insertErr.message)
    else console.log('  → Audit entry created (verdict: closed)')
    return
  }

  // Compare DB vs Kakao data
  const diffs: string[] = []
  if (place.phone && kakaoResult.phone && place.phone !== kakaoResult.phone) {
    diffs.push(`phone: "${place.phone}" → "${kakaoResult.phone}"`)
  }
  if (place.address && kakaoResult.address && place.address !== kakaoResult.address) {
    diffs.push(`address: "${place.address}" → "${kakaoResult.address}"`)
  }
  if (place.name !== kakaoResult.name) {
    diffs.push(`name: "${place.name}" → "${kakaoResult.name}"`)
  }

  // Check distance between DB coords and Kakao coords
  let distanceM = 0
  if (place.lat && place.lng) {
    const dlat = (place.lat - kakaoResult.lat) * 111000
    const dlng = (place.lng - kakaoResult.lng) * 111000 * Math.cos(place.lat * Math.PI / 180)
    distanceM = Math.round(Math.sqrt(dlat * dlat + dlng * dlng))
    if (distanceM > 50) diffs.push(`moved ~${distanceM}m`)
  }

  const verdict = diffs.length === 0 ? 'accurate' : (distanceM > 200 ? 'moved' : 'inaccurate')

  console.log(`  Kakao: "${kakaoResult.name}" (sim=${kakaoResult.similarity.toFixed(3)})`)
  console.log(`  Kakao address: ${kakaoResult.address}`)
  console.log(`  Kakao phone: ${kakaoResult.phone || '(none)'}`)
  if (diffs.length > 0) console.log(`  Diffs: ${diffs.join(', ')}`)
  else console.log(`  No differences found`)

  const { error: insertErr } = await supabase.from('place_accuracy_audit_log').insert({
    place_id: place.id,
    place_name: place.name,
    place_category: place.category,
    check_type: 'closed_moved',
    check_result: {
      kakao_name: kakaoResult.name,
      kakao_address: kakaoResult.address,
      kakao_phone: kakaoResult.phone,
      kakao_similarity: kakaoResult.similarity,
      distance_m: distanceM,
      diffs,
    },
    audit_verdict: verdict,
  })
  if (insertErr) console.error('  Audit log error:', insertErr.message)
  else console.log(`  → Audit entry created (verdict: ${verdict})`)
}

async function setVerdict(auditId: number, verdict: string, note?: string): Promise<void> {
  const update: Record<string, any> = { audit_verdict: verdict, audit_status: 'approved' }
  if (note) update.audit_notes = note

  const { error } = await supabase
    .from('place_accuracy_audit_log')
    .update(update)
    .eq('id', auditId)

  if (error) console.error('Error:', error.message)
  else console.log(`Set audit #${auditId} → ${verdict}${note ? ` (${note})` : ''}`)
}

const NOT_BABY_FRIENDLY_PATTERNS = /주점|술집|호프|바\s*$|타이어|자동차|중고차|묘지|납골|주유소|부동산|인테리어|여행사|모텔|사우나|노래방|당구|사격|볼링|PC방|피씨방|게임방|세차|렌터카|장의사|축산|도축|철물/

async function batchRevalidate(count = 5): Promise<void> {
  // Random sample of old places for Kakao re-verification
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

  const { count: total } = await supabase
    .from('places')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .lt('created_at', sixMonthsAgo)

  if (!total || total === 0) {
    console.log('No old places to revalidate')
    return
  }

  const offsets = new Set<number>()
  while (offsets.size < Math.min(count * 3, total)) {
    offsets.add(Math.floor(Math.random() * total))
  }

  let revalidated = 0
  for (const offset of offsets) {
    if (revalidated >= count) break

    const { data } = await supabase
      .from('places')
      .select('id')
      .eq('is_active', true)
      .lt('created_at', sixMonthsAgo)
      .order('id', { ascending: true })
      .range(offset, offset)
      .limit(1)

    if (data && data.length > 0) {
      await revalidatePlace(data[0].id)
      revalidated++
      // Rate limit Kakao API calls
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`\nBatch revalidation complete: ${revalidated} places checked`)
}

async function bulkJudgePlaces(): Promise<void> {
  const BATCH = 500
  let cursor = 0
  let approved = 0, flagged = 0

  while (true) {
    const { data, error } = await supabase
      .from('place_accuracy_audit_log')
      .select('id, place_name, place_category, check_type, check_result')
      .eq('audit_status', 'pending')
      .eq('check_type', 'data_accuracy')
      .order('id', { ascending: true })
      .gt('id', cursor)
      .limit(BATCH)

    if (error) { console.error('Error:', error.message); break }
    if (!data || data.length === 0) break

    const approveRows: number[] = []
    const flagRows: number[] = []

    for (const row of data) {
      cursor = row.id
      const name = row.place_name || ''
      const cr = (row.check_result || {}) as Record<string, any>
      const source = cr.source || ''

      if (NOT_BABY_FRIENDLY_PATTERNS.test(name)) {
        flagRows.push(row.id)
      } else {
        approveRows.push(row.id)
      }
    }

    if (approveRows.length > 0) {
      await supabase.from('place_accuracy_audit_log').update({ audit_status: 'approved', audit_verdict: 'accurate', audit_notes: 'bulk-judge: auto-approve' }).in('id', approveRows)
      approved += approveRows.length
    }
    if (flagRows.length > 0) {
      await supabase.from('place_accuracy_audit_log').update({ audit_status: 'flagged', audit_verdict: 'flagged', audit_notes: 'bulk-judge: not-baby-friendly name pattern' }).in('id', flagRows)
      flagged += flagRows.length
    }

    if (data.length < BATCH) break
  }

  console.log(`\nPlace bulk judge complete:`)
  console.log(`  Approved (accurate): ${approved}`)
  console.log(`  Flagged (review needed): ${flagged}`)
  console.log(`  Total: ${approved + flagged}`)
}

// ─── #7: Validate bulk judge rules — random sample check ─────────────────────

async function validateBulkPlace(count = 10): Promise<void> {
  const { data, error } = await supabase
    .from('place_accuracy_audit_log')
    .select('id, place_id, place_name, place_category, audit_verdict, audit_notes, check_result')
    .like('audit_notes', 'bulk-judge%')
    .order('id', { ascending: false })
    .limit(count * 3)

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) { console.log('No bulk-judged place entries found'); return }

  const shuffled = data.sort(() => Math.random() - 0.5).slice(0, count)

  console.log(`\n=== Place Bulk Judge Validation (${shuffled.length}건) ===`)
  console.log('Review each entry to check if auto-judgment was correct.\n')

  for (const row of shuffled) {
    const rule = (row.audit_notes || '').replace('bulk-judge: ', '')
    const cr = (row.check_result || {}) as Record<string, any>
    console.log(`[${row.audit_verdict?.toUpperCase()}] audit_id=${row.id} (rule: ${rule})`)
    console.log(`  Place: "${row.place_name}" (${row.place_category})`)
    console.log(`  Source: ${cr.source || '?'}, Address: ${cr.address || '(none)'}`)
    console.log('')
  }
}

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--validate-bulk')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await validateBulkPlace(count)
  } else if (args.includes('--sample')) {
    const countIdx = args.indexOf('--random')
    const randomCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 10 : 10
    await samplePlaces(randomCount)
  } else if (args.includes('--revalidate')) {
    const idx = args.indexOf('--revalidate')
    const placeId = parseInt(args[idx + 1])
    if (isNaN(placeId)) { console.error('Usage: --revalidate <place_id>'); return }
    await revalidatePlace(placeId)
  } else if (args.includes('--check-dupes')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 15 : 15
    await checkDuplicates(count)
  } else if (args.includes('--list')) {
    const limitIdx = args.indexOf('--limit')
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : 50
    await listPending(limit)
  } else if (args.includes('--summary')) {
    await showSummary()
  } else if (args.includes('--batch-revalidate')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 5 : 5
    await batchRevalidate(count)
  } else if (args.includes('--bulk-judge')) {
    await bulkJudgePlaces()
  } else if (args.includes('--correct') || args.includes('--accurate')) {
    const flag = args.includes('--correct') ? '--correct' : '--accurate'
    const idx = args.indexOf(flag)
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error(`Usage: ${flag} <audit_id>`); return }
    await setVerdict(id, 'accurate')
  } else if (args.includes('--inaccurate')) {
    const idx = args.indexOf('--inaccurate')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --inaccurate <audit_id> [--note]'); return }
    const noteIdx = args.indexOf('--note')
    const note = noteIdx >= 0 ? args[noteIdx + 1] : undefined
    await setVerdict(id, 'inaccurate', note)
  } else if (args.includes('--closed')) {
    const idx = args.indexOf('--closed')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --closed <audit_id>'); return }
    await setVerdict(id, 'closed')
  } else if (args.includes('--duplicate')) {
    const idx = args.indexOf('--duplicate')
    const id = parseInt(args[idx + 1])
    if (isNaN(id)) { console.error('Usage: --duplicate <audit_id>'); return }
    await setVerdict(id, 'duplicate')
  } else {
    console.log(`
Place Accuracy Audit CLI

Commands:
  --sample [--random N]        New places (전수) + existing random (default: 10)
  --revalidate <place_id>      Kakao API re-verify (폐업/이전 check)
  --batch-revalidate [--count] Random old places Kakao re-verify (#10)
  --check-dupes [--count N]    Find duplicate suspects (<100m, similar name)
  --list [--limit N]           Pending audit entries
  --summary                    Statistics
  --bulk-judge                 Auto-judge pending by name patterns
  --validate-bulk [--count N]  Validate bulk-judge accuracy (#7)
  --correct <audit_id>         Mark as accurate
  --inaccurate <audit_id>      Mark as inaccurate [--note]
  --closed <audit_id>          Mark as closed/moved
  --duplicate <audit_id>       Mark as duplicate
`)
  }

  process.exit(0)
}

main()
