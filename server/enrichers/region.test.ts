import { describe, it, expect } from 'vitest'
import { isInServiceArea, isValidServiceAddress, isInServiceRegion } from './region'

describe('isInServiceArea', () => {
  it('returns true for Seoul coordinates', () => {
    expect(isInServiceArea(37.57, 126.98)).toBe(true)
  })

  it('returns false for Busan coordinates', () => {
    expect(isInServiceArea(35.18, 129.07)).toBe(false)
  })

  it('returns true at exact swLat/swLng boundary (36.9, 126.5)', () => {
    expect(isInServiceArea(36.9, 126.5)).toBe(true)
  })

  it('returns true at exact neLat/neLng boundary (38.0, 127.9)', () => {
    expect(isInServiceArea(38.0, 127.9)).toBe(true)
  })

  it('returns false just below swLat boundary (36.89)', () => {
    expect(isInServiceArea(36.89, 126.98)).toBe(false)
  })
})

describe('isValidServiceAddress', () => {
  it('returns true for 서울 address', () => {
    expect(isValidServiceAddress('서울 강남구')).toBe(true)
  })

  it('returns true for 경기 address', () => {
    expect(isValidServiceAddress('경기 성남시')).toBe(true)
  })

  it('returns true for 인천 address', () => {
    expect(isValidServiceAddress('인천 부평구')).toBe(true)
  })

  it('returns false for 부산 address', () => {
    expect(isValidServiceAddress('부산 해운대구')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidServiceAddress('')).toBe(false)
  })
})

describe('isInServiceRegion', () => {
  it('returns true when both coordinate and address pass', () => {
    expect(isInServiceRegion(37.57, 126.98, '서울 강남구')).toBe(true)
  })

  it('returns false (short-circuit) when coordinate fails', () => {
    expect(isInServiceRegion(35.18, 129.07, '서울 강남구')).toBe(false)
  })

  it('returns false when coordinate passes but address fails', () => {
    expect(isInServiceRegion(37.57, 126.98, '부산 해운대구')).toBe(false)
  })

  it('returns true when coordinate passes and address is null', () => {
    expect(isInServiceRegion(37.57, 126.98, null)).toBe(true)
  })
})
