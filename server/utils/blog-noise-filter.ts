/**
 * Blog noise filter — LLM-based blacklist term auto-expansion
 *
 * Samples borderline blog_mentions (score 0.40~0.65), classifies them
 * with Haiku, extracts noise keywords, and accumulates them in
 * blog_blacklist_terms. Terms exceeding the promotion threshold
 * are activated and retroactively applied to existing mentions.
 *
 * Pattern: event-classifier.ts (Haiku batch, concurrency 2, 5s delay)
 * Cost: ~$0.05/month (4 batches/day, ~2,800 tokens/day)
 */

import { classifyWithGemini } from '../lib/gemini'
import { supabaseAdmin } from '../lib/supabase-admin'

// ─── Types ───────────────────────────────────────────────────────────────────

interface BorderlineMention {
  id: number
  place_id: number
  title: string | null
  snippet: string | null
  relevance_score: number
}

interface LLMClassification {
  /** 1-based index in batch */
  n: number
  /** 1 = relevant, 0 = irrelevant */
  r: number
  /** noise keyword (null if relevant) */
  t: string | null
}

export interface BlogNoiseFilterResult {
  sampled: number
  irrelevant: number
  downgraded: number
  termsExtracted: number
  termsPromoted: number
  retroactiveCleaned: number
  mentionCountsUpdated: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SAMPLE_LIMIT = 400
const BATCH_SIZE = 50
const CONCURRENCY = 4
const DELAY_BETWEEN_CHUNKS_MS = 2000

/** Promotion threshold: occurrence >= 5 AND distinct_places >= 3 */
const MIN_OCCURRENCE = 5
const MIN_DISTINCT_PLACES = 3

/** Retroactive cleanup batch limit (prevent long transactions) */
const RETROACTIVE_BATCH_LIMIT = 1000

/** Score to assign to irrelevant mentions */
const DOWNGRADE_SCORE = 0.15

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runBlogNoiseFilter(): Promise<BlogNoiseFilterResult> {
  const result: BlogNoiseFilterResult = {
    sampled: 0,
    irrelevant: 0,
    downgraded: 0,
    termsExtracted: 0,
    termsPromoted: 0,
    retroactiveCleaned: 0,
    mentionCountsUpdated: 0,
  }

  // 1. Sample borderline mentions
  const samples = await sampleBorderlineMentions()
  result.sampled = samples.length
  if (samples.length === 0) {
    console.log('[blog-noise-filter] No borderline mentions to review')
    return result
  }
  console.log(`[blog-noise-filter] Sampled ${samples.length} borderline mentions`)

  // 2. Classify with LLM
  const classifications = await classifyMentionsWithLLM(samples)

  // 3. Downgrade irrelevant mentions
  const irrelevantIds: number[] = []
  const extractedTerms: Array<{ term: string; placeId: number; title: string | null }> = []

  for (const c of classifications) {
    const idx = c.n - 1
    if (idx < 0 || idx >= samples.length) continue
    const mention = samples[idx]

    if (c.r === 0) {
      irrelevantIds.push(mention.id)
      result.irrelevant++

      if (c.t && c.t.trim().length >= 2) {
        extractedTerms.push({
          term: c.t.trim(),
          placeId: mention.place_id,
          title: mention.title,
        })
      }
    }
  }

  // 3+4+5 run in parallel: downgrade, mark reviewed, upsert terms
  const [downgraded] = await Promise.all([
    irrelevantIds.length > 0
      ? downgradeIrrelevantMentions(irrelevantIds)
      : Promise.resolve(0),
    markAsReviewed(samples.map((s) => s.id)),
    extractedTerms.length > 0
      ? upsertExtractedTerms(extractedTerms)
      : Promise.resolve(),
  ])
  result.downgraded = downgraded
  result.termsExtracted = extractedTerms.length

  // 6. Promote qualified terms
  const promoted = await promoteQualifiedTerms()
  result.termsPromoted = promoted.length

  // 7. Retroactive cleanup for newly promoted terms
  if (promoted.length > 0) {
    const cleaned = await retroactiveCleanup(promoted)
    result.retroactiveCleaned = cleaned.mentionsDowngraded

    // 8. Recalculate mention counts for affected places
    if (cleaned.affectedPlaceIds.size > 0) {
      await recalculateMentionCounts([...cleaned.affectedPlaceIds])
      result.mentionCountsUpdated = cleaned.affectedPlaceIds.size
    }
  }

  console.log('[blog-noise-filter] Complete:', JSON.stringify(result))
  return result
}

// ─── Step 1: Sample borderline mentions ──────────────────────────────────────

async function sampleBorderlineMentions(): Promise<BorderlineMention[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_mentions')
    .select('id, place_id, title, snippet, relevance_score')
    .eq('llm_reviewed', false)
    .gte('relevance_score', 0.40)
    .lte('relevance_score', 0.65)
    .order('relevance_score', { ascending: true })
    .order('collected_at', { ascending: false })
    .limit(SAMPLE_LIMIT)

  if (error) {
    console.error('[blog-noise-filter] Sample query error:', error)
    return []
  }

  return (data ?? []) as BorderlineMention[]
}

// ─── Step 2: LLM classification ─────────────────────────────────────────────

async function classifyMentionsWithLLM(
  samples: BorderlineMention[]
): Promise<LLMClassification[]> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[blog-noise-filter] No GEMINI_API_KEY, skipping LLM classification')
    return []
  }

  const batches: BorderlineMention[][] = []
  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    batches.push(samples.slice(i, i + BATCH_SIZE))
  }

  console.log(
    `[blog-noise-filter] Gemini classification: ${samples.length} mentions in ${batches.length} batches (concurrency=${CONCURRENCY})`
  )

  const allClassifications: LLMClassification[] = []

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS))
    }

    const chunk = batches.slice(i, i + CONCURRENCY)
    const promises = chunk.map((batch, chunkIdx) => {
      const globalOffset = (i + chunkIdx) * BATCH_SIZE
      return classifyBatch(batch, globalOffset)
    })

    const results = await Promise.allSettled(promises)

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allClassifications.push(...result.value)
      } else {
        console.error('[blog-noise-filter] Batch failed:', result.reason)
      }
    }
  }

  return allClassifications
}

