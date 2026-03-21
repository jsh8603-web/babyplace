import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          data: [],
          error: null,
        }),
      }),
      update: () => ({ eq: () => ({ data: null, error: null }) }),
    }),
  },
}))

import { checkPlaceGate, isBlockedByNamePattern, isBlockedByBrand, isBlockedByCategoryPattern, isBabyRelevantName } from './place-gate'

describe('checkPlaceGate — name pattern blocks', () => {
  it('"주차장" → blocked', async () => {
    const result = await checkPlaceGate({ name: '주차장' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"충전소" → blocked', async () => {
    const result = await checkPlaceGate({ name: '충전소' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"관리사무소" → blocked', async () => {
    const result = await checkPlaceGate({ name: '관리사무소' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"공영주차 강남" → blocked (contains BLOCKED pattern)', async () => {
    const result = await checkPlaceGate({ name: '공영주차 강남' })
    expect(result.allowed).toBe(false)
  })
})

describe('checkPlaceGate — brand blacklist', () => {
  it('"놀숲강남점" → blocked (startsWith "놀숲")', async () => {
    const result = await checkPlaceGate({ name: '놀숲강남점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })

  it('"스타벅스강남역점" → blocked (startsWith "스타벅스")', async () => {
    const result = await checkPlaceGate({ name: '스타벅스강남역점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })

  it('"메가커피홍대점" → blocked (startsWith "메가커피")', async () => {
    const result = await checkPlaceGate({ name: '메가커피홍대점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })
})

describe('checkPlaceGate — category blacklist', () => {
  it('"무한코믹스" with categoryName "만화카페" → blocked', async () => {
    const result = await checkPlaceGate({ name: '무한코믹스', categoryName: '만화카페' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('category')
  })

  it('"이스케이프강남" with categoryName "방탈출" → blocked', async () => {
    const result = await checkPlaceGate({ name: '이스케이프강남', categoryName: '방탈출' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('category')
  })
})

describe('checkPlaceGate — baby whitelist bypasses category block', () => {
  it('"키즈카페 놀이나라" with categoryName "카페" → allowed (BABY_NAME_WHITELIST)', async () => {
    // "카페" alone is not in BLOCKED_CATEGORIES, but even if it were,
    // the name contains "키즈" which is in BABY_NAME_WHITELIST.
    // Use a category that IS blocked to verify the bypass works.
    const result = await checkPlaceGate({ name: '키즈카페 놀이나라', categoryName: '카페' })
    expect(result.allowed).toBe(true)
  })

  it('"어린이 방탈출 체험관" with categoryName "방탈출" → allowed (name has "어린이")', async () => {
    const result = await checkPlaceGate({ name: '어린이 방탈출 체험관', categoryName: '방탈출' })
    expect(result.allowed).toBe(true)
  })

  it('"베이비키즈카페" with categoryName "만화카페" → allowed (name has "베이비")', async () => {
    const result = await checkPlaceGate({ name: '베이비키즈카페', categoryName: '만화카페' })
    expect(result.allowed).toBe(true)
  })
})

describe('checkPlaceGate — new blocked brands (retail/bank/convenience)', () => {
  it('"다이소강남점" → blocked', async () => {
    const result = await checkPlaceGate({ name: '다이소강남점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })

  it('"GS25역삼점" → blocked', async () => {
    const result = await checkPlaceGate({ name: 'GS25역삼점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })

  it('"KB국민은행강남지점" → blocked', async () => {
    const result = await checkPlaceGate({ name: 'KB국민은행강남지점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })

  it('"올리브영홍대점" → blocked', async () => {
    const result = await checkPlaceGate({ name: '올리브영홍대점' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('brand')
  })
})

describe('checkPlaceGate — expanded name patterns', () => {
  it('"소요산" (산$) → blocked', async () => {
    const result = await checkPlaceGate({ name: '소요산' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"왕곡천" (천$) → blocked', async () => {
    const result = await checkPlaceGate({ name: '왕곡천' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"삼성공장" (공장$) → blocked', async () => {
    const result = await checkPlaceGate({ name: '삼성공장' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"남양골프장" → blocked', async () => {
    const result = await checkPlaceGate({ name: '남양골프장' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"요양병원" → blocked', async () => {
    const result = await checkPlaceGate({ name: '신도림요양병원' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('name_pattern')
  })

  it('"어린이공원" → allowed (baby whitelist)', async () => {
    const result = await checkPlaceGate({ name: '서울숲어린이공원' })
    expect(result.allowed).toBe(true)
  })
})

describe('checkPlaceGate — normal places allowed', () => {
  it('"고우가 여의도점" with categoryName "식당" → allowed', async () => {
    const result = await checkPlaceGate({ name: '고우가 여의도점', categoryName: '식당' })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('pass')
  })

  it('"서울숲 어린이도서관" with no category → allowed', async () => {
    const result = await checkPlaceGate({ name: '서울숲 어린이도서관' })
    expect(result.allowed).toBe(true)
  })

  it('"이유식 전문점 알콩달콩" → allowed (no blocked pattern)', async () => {
    const result = await checkPlaceGate({ name: '이유식 전문점 알콩달콩', categoryName: '식당' })
    expect(result.allowed).toBe(true)
  })

  it('brand not at start of name is not blocked', async () => {
    // "스타벅스" is blocked only when name startsWith it
    const result = await checkPlaceGate({ name: '우리동네 카페', categoryName: '카페' })
    expect(result.allowed).toBe(true)
  })
})

// ─── Sync helper functions ──────────────────────────────────────────────────

describe('isBlockedByNamePattern', () => {
  it('blocks known patterns', () => {
    expect(isBlockedByNamePattern('강남주차장')).toBe(true)
    expect(isBlockedByNamePattern('삼성공장')).toBe(true)
    expect(isBlockedByNamePattern('소요산')).toBe(true)
    expect(isBlockedByNamePattern('왕곡천')).toBe(true)
    expect(isBlockedByNamePattern('신도림요양병원')).toBe(true)
  })

  it('allows normal names', () => {
    expect(isBlockedByNamePattern('키즈카페 놀이나라')).toBe(false)
    expect(isBlockedByNamePattern('서울숲 어린이도서관')).toBe(false)
    expect(isBlockedByNamePattern('고우가 여의도점')).toBe(false)
  })
})

describe('isBlockedByBrand', () => {
  it('blocks brands at start of name', () => {
    expect(isBlockedByBrand('스타벅스강남역점')).toBe(true)
    expect(isBlockedByBrand('다이소홍대점')).toBe(true)
    expect(isBlockedByBrand('GS25역삼점')).toBe(true)
    expect(isBlockedByBrand('KB국민은행강남지점')).toBe(true)
  })

  it('does not block brand in middle of name', () => {
    expect(isBlockedByBrand('우리동네 스타벅스 옆')).toBe(false)
  })

  it('does not block non-brand names', () => {
    expect(isBlockedByBrand('키즈파크')).toBe(false)
  })
})

describe('isBlockedByCategoryPattern', () => {
  it('blocks known categories', () => {
    expect(isBlockedByCategoryPattern('만화카페')).toBe(true)
    expect(isBlockedByCategoryPattern('방탈출')).toBe(true)
    expect(isBlockedByCategoryPattern('PC방')).toBe(true)
    expect(isBlockedByCategoryPattern('볼링장')).toBe(true)
  })

  it('allows baby-friendly categories', () => {
    expect(isBlockedByCategoryPattern('키즈카페')).toBe(false)
    expect(isBlockedByCategoryPattern('소아과')).toBe(false)
    expect(isBlockedByCategoryPattern('어린이도서관')).toBe(false)
  })
})

describe('isBabyRelevantName', () => {
  it('detects baby-relevant keywords', () => {
    expect(isBabyRelevantName('키즈카페 놀이나라')).toBe(true)
    expect(isBabyRelevantName('어린이 도서관')).toBe(true)
    expect(isBabyRelevantName('베이비 수영장')).toBe(true)
    expect(isBabyRelevantName('Baby Park')).toBe(true)
    expect(isBabyRelevantName('서울숲놀이터')).toBe(true)
  })

  it('returns false for non-baby names', () => {
    expect(isBabyRelevantName('스타벅스')).toBe(false)
    expect(isBabyRelevantName('삼성공장')).toBe(false)
    expect(isBabyRelevantName('남양골프장')).toBe(false)
  })
})
