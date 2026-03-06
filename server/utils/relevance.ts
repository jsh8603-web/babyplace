/**
 * Blog post ↔ Place relevance scoring.
 * Pure functions — no DB, no API, no side effects.
 * Used by naver-blog.ts (pipeline) and mention-audit.ts (audit).
 */

export interface AddressComponents {
  city: string          // "서울" | "경기" | "인천"
  district: string      // "중구" | "강남구" (접미사 포함)
  dong: string | null   // "남창동" | "와부읍"
  road: string | null   // "퇴계로" (숫자 제거)
}

export interface RelevanceBreakdown {
  name_title: number
  name_snippet: number
  addr_dong: number
  addr_road: number
  addr_district: number
  baby_bonus: number
  visit_intent: number
  penalty_competing_location: number
  penalty_competing_branch: number
  penalty_irrelevant: number
  penalty_landmark: number
  penalty_generic_suffix: number
  penalty_common_name: number
}

export interface RelevanceResult {
  score: number
  breakdown: RelevanceBreakdown
  penalties: string[]
}

// ─── Constants ──────────────────────────────────────────────────────────────

const COMPETING_LOCATIONS = new Set([
  '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '충청', '전북', '전남', '전라', '경북', '경남', '경상', '제주',
  '진주', '김해', '창원', '포항', '구미', '거제', '통영', '양산',
  '여수', '순천', '목포', '군산', '전주', '익산',
  '천안', '아산', '청주',
  '춘천', '원주', '강릉', '속초', '동해',
])

const SERVICE_AREA_CITIES = [
  '시흥', '이천', '수원', '성남', '안양', '부천', '용인', '고양', '김포',
  '하남', '구리', '광명', '안산', '평택', '파주', '양주', '포천', '여주',
  '안성', '오산', '의왕', '군포', '과천', '양평', '가평', '동두천', '연천',
  '남양주', '의정부',
  '판교', '분당', '동탄', '일산', '산본', '광교', '위례', '운정', '배곧',
]

const SUB_AREA_TO_PARENT: Record<string, string> = {
  '동탄': '화성', '병점': '화성', '봉담': '화성', '향남': '화성',
  '판교': '성남', '분당': '성남', '야탑': '성남', '정자': '성남',
  '일산': '고양', '화정': '고양', '행신': '고양', '삼송': '고양',
  '산본': '군포', '광교': '수원', '영통': '수원',
  '운정': '파주', '배곧': '시흥', '정왕': '시흥',
  '위례': '하남',
}

const IRRELEVANT_CONTENT_TERMS = [
  '구매후기', '제품리뷰', '상품평', '배송후기', '가격비교', '할인코드',
  '쿠팡', '네이버쇼핑', '11번가', '지마켓', '옥션',
  '사용후기', '언박싱', '개봉기',
  '분양정보', '매매가', '시세차익', '전세가', '재건축', '모델하우스',
  '평당가', '분양가', '청약', '입주자모집', '오피스텔분양', '빌라매매',
  '출장마사지', '출장안마', '홈타이',
]

const LANDMARK_MARKERS = ['근처', '옆에', '앞에', '뒤에', '인근', '부근', '바로 옆', '맞은편']

const GENERIC_PLACE_SUFFIXES = [
  '어린이공원', '근린공원', '소공원', '체육공원',
  '도시공원', '수변공원', '중앙공원',
]

const SHORT_TERM_THRESHOLD = 2
const KOREAN_CHAR_RE = /[\uAC00-\uD7AF]/

// ─── Internal helpers ───────────────────────────────────────────────────────

function hasCompetingLocation(text: string, ownCity: string): boolean {
  for (const loc of COMPETING_LOCATIONS) {
    if (loc === ownCity) continue
    if (text.includes(loc)) return true
  }
  return false
}

