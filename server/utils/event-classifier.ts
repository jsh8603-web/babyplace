/**
 * Event sub_category classifier + baby-relevance filter
 *
 * Classifies events into sub-categories based on title keywords.
 * Filters events for baby/toddler relevance using:
 *   Step 1: USE_TRGT blacklist (immediate exclude)
 *   Step 2: USE_TRGT whitelist (immediate include)
 *   Step 3: Claude Haiku batch classification (remaining events)
 */

import { classifyWithGemini } from '../lib/gemini'

export interface EventForClassification {
  TITLE: string
  USE_TRGT: string
  CODENAME: string
  PLACE: string
}

// Step 1: Blacklist — adult/senior-only events (USE_TRGT + TITLE)
const BLACKLIST_TARGET_PATTERN =
  /성인|미취학.*입장불가|14세\s*이상|13세\s*이상|12세\s*이상|만\s*19세|시니어|65세/
const BLACKLIST_TITLE_PATTERN = /개인전|1\+1|할인\s*이벤트|세일\s*이벤트|구매.*이벤트|프로모션|특가\s*이벤트/

// Step 2: Whitelist — clearly baby/child-related events
const WHITELIST_PATTERN =
  /어린이|유아|영유아|아기|키즈|가족|36개월|24개월|48개월|영아|유치원|어린이집/

// Step 2b: Title-based whitelist — events that are clearly baby-relevant by title
const WHITELIST_TITLE_PATTERN =
  /캐릭터.*전시|테마파크|팝업.*키즈|키즈.*팝업|키즈파크|어린이.*전시|인형극|동화.*공연|어린이.*뮤지컬|어린이.*공연|키즈.*체험/

// Fallback regex when LLM is unavailable
const FALLBACK_BABY_PATTERN =
  /어린이|유아|키즈|가족|아기|동화|인형극|체험.*어린이|캐릭터|놀이/

const SUB_CATEGORY_PATTERNS: [RegExp, string][] = [
  [/전시|展|갤러리|미술|아트페어|팝업|팝업스토어|테마파크|전시회/i, '전시'],
  [/축제|페스타|페스티벌|마켓|박람회|페어|런\b|마라톤/i, '축제'],
  [/체험|워크숍|클래스|만들기|키즈|플레이/i, '체험'],
  [/공연|콘서트|뮤지컬|연극|인형극|동화.*공연|음악회|쇼/i, '공연'],
]

/**
 * Classify event sub_category by title keywords.
 */
export function classifyEventByTitle(title: string): string | null {
  for (const [pattern, category] of SUB_CATEGORY_PATTERNS) {
    if (pattern.test(title)) {
      return category
    }
  }
  return null
}

const CODENAME_MAP: Record<string, string> = {
  '전시/미술': '전시',
  '전시': '전시',
  '미술': '전시',
  '축제-시민화합': '축제',
  '축제-문화/예술': '축제',
  '축제-자연/경관': '축제',
  '축제-전통/역사': '축제',
  '축제': '축제',
  '교육/체험': '체험',
  '체험': '체험',
  '공연': '공연',
  '콘서트': '공연',
  '뮤지컬/오페라': '공연',
  '연극': '공연',
  '클래식': '공연',
  '국악': '공연',
  '독주/독창회': '공연',
}

/**
 * Map Seoul CODENAME to sub_category.
 */
export function classifySeoulEvent(codename: string, title: string): string | null {
  if (CODENAME_MAP[codename]) {
    return CODENAME_MAP[codename]
  }
  for (const [key, value] of Object.entries(CODENAME_MAP)) {
    if (codename.startsWith(key)) {
      return value
    }
  }
  return classifyEventByTitle(title)
}

/**
 * Step 1: Check if event is blacklisted (adult-only).
 */
export function isBlacklisted(useTarget: string, title: string = ''): boolean {
  return BLACKLIST_TARGET_PATTERN.test(useTarget || '') || BLACKLIST_TITLE_PATTERN.test(title || '')
}

/** Returns matched blacklist pattern string, or null if not blacklisted */
export function getBlacklistMatch(useTarget: string, title: string = ''): string | null {
  const targetMatch = (useTarget || '').match(BLACKLIST_TARGET_PATTERN)
  if (targetMatch) return `BLACKLIST_TARGET: ${targetMatch[0]}`
  const titleMatch = (title || '').match(BLACKLIST_TITLE_PATTERN)
  if (titleMatch) return `BLACKLIST_TITLE: ${titleMatch[0]}`
  return null
}

/**
 * Step 2: Check if event is whitelisted (clearly baby-related).
 */
export function isWhitelisted(useTarget: string, title?: string): boolean {
  return WHITELIST_PATTERN.test(useTarget || '') || (!!title && WHITELIST_TITLE_PATTERN.test(title))
}

