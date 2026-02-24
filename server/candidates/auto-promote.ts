/**
 * Auto-promotion engine: place_candidates → places
 *
 * Promotion conditions (plan.md 10-4, Task #5 enhancements):
 *
 * Phase 1 (Original):
 *   ① 2+ independent blog sources (different domain origins)
 *   ② Kakao API match success (string similarity > 0.8, normalized)
 *   ③ Seoul/Gyeonggi region confirmed
 *   → All three met → INSERT to places table
 *
 * Phase 2 (Enhanced with public data sources):
 *   ① 1+ public data source (data.go.kr, LOCALDATA) OR 2+ blog sources
 *   ② Kakao API match (similarity > 0.8)
 *   ③ Seoul/Gyeonggi region confirmed
 *   → All three met → INSERT to places table
 *
 * Public data sources recognized:
 *   - 'data_go_kr': 공공데이터포털 (놀이시설, 공원, 도서관, 박물관)
 *   - 'localdata': LOCALDATA (키즈카페, 편의점 등)
 *   - 'kopis': 공연정보시스템
 *   - 'tour_api': 관광공사 API
 *   - 'seoul_gov': 서울시 열린데이터
 *
 * TTL cleanup:
 *   Candidates that have been waiting 30+ days without meeting criteria
 *   are automatically deleted.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import { kakaoLimiter } from '../rate-limiter'
import { similarity } from '../matchers/similarity'
import { isInServiceRegion } from '../enrichers/region'
import { getDistrictCode } from '../enrichers/district'
import { checkDuplicate } from '../matchers/duplicate'
import { PlaceCategory } from '../../src/types/index'

// ─── Kakao verification types ─────────────────────────────────────────────────

interface KakaoVerifyResult {
  matched: boolean
  kakaoPlaceId?: string
  kakaoName?: string
  address?: string
  roadAddress?: string
  lat?: number
  lng?: number
  phone?: string
  categoryName?: string
  similarityScore?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword'
const SIMILARITY_THRESHOLD = 0.8
const MIN_INDEPENDENT_SOURCES = 2
const CANDIDATE_TTL_DAYS = 30

// Public data sources that allow easier promotion
const PUBLIC_DATA_SOURCES = new Set(['data_go_kr', 'localdata', 'kopis', 'tour_api', 'seoul_gov'])

// ─── Main export ──────────────────────────────────────────────────────────────

export interface AutoPromoteResult {
  candidatesEvaluated: number
  promoted: number
  deleted: number    // TTL expired
  skipped: number    // did not meet criteria yet
  errors: number
}

export async function runAutoPromotion(): Promise<AutoPromoteResult> {
  const result: AutoPromoteResult = {
    candidatesEvaluated: 0,
    promoted: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  }

  const startedAt = Date.now()

  // --- Step 1: TTL cleanup (delete candidates older than 30 days) ---
  const ttlCutoff = new Date()
  ttlCutoff.setDate(ttlCutoff.getDate() - CANDIDATE_TTL_DAYS)

  const { count: deletedCount, error: deleteError } = await supabaseAdmin
    .from('place_candidates')
    .delete()
    .lt('first_seen_at', ttlCutoff.toISOString())
    .select('id')

  if (deleteError) {
    console.error('[auto-promote] TTL delete error:', deleteError)
  } else {
    result.deleted = deletedCount ?? 0
    if (result.deleted > 0) {
      console.log(`[auto-promote] TTL: deleted ${result.deleted} stale candidates`)
    }
  }

  // --- Step 2: Evaluate remaining candidates ---
  const { data: candidates, error: fetchError } = await supabaseAdmin
    .from('place_candidates')
    .select('*')
    .order('last_seen_at', { ascending: false })

  if (fetchError || !candidates) {
    console.error('[auto-promote] Failed to fetch candidates:', fetchError)
    result.errors++
    return result
  }

  for (const candidate of candidates) {
    result.candidatesEvaluated++

    try {
      const promoted = await evaluateCandidate(candidate)
      if (promoted) {
        result.promoted++
        // Remove the candidate after promotion
        await supabaseAdmin
          .from('place_candidates')
          .delete()
          .eq('id', candidate.id)
      } else {
        result.skipped++
      }
    } catch (err) {
      console.error(`[auto-promote] Error evaluating candidate ${candidate.id}:`, err)
      result.errors++
    }
  }

  // Log to collection_logs
  await supabaseAdmin.from('collection_logs').insert({
    collector: 'auto-promote',
    results_count: result.candidatesEvaluated,
    new_places: result.promoted,
    status: result.errors > 0 ? 'partial' : 'success',
    duration_ms: Date.now() - startedAt,
  })

  return result
}

// ─── Candidate evaluation ─────────────────────────────────────────────────────

interface CandidateRow {
  id: number
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  kakao_place_id: string | null
  kakao_similarity: number | null
  source_urls: string[]
  source_count: number
  first_seen_at: string
  last_seen_at: string
}

async function evaluateCandidate(candidate: CandidateRow): Promise<boolean> {
  // --- Condition ①: Check source requirements (Phase 2: enhanced) ---
  const independentSources = countIndependentSources(candidate.source_urls)
  const hasPublicDataSource = detectPublicDataSource(candidate.source_urls)

  // Phase 2 logic: accept if 1+ public source OR 2+ blog sources
  const hasValidSources = hasPublicDataSource || independentSources >= MIN_INDEPENDENT_SOURCES

  if (!hasValidSources) {
    return false
  }

  if (hasPublicDataSource) {
    console.log(
      `[auto-promote] Candidate "${candidate.name}" has public data source — easing promotion criteria`
    )
  }

  // --- Condition ②: Kakao API match (similarity > 0.8) ---
  const kakaoResult = await verifyWithKakao(candidate.name, candidate.address)
  if (!kakaoResult.matched || !kakaoResult.lat || !kakaoResult.lng) {
    // Update candidate's kakao_similarity to track progress
    if (kakaoResult.similarityScore !== undefined) {
      await supabaseAdmin
        .from('place_candidates')
        .update({ kakao_similarity: kakaoResult.similarityScore })
        .eq('id', candidate.id)
    }
    return false
  }

  // --- Condition ③: Seoul/Gyeonggi region ---
  const address = kakaoResult.roadAddress || kakaoResult.address || candidate.address
  if (!isInServiceRegion(kakaoResult.lat, kakaoResult.lng, address)) {
    return false
  }

  // --- All conditions met → check for duplicates before inserting ---
  const dup = await checkDuplicate({
    kakaoPlaceId: kakaoResult.kakaoPlaceId!,
    name: kakaoResult.kakaoName!,
    address: address ?? '',
    lat: kakaoResult.lat,
    lng: kakaoResult.lng,
  })

  if (dup.isDuplicate) {
    // Already in places — just delete the candidate
    return true
  }

  // --- Insert into places ---
  const districtCode = await getDistrictCode(
    kakaoResult.lat,
    kakaoResult.lng,
    address
  )

  const category = inferCategory(kakaoResult.categoryName, candidate.name)

  const { error } = await supabaseAdmin.from('places').insert({
    name: kakaoResult.kakaoName!,
    category,
    sub_category: kakaoResult.categoryName?.split('>').pop()?.trim() ?? null,
    address: kakaoResult.address ?? null,
    road_address: kakaoResult.roadAddress ?? null,
    district_code: districtCode,
    lat: kakaoResult.lat,
    lng: kakaoResult.lng,
    phone: kakaoResult.phone ?? null,
    source: 'auto_promoted',
    source_id: kakaoResult.kakaoPlaceId ?? null,
    kakao_place_id: kakaoResult.kakaoPlaceId ?? null,
    source_count: candidate.source_count,
    is_active: true,
  })

  if (error) {
    if (error.code === '23505') {
      // Duplicate kakao_place_id — treat as success
      return true
    }
    console.error('[auto-promote] Insert error:', error.message)
    throw new Error(error.message)
  }

  console.log(
    `[auto-promote] Promoted: "${kakaoResult.kakaoName}" (candidate ${candidate.id})`
  )
  return true
}

// ─── Kakao verification ───────────────────────────────────────────────────────

async function verifyWithKakao(
  candidateName: string,
  candidateAddress: string | null
): Promise<KakaoVerifyResult> {
  const query = candidateAddress
    ? `${candidateName} ${candidateAddress.split(/\s+/).slice(0, 3).join(' ')}`
    : candidateName

  const params = new URLSearchParams({
    query,
    size: '5',
  })

  try {
    const response = await kakaoLimiter.throttle(() =>
      fetch(`${KAKAO_KEYWORD_URL}?${params.toString()}`, {
        headers: {
          Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}`,
        },
      })
    )

    if (!response.ok) {
      return { matched: false }
    }

    const data = await response.json()
    const documents = data.documents ?? []

    if (documents.length === 0) {
      return { matched: false, similarityScore: 0 }
    }

    // Find best matching result
    let bestDoc: (typeof documents)[0] | null = null
    let bestScore = 0

    for (const doc of documents) {
      const score = similarity(candidateName, doc.place_name)
      if (score > bestScore) {
        bestScore = score
        bestDoc = doc
      }
    }

    if (bestScore >= SIMILARITY_THRESHOLD && bestDoc) {
      return {
        matched: true,
        kakaoPlaceId: bestDoc.id,
        kakaoName: bestDoc.place_name,
        address: bestDoc.address_name,
        roadAddress: bestDoc.road_address_name,
        lat: parseFloat(bestDoc.y),
        lng: parseFloat(bestDoc.x),
        phone: bestDoc.phone,
        categoryName: bestDoc.category_name,
        similarityScore: bestScore,
      }
    }

    return { matched: false, similarityScore: bestScore }
  } catch (err) {
    console.error('[auto-promote] Kakao verify error:', err)
    return { matched: false }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Counts independent sources by extracting domain origins from URLs.
 * Same blogger domain is NOT counted as independent.
 */