function hasCompetingServiceAreaCity(title: string, addr: AddressComponents): boolean {
  const titleL = title.toLowerCase()
  const fullAddr = `${addr.city} ${addr.district || ''} ${addr.dong || ''} ${addr.road || ''}`

  const ownCities = new Set<string>()
  for (const token of [addr.city, addr.district, addr.dong]) {
    if (token) ownCities.add(token)
  }
  for (const [sub, parent] of Object.entries(SUB_AREA_TO_PARENT)) {
    if (ownCities.has(parent)) ownCities.add(sub)
    if (fullAddr.includes(sub)) ownCities.add(parent)
  }

  const ownTokens = [addr.city, addr.district, addr.dong, addr.road]
    .filter((t): t is string => !!t && t.length >= 2)
  if (ownTokens.some(t => titleL.includes(t.toLowerCase()))) return false

  for (const city of SERVICE_AREA_CITIES) {
    if (ownCities.has(city)) continue
    if (titleL.includes(city)) return true
  }
  return false
}

function matchesAsStandaloneWord(text: string, term: string): boolean {
  if (term.length > SHORT_TERM_THRESHOLD) return text.includes(term)
  let idx = -1
  while ((idx = text.indexOf(term, idx + 1)) !== -1) {
    const before = idx > 0 ? text[idx - 1] : ''
    const after = idx + term.length < text.length ? text[idx + term.length] : ''
    if (!KOREAN_CHAR_RE.test(before) && !KOREAN_CHAR_RE.test(after)) return true
  }
  return false
}

function hasIrrelevantContentSignals(text: string, dynamicBlacklistTerms: string[] = []): boolean {
  if (IRRELEVANT_CONTENT_TERMS.some((t) => text.includes(t))) return true
  if (dynamicBlacklistTerms.some((t) => matchesAsStandaloneWord(text, t))) return true
  return false
}

function isLandmarkReference(placeName: string, text: string): boolean {
  const nameL = placeName.toLowerCase().replace(/\s+/g, '')
  for (const marker of LANDMARK_MARKERS) {
    if (text.includes(nameL + ' ' + marker) || text.includes(nameL + marker)) return true
    if (text.includes(marker + ' ' + nameL) || text.includes(marker + nameL)) return true
  }
  return false
}

function hasGenericPlaceSuffix(name: string): boolean {
  const n = name.replace(/\s+/g, '')
  return GENERIC_PLACE_SUFFIXES.some((s) => n.endsWith(s))
}

// ─── Address parser ─────────────────────────────────────────────────────────

const CITY_NORMALIZE: Record<string, string> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  경기도: '경기', 경기: '경기',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
}

export function parseAddressComponents(
  roadAddress: string | null,
  address: string | null
): AddressComponents {
  const result: AddressComponents = { city: '', district: '', dong: null, road: null }
  const raw = roadAddress || address || ''
  if (!raw) return result

  const tokens = raw.replace(/\(([^)]+)\)/g, ' $1 ').split(/\s+/)

  for (const t of tokens) {
    if (!result.city && CITY_NORMALIZE[t]) { result.city = CITY_NORMALIZE[t]; continue }
    if (!result.district && /^[가-힣]{1,5}[구군시]$/.test(t) && !CITY_NORMALIZE[t]) { result.district = t; continue }
    if (!result.dong && /^[가-힣]{1,10}[동읍면리]$/.test(t)) { result.dong = t; continue }
    if (!result.road && /[가-힣]+[로길]/.test(t)) {
      const roadMatch = t.match(/^([가-힣]+[로])/)
      if (roadMatch) result.road = roadMatch[1]
      continue
    }
  }

  if (!result.dong && roadAddress) {
    const parenMatch = roadAddress.match(/\(([가-힣]+[동읍면리])\)/)
    if (parenMatch) result.dong = parenMatch[1]
  }

  return result
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function computePostRelevance(
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  title: string,
  snippet: string,
  dynamicBlacklistTerms: string[] = []
): number {
  return computePostRelevanceDetailed(placeName, addr, isCommon, title, snippet, dynamicBlacklistTerms).score
}