/** Returns matched whitelist pattern string, or null if not whitelisted */
export function getWhitelistMatch(useTarget: string, title?: string): string | null {
  const targetMatch = (useTarget || '').match(WHITELIST_PATTERN)
  if (targetMatch) return `WHITELIST_TARGET: ${targetMatch[0]}`
  if (title) {
    const titleMatch = title.match(WHITELIST_TITLE_PATTERN)
    if (titleMatch) return `WHITELIST_TITLE: ${titleMatch[0]}`
  }
  return null
}

/**
 * Step 3: Classify remaining events with Claude Haiku in batches.
 * Returns Set of indices (from the input array) that are baby-relevant.
 */
export async function classifyEventsWithLLM(
  events: EventForClassification[]
): Promise<Set<number>> {
  const includedIndices = new Set<number>()

  if (events.length === 0) return includedIndices

  if (!process.env.GEMINI_API_KEY) {
    console.warn('[event-classifier] No GEMINI_API_KEY, using fallback regex')
    return classifyWithFallbackRegex(events)
  }

  const BATCH_SIZE = 50
  const CONCURRENCY = 4
  const DELAY_BETWEEN_CHUNKS_MS = 2000
  const batches: EventForClassification[][] = []

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    batches.push(events.slice(i, i + BATCH_SIZE))
  }

  console.log(`[event-classifier] Gemini classification: ${events.length} events in ${batches.length} batches (concurrency=${CONCURRENCY})`)

  // Process batches with concurrency limit + delay for rate limiting
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHUNKS_MS))
    }

    const chunk = batches.slice(i, i + CONCURRENCY)
    const promises = chunk.map((batch, chunkIdx) => {
      const batchIdx = i + chunkIdx
      const globalOffset = batchIdx * BATCH_SIZE
      return classifyBatch(batch, globalOffset)
    })

    const results = await Promise.allSettled(promises)

    let chunkIncluded = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const idx of result.value) {
          includedIndices.add(idx)
          chunkIncluded++
        }
      } else {
        console.error('[event-classifier] Batch failed:', result.reason)
      }
    }
    console.log(`[event-classifier] Chunk ${i / CONCURRENCY + 1}/${Math.ceil(batches.length / CONCURRENCY)}: +${chunkIncluded} included`)
  }

  return includedIndices
}

async function classifyBatch(
  batch: EventForClassification[],
  globalOffset: number
): Promise<number[]> {
  const items = batch.map((e, i) => ({
    n: i + 1,
    제목: e.TITLE,
    대상: e.USE_TRGT || '누구나',
    카테고리: e.CODENAME,
    장소: e.PLACE || '',
  }))

  const prompt = `당신은 영유아(0~5세) 자녀를 둔 부모를 위한 문화행사 추천 시스템입니다.
아래 목록에서 아기/유아 동반 부모가 아이와 함께 갈 만한 행사 번호만 JSON 배열로 답하세요.

포함 기준: 어린이 캐릭터 전시, 캐릭터 팝업스토어, 키즈 테마파크, 어린이 체험전, 가족 공연, 어린이 뮤지컬/인형극, 유아 대상 프로그램, 자연/동물 체험, 가족 축제, 아기/유아 워크숍, 키즈 플리마켓
제외 기준: 성인 미술 개인전, 클래식 콘서트, 성인 교육/강좌, 학술 세미나, 주류 행사, 성인 연극

${JSON.stringify(items, null, 0)}

JSON 배열만 응답하세요 (예: [1, 3, 7]).`

  try {
    const text = await classifyWithGemini(prompt)
    const match = text.match(/\[[\d\s,]*\]/)
    if (!match) return []

    const numbers: number[] = JSON.parse(match[0])
    return numbers
      .filter((n) => n >= 1 && n <= batch.length)
      .map((n) => globalOffset + n - 1) // Convert to global index
  } catch (err) {
    console.error('[event-classifier] Gemini batch error:', err)
    // Fallback: use regex for this batch
    return batch
      .map((e, i) =>
        FALLBACK_BABY_PATTERN.test(`${e.TITLE} ${e.USE_TRGT}`) ? globalOffset + i : -1
      )
      .filter((i) => i >= 0)
  }
}

function classifyWithFallbackRegex(events: EventForClassification[]): Set<number> {
  const included = new Set<number>()
  for (let i = 0; i < events.length; i++) {
    const text = `${events[i].TITLE} ${events[i].USE_TRGT}`
    if (FALLBACK_BABY_PATTERN.test(text)) {
      included.add(i)
    }
  }
  console.log(`[event-classifier] Fallback regex: ${included.size}/${events.length} included`)
  return included
}
