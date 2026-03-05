import { describe, it, expect } from 'vitest'
import { classifyEventByTitle, classifySeoulEvent, isBlacklisted, isWhitelisted } from './event-classifier'

describe('classifyEventByTitle', () => {
  it('classifies "전시회 개최" as 전시', () => {
    expect(classifyEventByTitle('전시회 개최')).toBe('전시')
  })

  it('classifies "봄꽃 축제" as 축제', () => {
    expect(classifyEventByTitle('봄꽃 축제')).toBe('축제')
  })

  it('classifies "체험 워크숍" as 체험', () => {
    expect(classifyEventByTitle('체험 워크숍')).toBe('체험')
  })

  it('classifies "인형극 공연" as 공연', () => {
    expect(classifyEventByTitle('인형극 공연')).toBe('공연')
  })

  it('returns null for unclassifiable title "일반 행사"', () => {
    expect(classifyEventByTitle('일반 행사')).toBeNull()
  })
})

describe('classifySeoulEvent', () => {
  it('maps codename "전시/미술" to 전시', () => {
    expect(classifySeoulEvent('전시/미술', '어떤 전시')).toBe('전시')
  })

  it('maps codename "축제-시민화합" to 축제', () => {
    expect(classifySeoulEvent('축제-시민화합', '시민 행사')).toBe('축제')
  })

  it('falls back to title classification for unmapped codename', () => {
    expect(classifySeoulEvent('알수없음', '봄꽃 축제')).toBe('축제')
  })
})

describe('isBlacklisted', () => {
  it('returns true when USE_TRGT contains "성인"', () => {
    expect(isBlacklisted('성인')).toBe(true)
  })

  it('returns true when USE_TRGT contains "14세 이상"', () => {
    expect(isBlacklisted('14세 이상')).toBe(true)
  })

  it('returns true when title contains "개인전"', () => {
    expect(isBlacklisted('누구나', '개인전')).toBe(true)
  })

  it('returns false for "누구나"', () => {
    expect(isBlacklisted('누구나')).toBe(false)
  })

  it('returns false for "어린이"', () => {
    expect(isBlacklisted('어린이')).toBe(false)
  })
})

describe('isWhitelisted', () => {
  it('returns true when USE_TRGT contains "영유아"', () => {
    expect(isWhitelisted('영유아')).toBe(true)
  })

  it('returns true when USE_TRGT contains "어린이"', () => {
    expect(isWhitelisted('어린이')).toBe(true)
  })

  it('returns true when title contains "캐릭터 전시"', () => {
    expect(isWhitelisted('누구나', '캐릭터 전시')).toBe(true)
  })

  it('returns false for "일반" with no baby-relevant title', () => {
    expect(isWhitelisted('일반')).toBe(false)
  })
})
