import { describe, it, expect, vi } from 'vitest'

vi.mock('./lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}))

import { computeRecency, computeDataCompleteness } from './scoring'

describe('computeRecency', () => {
  it('returns 0 for null input', () => {
    expect(computeRecency(null)).toBe(0)
  })

  it('returns ~1.0 for today', () => {
    const today = new Date().toISOString()
    expect(computeRecency(today)).toBeCloseTo(1.0, 2)
  })

  it('returns ~0.368 for 180 days ago (one half-life)', () => {
    const date = new Date()
    date.setDate(date.getDate() - 180)
    expect(computeRecency(date.toISOString())).toBeCloseTo(0.368, 2)
  })

  it('returns ~0.135 for 360 days ago (two half-lives)', () => {
    const date = new Date()
    date.setDate(date.getDate() - 360)
    expect(computeRecency(date.toISOString())).toBeCloseTo(0.135, 2)
  })

  it('accepts custom halfLifeDays', () => {
    const date = new Date()
    date.setDate(date.getDate() - 90)
    // exp(-90/90) = exp(-1) ≈ 0.368
    expect(computeRecency(date.toISOString(), 90)).toBeCloseTo(0.368, 2)
  })
})

describe('computeDataCompleteness', () => {
  it('returns 0 for empty object', () => {
    expect(computeDataCompleteness({} as any)).toBe(0)
  })

  it('returns 1.0 for all 5 fields filled', () => {
    expect(
      computeDataCompleteness({
        name: '서울숲',
        address: '서울 성동구',
        phone: '02-1234-5678',
        tags: ['공원', '아이'],
        description: '넓은 공원',
      } as any)
    ).toBe(1.0)
  })

  it('returns 0.4 for 2 of 5 fields filled', () => {
    expect(
      computeDataCompleteness({
        name: '서울숲',
        address: '서울 성동구',
      } as any)
    ).toBe(0.4)
  })

  it('does not count empty string name', () => {
    expect(
      computeDataCompleteness({
        name: '',
        address: '서울 성동구',
      } as any)
    ).toBe(0.2)
  })

  it('does not count whitespace-only address', () => {
    expect(
      computeDataCompleteness({
        name: '카페',
        address: '   ',
      } as any)
    ).toBe(0.2)
  })

  it('does not count empty tags array', () => {
    expect(
      computeDataCompleteness({
        name: '카페',
        tags: [],
      } as any)
    ).toBe(0.2)
  })

  it('counts non-empty tags array', () => {
    expect(
      computeDataCompleteness({
        name: '카페',
        tags: ['키즈'],
      } as any)
    ).toBe(0.4)
  })

  it('returns 0.2 for only phone filled', () => {
    expect(
      computeDataCompleteness({
        phone: '02-0000-0000',
      } as any)
    ).toBe(0.2)
  })

  it('returns 0.2 for only description filled', () => {
    expect(
      computeDataCompleteness({
        description: '아기 친화 식당',
      } as any)
    ).toBe(0.2)
  })
})
