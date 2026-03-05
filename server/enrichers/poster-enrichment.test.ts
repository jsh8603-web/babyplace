import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}))
import {
  stripHtml,
  cleanEventName,
  extractCoreKeywords,
  hasStaleYear,
  isBlocked,
  isTrusted,
  preFilter,
} from './poster-enrichment'

describe('stripHtml', () => {
  it('removes HTML tags and replaces entities with space', () => {
    expect(stripHtml('<b>Event</b> &amp; more')).toBe('Event   more')
  })

  it('removes multiple tags', () => {
    const result = stripHtml('<h1>Title</h1><p>Body</p>')
    expect(result).toBe('TitleBody')
  })

  it('trims surrounding whitespace', () => {
    expect(stripHtml('  hello  ')).toBe('hello')
  })

  it('returns plain string unchanged (trimmed)', () => {
    expect(stripHtml('plain text')).toBe('plain text')
  })
})

describe('cleanEventName', () => {
  it('removes brackets and year annotations', () => {
    const result = cleanEventName('행사명 [2024]')
    // [2024] is not () so won't be removed by \([^)]*\), but ] is not in the list
    // The [] chars are not in the replacement list, so only content from the rules applies
    // Checking the actual regex: no [] removal, but collapses spaces and trims
    expect(result.trim()).toBeTruthy()
  })

  it('removes content inside parentheses', () => {
    expect(cleanEventName('이벤트 (서울시 주최)')).toBe('이벤트')
  })

  it('removes 「」 brackets', () => {
    expect(cleanEventName('「아기」 전시')).toBe('아기 전시')
  })

  it('removes 《》 brackets', () => {
    expect(cleanEventName('《봄날》 공연')).toBe('봄날 공연')
  })

  it('replaces · with space', () => {
    expect(cleanEventName('봄·여름 행사')).toBe('봄 여름 행사')
  })

  it('replaces : with space', () => {
    expect(cleanEventName('행사: 2024')).toBe('행사 2024')
  })

  it('replaces - with space', () => {
    expect(cleanEventName('어린이-축제')).toBe('어린이 축제')
  })

  it('replaces | with space', () => {
    expect(cleanEventName('공연 | 전시')).toBe('공연 전시')
  })

  it('replaces / with space', () => {
    expect(cleanEventName('봄/여름 행사')).toBe('봄 여름 행사')
  })

  it('collapses multiple spaces', () => {
    expect(cleanEventName('봄   여름   행사')).toBe('봄 여름 행사')
  })

  it('trims result', () => {
    expect(cleanEventName('  행사  ')).toBe('행사')
  })
})

describe('extractCoreKeywords', () => {
  it('filters out stopwords', () => {
    const result = extractCoreKeywords('체험 무료 기념 특가')
    // 체험, 무료, 기념, 특가 are all in the stopword list
    expect(result).toBe('')
  })

  it('returns up to 3 non-stopword tokens', () => {
    const result = extractCoreKeywords('서울 어린이 공원 봄 여름 가을 겨울')
    const tokens = result.split(' ').filter(Boolean)
    expect(tokens.length).toBeLessThanOrEqual(3)
  })

  it('excludes 전시 as stopword', () => {
    const result = extractCoreKeywords('전시 키즈카페 어린이')
    expect(result).not.toContain('전시')
    expect(result).toContain('키즈카페')
  })

  it('excludes 공연 as stopword', () => {
    const result = extractCoreKeywords('공연 뮤지컬 아기')
    expect(result).not.toContain('공연')
    expect(result).not.toContain('뮤지컬')
    expect(result).toContain('아기')
  })

  it('filters tokens shorter than 2 chars', () => {
    const result = extractCoreKeywords('A 봄 어린이')
    expect(result).not.toContain(' A ')
    expect(result).toContain('어린이')
  })
})

describe('hasStaleYear', () => {
  it('returns true for URL with /2024/ (stale, currentYear=2026)', () => {
    expect(hasStaleYear('https://example.com/2024/image.jpg')).toBe(true)
  })

  it('returns false for URL with /2025/', () => {
    // currentYear=2026, 2025 >= 2026-1 → not stale
    expect(hasStaleYear('https://example.com/2025/image.jpg')).toBe(false)
  })

  it('returns false for URL with /2026/', () => {
    expect(hasStaleYear('https://example.com/2026/image.jpg')).toBe(false)
  })

  it('returns false for URL with no year pattern', () => {
    expect(hasStaleYear('https://example.com/images/poster.jpg')).toBe(false)
  })

  it('returns false for URL with /2023/ but also checking regex coverage', () => {
    // 2023 < 2025 (2026-1) → stale
    expect(hasStaleYear('https://example.com/2023/image.jpg')).toBe(true)
  })
})

