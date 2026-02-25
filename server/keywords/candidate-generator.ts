/**
 * Keyword candidate generation — Text mining + template-based auto-generation.
 *
 * Triggered when EXHAUSTED keywords reach ≥30% (plan.md 9-2, 25).
 *
 * Two methods:
 *   1. Text mining: Extract high-frequency words from blog_mentions titles/snippets
 *      (focusing on baby/parenting-related terms).
 *   2. Template-based: Combine category names with "아기" + common place types.
 *
 * Generated candidates inserted into keywords table with status='NEW'.
 * Duplicates ignored (UNIQUE constraint on keyword).
 */

import { supabaseAdmin } from '../lib/supabase-admin'

export interface GeneratedKeywordCandidate {
  keyword: string
  source: 'text_mining' | 'template'
  estimatedRelevance: number // 0~1
}

/**
 * Category-based templates: "아기 + place type"
 * Used when exhausted keywords reach critical threshold.
 */
const CATEGORY_TEMPLATES: Record<string, string[]> = {
  놀이: [
    '아기 키즈카페',
    '아기 실내놀이터',
    '아기 유아놀이',
    '어린이 재미있는 곳',
    '아기 음악학원',
  ],
  '공원/놀이터': [
    '아기 공원',
    '아기 놀이터',
    '유아 숲',
    '아기 산책',
    '아기 어린이공원',
  ],
  '전시/체험': [
    '아기 박물관',
    '아기 과학관',
    '유아 체험',
    '아기 전시',
    '영아 교육',
  ],
  '동물/자연': [
    '아기 동물원',
    '아기 아쿠아리움',
    '아기 자연',
    '유아 생태',
    '아기 팜스테이',
  ],
  '식당/카페': [
    '아기 카페',
    '유아식당',
    '아기 친화 카페',
    '아기 밥',
    '유모차 카페',
  ],
  도서관: [
    '아기 도서관',
    '유아 도서',
    '그림책 도서관',
    '아기 책',
    '영아 프로그램',
  ],
  '수영/물놀이': [
    '아기 수영장',
    '아기 물놀이',
    '유아 워터파크',
    '아기 수영',
    '영아 수영',
  ],
  문화행사: [
    '아기 축제',
    '유아 공연',
    '아기 뮤지컬',
    '어린이 뮤지컬',
    '아기 인형극',
  ],
  편의시설: [
    '아기 수유실',
    '기저귀 갈기',
    '아기 화장실',
    '아기 유모차',
    '아기 쉬는곳',
  ],
}

/** Baby/parenting related keywords for text mining. */
const BABY_KEYWORDS = [
  '아기',
  '유아',
  '영아',
  '어린이',
  '아이',
  '아이들',
  '엄마',
  '부모',
  '임산부',
  '신생아',
  '돌아기',
  '미취학',
  '유치원',
  '보육',
  '키즈',
  '베이비',
  '수유',
  '기저귀',
  '유모차',
  '아기띠',
]

/** Stop words to exclude from text mining. */
const STOP_WORDS = new Set([
  '을',
  '를',
  '이',
  '가',
  '에',
  '에서',
  '은',
  '는',
  '고',
  '과',
  '의',
  '그',
  '이',
  '저',
  '그리고',
  '또는',
  '있다',
  '없다',
  '하다',
  '되다',
  '말다',
  '있는',
  '없는',
  '하는',
  '되는',
])

/**
 * Generate new keyword candidates via text mining + templates.
 * Called when keyword health check shows ≥30% exhausted (plan.md 9-2, 25).
 */
export async function generateNewKeywordCandidates(): Promise<{
  candidatesGenerated: number
  candidatesInserted: number
  errors: number
}> {
  const result = {
    candidatesGenerated: 0,
    candidatesInserted: 0,
    errors: 0,
  }

  try {
    // Method 1: Text mining from recent blog mentions
    console.log('[candidate-generator] Extracting keywords from blog mentions...')
    const textMinedCandidates = await extractFromBlogMentions()
    result.candidatesGenerated += textMinedCandidates.length

    // Method 2: Template-based generation
    console.log('[candidate-generator] Generating template-based candidates...')
    const templateCandidates = generateFromTemplates()
    result.candidatesGenerated += templateCandidates.length

    // Combine and deduplicate
    const allCandidates = [...textMinedCandidates, ...templateCandidates]
    const uniqueCandidates = deduplicateCandidates(allCandidates)

    console.log(
      `[candidate-generator] Generated ${uniqueCandidates.length} unique candidates`
    )

    // Insert into keywords table (ignore duplicates via UNIQUE constraint)
    for (const candidate of uniqueCandidates) {
      try {
        const { error } = await supabaseAdmin.from('keywords').insert({
          keyword: candidate.keyword,
          status: 'NEW',
          source: candidate.source,
          efficiency_score: 0,
          cycle_count: 0,
          consecutive_zero_new: 0,
          created_at: new Date().toISOString(),
        })

        if (error) {
          // Ignore duplicate key errors (expected for existing keywords)
          if (error.code !== '23505') {
            console.warn(
              `[candidate-generator] Failed to insert candidate "${candidate.keyword}":`,
              error
            )
            result.errors++
          }
        } else {
          result.candidatesInserted++
        }
      } catch (err) {
        console.error(
          `[candidate-generator] Unexpected error inserting candidate "${candidate.keyword}":`,
          err
        )
        result.errors++
      }
    }

    console.log(
      `[candidate-generator] Inserted ${result.candidatesInserted} new keywords (${result.errors} duplicates/errors)`
    )

    return result
  } catch (err) {
    console.error('[candidate-generator] Unexpected error in candidate generation:', err)
    result.errors++
    return result
  }
}

