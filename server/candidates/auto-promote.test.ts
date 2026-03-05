import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}))

import { countIndependentSources, inferCategory } from './auto-promote'

describe('countIndependentSources', () => {
  it('returns 0 for empty array', () => {
    expect(countIndependentSources([])).toBe(0)
  })

  it('returns 0 for null/falsy input', () => {
    expect(countIndependentSources(null as any)).toBe(0)
  })

  it('counts two different naver bloggers as 2', () => {
    expect(
      countIndependentSources([
        'https://blog.naver.com/user1/post1',
        'https://blog.naver.com/user2/post2',
      ])
    ).toBe(2)
  })

  it('counts same blogger with different posts as 1', () => {
    expect(
      countIndependentSources([
        'https://blog.naver.com/user1/a',
        'https://blog.naver.com/user1/b',
      ])
    ).toBe(1)
  })

  it('counts different domains as independent', () => {
    expect(
      countIndependentSources([
        'https://blog.naver.com/user1/post1',
        'https://tistory.com/entry/123',
      ])
    ).toBe(2)
  })

  it('uses first 50 chars as fallback for malformed URLs', () => {
    const malformed = 'not-a-valid-url-string-that-cannot-be-parsed-by-url'
    expect(countIndependentSources([malformed])).toBe(1)
  })

  it('deduplicates identical URLs', () => {
    expect(
      countIndependentSources([
        'https://blog.naver.com/user1/post1',
        'https://blog.naver.com/user1/post1',
      ])
    ).toBe(1)
  })

  it('returns 1 for a single URL', () => {
    expect(countIndependentSources(['https://blog.naver.com/user1/post1'])).toBe(1)
  })
})

describe('inferCategory', () => {
  it('maps 음식점>한식 to 식당/카페', () => {
    expect(inferCategory('음식점>한식', '맛집')).toBe('식당/카페')
  })

  it('maps 카페 to 식당/카페', () => {
    expect(inferCategory('카페', '커피숍')).toBe('식당/카페')
  })

  it('maps 문화시설>박물관 to 전시/체험', () => {
    expect(inferCategory('문화시설>박물관', '박물관')).toBe('전시/체험')
  })

  it('maps 미술관 to 전시/체험', () => {
    expect(inferCategory('미술관', '갤러리')).toBe('전시/체험')
  })

  it('maps 관광>동물원 to 동물/자연', () => {
    expect(inferCategory('관광>동물원', '동물원')).toBe('동물/자연')
  })

  it('maps 도서관 to 도서관', () => {
    expect(inferCategory('도서관', '어린이도서관')).toBe('도서관')
  })

  it('guesses 놀이 from name when category is undefined', () => {
    expect(inferCategory(undefined, '키즈카페 놀이나라')).toBe('놀이')
  })

  it('guesses 공원/놀이터 from name when category is undefined', () => {
    expect(inferCategory(undefined, '서울숲공원')).toBe('공원/놀이터')
  })

  it('returns null when no match is found', () => {
    expect(inferCategory(undefined, '알 수 없는 장소')).toBeNull()
  })

  it('returns null when category is empty string and name has no match', () => {
    expect(inferCategory('', '알 수 없는 장소')).toBeNull()
  })

  it('guesses 전시/체험 from name containing 박물관', () => {
    expect(inferCategory(undefined, '국립어린이박물관')).toBe('전시/체험')
  })

  it('guesses 동물/자연 from name containing 동물원', () => {
    // "서울대공원동물원" matches /공원/ first → '공원/놀이터', use pure 동물원 name
    expect(inferCategory(undefined, '어린이동물원')).toBe('동물/자연')
  })
})
