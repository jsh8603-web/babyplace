/**
 * Audit: Find blog_mentions wrongly assigned to branch places.
 *
 * Only detects: Title mentions a DIFFERENT location (홍대, 강남, 속초, ...)
 * while NOT mentioning the place's own location (branch name or address).
 *
 * Does NOT flag low relevance_score alone (old scoring → not reliable).
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_audit_branch_mentions.ts
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_audit_branch_mentions.ts --fix
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

// ─── District → local common area names ─────────────────────────────────────
// Places in the same gu should not flag each other's common area names

const DISTRICT_LOCAL_AREAS: Record<string, string[]> = {
  마포: ['홍대', '홍대입구', '합정', '연남', '상수', '망원', '서교', '동교', '연남동', '서교동', '합정동', '망원동', '상수동'],
  성동: ['왕십리', '성수', '뚝섬', '금호', '행당', '응봉', '옥수', '성수동', '금호동', '행당동'],
  강남: ['강남', '역삼', '삼성', '논현', '학동', '청담', '압구정', '신사', '대치', '개포', '수서', '역삼동', '삼성동', '논현동', '청담동', '압구정동', '신사동', '대치동'],
  서초: ['서초', '반포', '방배', '교대', '양재', '서초동', '반포동', '방배동', '양재동'],
  송파: ['잠실', '송파', '가락', '문정', '장지', '석촌', '잠실동', '가락동', '문정동', '석촌동'],
  강동: ['천호', '길동', '둔촌', '상일', '명일', '고덕', '천호동', '길동', '명일동', '고덕동'],
  용산: ['용산', '이태원', '한남', '삼각지', '이태원동', '한남동', '보광동'],
  종로: ['종로', '인사동', '혜화', '광화문', '삼청동', '북촌', '서촌', '인사동'],
  중구: ['중구', '명동', '충무로', '을지로', '회현', '약수', '신당', '동대문', '명동', '회현동', '신당동', '황학동'],
  서대문: ['서대문', '신촌', '이대', '연세로', '창천', '홍은동'],
  관악: ['관악', '신림', '봉천', '서울대입구', '낙성대'],
  동작: ['동작', '사당', '이수', '노량진', '상도', '흑석'],
  광진: ['광진', '건대', '건대입구', '군자', '구의', '자양', '자양동', '구의동', '중곡'],
  영등포: ['영등포', '여의도', '당산', '문래', '양평동', '대림'],
  양천: ['양천', '목동', '신정', '신월'],
  강서: ['강서', '마곡', '발산', '화곡', '등촌', '방화', '가양', '마곡동'],
  구로: ['구로', '구로디지털', '개봉', '오류', '신도림'],
  금천: ['금천', '가산', '독산', '시흥대로'],
  노원: ['노원', '상계', '중계', '하계', '공릉', '월계'],
  도봉: ['도봉', '쌍문', '방학', '창동'],
  강북: ['강북', '수유', '미아', '번동'],
  성북: ['성북', '정릉', '길음', '돈암', '성신여대', '보문'],
  동대문: ['동대문', '장안', '답십리', '제기', '회기', '청량리', '이문', '휘경'],
  중랑: ['중랑', '면목', '상봉', '망우', '묵동', '신내'],
  은평: ['은평', '응암', '역촌', '불광', '연신내'],
}

// ─── Sub-area → parent city mapping (matches naver-blog.ts SUB_AREA_TO_PARENT) ─

const SUB_AREA_TO_PARENT: Record<string, string> = {
  동탄: '화성', 병점: '화성', 봉담: '화성', 향남: '화성',
  판교: '성남', 분당: '성남', 야탑: '성남', 서현: '성남', 정자: '성남',
  일산: '고양', 삼송: '고양', 화정: '고양', 대화: '고양', 탄현: '고양',
  광교: '수원', 영통: '수원', 인계: '수원', 매탄: '수원',
  산본: '군포', 위례: '하남', 운정: '파주', 배곧: '시흥',
  호매실: '수원', 금곡: '수원', 권선: '수원',
  미금: '성남', 오리: '성남', 수내: '성남',
}

// Known location names for competing branch detection
const KNOWN_LOCATIONS = [
  // Seoul areas (3+ chars preferred, avoid 2-char false positives)
  '강남역', '강남구', '서초구', '서초동', '송파구', '잠실역', '잠실동', '강동구',
  '광진구', '건대입구', '성동구', '왕십리', '중구', '을지로', '종로구', '종로',
  '마포구', '홍대입구', '홍대역', '합정역', '합정동', '연남동', '상수동',
  '영등포', '여의도', '구로구', '금천구', '관악구', '동작구', '사당역',
  '용산구', '이태원', '한남동', '성북구', '노원구', '도봉구', '강북구',
  '은평구', '서대문', '동대문', '중랑구', '양천구', '목동', '강서구',
  '청담동', '압구정', '역삼동', '논현동', '학동역',
  '건대', '뚝섬', '성수동', '행당동', '금호동',
  '방배동', '교대역', '대치동', '개포동', '수서역', '가락동', '문정동',
  '천호동', '길동', '상일동',
  '수유역', '쌍문역', '창동역', '상봉역', '면목동',
  '마곡', '발산역', '등촌동', '화곡동',
  '신촌역', '이대역', '아현동',
  '명동', '회현역', '충무로', '약수역', '신당동',
  '답십리', '장한평', '군자역',
  // Shortened forms that commonly appear in blog titles
  '홍대', '강남', '잠실', '건대', '송파', '이태원', '합정', '연남', '상수',
  '여의도', '사당', '교대', '성수', '왕십리', '을지로', '신촌', '명동',
  '이수', '반포', '방배', '한남', '용산', '양재', '논현', '삼성', '역삼',
  // Gyeonggi
  '분당', '판교', '수원', '일산', '고양', '성남', '용인', '동탄', '하남',
  '구리', '남양주', '의정부', '부천', '안양', '광명', '안산', '시흥', '김포',
  '파주', '과천', '군포', '평택', '광교', '산본', '위례',
  '인천', '부평', '송도', '청라',
]

// Out-of-service-area locations (always wrong)
const OUT_OF_AREA = [
  '속초', '강릉', '춘천', '원주', '부산', '해운대', '대구', '대전', '광주', '울산',
  '전주', '목포', '여수', '순천', '제주', '서귀포', '경주', '포항', '창원', '진주',
  '거제', '통영', '충주', '천안', '아산', '세종', '청주', '논산', '익산',
  '군산', '김해', '양산', '안동', '영주', '태백', '삼척', '동해', '정선',
  '양양', '인제', '홍천', '영월',
]

// ─── Types ─────────────────────────────────────────────────────────────────

interface BadMention {
  mentionId: number
  placeId: number
  placeName: string
  title: string
  reason: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface PlaceLocations {
  brand: Set<string>    // Chain/brand name words (NOT used for positive matching)
  location: Set<string> // Location identifiers (used for positive matching)
}

function getPlaceLocations(name: string, address: string | null, roadAddress: string | null): PlaceLocations {
  const brand = new Set<string>()
  const location = new Set<string>()

  const isBranch = /점$/.test(name)

  if (isBranch) {
    // Extract branch part: "청기와타운 왕십리점" → brand="청기와타운", location="왕십리"
    const branchMatch = name.match(/(.+?)점$/)
    if (branchMatch) {
      const full = branchMatch[1]

      // Scan for known location names within the full name
      const allLocations = [...KNOWN_LOCATIONS, ...OUT_OF_AREA]
      for (const loc of allLocations) {
        if (loc.length >= 2 && full.includes(loc)) location.add(loc)
      }

      // Extract trailing branch part after last space
      const spaceMatch = full.match(/\s+(.+)$/)
      if (spaceMatch) {
        const branchPart = spaceMatch[1].replace(/역$/, '')
        location.add(branchPart)
        // Brand is everything before the branch
        const brandPart = full.replace(/\s+.+$/, '')
        for (const w of brandPart.split(/\s+/)) {
          if (w.length >= 2) brand.add(w)
        }
      } else {
        // No space: "키즈베이위례점" — entire prefix is brand+location mixed
        // Known locations already extracted above
        brand.add(full.replace(/[가-힣]{2,}점$/, full))
      }

      // Sub-area mappings for branch location
      for (const token of [...location]) {
        if (SUB_AREA_TO_PARENT[token]) location.add(SUB_AREA_TO_PARENT[token])
        for (const [sub, parent] of Object.entries(SUB_AREA_TO_PARENT)) {
          if (parent === token) location.add(sub)
        }
      }
    }
  } else {
    // Non-branch: all name words go to brand, scan for embedded locations
    for (const word of name.split(/\s+/)) {
      if (word.length >= 2) brand.add(word)
    }
    for (const loc of [...KNOWN_LOCATIONS, ...OUT_OF_AREA]) {
      if (loc.length >= 2 && name.includes(loc)) location.add(loc)
    }
  }

  // From address — multi-level suffix stripping → always location
  const addr = address || roadAddress || ''
  const addrParts = addr.replace(/[()]/g, ' ').split(/\s+/)
  const adminSuffix = /특별시$|광역시$|시$|구$|군$|읍$|면$|동$|로$|길$/
  for (const p of addrParts) {
    if (p.length < 2) continue
    location.add(p)
    let c1 = p.replace(adminSuffix, '')
    if (c1.length >= 2 && c1 !== p) {
      location.add(c1)
      let c2 = c1.replace(adminSuffix, '')
      if (c2.length >= 2 && c2 !== c1) location.add(c2)
    }
  }

  // Sub-area mappings for address tokens
  for (const token of [...location]) {
    if (SUB_AREA_TO_PARENT[token]) location.add(SUB_AREA_TO_PARENT[token])
    for (const [sub, parent] of Object.entries(SUB_AREA_TO_PARENT)) {
      if (parent === token) location.add(sub)
    }
  }

  // District → local areas: if place is in 마포구, add 홍대/합정/연남 etc.
  for (const token of [...location]) {
    const localAreas = DISTRICT_LOCAL_AREAS[token]
    if (localAreas) {
      for (const area of localAreas) location.add(area)
    }
  }

  return { brand, location }
}

// Word-boundary-aware location match for Korean text
// "진안동맛집" should NOT match "안동" (안동 is substring but 진+안동 is a different word)
// "안동맛집" or "안동 맛집" SHOULD match "안동"
function matchLocation(text: string, loc: string): boolean {
  let idx = 0
  while (true) {
    const pos = text.indexOf(loc, idx)
    if (pos === -1) return false

    // Check left boundary: start of string, space, or bracket
    const leftOk = pos === 0 || /[\s\[\](]/.test(text[pos - 1])

    // For 2-char locations, require stricter boundary to avoid substring matches
    if (loc.length <= 2 && !leftOk) {
      idx = pos + 1
      continue
    }

    return true
  }
}

function detectWrongBranch(title: string, locs: PlaceLocations): string | null {
  const titleL = title.toLowerCase()

  // Check if title mentions the place's own LOCATION (not brand) → not wrong
  for (const loc of locs.location) {
    if (titleL.includes(loc.toLowerCase())) return null
  }

  // Out-of-area locations (always wrong) — require word boundary for short names
  for (const loc of OUT_OF_AREA) {
    if (locs.location.has(loc)) continue
    if (matchLocation(titleL, loc)) return `서비스지역외(${loc})`
  }

  // Competing locations within service area
  for (const loc of KNOWN_LOCATIONS) {
    if (loc.length < 2) continue
    if (locs.location.has(loc)) continue
    if (matchLocation(titleL, loc)) return `다른지역(${loc})`
  }

  return null
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const doFix = process.argv.includes('--fix')
  console.log(doFix ? '=== FIX MODE ===' : '=== AUDIT MODE ===')

  // Get all active places with mentions (paginated, Supabase default limit = 1000)
  const allPlaces: { id: number; name: string; address: string | null; road_address: string | null; mention_count: number | null }[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error: fetchErr } = await supabase
      .from('places')
      .select('id, name, address, road_address, mention_count')
      .eq('is_active', true)
      .gt('mention_count', 0)
      .order('mention_count', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (fetchErr || !data || data.length === 0) break
    allPlaces.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  const error = allPlaces.length === 0 ? new Error('No data') : null

  if (error || !allPlaces) {
    console.error('Failed to fetch places:', error)
    process.exit(1)
  }

  console.log(`Active places with mentions: ${allPlaces.length}`)

  const badMentions: BadMention[] = []
  let totalMentionsChecked = 0

  for (const place of allPlaces) {
    const locs = getPlaceLocations(place.name, place.address, place.road_address)

    const { data: mentions } = await supabase
      .from('blog_mentions')
      .select('id, title')
      .eq('place_id', place.id)

    if (!mentions || mentions.length === 0) continue
    totalMentionsChecked += mentions.length

    for (const m of mentions) {
      if (!m.title) continue

      const wrongReason = detectWrongBranch(m.title, locs)
      if (wrongReason) {
        badMentions.push({
          mentionId: m.id,
          placeId: place.id,
          placeName: place.name,
          title: m.title.slice(0, 80),
          reason: wrongReason,
        })
      }
    }
  }

  console.log(`Total mentions checked: ${totalMentionsChecked}`)
  console.log(`Bad mentions found: ${badMentions.length}`)

  if (badMentions.length === 0) {
    console.log('No bad mentions found.')
    return
  }

  // Group by place
  const byPlace = new Map<number, BadMention[]>()
  for (const bm of badMentions) {
    const group = byPlace.get(bm.placeId) || []
    group.push(bm)
    byPlace.set(bm.placeId, group)
  }

  console.log(`Affected places: ${byPlace.size}\n`)

  for (const [placeId, mentions] of byPlace) {
    const first = mentions[0]
    const place = allPlaces.find((p) => p.id === placeId)
    const curCount = place?.mention_count || 0
    const newCount = curCount - mentions.length
    console.log(`  ${first.placeName} (id:${placeId}) — ${mentions.length} bad / ${curCount} total → ${newCount}`)
    for (const m of mentions) {
      console.log(`    [${m.reason}] ${m.title}`)
    }
    console.log()
  }

  if (!doFix) {
    console.log('Run with --fix to delete bad mentions and recalculate counts.')
    return
  }

  // Delete bad mentions
  const mentionIds = badMentions.map((m) => m.mentionId)
  for (let i = 0; i < mentionIds.length; i += 100) {
    const batch = mentionIds.slice(i, i + 100)
    const { error: delErr } = await supabase.from('blog_mentions').delete().in('id', batch)
    if (delErr) console.error('Delete error:', delErr.message)
  }
  console.log(`Deleted ${mentionIds.length} bad mentions`)

  // Recalculate mention_count for affected places
  const affectedPlaceIds = [...byPlace.keys()]
  for (const placeId of affectedPlaceIds) {
    const { count } = await supabase
      .from('blog_mentions')
      .select('id', { count: 'exact', head: true })
      .eq('place_id', placeId)

    await supabase
      .from('places')
      .update({ mention_count: count || 0 })
      .eq('id', placeId)
  }
  console.log(`Recalculated mention_count for ${affectedPlaceIds.length} places`)

  // Verify 청기와타운
  const { data: verify } = await supabase
    .from('blog_mentions')
    .select('id, title')
    .eq('place_id', 36431)
  console.log(`\n=== 검증: 청기와타운 왕십리점 남은 mentions: ${(verify || []).length} ===`)
  for (const m of verify || []) {
    console.log(`  ${m.title?.slice(0, 70)}`)
  }

  console.log('\nDone.')
}

main().catch(console.error)
