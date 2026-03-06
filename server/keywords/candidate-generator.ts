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
import { extractWithGemini } from '../lib/gemini'

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
    '돌아기 키즈카페 추천',
    '아기 볼풀장',
    '유아 키즈파크',
    '아기 놀이공간 추천',
    '24개월 실내놀이',
  ],
  '공원/놀이터': [
    '아기 공원',
    '아기 놀이터',
    '유아 숲',
    '아기 산책',
    '아기 어린이공원',
    '유아숲체험원 후기',
    '유모차 산책 추천',
    '아기 모래놀이터',
  ],
  '전시/체험': [
    '아기 박물관',
    '아기 과학관',
    '유아 체험',
    '아기 전시',
    '영아 교육',
    '어린이 미술관 추천',
    '키즈 체험관 후기',
    '유아 요리 체험',
    '아기 만들기 체험',
  ],
  '동물/자연': [
    '아기 동물원',
    '아기 아쿠아리움',
    '아기 자연',
    '유아 생태',
    '아기 팜스테이',
    '유아 동물 먹이주기',
    '아기 곤충체험',
    '아기 토끼카페',
  ],
  '식당/카페': [
    '아기 카페',
    '유아식당',
    '아기 친화 카페',
    '아기 밥',
    '유모차 카페',
    '아기 외식',
    '키즈존 식당',
    '아기 뷔페',
    '이유식 맛집',
    '유아 브런치',
  ],
  도서관: [
    '아기 도서관',
    '유아 도서',
    '그림책 도서관',
    '아기 책',
    '영아 프로그램',
    '어린이 도서관 추천',
    '유아 책읽기 프로그램',
    '아기 책방',
  ],
  '수영/물놀이': [
    '아기 수영장',
    '아기 물놀이',
    '유아 워터파크',
    '아기 수영',
    '영아 수영',
    '베이비 스위밍',
    '키즈풀 추천',
    '아기 수영 교실',
  ],
  문화행사: [
    '아기 축제',
    '유아 공연',
    '아기 뮤지컬',
    '어린이 뮤지컬',
    '아기 인형극',
  ],
  '의료/편의': [
    '소아과 추천',
    '아기 소아과',
    '수유실 추천',
    '기저귀갈이대',
    '아기 치과',
    '유아 안과',
    '소아청소년과',
    '아기 예방접종',
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
  { keyword: '놀이방식당', group: '식당/카페', isIndoor: true },
  { keyword: '키즈레스토랑', group: '식당/카페', isIndoor: true },
  { keyword: '이유식카페', group: '식당/카페', isIndoor: true },
  { keyword: '아기의자 식당', group: '식당/카페', isIndoor: true },
  { keyword: '아기뷔페', group: '식당/카페', isIndoor: true },
  { keyword: '키즈플레이트', group: '식당/카페', isIndoor: true },
  { keyword: '아기랑맛집', group: '식당/카페', isIndoor: true },
  { keyword: '유아동반식당', group: '식당/카페', isIndoor: true },
  { keyword: '키즈카페식당', group: '식당/카페', isIndoor: true },
  { keyword: '놀이방맛집', group: '식당/카페', isIndoor: true },
  { keyword: '돌잔치', group: '식당/카페', isIndoor: true },
  { keyword: '백일잔치', group: '식당/카페', isIndoor: true },
  { keyword: '키즈브런치', group: '식당/카페', isIndoor: true },
  { keyword: '아기돈까스', group: '식당/카페', isIndoor: true },
  { keyword: '키즈피자', group: '식당/카페', isIndoor: true },
  { keyword: '유아동반카페', group: '식당/카페', isIndoor: true },
  { keyword: '키즈한정식', group: '식당/카페', isIndoor: true },
  { keyword: '아기베이커리', group: '식당/카페', isIndoor: true },
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

// ─── Location × category pattern templates ──────────────────────────────────

const LOCATION_PATTERNS_BY_CATEGORY: Record<string, string[]> = {
  '식당/카페': ['{loc} 아기랑 식당', '{loc} 키즈존 카페'],
  '놀이': ['{loc} 키즈카페 추천', '{loc} 아기 놀곳'],
  '전시/체험': ['{loc} 아기 체험', '{loc} 어린이 박물관'],
  '의료/편의': ['{loc} 소아과 추천', '{loc} 수유실'],
}

const KEY_LOCATIONS = [
  // 서울 (25)
  '강남역', '잠실역', '홍대입구역', '건대입구역', '성수동',
  '여의도역', '용산역', '합정역', '왕십리역', '목동',
  '노원역', '송파역', '영등포역', '이태원역', '신촌역',
  '사당역', '천호역', '구로디지털단지역', '종로', '압구정역',
  '서울숲', '마곡역', '상봉역', '창동역', '화곡역',
  // 경기 (10)
  '분당', '판교역', '수원역', '용인', '고양',
  '일산', '김포', '광명역', '하남', '안양',
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
  { pattern: '돌잔치', group: '식당/카페', isIndoor: true },
  { pattern: '백일잔치', group: '식당/카페', isIndoor: true },
  { pattern: '돈까스', group: '식당/카페', isIndoor: true },
  { pattern: '피자', group: '식당/카페', isIndoor: true },
  { pattern: '한정식', group: '식당/카페', isIndoor: true },
  { pattern: '파스타', group: '식당/카페', isIndoor: true },
  { pattern: '브런치', group: '식당/카페', isIndoor: true },
  { pattern: '베이커리', group: '식당/카페', isIndoor: true },
  { pattern: '레스토랑', group: '식당/카페', isIndoor: true },
  { pattern: '뷔페', group: '식당/카페', isIndoor: true },
  { pattern: '소아과', group: '의료/편의', isIndoor: true },
  { pattern: '수유실', group: '의료/편의', isIndoor: true },
  { pattern: '기저귀', group: '의료/편의', isIndoor: true },
  { pattern: '치과', group: '의료/편의', isIndoor: true },
  { pattern: '안과', group: '의료/편의', isIndoor: true },
  { pattern: '한의원', group: '의료/편의', isIndoor: true },
  { pattern: '예방접종', group: '의료/편의', isIndoor: true },
  { pattern: '피부과', group: '의료/편의', isIndoor: true },
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
      .gte('relevance_score', 0.3)
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
 * Also generates location×category pattern combos (35 locations × 4 categories).
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

  // Location × pattern combos for restaurant/cafe discovery
  const locationCandidates = generateLocationKeywords()
  candidates.push(...locationCandidates)

  console.log(
    `[candidate-generator] Generated ${candidates.length} naver template-based candidates (${locationCandidates.length} location-based)`
  )
  return candidates
}

/**
 * Generate location × category pattern keyword combos.
 * 35 locations × 4 categories × 2 patterns = 280 candidates.
 */
function generateLocationKeywords(): GeneratedKeywordCandidate[] {
  const candidates: GeneratedKeywordCandidate[] = []

  for (const loc of KEY_LOCATIONS) {
    for (const [group, patterns] of Object.entries(LOCATION_PATTERNS_BY_CATEGORY)) {
      for (const pattern of patterns) {
        candidates.push({
          keyword: pattern.replace('{loc}', loc),
          source: 'template',
          estimatedRelevance: 0.80,
          provider: 'naver',
          keywordGroup: group,
        })
      }
    }
  }

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

/** Korean josa (particles) to strip from tokens for cleaner keyword extraction. */
const JOSA = /(에서의|에서|으로|에는|까지|부터|마다|라는|라고|은|는|이|가|을|를|와|과|의|도|만|로)$/

function stripJosa(token: string): string {
  const stripped = token.replace(JOSA, '')
  return stripped.length >= 2 ? stripped : token
}

/**
 * Tokenize Korean + English text.
 * Simple split on spaces and punctuation, then strip Korean josa.
 */
function tokenize(text: string): string[] {
  return text
    .split(/[\s\-\.,;:'"()\[\]]+/)
    .filter((token) => token.length > 0)
    .map(stripJosa)
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
 * Generate semantically diverse keywords using Gemini Flash.
 * Fetches all existing keywords from DB and asks LLM to produce 50 new ones
 * covering different search intents (activity type, age group, location, season, etc.).
 */
export async function generateDiverseKeywordsWithLLM(): Promise<{
  candidatesGenerated: number
  candidatesInserted: number
  errors: number
}> {
  const result = { candidatesGenerated: 0, candidatesInserted: 0, errors: 0 }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('[candidate-generator] No GEMINI_API_KEY, skipping LLM keyword generation')
    return result
  }

  try {
    // Fetch all existing keywords to avoid duplicates
    const { data: existing } = await supabaseAdmin
      .from('keywords')
      .select('keyword')
      .eq('provider', 'naver')
    const existingSet = new Set((existing ?? []).map((k: { keyword: string }) => k.keyword.toLowerCase()))
    const existingList = (existing ?? []).map((k: { keyword: string }) => k.keyword).slice(0, 200)

    const prompt = `당신은 "아기/유아와 함께 갈 수 있는 장소"를 찾는 네이버 블로그 검색 키워드 전문가입니다.

기존 키워드 목록 (중복 금지):
${JSON.stringify(existingList)}

위 키워드와 중복되지 않는 새로운 검색 키워드 50개를 생성하세요.

카테고리별 분배 (필수):
- 놀이/키즈카페: 최소 5개
- 공원/놀이터: 최소 5개
- 전시/체험: 최소 5개
- 동물/자연: 최소 5개
- 수영/물놀이: 최소 5개
- 도서관: 최소 3개
- 의료/편의(소아과/수유실): 최소 5개
- 식당/카페: 최대 5개 (이미 충분히 많음)

다양성 기준:
1. 연령대: 신생아, 100일, 돌아기, 2세, 3세, 유치원생 등
2. 상황: 비 오는 날, 주말, 평일, 생일파티, 돌잔치 등
3. 계절: 봄나들이, 여름물놀이, 가을단풍, 겨울실내 등
4. 지역 특화: 서울/경기 주요 지역명 + 장소 유형

형태적 변형(조사만 다른 키워드)은 생성하지 마세요.
모든 키워드에 아기 시그널(아기/유아/키즈/베이비/수유/어린이 등) 최소 1개 포함.
실제 부모가 네이버에 검색할 자연스러운 표현을 사용하세요.

JSON 배열로 응답: ["키워드1", "키워드2", ...]`

    const text = await extractWithGemini(prompt)
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) {
      console.warn('[candidate-generator] LLM keyword generation: no JSON array in response')
      return result
    }

    const keywords: string[] = JSON.parse(match[0])
    result.candidatesGenerated = keywords.length

    for (const kw of keywords) {
      if (!kw || typeof kw !== 'string' || kw.length < 2) continue
      if (existingSet.has(kw.toLowerCase())) continue

      const { group, isIndoor } = inferKeywordGroup(kw)
      const { error } = await supabaseAdmin.from('keywords').insert({
        keyword: kw.trim(),
        provider: 'naver',
        keyword_group: group,
        is_indoor: isIndoor,
        status: 'NEW',
        source: 'llm_generated',
        efficiency_score: 0,
        cycle_count: 0,
        consecutive_zero_new: 0,
        created_at: new Date().toISOString(),
      })

      if (error) {
        if (error.code !== '23505') result.errors++
      } else {
        result.candidatesInserted++
        existingSet.add(kw.toLowerCase())
      }
    }

    console.log(`[candidate-generator] LLM generated ${result.candidatesGenerated}, inserted ${result.candidatesInserted} new keywords`)
    return result
  } catch (err) {
    console.error('[candidate-generator] LLM keyword generation error:', err)
    result.errors++
    return result
  }
}

