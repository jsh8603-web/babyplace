/**
 * Shared Kakao Place keyword search utility.
 *
 * Extracts the common pattern used by:
 *   - auto-promote.ts (verifyWithKakao)
 *   - auto-deactivate.ts (checkKakaoAlive)
 *   - naver-blog.ts (validateWithKakao)
 *   - kakao-enrich.ts (enrichPlace)
 */

import { kakaoLimiter, type RateLimiter } from '../rate-limiter'
import { similarity } from '../matchers/similarity'

export const KAKAO_KEYWORD_URL =
  'https://dapi.kakao.com/v2/local/search/keyword'

export interface KakaoPlaceMatch {
  id: string
  name: string
  address: string
  roadAddress: string
  phone: string
  categoryName: string
  lat: number
  lng: number
  similarity: number
}

interface SearchOptions {
  /** Rate limiter to use (default: kakaoLimiter) */
  limiter?: RateLimiter
  /** Number of address words to include in query (default: 3, 0 = use raw address) */
  addressWords?: number
  /** Minimum similarity threshold (default: 0.75) */
  threshold?: number
  /** If provided, check for exact Kakao place ID match first */
  kakaoPlaceId?: string | null
  /** Bounding box: "swLng,swLat,neLng,neLat" (Kakao rect format) */
  rect?: string
}

export interface KakaoSearchResult {
  match: KakaoPlaceMatch | null
  bestScore: number
  resultCount: number
}

/**
 * Search Kakao Place API and return detailed results including
 * best score and result count (for DROP tracking).
 */
export async function searchKakaoPlaceDetailed(
  name: string,
  address: string | null,
  options: SearchOptions = {}
): Promise<KakaoSearchResult> {
  const {
    limiter = kakaoLimiter,
    addressWords = 3,
    threshold = 0.75,
    kakaoPlaceId = null,
    rect,
  } = options

  const queryParts = [name]
  if (address) {
    queryParts.push(
      addressWords > 0
        ? address.split(/\s+/).slice(0, addressWords).join(' ')
        : address
    )
  }

  const params = new URLSearchParams({
    query: queryParts.join(' '),
    size: '15',
  })
  if (rect) {
    params.set('rect', rect)
  }

  const response = await limiter.throttle(() =>
    fetch(`${KAKAO_KEYWORD_URL}?${params.toString()}`, {
      headers: {
        Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
      },
    })
  )

  if (!response.ok) return { match: null, bestScore: 0, resultCount: 0 }

  const data = await response.json()
  const documents = data.documents ?? []
  if (documents.length === 0) return { match: null, bestScore: 0, resultCount: 0 }

  // Check for exact Kakao place ID match first
  if (kakaoPlaceId) {
    const idMatch = documents.find(
      (doc: Record<string, string>) => doc.id === kakaoPlaceId
    )
    if (idMatch) {
      return { match: docToMatch(idMatch, 1.0), bestScore: 1.0, resultCount: documents.length }
    }
  }

  // Find best similarity match
  let bestDoc: Record<string, string> | null = null
  let bestScore = 0

  for (const doc of documents) {
    const score = similarity(name, doc.place_name)
    if (score > bestScore) {
      bestScore = score
      bestDoc = doc
    }
  }

  if (bestScore >= threshold && bestDoc) {
    return { match: docToMatch(bestDoc, bestScore), bestScore, resultCount: documents.length }
  }

  return { match: null, bestScore, resultCount: documents.length }
}

/**
 * Search Kakao Place API by name + address and return the best match
 * above the similarity threshold.
 *
 * Returns null if no match found or API error.
 */
export async function searchKakaoPlace(
  name: string,
  address: string | null,
  options: SearchOptions = {}
): Promise<KakaoPlaceMatch | null> {
  const result = await searchKakaoPlaceDetailed(name, address, options)
  return result.match
}

function docToMatch(
  doc: Record<string, string>,
  score: number
): KakaoPlaceMatch {
  return {
    id: doc.id,
    name: doc.place_name,
    address: doc.address_name,
    roadAddress: doc.road_address_name,
    phone: doc.phone,
    categoryName: doc.category_name,
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    similarity: score,
  }
}
