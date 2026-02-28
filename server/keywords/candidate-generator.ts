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

export type KeywordProvider = 'naver' | 'kakao'

export interface GeneratedKeywordCandidate {
  keyword: string
  source: 'text_mining' | 'template'
  estimatedRelevance: number // 0~1
  provider: KeywordProvider
  keywordGroup?: string
  isIndoor?: boolean | null
  seasonalMonths?: number[]
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

/**
 * Kakao-specific templates: direct place search keywords (no "아기" prefix needed).
 * 7 categories × 4 keywords = 28 candidates.
 */
const KAKAO_CATEGORY_TEMPLATES: { keyword: string; group: string; isIndoor: boolean | null }[] = [
  // 놀이
  { keyword: '어린이놀이공간', group: '놀이', isIndoor: true },
  { keyword: '유아놀이시설', group: '놀이', isIndoor: true },
  { keyword: '키즈파크', group: '놀이', isIndoor: true },
  { keyword: '아이랜드', group: '놀이', isIndoor: true },
  // 공원/놀이터
  { keyword: '유아숲체험원', group: '공원/놀이터', isIndoor: false },
  { keyword: '모래놀이터', group: '공원/놀이터', isIndoor: false },
  { keyword: '물놀이 공원', group: '공원/놀이터', isIndoor: false },
  { keyword: '자연놀이터', group: '공원/놀이터', isIndoor: false },
  // 전시/체험
  { keyword: '키즈체험', group: '전시/체험', isIndoor: true },
  { keyword: '유아미술관', group: '전시/체험', isIndoor: true },
  { keyword: '어린이전시', group: '전시/체험', isIndoor: true },
  { keyword: '어린이과학관', group: '전시/체험', isIndoor: true },
  // 동물/자연
  { keyword: '아기동물농장', group: '동물/자연', isIndoor: false },
  { keyword: '곤충체험관', group: '동물/자연', isIndoor: true },
  { keyword: '체험목장', group: '동물/자연', isIndoor: false },
  { keyword: '생태공원', group: '동물/자연', isIndoor: false },
  // 식당/카페
  { keyword: '패밀리레스토랑', group: '식당/카페', isIndoor: true },
  { keyword: '유아식당', group: '식당/카페', isIndoor: true },
  { keyword: '키즈존카페', group: '식당/카페', isIndoor: true },
  { keyword: '아이맛집', group: '식당/카페', isIndoor: true },
  // 수영/물놀이
  { keyword: '영유아수영', group: '수영/물놀이', isIndoor: true },
  { keyword: '베이비풀', group: '수영/물놀이', isIndoor: true },
  { keyword: '유아물놀이', group: '수영/물놀이', isIndoor: null },
  { keyword: '키즈워터파크', group: '수영/물놀이', isIndoor: null },
  // 도서관
  { keyword: '그림책 카페', group: '도서관', isIndoor: true },
  { keyword: '유아도서관', group: '도서관', isIndoor: true },
  { keyword: '어린이책방', group: '도서관', isIndoor: true },
  { keyword: '키즈도서관', group: '도서관', isIndoor: true },
]

/**
 * Kakao seasonal keyword templates — auto-generated when seasonal EXHAUSTED ≥ 30%.
 * Each entry has months (1-12) when active.
 */
const KAKAO_SEASONAL_TEMPLATES: { keyword: string; group: string; isIndoor: boolean | null; months: number[] }[] = [
  // 봄 (3~5월)
  { keyword: '봄꽃놀이', group: '공원/놀이터', isIndoor: false, months: [3, 4, 5] },
  { keyword: '유채꽃 아이', group: '동물/자연', isIndoor: false, months: [3, 4, 5] },
  { keyword: '봄소풍', group: '공원/놀이터', isIndoor: false, months: [3, 4, 5] },
  { keyword: '아이 피크닉', group: '공원/놀이터', isIndoor: false, months: [3, 4, 5] },
  { keyword: '딸기체험', group: '전시/체험', isIndoor: false, months: [3, 4, 5] },
  // 여름 (6~8월)
  { keyword: '유아물놀이장', group: '수영/물놀이', isIndoor: false, months: [6, 7, 8] },
  { keyword: '키즈풀장', group: '수영/물놀이', isIndoor: null, months: [6, 7, 8] },
  { keyword: '아이물놀이', group: '수영/물놀이', isIndoor: false, months: [6, 7, 8] },
  { keyword: '어린이워터파크', group: '수영/물놀이', isIndoor: null, months: [6, 7, 8] },
  { keyword: '계곡 아이', group: '동물/자연', isIndoor: false, months: [6, 7, 8] },
  // 가을 (9~11월)
  { keyword: '단풍놀이', group: '공원/놀이터', isIndoor: false, months: [9, 10, 11] },
  { keyword: '가을소풍', group: '공원/놀이터', isIndoor: false, months: [9, 10, 11] },
  { keyword: '고구마캐기', group: '전시/체험', isIndoor: false, months: [9, 10, 11] },
  { keyword: '밤줍기체험', group: '전시/체험', isIndoor: false, months: [9, 10, 11] },
  { keyword: '허수아비축제', group: '동물/자연', isIndoor: false, months: [9, 10, 11] },
  // 겨울 (12~2월)
  { keyword: '실내키즈파크', group: '놀이', isIndoor: true, months: [12, 1, 2] },
  { keyword: '어린이스키', group: '놀이', isIndoor: false, months: [12, 1, 2] },
  { keyword: '겨울실내놀이', group: '놀이', isIndoor: true, months: [12, 1, 2] },
  { keyword: '아이썰매장', group: '놀이', isIndoor: false, months: [12, 1, 2] },
  { keyword: '실내트램폴린', group: '놀이', isIndoor: true, months: [12, 1, 2] },
]

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
export async function generateNewKeywordCandidates(provider: KeywordProvider = 'naver'): Promise<{
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
    let allCandidates: GeneratedKeywordCandidate[]

    if (provider === 'kakao') {
      // Kakao: template-based + seasonal templates + cross-pollinated blog text mining
      console.log('[candidate-generator] Generating kakao template-based candidates...')
      const kakaoCandidates = generateKakaoTemplates()
      const seasonalCandidates = generateKakaoSeasonalTemplates()

      console.log('[candidate-generator] Cross-pollinating naver blog text mining → kakao...')
      const crossPollinatedCandidates = await extractFromBlogMentions('kakao')

      result.candidatesGenerated +=
        kakaoCandidates.length + seasonalCandidates.length + crossPollinatedCandidates.length
      allCandidates = [...kakaoCandidates, ...seasonalCandidates, ...crossPollinatedCandidates]
    } else {
      // Naver: text mining + template-based
      console.log('[candidate-generator] Extracting keywords from blog mentions...')
      const textMinedCandidates = await extractFromBlogMentions()
      result.candidatesGenerated += textMinedCandidates.length

      console.log('[candidate-generator] Generating template-based candidates...')
      const templateCandidates = generateFromTemplates()
      result.candidatesGenerated += templateCandidates.length

      allCandidates = [...textMinedCandidates, ...templateCandidates]
    }

    // Deduplicate
    const uniqueCandidates = deduplicateCandidates(allCandidates)

    console.log(
      `[candidate-generator] Generated ${uniqueCandidates.length} unique ${provider} candidates`
    )

    // Insert into keywords table (ignore duplicates via UNIQUE constraint)
    for (const candidate of uniqueCandidates) {
      try {
        const isSeasonal = candidate.seasonalMonths && candidate.seasonalMonths.length > 0
        const { error } = await supabaseAdmin.from('keywords').insert({
          keyword: candidate.keyword,
          provider: candidate.provider,
          keyword_group: candidate.keywordGroup || null,
          is_indoor: candidate.isIndoor ?? null,
          status: isSeasonal ? 'SEASONAL' : 'NEW',
          seasonal_months: candidate.seasonalMonths || null,
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
      `[candidate-generator] Inserted ${result.candidatesInserted} new ${provider} keywords (${result.errors} duplicates/errors)`
    )

    return result
  } catch (err) {
    console.error('[candidate-generator] Unexpected error in candidate generation:', err)
    result.errors++
    return result
  }
}

/** Keyword group inference map: token substring → kakao keyword_group */
const KEYWORD_GROUP_HINTS: { pattern: string; group: string; isIndoor: boolean | null }[] = [
  { pattern: '수영', group: '수영/물놀이', isIndoor: true },
  { pattern: '물놀이', group: '수영/물놀이', isIndoor: null },
  { pattern: '워터', group: '수영/물놀이', isIndoor: null },
  { pattern: '풀장', group: '수영/물놀이', isIndoor: null },
  { pattern: '카페', group: '식당/카페', isIndoor: true },
  { pattern: '식당', group: '식당/카페', isIndoor: true },
  { pattern: '맛집', group: '식당/카페', isIndoor: true },
  { pattern: '놀이터', group: '공원/놀이터', isIndoor: false },
  { pattern: '공원', group: '공원/놀이터', isIndoor: false },
  { pattern: '숲', group: '공원/놀이터', isIndoor: false },
  { pattern: '산책', group: '공원/놀이터', isIndoor: false },
  { pattern: '키즈카페', group: '놀이', isIndoor: true },
  { pattern: '놀이시설', group: '놀이', isIndoor: true },
  { pattern: '키즈', group: '놀이', isIndoor: true },
  { pattern: '박물관', group: '전시/체험', isIndoor: true },
  { pattern: '체험', group: '전시/체험', isIndoor: null },
  { pattern: '전시', group: '전시/체험', isIndoor: true },
  { pattern: '미술관', group: '전시/체험', isIndoor: true },
  { pattern: '동물', group: '동물/자연', isIndoor: false },
  { pattern: '농장', group: '동물/자연', isIndoor: false },
  { pattern: '목장', group: '동물/자연', isIndoor: false },
  { pattern: '도서관', group: '도서관', isIndoor: true },
  { pattern: '책', group: '도서관', isIndoor: true },
]

/**
 * Infer kakao keyword_group and isIndoor from a keyword string.
 * Returns first matching hint, or default '놀이' group.
 */
function inferKeywordGroup(keyword: string): { group: string; isIndoor: boolean | null } {
  for (const hint of KEYWORD_GROUP_HINTS) {
    if (keyword.includes(hint.pattern)) {
      return { group: hint.group, isIndoor: hint.isIndoor }
    }
  }
  return { group: '놀이', isIndoor: null }
}

/**
 * Extract keyword candidates from blog mentions text mining.
 * Analyzes titles and snippets from recent blog_mentions entries.
 * Looks for baby/parenting keywords and high-frequency words.
 *
 * @param targetProvider - Provider tag for generated candidates ('naver' or 'kakao').
 *   When 'kakao', results are tagged with inferred keywordGroup and isIndoor.
 */
async function extractFromBlogMentions(
  targetProvider: KeywordProvider = 'naver'
): Promise<GeneratedKeywordCandidate[]> {
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
      .map(([word]): GeneratedKeywordCandidate => {
        if (targetProvider === 'kakao') {
          const { group, isIndoor } = inferKeywordGroup(word)
          return {
            keyword: word,
            source: 'text_mining',
            estimatedRelevance: 0.65, // slightly lower confidence for cross-pollinated
            provider: 'kakao',
            keywordGroup: group,
            isIndoor,
          }
        }
        return {
          keyword: word,
          source: 'text_mining',
          estimatedRelevance: 0.7,
          provider: 'naver',
        }
      })

    console.log(
      `[candidate-generator] Extracted ${topWords.length} keywords from text mining (target: ${targetProvider})`
    )
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

  for (const [_category, templates] of Object.entries(CATEGORY_TEMPLATES)) {
    for (const template of templates) {
      candidates.push({
        keyword: template,
        source: 'template',
        estimatedRelevance: 0.85,
        provider: 'naver',
      })
    }
  }

  console.log(`[candidate-generator] Generated ${candidates.length} naver template-based candidates`)
  return candidates
}

/**
 * Generate kakao keyword candidates from kakao-specific templates.
 */
function generateKakaoTemplates(): GeneratedKeywordCandidate[] {
  return KAKAO_CATEGORY_TEMPLATES.map((t) => ({
    keyword: t.keyword,
    source: 'template' as const,
    estimatedRelevance: 0.85,
    provider: 'kakao' as const,
    keywordGroup: t.group,
    isIndoor: t.isIndoor,
  }))
}

/**
 * Generate kakao seasonal keyword candidates with seasonal_months.
 * Inserted as status='SEASONAL' so they activate/deactivate by season.
 */
function generateKakaoSeasonalTemplates(): GeneratedKeywordCandidate[] {
  return KAKAO_SEASONAL_TEMPLATES.map((t) => ({
    keyword: t.keyword,
    source: 'template' as const,
    estimatedRelevance: 0.85,
    provider: 'kakao' as const,
    keywordGroup: t.group,
    isIndoor: t.isIndoor,
    seasonalMonths: t.months,
  }))
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
