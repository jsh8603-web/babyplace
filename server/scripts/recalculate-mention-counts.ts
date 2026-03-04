/**
 * One-time script: recalculate mention_count for all places with blog_mentions.
 * Fixes mismatch caused by noise filter downgrading scores without updating counts.
 *
 * Usage: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/recalculate-mention-counts.ts
 */

import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  // Get all distinct place_ids that have blog_mentions (paginated to avoid 1000-row limit)
  const allPlaceIds = new Set<number>()
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('blog_mentions')
      .select('place_id')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Failed to fetch place_ids:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    for (const row of data) allPlaceIds.add(row.place_id)
    if (data.length < PAGE) break
    from += PAGE
  }

  const uniquePlaceIds = [...allPlaceIds]
  console.log(`Recalculating mention_count for ${uniquePlaceIds.length} places...`)

  let updated = 0
  let mismatches = 0
  const BATCH = 50

  for (let i = 0; i < uniquePlaceIds.length; i += BATCH) {
    const batch = uniquePlaceIds.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async (placeId) => {
        // Count mentions with relevance_score >= 0.3 (matches detail API filter)
        const { count, error: countErr } = await supabaseAdmin
          .from('blog_mentions')
          .select('id', { count: 'exact', head: true })
          .eq('place_id', placeId)
          .gte('relevance_score', 0.3)

        if (countErr) {
          console.error(`Count error for place ${placeId}:`, countErr)
          return
        }

        const newCount = count ?? 0

        // Get current mention_count
        const { data: place } = await supabaseAdmin
          .from('places')
          .select('mention_count, name')
          .eq('id', placeId)
          .single()

        const oldCount = place?.mention_count ?? 0

        if (oldCount !== newCount) {
          mismatches++
          console.log(`  ${place?.name ?? placeId}: ${oldCount} → ${newCount}`)
        }

        await supabaseAdmin
          .from('places')
          .update({ mention_count: newCount })
          .eq('id', placeId)

        updated++
      })
    )
  }

  console.log(`\nDone: ${updated} places updated, ${mismatches} mismatches fixed`)
}

main().catch(console.error)