function countIndependentSources(sourceUrls: string[]): number {
  if (!sourceUrls || sourceUrls.length === 0) return 0

  const domains = new Set<string>()
  for (const url of sourceUrls) {
    try {
      const parsed = new URL(url)
      // Normalize blog.naver.com/username → just blog.naver.com/username prefix
      // to treat each blogger as independent
      const host = parsed.hostname
      const pathPrefix = parsed.pathname.split('/')[1] ?? ''
      domains.add(`${host}/${pathPrefix}`)
    } catch {
      domains.add(url.slice(0, 50)) // fallback for malformed URLs
    }
  }

  return domains.size
}

/**
 * Infers a BabyPlace category from Kakao's category string and candidate name.
 */
function inferCategory(
  kakaoCategory: string | undefined,
  candidateName: string
): PlaceCategory {
  if (!kakaoCategory) return guessFromName(candidateName)

  const cat = kakaoCategory.toLowerCase()

  if (cat.includes('카페') || cat.includes('음식점')) return '식당/카페'
  if (cat.includes('문화시설') || cat.includes('박물관') || cat.includes('미술관'))
    return '전시/체험'
  if (cat.includes('관광') || cat.includes('동물') || cat.includes('아쿠아'))
    return '동물/자연'
  if (cat.includes('도서관')) return '도서관'

  return guessFromName(candidateName)
}

