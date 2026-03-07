/**
 * Weekly full blog audit — re-reviews ALL blog_mentions with place context
 *
 * Catches high-score irrelevant mentions that daily filter misses.
 * Uses the same Gemini Flash-Lite classifier as the daily noise filter
 * but processes ALL mentions (score >= 0.3) instead of sampling 400.
 *
 * Schedule: Sunday 07:00 KST (0 22 * * 0 UTC)
 * Cost: ~$0 (Flash-Lite free tier, ~20K mentions in 7-10 min)
 */

import { classifyWithGemini } from '../lib/gemini'
import { supabaseAdmin } from '../lib/supabase-admin'
import {
  DOWNGRADE_SCORE,
  downgradeIrrelevantMentions,
  markAsReviewed,
  upsertExtractedTerms,
  promoteQualifiedTerms,
  retroactiveCleanup,
  recalculateMentionCounts,
} from './blog-noise-filter'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditMention {
  id: number
  place_id: number
  title: string | null
  snippet: string | null
  relevance_score: number
  post_date: string | null
  places: {
    name: string
    category: string
    address: string | null
  }
}

interface LLMClassification {
  n: number
  r: number
  t: string | null
}

export interface BlogFullAuditResult {
  totalLoaded: number
  llmClassified: number
  irrelevant: number
  downgraded: number
  termsExtracted: number
  termsFiltered: number
  termsPromoted: number
  retroactiveCleaned: number
  mentionCountsUpdated: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 1000
const BATCH_SIZE = 50
const CONCURRENCY = 4
const DELAY_BETWEEN_CHUNKS_MS = 2000
const DOWNGRADE_BATCH_SIZE = 500

// P9: Baby-friendly terms that should never be blacklisted
const BABY_FRIENDLY_SAFELIST = new Set([
  '카페', '전시', '베이커리', '브런치', '호텔', '펜션', '맛집',
  '키즈', '어린이', '유아', '아기', '놀이', '체험', '교육',
  '박물관', '미술관', '도서관', '공원', '수영장', '워터파크',
  '키즈카페', '놀이터', '동물원', '수족관', '과학관', '문화센터',
])

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runFullBlogAudit(resume = false): Promise<BlogFullAuditResult> {
  const result: BlogFullAuditResult = {
    totalLoaded: 0,
    llmClassified: 0,
    irrelevant: 0,
    downgraded: 0,
    termsExtracted: 0,
    termsFiltered: 0,
    termsPromoted: 0,
    retroactiveCleaned: 0,
    mentionCountsUpdated: 0,
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('[blog-full-audit] No GEMINI_API_KEY, skipping')
    return result
  }

  console.log(`[blog-full-audit] Starting ${resume ? 'resume' : 'full'} audit...`)

  // Phase 1: Load all mentions with place context (paginated)
  const allMentions = await loadAllMentions(resume)
  result.totalLoaded = allMentions.length

  if (allMentions.length === 0) {
    console.log('[blog-full-audit] No mentions to audit')
    return result
  }
  console.log(`[blog-full-audit] Loaded ${allMentions.length} mentions`)

  // Phase 2: Classify with Gemini Flash-Lite
  const irrelevantIds: number[] = []
  const allIds: number[] = []
  const extractedTerms: Array<{ term: string; placeId: number; title: string | null }> = []
  const affectedPlaceIds = new Set<number>()

  const batches: AuditMention[][] = []
  for (let i = 0; i < allMentions.length; i += BATCH_SIZE) {
    batches.push(allMentions.slice(i, i + BATCH_SIZE))
  }

  console.log(
    `[blog-full-audit] Classifying ${allMentions.length} mentions in ${batches.length} batches (concurrency=${CONCURRENCY})`
  )

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS))
    }

    const chunk = batches.slice(i, i + CONCURRENCY)
    const promises = chunk.map((batch, chunkIdx) => {
      const globalOffset = (i + chunkIdx) * BATCH_SIZE
      return classifyAuditBatch(batch, globalOffset)
    })

    const results = await Promise.allSettled(promises)

    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const c of r.value) {
          const idx = c.n - 1
          const batchIdx = Math.floor(idx / BATCH_SIZE)
          const localIdx = idx % BATCH_SIZE
          const batch = batches[batchIdx]
          if (!batch || localIdx >= batch.length) continue

          const mention = batch[localIdx]
          allIds.push(mention.id)
          result.llmClassified++

          if (c.r === 0) {
            irrelevantIds.push(mention.id)
            affectedPlaceIds.add(mention.place_id)
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
      } else {
        console.error('[blog-full-audit] Batch failed:', r.reason)
      }
    }

    // Progress log every 10 chunks
    if ((i / CONCURRENCY) % 10 === 0 && i > 0) {
      console.log(
        `[blog-full-audit] Progress: ${Math.min(i + CONCURRENCY, batches.length)}/${batches.length} batches, ${irrelevantIds.length} irrelevant so far`
      )
    }
  }

  console.log(
    `[blog-full-audit] Classification done: ${result.llmClassified} classified, ${irrelevantIds.length} irrelevant`
  )

  // Phase 3: Downgrade irrelevant mentions (batched)
  if (irrelevantIds.length > 0) {
    for (let i = 0; i < irrelevantIds.length; i += DOWNGRADE_BATCH_SIZE) {
      const batch = irrelevantIds.slice(i, i + DOWNGRADE_BATCH_SIZE)
      const count = await downgradeIrrelevantMentions(batch)
      result.downgraded += count
    }
    console.log(`[blog-full-audit] Downgraded ${result.downgraded} mentions`)
  }

  // Phase 4: Mark all as reviewed (batched)
  for (let i = 0; i < allIds.length; i += DOWNGRADE_BATCH_SIZE) {
    const batch = allIds.slice(i, i + DOWNGRADE_BATCH_SIZE)
    await markAsReviewed(batch)
  }

  // Phase 5: Blacklist terms upsert + promote + retroactive cleanup
  if (extractedTerms.length > 0) {
    // P9: Filter out baby-friendly terms before upserting to blacklist
    const safeTerms = extractedTerms.filter(t => {
      const term = t.term.toLowerCase()
      if (BABY_FRIENDLY_SAFELIST.has(term)) return false
      const safeArr = Array.from(BABY_FRIENDLY_SAFELIST)
      for (let si = 0; si < safeArr.length; si++) {
        if (term.includes(safeArr[si])) return false
      }
      return true
    })
    result.termsFiltered = extractedTerms.length - safeTerms.length

    if (result.termsFiltered > 0) {
      console.log(`[blog-full-audit] Filtered ${result.termsFiltered} baby-friendly terms from blacklist candidates`)
    }

    if (safeTerms.length > 0) {
      await upsertExtractedTerms(safeTerms)
      result.termsExtracted = safeTerms.length
      console.log(`[blog-full-audit] Extracted ${safeTerms.length} noise terms`)
    }
  }

  const promoted = await promoteQualifiedTerms()
  result.termsPromoted = promoted.length

  if (promoted.length > 0) {
    const cleaned = await retroactiveCleanup(promoted)
    result.retroactiveCleaned = cleaned.mentionsDowngraded
    for (const pid of cleaned.affectedPlaceIds) {
      affectedPlaceIds.add(pid)
    }
  }

  // Phase 6: Recalculate mention counts for affected places
  if (affectedPlaceIds.size > 0) {
    await recalculateMentionCounts([...affectedPlaceIds])
    result.mentionCountsUpdated = affectedPlaceIds.size
    console.log(`[blog-full-audit] Updated mention counts for ${affectedPlaceIds.size} places`)
  }

  // Phase 7: Report
  console.log('[blog-full-audit] Complete:', JSON.stringify(result))
  return result
}

