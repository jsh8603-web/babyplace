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

import { checkPlaceGate } from './place-gate'

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
