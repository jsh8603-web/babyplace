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

/** Name patterns for non-baby-relevant places (single source of truth) */
const BLOCKED_NAME_PATTERNS =
  /주차장|충전소|사업단|관리사무소|행정기관|관리공단|운영사무국|안전센터|지구대|파출소|교도소|소방서|우체국|세무서|등기소|출장소|민원실|공영주차|노상주차|물류센터|데이터센터|행정복지센터|관광안내소|무인민원발급|자전거인증센터|국방벤처|미디어센터|삼성전자서비스|LG전자서비스|한국건강관리협회|사이즈코리아|판금공업|카센터|자동차정비|자동차수리|타이어뱅크|타이어프로|오토바이|철물점|공업사|아이모터스|현대모터스|기아모터스|경찰서|버스터미널|시외버스터미널|고속버스터미널|하나로마트|농협마트|묘역$|추모비$|순절비$|선정비$|장군묘|행궁지$|저수지$|등산로$|산림욕장$|관광특구$|약수터$|해맞이|소악루|삼층석탑|열녀문|소녀상|동상$|치현정|염창정|용왕정|인증센터|기념관$|썬팅|PT스튜디오|피트니스|공장$|금속$|플라스틱|엔지니어링$|CC$|골프장|마을회관$|공중화장실|보호수|저류지$|시민농원|정미소|가구물류|조경자재|낚시터|건설학원|요양원|요양병원|터널$|제각$|선생묘|공적비|보루$|보루군|좌상$|마애|현충탑|봉돈|산$|봉$|천$|골$|고개$|폭포$|바위$|궁$|궁궐|사찰|사당|서원$|향교|명륜|번사|총국|관아|왕릉|능묘|묘소|성곽|성터|성벽|봉수대|비석|기념비|전적지|유적|사적|종묘|반려견|애견|스키장|슬로프|렌탈샵|스노파크|실내스키|수상스키|레저클럽|바베큐캠프|관사병영|연수원$|철교$|대교$|고양이카페|애묘|교차로$|순교지|성황당|부군당|관측소|지하상가|주류$|맥주창고|갈림길|초급자|중급자|상급자|최상급자|관광정보센터|석불|용수지$|샘터$|스노우캣|드론라이트쇼/

/** Brand blacklist: startsWith match (handles "놀숲강남점", "벌툰홍대점" etc.) */
const BLOCKED_BRANDS = [
  '놀숲', '벌툰', '레드버튼', '홈즈앤루팡', '히어로보드게임', '나인블럭',
  '홈플러스',
  '스타벅스', '이디야', '투썸플레이스', '할리스', '메가커피', '컴포즈',
  '빽다방', '더벤티', '파스쿠찌', '폴바셋', '엔제리너스', '카페베네',
  '탐앤탐스', '커피빈', '요거프레소', '공차', '쥬시',
  '다이소', '유니클로', '올리브영',
  'GS25', '세븐일레븐', 'CU ',
  'KB국민은행', '하나은행', '우리은행', '신한은행', 'NH농협은행', 'IBK기업은행',
  '베어스타운', '양지파인리조트', '곤지암리조트', '지산리조트',
]

/** Category patterns to block */
const BLOCKED_CATEGORIES =
  /만화카페|보드게임|방탈출|PC방|피시방|스터디카페|코인노래방|당구|볼링장|노래방|네일|피부관리|미용실|안경|성인|카지노|나이트|룸카페|룸살롬|주점|유흥|호프|라이브카페|직업소개|인력파견|배관|누수|전기자재|부품|직물|원단|반도체|해운|해상|시공업체|철거|조명기기|오피스텔|빌라,주택|아파트|전자담배|셀프세차|세차장|화장품|숙박예약|쇼핑시설관리|행정기관|지방행정|슈퍼마켓|가구판매|주방가구|정육점|단체,협회|협회,단체|연구소|사회단체|시민단체|자동차정비|자동차수리|타이어|판금|도장|철물|공업사|카센터|오락실|게임장|게임센터|탁구장|탁구클럽|사우나|찜질방|모텔|여관|여인숙|호텔|펜션|리조트|게스트하우스|민박|부동산|공인중개|인테리어|여행사|주유소|세탁소|빨래방|코인세탁|묘지|납골|장례|화장장|주차|렌터카|대리운전|경찰서|소방서|파출소|우체국|버스터미널|시외버스|고속버스|양꼬치|샤브샤브|곱창|대창|막창|쭈꾸미|닭발|족발|보쌈|치킨|피자|햄버거|중국집|중식당|일식집|횟집|삼겹살|고깃집|고기집|갈비|곱창전골|하나로마트|농협마트|이마트|롯데마트|코스트코|피트니스|헬스장|PT스튜디오|크로스핏|필라테스|썬팅|자동차썬팅|테마거리|먹자골목|카페거리|도보여행|고궁|사적지|유적지|반려견|영화관|CGV|롯데시네마|메가박스|시네마|교회$|성당$/

/** Names containing these keywords bypass category blocking (explicit baby-relevance) */
const BABY_NAME_WHITELIST = /키즈|어린이|유아|베이비|아기|아동|육아|이유식|맘마|baby|kids|키움|돌봄|놀이터|장난감/i

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

// ─── Sync helpers (for audit bulk-judge, no DB call) ────────────────────────

/** Check name against static BLOCKED_NAME_PATTERNS (sync, no DB) */
export function isBlockedByNamePattern(name: string): boolean {
  return BLOCKED_NAME_PATTERNS.test(name)
}

/** Check name against static BLOCKED_BRANDS (sync, no DB) */
export function isBlockedByBrand(name: string): boolean {
  return BLOCKED_BRANDS.some((brand) => name.startsWith(brand))
}

/** Check category string against static BLOCKED_CATEGORIES (sync, no DB) */
export function isBlockedByCategoryPattern(catStr: string): boolean {
  return BLOCKED_CATEGORIES.test(catStr)
}

/** Check if name contains explicit baby-relevant keywords */
export function isBabyRelevantName(name: string): boolean {
  return BABY_NAME_WHITELIST.test(name)
}

// ─── Main export ────────────────────────────────────────────────────────────

export async function checkPlaceGate(input: PlaceGateInput): Promise<PlaceGateResult> {
  const { name, categoryName, subCategory } = input

  // 0. Short/generic name filter (#14): block 2-char-or-less non-specific names
  if (name.length <= 2 && !BABY_NAME_WHITELIST.test(name)) {
    return { allowed: false, reason: `short_name: "${name}" (<=2 chars)` }
  }

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

  // 3. Category blacklist (skip if name has explicit baby keywords)
  const catStr = [categoryName, subCategory].filter(Boolean).join(' ')
  if (catStr && BLOCKED_CATEGORIES.test(catStr) && !BABY_NAME_WHITELIST.test(name)) {
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
