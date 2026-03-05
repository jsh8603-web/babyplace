import { describe, it, expect } from 'vitest'
import { normalizePlaceName, similarity } from './similarity'

describe('normalizePlaceName', () => {
  it('strips all whitespace', () => {
    expect(normalizePlaceName('코코몽 에코 파크')).toBe('코코몽에코파크')
  })

  it('removes special characters, keeps Korean and alphanumeric', () => {
    expect(normalizePlaceName('서울(강남)카페!')).toBe('서울강남카페')
  })

  it('lowercases ASCII letters', () => {
    expect(normalizePlaceName('Cafe ABC')).toBe('cafeabc')
  })

  it('keeps digits', () => {
    expect(normalizePlaceName('카페123')).toBe('카페123')
  })

  it('returns empty string for all-special input', () => {
    expect(normalizePlaceName('!@#$%')).toBe('')
  })

  it('handles already-normalized input unchanged', () => {
    expect(normalizePlaceName('코코몽에코파크')).toBe('코코몽에코파크')
  })
})

describe('similarity', () => {
  it('identical strings → 1.0', () => {
    expect(similarity('코코몽에코파크', '코코몽에코파크')).toBe(1.0)
  })

  it('both empty → 1.0', () => {
    expect(similarity('', '')).toBe(1.0)
  })

  it('one empty → 0.0', () => {
    expect(similarity('', '코코몽에코파크')).toBe(0.0)
    expect(similarity('코코몽에코파크', '')).toBe(0.0)
  })

  it('normalization makes "코코몽 에코파크" and "코코몽에코파크" identical → 1.0', () => {
    expect(similarity('코코몽 에코파크', '코코몽에코파크')).toBe(1.0)
  })

  it('substring with ratio≥0.6 → 0.9 (e.g. "스타벅스강남역" vs "스타벅스강남역점")', () => {
    // "스타벅스강남역" (7 chars) in "스타벅스강남역점" (8 chars) → ratio = 7/8 = 0.875 ≥ 0.6
    expect(similarity('스타벅스강남역', '스타벅스강남역점')).toBe(0.9)
  })

  it('substring with ratio<0.6 → falls through to Dice (not 0.9)', () => {
    // "미도인" (3 chars) in "미도인왕십리역사점" (9 chars) → ratio = 3/9 ≈ 0.33 < 0.6
    const score = similarity('미도인', '미도인왕십리역사점')
    expect(score).toBeLessThan(0.9)
  })

  it('returns a Dice coefficient for partial matches (not 0 and not 1)', () => {
    const score = similarity('강남카페', '강남레스토랑')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('completely different strings → low score', () => {
    const score = similarity('주차장', '키즈카페')
    expect(score).toBeLessThan(0.5)
  })

  it('reverse substring also triggers ratio guard', () => {
    // "스타벅스강남역점" contains "스타벅스강남역" — also 0.9
    expect(similarity('스타벅스강남역점', '스타벅스강남역')).toBe(0.9)
  })
})
