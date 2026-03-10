/**
 * One-time cleanup script: Find and merge duplicate active places.
 *
 * Strategy:
 *   1. Load all active places
 *   2. Find pairs within 200m with name similarity > 0.7 or name containment
 *   3. Choose keeper (prefer: kakao_place_id without prefix > more mentions > lower id)
 *   4. Migrate blog_mentions from loser to keeper
 *   5. Deactivate loser
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_cleanup-duplicate-places.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'
import { similarity } from '../matchers/similarity'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')

interface Place {
  id: number
  name: string
  category: string
  lat: number | null
  lng: number | null
  source: string | null
  kakao_place_id: string | null
  mention_count: number
  created_at: string
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function normalize(n: string) { return n.replace(/\s+/g, '').replace(/[()（）]/g, '') }

/** Score a place for keeper selection (higher = better to keep) */
function keeperScore(p: Place): number {
  let score = 0
  // Prefer real kakao_place_id (no prefix)
  if (p.kakao_place_id && /^\d+$/.test(p.kakao_place_id)) score += 100
  // Prefer more mentions
  score += (p.mention_count ?? 0) * 10
  // Prefer kakao source
  if (p.source === 'kakao') score += 50
  if (p.source === 'auto_promoted') score += 30
  // Prefer lower id (older = more established)
  score -= p.id * 0.0001
  return score
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===')

  // Load all active places
  const all: Place[] = []
  let from = 0
  while (true) {
    const { data } = await supabase.from('places')
      .select('id, name, category, lat, lng, source, kakao_place_id, mention_count, created_at')
      .eq('is_active', true)
      .range(from, from + 999)
      .order('id')
    if (!data || data.length === 0) break
    all.push(...(data as Place[]))
    from += 1000
  }
  console.log(`Loaded ${all.length} active places`)

  // Find duplicate pairs
  const pairs: { a: Place; b: Place; dist: number; sim: number }[] = []
  for (let i = 0; i < all.length; i++) {
    const a = all[i]
    if (!a.lat || !a.lng) continue
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]
      if (!b.lat || !b.lng) continue
      const dist = haversine(a.lat, a.lng, b.lat, b.lng)
      if (dist > 300) continue
      const sim = similarity(a.name, b.name)
      const na = normalize(a.name), nb = normalize(b.name)
      // Substring containment only valid when shorter name is at least 60% of longer
      const lenRatio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length)
      const isContained = (na.includes(nb) || nb.includes(na)) && lenRatio >= 0.6
      // Require higher similarity (0.85) to avoid false positives like
      // "에버랜드 매직스윙" vs "에버랜드 매직랜드" (sim ~0.73)
      if (sim > 0.85 || (isContained && sim > 0.5)) {
        // Exclude pairs where only digits differ (e.g. "제1동굴" vs "제3동굴")
        const digitsA = na.replace(/[^\d]/g, '')
        const digitsB = nb.replace(/[^\d]/g, '')
        const textA = na.replace(/\d/g, '')
        const textB = nb.replace(/\d/g, '')
        if (textA === textB && digitsA !== digitsB) continue

        pairs.push({ a, b, dist: Math.round(dist), sim })
      }
    }
  }
  console.log(`Found ${pairs.length} duplicate pairs`)

  // Group into clusters (transitive closure via union-find)
  const parent = new Map<number, number>()
  function find(x: number): number {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(x: number, y: number) {
    const px = find(x), py = find(y)
    if (px !== py) parent.set(px, py)
  }

  for (const p of pairs) {
    union(p.a.id, p.b.id)
  }

  // Build clusters
  const clusters = new Map<number, Set<number>>()
  const placeMap = new Map<number, Place>()
  for (const p of all) placeMap.set(p.id, p)

  for (const p of pairs) {
    for (const place of [p.a, p.b]) {
      const root = find(place.id)
      if (!clusters.has(root)) clusters.set(root, new Set())
      clusters.get(root)!.add(place.id)
    }
  }

  console.log(`Grouped into ${clusters.size} clusters`)

  // Process each cluster
  let deactivated = 0
  let mentionsMigrated = 0

  for (const [, ids] of clusters) {
    const places = Array.from(ids).map(id => placeMap.get(id)!).filter(Boolean)
    if (places.length < 2) continue

    // Sort by keeper score descending — first one is the keeper
    places.sort((a, b) => keeperScore(b) - keeperScore(a))
    const keeper = places[0]
    const losers = places.slice(1)

    console.log(`\nCluster: keeper=${keeper.id} "${keeper.name}" (${keeper.source}, mc=${keeper.mention_count})`)
    for (const loser of losers) {
      console.log(`  deactivate=${loser.id} "${loser.name}" (${loser.source}, mc=${loser.mention_count}, dist from keeper)`)

      if (!DRY_RUN) {
        // Migrate blog_mentions
        const { data: mentions } = await supabase
          .from('blog_mentions')
          .select('id')
          .eq('place_id', loser.id)
        const migrateCount = mentions?.length ?? 0

        if (migrateCount > 0) {
          await supabase
            .from('blog_mentions')
            .update({ place_id: keeper.id })
            .eq('place_id', loser.id)
          mentionsMigrated += migrateCount
        }

        // Add mention counts
        if ((loser.mention_count ?? 0) > 0) {
          await supabase
            .from('places')
            .update({ mention_count: (keeper.mention_count ?? 0) + (loser.mention_count ?? 0) })
            .eq('id', keeper.id)
          keeper.mention_count += loser.mention_count ?? 0
        }

        // Deactivate loser
        await supabase
          .from('places')
          .update({ is_active: false })
          .eq('id', loser.id)
      }

      deactivated++
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Clusters: ${clusters.size}`)
  console.log(`Deactivated: ${deactivated}`)
  console.log(`Mentions migrated: ${mentionsMigrated}`)
  if (DRY_RUN) console.log('(dry run — no changes made)')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
