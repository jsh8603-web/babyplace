import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}))

import { datesOverlap, tokenSimilarity, isProbableDuplicate } from './event-dedup'

describe('datesOverlap', () => {
  it('exact same start and end dates → true', () => {
    expect(datesOverlap('2026-03-01', '2026-03-31', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('partial overlap → true', () => {
    expect(datesOverlap('2026-03-01', '2026-03-15', '2026-03-10', '2026-03-31')).toBe(true)
  })

  it('one contains the other → true', () => {
    expect(datesOverlap('2026-03-01', '2026-03-31', '2026-03-10', '2026-03-20')).toBe(true)
  })

  it('adjacent dates (end1 === start2) → true (boundary touching)', () => {
    expect(datesOverlap('2026-03-01', '2026-03-15', '2026-03-15', '2026-03-31')).toBe(true)
  })

  it('no overlap: range1 entirely before range2 → false', () => {
    expect(datesOverlap('2026-03-01', '2026-03-10', '2026-03-20', '2026-03-31')).toBe(false)
  })

  it('no overlap: range1 entirely after range2 → false', () => {
    expect(datesOverlap('2026-04-01', '2026-04-30', '2026-03-01', '2026-03-31')).toBe(false)
  })

  it('null end_date treated as same-day event (equal to start_date)', () => {
    // event2 is a single day (2026-03-15), event1 spans that day
    expect(datesOverlap('2026-03-01', '2026-03-31', '2026-03-15', null)).toBe(true)
  })

  it('null end_date on both: same day → true', () => {
    expect(datesOverlap('2026-03-15', null, '2026-03-15', null)).toBe(true)
  })

  it('null end_date on both: different days → false', () => {
    expect(datesOverlap('2026-03-10', null, '2026-03-20', null)).toBe(false)
  })
})

describe('tokenSimilarity', () => {
  it('word-order independent: "40주년 보노보노" vs "보노보노 40주년" → high score', () => {
    const score = tokenSimilarity('40주년 보노보노', '보노보노 40주년')
    expect(score).toBeGreaterThanOrEqual(0.75)
  })

  it('identical strings → 1.0', () => {
    expect(tokenSimilarity('보노보노 전시회', '보노보노 전시회')).toBe(1.0)
  })

  it('short tokens (<2 chars) are filtered out', () => {
    // "A B 전시" — "A" and "B" are single-char tokens, filtered; only "전시" remains
    const score = tokenSimilarity('A B 전시회', '전시회 C D')
    // Both have only "전시회" after filtering single chars → overlap = 1
    expect(score).toBe(1.0)
  })

  it('empty string → 0', () => {
    expect(tokenSimilarity('', '보노보노 전시회')).toBe(0)
    expect(tokenSimilarity('보노보노 전시회', '')).toBe(0)
  })

  it('completely different tokens → 0', () => {
    expect(tokenSimilarity('보노보노 전시회', '뽀로로 체험전')).toBe(0)
  })

  it('partial overlap returns intermediate score', () => {
    // "보노보노 특별 전시회" vs "보노보노 어린이 전시회" — "보노보노", "전시회" overlap
    const score = tokenSimilarity('보노보노 특별 전시회', '보노보노 어린이 전시회')
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('strips 4-digit years before comparing', () => {
    // "2026 보노보노 전시회" vs "보노보노 전시회 2025" — years stripped, tokens match
    const score = tokenSimilarity('2026 보노보노 전시회', '보노보노 전시회 2025')
    expect(score).toBe(1.0)
  })
})

describe('isProbableDuplicate', () => {
  const baseEvent1 = {
    id: 1,
    name: '보노보노 40주년 특별전',
    source: 'tour_api',
    venue_name: '예술의전당',
    start_date: '2026-03-01',
    end_date: '2026-04-30',
  }

  const baseEvent2 = {
    id: 2,
    name: '40주년 보노보노 특별전',
    source: 'seoul_events',
    venue_name: '예술의전당',
    start_date: '2026-03-15',
    end_date: '2026-05-15',
  }

  it('similar name + date overlap → true', () => {
    expect(isProbableDuplicate(baseEvent1, baseEvent2)).toBe(true)
  })

  it('same venue + similar name (no date needed) → true', () => {
    const e1 = { ...baseEvent1, start_date: null, end_date: null }
    const e2 = { ...baseEvent2, start_date: null, end_date: null }
    // Same venue_name + nameSim > 0.75 → true
    expect(isProbableDuplicate(e1, e2)).toBe(true)
  })

  it('completely different events → false', () => {
    const e1 = {
      id: 3,
      name: '뽀로로 어린이 체험전',
      source: 'tour_api',
      venue_name: '롯데월드',
      start_date: '2026-03-01',
      end_date: '2026-03-31',
    }
    const e2 = {
      id: 4,
      name: '헬로키티 팝업스토어',
      source: 'interpark',
      venue_name: '코엑스',
      start_date: '2026-04-01',
      end_date: '2026-04-30',
    }
    expect(isProbableDuplicate(e1, e2)).toBe(false)
  })

  it('high name similarity but no date overlap → false (name alone insufficient)', () => {
    const e1 = { ...baseEvent1, start_date: '2026-01-01', end_date: '2026-01-31' }
    const e2 = { ...baseEvent2, venue_name: '세종문화회관', start_date: '2026-06-01', end_date: '2026-06-30' }
    // Different venue, different dates → should not be duplicate
    expect(isProbableDuplicate(e1, e2)).toBe(false)
  })

  it('token similarity ≥ 0.75 + date overlap → true (word-order variant)', () => {
    const e1 = {
      id: 5,
      name: '보노보노 40주년 전시',
      source: 'tour_api',
      venue_name: '예술의전당',
      start_date: '2026-03-01',
      end_date: '2026-04-30',
    }
    const e2 = {
      id: 6,
      name: '40주년 보노보노 전시',
      source: 'blog_discovery',
      venue_name: '서울시립미술관',
      start_date: '2026-03-15',
      end_date: '2026-05-15',
    }
    expect(isProbableDuplicate(e1, e2)).toBe(true)
  })
})