export function computePostRelevanceDetailed(
  placeName: string,
  addr: AddressComponents,
  isCommon: boolean,
  title: string,
  snippet: string,
  dynamicBlacklistTerms: string[] = []
): RelevanceResult {
  const text = `${title} ${snippet}`.toLowerCase()
  const nameL = placeName.toLowerCase()
  let score = 0
  const penalties: string[] = []

  const bd: RelevanceBreakdown = {
    name_title: 0, name_snippet: 0,
    addr_dong: 0, addr_road: 0, addr_district: 0,
    baby_bonus: 0, visit_intent: 0,
    penalty_competing_location: 0, penalty_competing_branch: 0,
    penalty_irrelevant: 0, penalty_landmark: 0,
    penalty_generic_suffix: 0, penalty_common_name: 0,
  }

  // --- Positive signals ---
  if (title.toLowerCase().includes(nameL)) {
    bd.name_title = 0.25; score += 0.25
  } else if (text.includes(nameL)) {
    bd.name_snippet = 0.15; score += 0.15
  } else {
    const nameWords = nameL.split(/\s+/).filter((w) => w.length >= 2)
    const matchedWords = nameWords.filter((w) => text.includes(w))
    if (matchedWords.length > 0) {
      const v = 0.10 * (matchedWords.length / nameWords.length)
      bd.name_snippet = v; score += v
    }
  }

  if (addr.dong && text.includes(addr.dong)) { bd.addr_dong = 0.30; score += 0.30 }
  if (addr.road && text.includes(addr.road)) { bd.addr_road = 0.20; score += 0.20 }
  if (addr.district && text.includes(addr.district)) { bd.addr_district = 0.10; score += 0.10 }

  const babyTerms = ['아기', '유아', '아이', '키즈', '어린이', '유모차', '수유']
  if (babyTerms.some((t) => text.includes(t))) { bd.baby_bonus = 0.10; score += 0.10 }

  const VISIT_INTENT_TERMS = ['다녀왔', '방문했', '갔다왔', '놀러갔', '산책했', '나들이', '데리고 갔', '다녀온']
  if (VISIT_INTENT_TERMS.some((t) => text.includes(t))) { bd.visit_intent = 0.10; score += 0.10 }

  // --- Negative signals ---
  if (hasCompetingLocation(text, addr.city)) {
    bd.penalty_competing_location = -0.50; score -= 0.50; penalties.push('competing_location')
  }
  if (hasCompetingServiceAreaCity(title, addr)) {
    bd.penalty_competing_branch = -0.30; score -= 0.30; penalties.push('competing_branch')
  }
  if (hasIrrelevantContentSignals(text, dynamicBlacklistTerms)) {
    bd.penalty_irrelevant = -0.20; score -= 0.20; penalties.push('irrelevant_content')
  }

  const isLandmarkRef = isLandmarkReference(placeName, text)
  if (isLandmarkRef) { bd.penalty_landmark = -0.20; score -= 0.20; penalties.push('landmark_ref') }

  const genericSuffix = hasGenericPlaceSuffix(placeName)
  const hasDongMatch = addr.dong ? text.includes(addr.dong) : false
  const hasRoadMatch = addr.road ? text.includes(addr.road) : false

  if (genericSuffix) {
    if (!hasDongMatch && !hasRoadMatch) {
      bd.penalty_generic_suffix += -0.30; score -= 0.30; penalties.push('generic_suffix_no_addr')
    }
    if (isLandmarkRef) {
      bd.penalty_generic_suffix += -0.20; score -= 0.20; penalties.push('generic_suffix_landmark')
    }
  }

  if (isCommon && !addr.dong?.length && !addr.road?.length) {
    bd.penalty_common_name = -(score - 0.20)
    score = Math.min(score, 0.20)
    penalties.push('common_name_no_addr')
  } else if (isCommon) {
    if (!hasDongMatch && !hasRoadMatch) {
      bd.penalty_common_name = -0.25; score -= 0.25; penalties.push('common_name_addr_miss')
    }
  }

  // Name-absent cap: if place name is not found anywhere in text, cap score at 0.25
  // Address-only matches (dong/road/district) without any name match are unreliable
  const hasAnyNameMatch = bd.name_title > 0 || bd.name_snippet > 0
  if (!hasAnyNameMatch && score > 0.25) {
    const excess = score - 0.25
    bd.penalty_generic_suffix += -excess
    score = 0.25
    penalties.push('name_absent_cap')
  }

  return { score: Math.max(0, Math.min(score, 1.0)), breakdown: bd, penalties }
}