async function classifyBatch(
  batch: BorderlineMention[],
  globalOffset: number
): Promise<LLMClassification[]> {
  const items = batch.map((m, i) => ({
    n: i + 1,
    제목: m.title ?? '(제목없음)',
    내용: (m.snippet ?? '').slice(0, 200),
  }))

  const prompt = `당신은 아기/유아(0~5세)와 함께 갈 수 있는 장소에 대한 블로그 언급의 관련성을 판정합니다.

각 항목은 특정 장소에 대한 블로그 포스트의 제목+내용 요약입니다.
해당 장소를 실제 방문하거나 소개하는 글이면 "관련", 아니면 "무관"으로 판정하세요.

관련: 장소 방문 후기, 시설 소개, 아이와 함께 갈 만한 곳 추천
무관: 부동산(분양/매매/전세), 상품 리뷰, 다른 지역 소개, 광고/스팸, 성인 전용, 학원, 일반 맛집(키즈존 아닌)

JSON으로 응답: [{"n":1,"r":1,"t":null},{"n":2,"r":0,"t":"분양"}]
n=번호, r=관련(1)/무관(0), t=무관일 때 핵심 노이즈 키워드(1~2단어, 관련이면 null)

${JSON.stringify(items, null, 0)}`

  try {
    const text = await classifyWithGemini(prompt)
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed: LLMClassification[] = JSON.parse(match[0])

    // Adjust indices to global offset
    return parsed.map((c) => ({
      ...c,
      n: globalOffset + c.n,
    }))
  } catch (err) {
    console.error('[blog-noise-filter] Gemini batch error:', err)
    return []
  }
}

// ─── Step 3: Downgrade irrelevant mentions ──────────────────────────────────

async function downgradeIrrelevantMentions(mentionIds: number[]): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from('blog_mentions')
    .update({ relevance_score: DOWNGRADE_SCORE })
    .in('id', mentionIds)

  if (error) {
    console.error('[blog-noise-filter] Downgrade error:', error)
    return 0
  }
  return count ?? mentionIds.length
}

// ─── Step 4: Mark as reviewed ───────────────────────────────────────────────

