/**
 * Place Gate — central quality filter for all collectors.
 *
 * Every collector calls checkPlaceGate() before INSERT.
 * Returns { allowed: false, reason } to block non-baby-relevant places.
 *
 * Checks (in order, first match blocks):
 *   1. Name patterns (parking, charging, admin offices, etc.)
 *   2. Brand blacklist (comic cafes, board game cafes, coffee chains)
 *   3. Category blacklist (manga cafe, escape room, PC bang, etc.)
 *   4. Dynamic DB patterns (place_blacklist_patterns table, 5-min cache)
 */

import { supabaseAdmin } from '../lib/supabase-admin'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlaceGateInput {
  name: string
  categoryName?: string | null
  source?: string
  subCategory?: string | null
}

export interface PlaceGateResult {
  allowed: boolean
  reason: string
}

// ─── Static patterns ────────────────────────────────────────────────────────

/** Name patterns for non-baby-relevant places */
const BLOCKED_NAME_PATTERNS =
  /주차장|충전소|사업단|관리사무소|행정기관|관리공단|운영사무국|안전센터|지구대|파출소|교도소|소방서|우체국|세무서|등기소|출장소|민원실|공영주차|노상주차/

/** Brand blacklist: startsWith match (handles "놀숲강남점", "벌툰홍대점" etc.) */
const BLOCKED_BRANDS = [
  '놀숲', '벌툰', '레드버튼', '홈즈앤루팡', '히어로보드게임', '나인블럭',
  '스타벅스', '이디야', '투썸플레이스', '할리스', '메가커피', '컴포즈',
  '빽다방', '더벤티', '파스쿠찌', '폴바셋', '엔제리너스', '카페베네',
  '탐앤탐스', '커피빈', '요거프레소', '공차', '쥬시',
]

/** Category patterns to block */
const BLOCKED_CATEGORIES =
  /만화카페|보드게임|방탈출|PC방|피시방|스터디카페|코인노래방|당구|볼링장|노래방|네일|피부관리|미용실|안경|성인|카지노|나이트|룸카페|룸살롱/

// ─── Dynamic DB patterns (5-min cache) ──────────────────────────────────────

interface CachedPatterns {
  namePatterns: RegExp[]
  brandPrefixes: string[]
  categoryPatterns: RegExp[]
  loadedAt: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let cachedPatterns: CachedPatterns | null = null

async function loadDynamicPatterns(): Promise<CachedPatterns> {
  if (cachedPatterns && Date.now() - cachedPatterns.loadedAt < CACHE_TTL_MS) {
    return cachedPatterns
  }

  const result: CachedPatterns = {
    namePatterns: [],
    brandPrefixes: [],
    categoryPatterns: [],
    loadedAt: Date.now(),
  }

  const { data, error } = await supabaseAdmin
    .from('place_blacklist_patterns')
    .select('pattern_type, pattern')
    .eq('is_active', true)

  if (error || !data) {
    cachedPatterns = result
    return result
  }

  for (const row of data) {
    try {
      if (row.pattern_type === 'name') {
        result.namePatterns.push(new RegExp(row.pattern))
      } else if (row.pattern_type === 'brand') {
        result.brandPrefixes.push(row.pattern)
      } else if (row.pattern_type === 'category') {
        result.categoryPatterns.push(new RegExp(row.pattern))
      }
    } catch {
      // Invalid regex — skip
    }
  }

  cachedPatterns = result
  return result
}

// ─── Main export ────────────────────────────────────────────────────────────

export async function checkPlaceGate(input: PlaceGateInput): Promise<PlaceGateResult> {
  const { name, categoryName, subCategory } = input

  // 1. Name patterns
  if (BLOCKED_NAME_PATTERNS.test(name)) {
    return { allowed: false, reason: `name_pattern: ${name}` }
  }

  // 2. Brand blacklist
  for (const brand of BLOCKED_BRANDS) {
    if (name.startsWith(brand)) {
      return { allowed: false, reason: `brand: ${brand}` }
    }
  }

  // 3. Category blacklist
  const catStr = [categoryName, subCategory].filter(Boolean).join(' ')
  if (catStr && BLOCKED_CATEGORIES.test(catStr)) {
    return { allowed: false, reason: `category: ${catStr}` }
  }

  // 4. Dynamic DB patterns
  const dynamic = await loadDynamicPatterns()

  for (const re of dynamic.namePatterns) {
    if (re.test(name)) {
      return { allowed: false, reason: `db_name_pattern: ${re.source}` }
    }
  }

  for (const brand of dynamic.brandPrefixes) {
    if (name.startsWith(brand)) {
      return { allowed: false, reason: `db_brand: ${brand}` }
    }
  }

  if (catStr) {
    for (const re of dynamic.categoryPatterns) {
      if (re.test(catStr)) {
        return { allowed: false, reason: `db_category: ${re.source}` }
      }
    }
  }

  return { allowed: true, reason: 'pass' }
}

// ─── Feedback loop: flag irrelevant places ──────────────────────────────────

export async function flagIrrelevantPlaces(): Promise<{
  deactivated: number
  patternsLearned: number
}> {
  let deactivated = 0
  let patternsLearned = 0

  // 1. Deactivate places with high irrelevant count + low mention count
  const { data: flagged, error } = await supabaseAdmin
    .from('places')
    .select('id, name')
    .eq('is_active', true)
    .gte('irrelevant_mention_count', 5)
    .lte('mention_count', 2)

  if (error || !flagged || flagged.length === 0) {
    return { deactivated, patternsLearned }
  }

  const ids = flagged.map((p) => p.id)
  const { error: updateErr } = await supabaseAdmin
    .from('places')
    .update({ is_active: false })
    .in('id', ids)

  if (!updateErr) {
    deactivated = ids.length
    console.log(`[place-gate] Deactivated ${deactivated} irrelevant places`)
  }

  // 2. Extract name token patterns from deactivated places
  const tokenCounts = new Map<string, number>()
  for (const p of flagged) {
    const firstToken = p.name.split(/\s+/)[0]
    if (firstToken && firstToken.length >= 2) {
      tokenCounts.set(firstToken, (tokenCounts.get(firstToken) || 0) + 1)
    }
  }

  // 3. Register patterns for tokens appearing 3+ times
  for (const [token, count] of tokenCounts) {
    if (count < 3) continue

    const { error: insertErr } = await supabaseAdmin
      .from('place_blacklist_patterns')
      .upsert(
        {
          pattern_type: 'brand',
          pattern: token,
          source: 'feedback_loop',
          is_active: true,
        },
        { onConflict: 'pattern_type,pattern' }
      )

    if (!insertErr) {
      patternsLearned++
      console.log(`[place-gate] Learned pattern: brand "${token}" (${count} occurrences)`)
    }
  }

  // Invalidate cache so new patterns take effect immediately
  cachedPatterns = null

  return { deactivated, patternsLearned }
}
