import { describe, it, expect } from 'vitest'
import { extractDistrictCodeFromAddress } from './district'

describe('extractDistrictCodeFromAddress', () => {
  it('returns first 3 tokens joined with _ for 3-part address', () => {
    expect(extractDistrictCodeFromAddress('서울 강남구 삼성동')).toBe('서울_강남구_삼성동')
  })

  it('returns first 2 tokens joined with _ for 2-part address', () => {
    expect(extractDistrictCodeFromAddress('서울 강남구')).toBe('서울_강남구')
  })

  it('returns null for single token (less than 2 parts)', () => {
    expect(extractDistrictCodeFromAddress('서울')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractDistrictCodeFromAddress('')).toBeNull()
  })

  it('handles multiple spaces between tokens', () => {
    expect(extractDistrictCodeFromAddress('  서울   강남구  ')).toBe('서울_강남구')
  })

  it('handles leading and trailing whitespace', () => {
    expect(extractDistrictCodeFromAddress('  서울 강남구 삼성동  ')).toBe('서울_강남구_삼성동')
  })

  it('uses only first 3 tokens even when more exist', () => {
    const result = extractDistrictCodeFromAddress('서울 강남구 삼성동 테헤란로')
    expect(result).toBe('서울_강남구_삼성동')
  })

  it('returns first 2 tokens for 2-token address with extra spaces', () => {
    expect(extractDistrictCodeFromAddress('  경기   성남시  ')).toBe('경기_성남시')
  })
})