async function markAsReviewed(mentionIds: number[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('blog_mentions')
    .update({ llm_reviewed: true })
    .in('id', mentionIds)

  if (error) {
    console.error('[blog-noise-filter] Mark reviewed error:', error)
  }
}

// ─── Step 5: Upsert extracted terms ─────────────────────────────────────────

async function upsertExtractedTerms(
  terms: Array<{ term: string; placeId: number; title: string | null }>
): Promise<void> {
  await Promise.all(
    terms.map(async ({ term, placeId, title }) => {
      const { error } = await supabaseAdmin.rpc('upsert_blacklist_term', {
        p_term: term,
        p_place_id: placeId,
        p_sample_title: title,
      })
      if (error) {
        console.error(`[blog-noise-filter] Upsert term "${term}" error:`, error)
      }
    })
  )
}

// ─── Step 6: Promote qualified terms ────────────────────────────────────────

async function promoteQualifiedTerms(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_blacklist_terms')
    .select('id, term')
    .eq('status', 'candidate')
    .gte('occurrence_count', MIN_OCCURRENCE)
    .gte('distinct_place_count', MIN_DISTINCT_PLACES)

  if (error || !data || data.length === 0) return []

  const termIds = data.map((d) => d.id)
  const termNames = data.map((d) => d.term)

  const { error: updateError } = await supabaseAdmin
    .from('blog_blacklist_terms')
    .update({ status: 'active', activated_at: new Date().toISOString() })
    .in('id', termIds)

  if (updateError) {
    console.error('[blog-noise-filter] Promote error:', updateError)
    return []
  }

  console.log(`[blog-noise-filter] Promoted ${termNames.length} terms: ${termNames.join(', ')}`)
  return termNames
}

// ─── Step 7: Retroactive cleanup ────────────────────────────────────────────

async function retroactiveCleanup(
  newActiveTerms: string[]
): Promise<{ mentionsDowngraded: number; affectedPlaceIds: Set<number> }> {
  const affectedPlaceIds = new Set<number>()
  let totalDowngraded = 0

  for (const term of newActiveTerms) {
    // Find existing mentions containing this term (title or snippet)
    // Use ilike for case-insensitive matching
    const { data: mentions, error } = await supabaseAdmin
      .from('blog_mentions')
      .select('id, place_id')
      .gt('relevance_score', DOWNGRADE_SCORE)
      .or(`title.ilike.%${term}%,snippet.ilike.%${term}%`)
      .limit(RETROACTIVE_BATCH_LIMIT)

    if (error || !mentions || mentions.length === 0) continue

    const ids = mentions.map((m) => m.id)
    for (const m of mentions) {
      affectedPlaceIds.add(m.place_id)
    }

    const { error: updateError, count } = await supabaseAdmin
      .from('blog_mentions')
      .update({ relevance_score: DOWNGRADE_SCORE })
      .in('id', ids)

    if (!updateError) {
      totalDowngraded += count ?? ids.length
    }
  }

  console.log(
    `[blog-noise-filter] Retroactive cleanup: ${totalDowngraded} mentions downgraded across ${affectedPlaceIds.size} places`
  )
  return { mentionsDowngraded: totalDowngraded, affectedPlaceIds }
}

// ─── Step 8: Recalculate mention counts ─────────────────────────────────────

async function recalculateMentionCounts(placeIds: number[]): Promise<void> {
  await Promise.all(
    placeIds.map(async (placeId) => {
      const { count, error } = await supabaseAdmin
        .from('blog_mentions')
        .select('id', { count: 'exact', head: true })
        .eq('place_id', placeId)
        .gt('relevance_score', DOWNGRADE_SCORE)

      if (error) {
        console.error(`[blog-noise-filter] Count error for place ${placeId}:`, error)
        return
      }

      await supabaseAdmin
        .from('places')
        .update({ mention_count: count ?? 0 })
        .eq('id', placeId)
    })
  )
}

// ─── Exported: Load active blacklist terms (for Pipeline B) ─────────────────

export async function loadActiveBlacklistTerms(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('blog_blacklist_terms')
    .select('term')
    .eq('status', 'active')

  if (error) {
    console.error('[blog-noise-filter] Load active terms error:', error)
    return []
  }

  return (data ?? []).map((d) => d.term)
}
