/**
 * Cleanup duplicate events — similarity-based grouping with blog_mentions migration.
 *
 * Algorithm:
 *   1. Load all visible events (is_hidden=false)
 *   2. O(n²) similarity grouping via Union-Find (Dice > 0.65 OR Dice > 0.5 + venue > 0.8)
 *   3. Pick survivor per group (source priority → end_date NOT NULL → source_url → mention_count)
 *   4. Migrate blog_mentions, merge stats, fill empty fields, delete victims
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/cleanup-duplicate-events.ts --dry-run
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/cleanup-duplicate-events.ts
 */

import { createClient } from '@supabase/supabase-js'
import { similarity, normalizePlaceName } from '../matchers/similarity'
import { normalizeEventName } from '../collectors/blog-event-discovery'

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

const NAME_SIMILARITY_THRESHOLD = 0.65
const SHORT_NAME_THRESHOLD = 0.75 // Stricter for short strings (≤12 chars) to avoid suffix false positives
const VENUE_ASSISTED_NAME_THRESHOLD = 0.5
const VENUE_SIMILARITY_THRESHOLD = 0.8

// ─── Union-Find ────────────────────────────────────────────────────────────

class UnionFind {
  private parent: Map<number, number> = new Map()

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // Path compression
    let curr = x
    while (curr !== root) {
      const next = this.parent.get(curr)!
      this.parent.set(curr, root)
      curr = next
    }
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }

  groups(): Map<number, number[]> {
    const result = new Map<number, number[]>()
    for (const key of this.parent.keys()) {
      const root = this.find(key)
      const group = result.get(root) || []
      group.push(key)
      result.set(root, group)
    }
    return result
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface EventRow {
  id: number
  name: string
  source: string
  venue_name: string | null
  start_date: string
  end_date: string | null
  mention_count: number | null
  popularity_score: number | null
  last_mentioned_at: string | null
  source_url: string | null
  poster_url: string | null
}

// ─── Survivor selection ────────────────────────────────────────────────────

function pickSurvivor(group: EventRow[]): EventRow {
  return group.sort((a, b) => {
    // 1. Source priority (lower = better)
    const pa = SOURCE_PRIORITY[a.source] ?? 99
    const pb = SOURCE_PRIORITY[b.source] ?? 99
    if (pa !== pb) return pa - pb

    // 2. end_date NOT NULL preferred
    const aHasEnd = a.end_date ? 0 : 1
    const bHasEnd = b.end_date ? 0 : 1
    if (aHasEnd !== bHasEnd) return aHasEnd - bHasEnd

    // 3. source_url present
    const aHasUrl = a.source_url ? 0 : 1
    const bHasUrl = b.source_url ? 0 : 1
    if (aHasUrl !== bHasUrl) return aHasUrl - bHasUrl

    // 4. Higher mention_count
    return (b.mention_count || 0) - (a.mention_count || 0)
  })[0]
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===')

  // Step 1: Load all visible events
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, source, venue_name, start_date, end_date, mention_count, popularity_score, last_mentioned_at, source_url, poster_url')
    .eq('is_hidden', false)
    .order('created_at', { ascending: true })

  if (error || !events) {
    console.error('Failed to fetch events:', error)
    process.exit(1)
  }

  console.log(`Loaded ${events.length} events`)

  // Step 2: Similarity-based grouping (O(n²), n≈174)
  const uf = new UnionFind()
  const normalized = events.map((e) => ({
    id: e.id,
    name: normalizeEventName(e.name),
    venue: normalizePlaceName(e.venue_name || ''),
  }))

  for (let i = 0; i < normalized.length; i++) {
    uf.find(normalized[i].id) // Ensure all nodes exist
    for (let j = i + 1; j < normalized.length; j++) {
      const nameSim = similarity(normalized[i].name, normalized[j].name)
      const shorter = Math.min(normalized[i].name.length, normalized[j].name.length)
      const nameThreshold = shorter <= 12 ? SHORT_NAME_THRESHOLD : NAME_SIMILARITY_THRESHOLD

      // Primary: name similarity above threshold
      if (nameSim > nameThreshold) {
        uf.union(normalized[i].id, normalized[j].id)
        continue
      }

      // Secondary: moderate name similarity + same venue
      if (nameSim > VENUE_ASSISTED_NAME_THRESHOLD && normalized[i].venue && normalized[j].venue) {
        if (similarity(normalized[i].venue, normalized[j].venue) > VENUE_SIMILARITY_THRESHOLD) {
          uf.union(normalized[i].id, normalized[j].id)
        }
      }
    }
  }

  // Extract duplicate groups (size >= 2)
  const eventMap = new Map(events.map((e) => [e.id, e]))
  const allGroups = uf.groups()
  const dupGroups: EventRow[][] = []

  for (const [, ids] of allGroups) {
    if (ids.length < 2) continue
    dupGroups.push(ids.map((id) => eventMap.get(id)!))
  }

  if (dupGroups.length === 0) {
    console.log('No duplicate groups found.')
    return
  }

  console.log(`\nFound ${dupGroups.length} duplicate groups:\n`)

  let totalVictims = 0
  const mergeOps: { survivor: EventRow; victims: EventRow[] }[] = []

  for (const group of dupGroups) {
    const survivor = pickSurvivor(group)
    const victims = group.filter((e) => e.id !== survivor.id)
    totalVictims += victims.length

    console.log(`  Group: "${survivor.name}"`)
    console.log(`    KEEP:   [${survivor.source}] id:${survivor.id} "${survivor.name}" (mentions:${survivor.mention_count || 0})`)
    for (const v of victims) {
      console.log(`    DELETE: [${v.source}] id:${v.id} "${v.name}" (mentions:${v.mention_count || 0})`)
    }
    console.log()

    mergeOps.push({ survivor, victims })
  }

  console.log(`Total: ${totalVictims} victims across ${dupGroups.length} groups`)

  if (dryRun) {
    console.log('\nDry run — no changes performed.')
    return
  }

  // Step 3+4: Merge and delete
  let mentionsMigrated = 0
  let victimsDeleted = 0

  for (const { survivor, victims } of mergeOps) {
    const victimIds = victims.map((v) => v.id)

    // A. Migrate blog_mentions
    const { count } = await supabase
      .from('blog_mentions')
      .update({ event_id: survivor.id })
      .in('event_id', victimIds)
      .select('id', { count: 'exact', head: true })

    if (count && count > 0) {
      mentionsMigrated += count
      console.log(`  Migrated ${count} blog_mentions → survivor ${survivor.id}`)
    }

    // B. Merge stats into survivor
    const mergedMentions = victims.reduce((sum, v) => sum + (v.mention_count || 0), survivor.mention_count || 0)
    const mergedPopularity = Math.max(survivor.popularity_score || 0, ...victims.map((v) => v.popularity_score || 0))
    const allDates = [survivor.last_mentioned_at, ...victims.map((v) => v.last_mentioned_at)].filter(Boolean) as string[]
    const mergedLastMentioned = allDates.length > 0 ? allDates.sort().pop()! : null

    const updatePayload: Record<string, unknown> = {
      mention_count: mergedMentions,
      popularity_score: mergedPopularity,
      last_mentioned_at: mergedLastMentioned,
    }

    // Fill empty fields from victims (COALESCE behavior)
    if (!survivor.source_url) {
      const donorUrl = victims.find((v) => v.source_url)?.source_url
      if (donorUrl) updatePayload.source_url = donorUrl
    }
    if (!survivor.poster_url) {
      const donorPoster = victims.find((v) => v.poster_url)?.poster_url
      if (donorPoster) updatePayload.poster_url = donorPoster
    }

    await supabase.from('events').update(updatePayload).eq('id', survivor.id)

    // C. Delete victims (favorites, user_hidden_items cascade via FK)
    const { error: delErr } = await supabase.from('events').delete().in('id', victimIds)
    if (delErr) {
      console.error(`  Delete error for group "${survivor.name}":`, delErr.message)
    } else {
      victimsDeleted += victimIds.length
    }
  }

  console.log(`\nDone: ${victimsDeleted} events deleted, ${mentionsMigrated} blog_mentions migrated`)
}

main().catch(console.error)