/**
 * Extract keyword candidates from blog mentions text mining.
 * Analyzes titles and snippets from recent blog_mentions entries.
 * Looks for baby/parenting keywords and high-frequency words.
 */
async function extractFromBlogMentions(): Promise<GeneratedKeywordCandidate[]> {
  try {
    // Fetch recent blog mentions (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: mentions, error } = await supabaseAdmin
      .from('blog_mentions')
      .select('title, snippet')
      .gte('collected_at', sevenDaysAgo)
      .limit(1000) // Sample size for text mining

    if (error || !mentions) {
      console.warn('[candidate-generator] Failed to fetch blog mentions:', error)
      return []
    }

    // Concatenate and tokenize
    const allText = (mentions as { title?: string | null; snippet?: string | null }[])
      .map((m) => `${m.title || ''} ${m.snippet || ''}`)
      .join(' ')
      .toLowerCase()

    // Tokenize (simple split + cleanup)
    const tokens = tokenize(allText)

    // Filter: keep only words containing baby keywords or high-frequency terms
    const wordFreq = new Map<string, number>()
    for (const token of tokens) {
      if (
        STOP_WORDS.has(token) ||
        token.length < 2 ||
        token.length > 20
      ) {
        continue
      }

      // Prefer tokens containing baby keywords
      const isBabyRelated = BABY_KEYWORDS.some((bk) => token.includes(bk))
      if (isBabyRelated || token.length >= 3) {
        wordFreq.set(token, (wordFreq.get(token) ?? 0) + 1)
      }
    }

    // Extract top candidates
    const topWords = Array.from(wordFreq.entries())
      .filter(([_, count]) => count >= 3) // Minimum frequency
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => ({
        keyword: word,
        source: 'text_mining' as const,
        estimatedRelevance: 0.7,
      }))

    console.log(`[candidate-generator] Extracted ${topWords.length} keywords from text mining`)
    return topWords
  } catch (err) {
    console.error('[candidate-generator] Error in text mining:', err)
    return []
  }
}

/**
 * Generate keyword candidates from category templates.
 * Creates combinations like "아기 + category_type".
 */
function generateFromTemplates(): GeneratedKeywordCandidate[] {
  const candidates: GeneratedKeywordCandidate[] = []

  for (const [category, templates] of Object.entries(CATEGORY_TEMPLATES)) {
    for (const template of templates) {
      candidates.push({
        keyword: template,
        source: 'template',
        estimatedRelevance: 0.85, // Templates are highly relevant
      })
    }
  }

  console.log(`[candidate-generator] Generated ${candidates.length} template-based candidates`)
  return candidates
}

/**
 * Tokenize Korean + English text.
 * Simple split on spaces and punctuation.
 */
function tokenize(text: string): string[] {
  return text
    .split(/[\s\-\.,;:'"()\[\]]+/)
    .filter((token) => token.length > 0)
}

/**
 * Deduplicate candidates by keyword string (case-insensitive).
 * Prefer higher relevance scores when duplicates exist.
 */
function deduplicateCandidates(
  candidates: GeneratedKeywordCandidate[]
): GeneratedKeywordCandidate[] {
  const map = new Map<string, GeneratedKeywordCandidate>()

  for (const candidate of candidates) {
    const key = candidate.keyword.toLowerCase().trim()
    const existing = map.get(key)

    if (!existing || candidate.estimatedRelevance > existing.estimatedRelevance) {
      map.set(key, candidate)
    }
  }

  return Array.from(map.values())
}

/**
 * Estimate relevance of a keyword to baby/parenting (0~1).
 * Simple heuristic: count baby keywords in string.
 */
export function estimateKeywordRelevance(keyword: string): number {
  const lower = keyword.toLowerCase()
  const babyKeywordCount = BABY_KEYWORDS.filter((bk) => lower.includes(bk)).length
  const maxBabyKeywords = 3
  return Math.min(babyKeywordCount / maxBabyKeywords, 1.0)
}
