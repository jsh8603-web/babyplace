/**
 * Cleanup duplicate events across sources.
 *
 * Source priority: seoul_events > tour_api > blog_discovery > exhibition_extraction
 * Events with same normalized name + overlapping dates → keep highest priority source.
 *
 * Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/cleanup-duplicate-events.ts
 */

import { createClient } from '@supabase/supabase-js'
import { normalizePlaceName } from '../matchers/similarity'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SOURCE_PRIORITY: Record<string, number> = {
  seoul_events: 1,
  tour_api: 2,
  blog_discovery: 3,
  exhibition_extraction: 4,
}

function normalizeEventName(name: string): string {
  return normalizePlaceName(
    name
      .replace(/\d{4}/g, '')
      .replace(/서울|경기|인천|수원|성남|부산|대구|대전|광주|고양|용인|부천|안산|안양/g, '')
      .replace(/[\s\-]+/g, '')
  )
}

function datesOverlap(a: { start_date: string; end_date: string | null }, b: { start_date: string; end_date: string | null }): boolean {
  const aEnd = a.end_date || a.start_date
  const bEnd = b.end_date || b.start_date
  return a.start_date <= bEnd && aEnd >= b.start_date
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // Fetch all active events
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, source, start_date, end_date')
    .gte('end_date', new Date().toISOString().split('T')[0])
    .order('created_at', { ascending: true })

  if (error || !events) {
    console.error('Failed to fetch events:', error)
    process.exit(1)
  }

  console.log(`Loaded ${events.length} active events`)

  // Group by normalized name
  const groups = new Map<string, typeof events>()
  for (const ev of events) {
    const key = normalizeEventName(ev.name)
    if (!key) continue
    const group = groups.get(key) || []
    group.push(ev)
    groups.set(key, group)
  }

  const toDelete = new Set<number>()

  for (const [key, group] of groups) {
    if (group.length < 2) continue

    // Sort by source priority (keep highest priority = lowest number)
    group.sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99))

    // Keep the first (highest priority), delete rest that overlap with it
    for (let i = 1; i < group.length; i++) {
      if (toDelete.has(group[i].id)) continue
      if (datesOverlap(group[0], group[i])) {
        toDelete.add(group[i].id)
      }
    }
  }

  const deleteIds = [...toDelete]
  console.log(`Found ${deleteIds.length} duplicate events to delete`)

  if (deleteIds.length === 0) {
    console.log('No duplicates found.')
    return
  }

  // Show what will be deleted
  const deleteEvents = events.filter((e) => toDelete.has(e.id))
  for (const ev of deleteEvents.slice(0, 20)) {
    console.log(`  DELETE: [${ev.source}] ${ev.name} (${ev.start_date} ~ ${ev.end_date})`)
  }
  if (deleteEvents.length > 20) console.log(`  ... and ${deleteEvents.length - 20} more`)

  if (dryRun) {
    console.log('Dry run — no deletions performed.')
    return
  }

  // Delete in batches of 100
  for (let i = 0; i < deleteIds.length; i += 100) {
    const batch = deleteIds.slice(i, i + 100)
    const { error: delErr } = await supabase.from('events').delete().in('id', batch)
    if (delErr) {
      console.error(`Delete batch error:`, delErr)
    }
  }

  console.log(`Deleted ${deleteIds.length} duplicate events.`)
}

main().catch(console.error)