// ─── Data Loading ────────────────────────────────────────────────────────────

async function loadAllMentions(resumeOnly: boolean): Promise<AuditMention[]> {
  const all: AuditMention[] = []
  let offset = 0

  while (true) {
    let query = supabaseAdmin
      .from('blog_mentions')
      .select('id, place_id, title, snippet, relevance_score, post_date, places!inner(name, category, address)')
      .gte('relevance_score', 0.3)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (resumeOnly) {
      query = query.eq('llm_reviewed', false)
    }

    const { data, error } = await query

    if (error) {
      console.error('[blog-full-audit] Load error:', error)
      break
    }

    if (!data || data.length === 0) break

    // Flatten the places join
    for (const row of data as Array<Record<string, unknown>>) {
      const places = row.places as { name: string; category: string; address: string | null }
      all.push({
        id: row.id as number,
        place_id: row.place_id as number,
        title: row.title as string | null,
        snippet: row.snippet as string | null,
        relevance_score: row.relevance_score as number,
        post_date: row.post_date as string | null,
        places,
      })
    }

    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

// ─── LLM Classification ─────────────────────────────────────────────────────

async function classifyAuditBatch(
  batch: AuditMention[],
  globalOffset: number
): Promise<LLMClassification[]> {
  const items = batch.map((m, i) => ({
    n: i + 1,
    장소명: m.places.name,
    카테고리: m.places.category,
    주소: m.places.address ?? '',
    제목: m.title ?? '(제목없음)',
    내용: (m.snippet ?? '').slice(0, 200),
    작성일: m.post_date ? m.post_date.split('T')[0] : '',
  }))

  const prompt = `당신은 아기/유아(0~5세)와 함께 갈 수 있는 장소에 대한 블로그 언급의 관련성을 판정합니다.

각 항목은 특정 장소(장소명, 카테고리, 주소 포함)에 대한 블로그 포스트의 제목+내용 요약입니다.
해당 장소를 실제 방문하거나 소개하는 글이면 "관련", 아니면 "무관"으로 판정하세요.

관련: 해당 장소 방문 후기, 시설 소개, 아이와 함께 추천
무관: 부동산(분양/매매/전세), 상품리뷰/광고, 타 지역, 스팸, 성인전용, 학원, 일반맛집(키즈존X), 장소를 위치참조로만 사용

추가 판정 기준:
- 체인 지점: 같은 이름이라도 블로그에 언급된 지역(목동, 청라, 동탄 등)이 장소 주소와 다르면 무관 (다른 지점 방문기)
- 서비스 지역 외: 장소 주소가 서울/경기인데 블로그가 부산/대구/광주/대전/울산/강원/제주 등 타 지역 내용이면 무관
- 짧은 장소명(2~3글자): "강남", "가평" 등 일반명사는 장소를 위치참조로만 쓸 가능성 높음 → 실제 방문이 아니면 무관
- 오래된 블로그: 작성일이 3년 이상 오래되었으면 폐업/리모델링 가능성 → 주의하여 판정

JSON으로 응답: [{"n":1,"r":1,"t":null},{"n":2,"r":0,"t":"분양"}]
n=번호, r=관련(1)/무관(0), t=무관일 때 핵심 노이즈 키워드(1~2단어, 관련이면 null)

${JSON.stringify(items, null, 0)}`

  try {
    const text = await classifyWithGemini(prompt)
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed: LLMClassification[] = JSON.parse(match[0])

    return parsed.map((c) => ({
      ...c,
      n: globalOffset + c.n,
    }))
  } catch (err) {
    console.error('[blog-full-audit] Gemini batch error:', err)
    return []
  }
}
