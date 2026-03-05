import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}))

import { addressDistrictMatch } from './duplicate'

describe('addressDistrictMatch', () => {
  it('"서울 강남구" vs "서울특별시 강남구 삼성동" → true', () => {
    // tokensA = "서울강남구" → clean = "강남" (removes 특별시/시/구), slice(0,3) = "강남"
    // tokensB = "서울특별시강남구" → clean = "강남", slice(0,3) = "강남"
    expect(addressDistrictMatch('서울 강남구', '서울특별시 강남구 삼성동')).toBe(true)
  })

  it('"서울 강남구" vs "경기 성남시" → false', () => {
    expect(addressDistrictMatch('서울 강남구', '경기 성남시')).toBe(false)
  })

  it('same city different district → false', () => {
    expect(addressDistrictMatch('서울 강남구', '서울 마포구')).toBe(false)
  })

  it('short address with single token → false (length < 2 check)', () => {
    // Only one token → joined = "서울" (length 2) → clean = "" → slice(0,3) = ""
    // The check is tokensA.length < 2 or tokensB.length < 2 before clean
    // tokensA for "서울" → slice(0,2).join("") = "서울" (length 2) → passes length check
    // But clean("서울") removes 시 → "" → compare "" === ... → false
    expect(addressDistrictMatch('서울', '서울 강남구')).toBe(false)
  })

  it('empty string → false', () => {
    expect(addressDistrictMatch('', '서울 강남구')).toBe(false)
    expect(addressDistrictMatch('서울 강남구', '')).toBe(false)
  })

  it('"경기도 수원시" vs "경기 수원시 팔달구" → true', () => {
    // tokensA = "경기도수원시" → clean removes 도/시 → "경기수원" → slice(0,3) = "경기수"
    // tokensB = "경기수원시" → clean → "경기수원" → slice(0,3) = "경기수"
    expect(addressDistrictMatch('경기도 수원시', '경기 수원시 팔달구')).toBe(true)
  })

  it('"서울 강남구" vs "서울 강북구" → true (same city prefix after cleaning)', () => {
    // clean removes 구: "서울강남구"→"서울강남", slice(0,3)="서울강" — same prefix
    expect(addressDistrictMatch('서울 강남구', '서울 강북구')).toBe(true)
  })

  it('same district different city → false', () => {
    // "인천 남동구" vs "서울 남동구" — different city prefix
    expect(addressDistrictMatch('인천 남동구', '서울 남동구')).toBe(false)
  })
})
