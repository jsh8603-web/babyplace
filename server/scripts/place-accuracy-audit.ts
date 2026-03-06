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

async function samplePlaces(count = 15): Promise<void> {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, category, address, lat, lng, phone, source, kakao_place_id, created_at')
    .eq('is_active', true)
    .order('id', { ascending: false })
    .limit(count * 2)

  if (error) { console.error('Error:', error.message); return }
  if (!data || data.length === 0) { console.log('No active places found.'); return }

  // Exclude already audited
  const placeIds = data.map((d: any) => d.id)
  const { data: existing } = await supabase
    .from('place_accuracy_audit_log')
    .select('place_id')
    .in('place_id', placeIds)

  const existingSet = new Set((existing || []).map((a: any) => a.place_id))

  let sampled = 0
  for (const place of data) {
    if (existingSet.has(place.id)) continue
    if (sampled >= count) break

    const { error: insertErr } = await supabase.from('place_accuracy_audit_log').insert({
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

    if (!insertErr) sampled++
  }

  console.log(`Sampled ${sampled} places for accuracy audit`)
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
        const overlap = [...tokens1].filter(t => tokens2.has(t)).length
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

// ─── CLI Parser ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--sample')) {
    const countIdx = args.indexOf('--count')
    const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) || 15 : 15
    await samplePlaces(count)
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
  --sample [--count N]         Random active places (default: 15)
  --revalidate <place_id>      Kakao API re-verify (폐업/이전 check)
  --check-dupes [--count N]    Find duplicate suspects (<100m, similar name)
  --list [--limit N]           Pending audit entries
  --summary                    Statistics
  --correct <audit_id>         Mark as accurate
  --inaccurate <audit_id>      Mark as inaccurate [--note]
  --closed <audit_id>          Mark as closed/moved
  --duplicate <audit_id>       Mark as duplicate
`)
  }

  process.exit(0)
}

main()
