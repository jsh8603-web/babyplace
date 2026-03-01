/**
 * Event sub_category classifier
 *
 * Classifies events into sub-categories based on title keywords.
 * Used by both collectors (Seoul, Tour API) and migration backfill.
 */

const SUB_CATEGORY_PATTERNS: [RegExp, string][] = [
  [/전시|展|갤러리|미술|아트페어/i, '전시'],
  [/축제|페스타|페스티벌|마켓|박람회/i, '축제'],
  [/체험|워크숍|클래스|만들기/i, '체험'],
  [/공연|콘서트|뮤지컬|연극/i, '공연'],
]

/**
 * Classify event sub_category by title keywords.
 * Returns null if no pattern matches.
 */
export function classifyEventByTitle(title: string): string | null {
  for (const [pattern, category] of SUB_CATEGORY_PATTERNS) {
    if (pattern.test(title)) {
      return category
    }
  }
  return null
}

/**
 * Seoul CODENAME → sub_category mapping.
 * Seoul API CODENAME examples: "전시/미술", "축제-시민화합", "교육/체험", "공연"
 */
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
 * Falls back to title-based classification if CODENAME not recognized.
 */
export function classifySeoulEvent(codename: string, title: string): string | null {
  // Try exact CODENAME match first
  if (CODENAME_MAP[codename]) {
    return CODENAME_MAP[codename]
  }

  // Try partial match (e.g., "축제-기타" → "축제")
  for (const [key, value] of Object.entries(CODENAME_MAP)) {
    if (codename.startsWith(key)) {
      return value
    }
  }

  // Fall back to title-based classification
  return classifyEventByTitle(title)
}