function guessFromName(name: string): PlaceCategory {
  if (/키즈카페|볼풀|실내놀이/.test(name)) return '놀이'
  if (/공원|놀이터/.test(name)) return '공원/놀이터'
  if (/박물관|과학관|미술관|체험/.test(name)) return '전시/체험'
  if (/동물원|아쿠아|농장/.test(name)) return '동물/자연'
  if (/도서관/.test(name)) return '도서관'
  if (/수영|물놀이|키즈풀/.test(name)) return '수영/물놀이'
  if (/식당|카페|맛집|이유식/.test(name)) return '식당/카페'
  return '놀이' // default fallback
}

/**
 * Detects if a candidate has source URLs from known public data sources.
 * Checks actual source URLs for public data domains instead of relying on
 * heuristic patterns from place names (which can lead to false positives).
 *
 * Public data sources recognized:
 *   - data.go.kr (공공데이터포털)
 *   - apis.data.go.kr (data.go.kr API)
 *   - kopis.or.kr (KOPIS 공연정보시스템)
 *   - tour.go.kr (관광공사)
 *   - openapi.seoul.go.kr (서울 열린데이터)
 */
function detectPublicDataSource(sourceUrls: string[]): boolean {
  if (!sourceUrls || sourceUrls.length === 0) {
    return false
  }

  const publicDomains = [
    'data.go.kr',
    'apis.data.go.kr',
    'kopis.or.kr',
    'tour.go.kr',
    'openapi.seoul.go.kr',
  ]

  return sourceUrls.some((url) =>
    publicDomains.some((domain) => {
      try {
        const parsed = new URL(url)
        return parsed.hostname?.includes(domain) ?? false
      } catch {
        // Fallback for malformed URLs
        return url.includes(domain)
      }
    })
  )
}