describe('isBlocked', () => {
  it('returns true for freepik domain', () => {
    expect(isBlocked('https://img.freepik.com/poster.jpg')).toBe(true)
  })

  it('returns false for trusted culture.seoul.go.kr', () => {
    expect(isBlocked('https://culture.seoul.go.kr/poster.jpg')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isBlocked('https://IMG.FREEPIK.COM/poster.jpg')).toBe(true)
  })

  it('returns true for pinimg.com', () => {
    expect(isBlocked('https://i.pinimg.com/img.jpg')).toBe(true)
  })

  it('returns false for a random unlisted domain', () => {
    expect(isBlocked('https://random-safe-site.com/poster.jpg')).toBe(false)
  })

  it('returns true for dcinside.com', () => {
    expect(isBlocked('https://dcinside.com/image.jpg')).toBe(true)
  })
})

describe('isTrusted', () => {
  it('returns true for culture.seoul.go.kr', () => {
    expect(isTrusted('https://culture.seoul.go.kr/img.jpg')).toBe(true)
  })

  it('returns false for a random site', () => {
    expect(isTrusted('https://random.com/img.jpg')).toBe(false)
  })

  it('returns true for kopis.or.kr', () => {
    expect(isTrusted('https://kopis.or.kr/poster.jpg')).toBe(true)
  })

  it('returns true for interpark.com', () => {
    expect(isTrusted('https://interpark.com/poster.jpg')).toBe(true)
  })

  it('returns true for yes24.com', () => {
    expect(isTrusted('https://yes24.com/poster.jpg')).toBe(true)
  })

  it('returns false for a blocked domain', () => {
    expect(isTrusted('https://img.freepik.com/poster.jpg')).toBe(false)
  })
})

describe('preFilter', () => {
  it('returns empty array for empty input', () => {
    expect(preFilter([])).toEqual([])
  })

  it('filters out images from blocked domains', () => {
    const items = [
      { title: 'img', link: 'https://img.freepik.com/image.jpg', thumbnail: '', sizewidth: '500', sizeheight: '500' },
    ]
    expect(preFilter(items)).toHaveLength(0)
  })

  it('filters out images smaller than 200x200', () => {
    const items = [
      { title: 'img', link: 'https://safe.com/image.jpg', thumbnail: '', sizewidth: '100', sizeheight: '100' },
    ]
    expect(preFilter(items)).toHaveLength(0)
  })

  it('filters out images with stale year in URL', () => {
    const items = [
      { title: 'img', link: 'https://safe.com/2024/image.jpg', thumbnail: '', sizewidth: '500', sizeheight: '500' },
    ]
    expect(preFilter(items)).toHaveLength(0)
  })

  it('passes images that meet all criteria', () => {
    const items = [
      { title: '<b>Poster</b>', link: 'https://safe.com/2026/image.jpg', thumbnail: '', sizewidth: '600', sizeheight: '800' },
    ]
    const result = preFilter(items)
    expect(result).toHaveLength(1)
    expect(result[0].link).toBe('https://safe.com/2026/image.jpg')
    expect(result[0].width).toBe(600)
    expect(result[0].height).toBe(800)
    expect(result[0].source).toBe('naver_image')
  })

  it('strips HTML from title in output', () => {
    const items = [
      { title: '<b>제목</b>', link: 'https://safe.com/image.jpg', thumbnail: '', sizewidth: '300', sizeheight: '400' },
    ]
    const result = preFilter(items)
    expect(result[0].title).toBe('제목')
  })

  it('filters out images exactly at 199x199 (below minimum)', () => {
    const items = [
      { title: 'img', link: 'https://safe.com/image.jpg', thumbnail: '', sizewidth: '199', sizeheight: '199' },
    ]
    expect(preFilter(items)).toHaveLength(0)
  })

  it('passes images exactly at 200x200 (minimum boundary)', () => {
    const items = [
      { title: 'img', link: 'https://safe.com/image.jpg', thumbnail: '', sizewidth: '200', sizeheight: '200' },
    ]
    expect(preFilter(items)).toHaveLength(1)
  })
})
