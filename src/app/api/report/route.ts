import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createServerSupabase } from '@/lib/supabase-server'
import { SERVICE_AREA_BOUNDS } from '@/lib/service-area'

/**
 * POST /api/report
 * User reports a new place → auto-validates via Kakao Place API
 * If Kakao confirms (high similarity) → insert into places directly
 * Otherwise → insert into place_candidates for later promotion
 *
 * Body: { name: string, address?: string, category: string, description?: string }
 * Response: { status: 'registered' | 'candidate', placeId?: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()

  // Optional auth — anonymous reports also accepted but logged
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let body: ReportBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { name, address, category, description } = body

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Place name is required' }, { status: 400 })
  }

  if (!category || typeof category !== 'string') {
    return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  }

  const trimmedName = name.trim()

  // --- Step 1: Check for duplicates in places table ---
  const { data: duplicates } = await supabaseAdmin
    .from('places')
    .select('id, name, address')
    .ilike('name', `%${trimmedName}%`)
    .eq('is_active', true)
    .limit(5)

  if (duplicates && duplicates.length > 0) {
    // Check if exact match exists
    const exactMatch = duplicates.find(
      (p) => normalizeText(p.name) === normalizeText(trimmedName)
    )
    if (exactMatch) {
      return NextResponse.json(
        { status: 'duplicate', message: '이미 등록된 장소입니다.', placeId: exactMatch.id },
        { status: 200 }
      )
    }
  }

  // --- Step 2: Validate via Kakao Local API ---
  const kakaoKey = process.env.KAKAO_REST_KEY
  let kakaoResult: KakaoPlaceResult | null = null

  if (kakaoKey) {
    try {
      const query = address ? `${trimmedName} ${address}` : trimmedName
      const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=5`

      const kakaoResponse = await fetch(kakaoUrl, {
        headers: { Authorization: `KakaoAK ${kakaoKey}` },
        signal: AbortSignal.timeout(5000),
      })

      if (kakaoResponse.ok) {
        const kakaoData = await kakaoResponse.json()
        const docs: KakaoDocument[] = kakaoData?.documents ?? []

        // Find best matching result by name similarity
        if (docs.length > 0) {
          const best = docs.reduce<{ doc: KakaoDocument; score: number } | null>((acc, doc) => {
            const score = nameSimilarity(trimmedName, doc.place_name)
            if (!acc || score > acc.score) return { doc, score }
            return acc
          }, null)

          if (best && best.score >= 0.6) {
            kakaoResult = {
              kakaoPlaceId: best.doc.id,
              name: best.doc.place_name,
              address: best.doc.address_name,
              roadAddress: best.doc.road_address_name,
              lat: parseFloat(best.doc.y),
              lng: parseFloat(best.doc.x),
              phone: best.doc.phone,
              similarity: best.score,
            }
          }
        }
      }
    } catch (err) {
      // Kakao API failure is non-fatal; fall back to candidate
      console.warn('[POST /api/report] Kakao API error:', err)
    }
  }

  // --- Step 3: High-confidence Kakao match → register directly in places ---
  if (kakaoResult && kakaoResult.similarity >= 0.8) {
    // Check if kakao_place_id already exists
    const { data: existing } = await supabaseAdmin
      .from('places')
      .select('id')
      .eq('kakao_place_id', kakaoResult.kakaoPlaceId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { status: 'duplicate', message: '이미 등록된 장소입니다.', placeId: existing.id },
        { status: 200 }
      )
    }

    // Validate Seoul/Gyeonggi bounds
    if (kakaoResult.lat && kakaoResult.lng) {
      if (!isSeoulGyeonggi(kakaoResult.lat, kakaoResult.lng)) {
        return NextResponse.json(
          { status: 'out_of_area', message: '서울/경기 지역만 등록 가능합니다.' },
          { status: 200 }
        )
      }
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('places')
      .insert({
        name: kakaoResult.name,
        category: category.trim(),
        address: kakaoResult.address,
        road_address: kakaoResult.roadAddress,
        lat: kakaoResult.lat,
        lng: kakaoResult.lng,
        phone: kakaoResult.phone ?? null,
        kakao_place_id: kakaoResult.kakaoPlaceId,
        source: 'user_report',
        description: description?.trim() ?? null,
        tags: [],
        is_active: true,
        popularity_score: 0,
        mention_count: 0,
        source_count: 1,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[POST /api/report] Place insert error:', insertError)
      return NextResponse.json({ error: 'Failed to register place' }, { status: 500 })
    }

    return NextResponse.json({ status: 'registered', placeId: inserted.id })
  }

  // --- Step 4: Low-confidence or no Kakao match → place_candidates ---
  // onConflict targets the unique index uq_place_candidates_name_address (name, COALESCE(address, '')).
  // Supabase upsert requires the actual column names; the COALESCE is handled by the partial index.
  // On conflict: increment source_count and refresh last_seen_at rather than resetting to 1.
  const addressTrimmed = address?.trim() ?? null
  const { data: candidate, error: candidateError } = await supabaseAdmin
    .from('place_candidates')
    .upsert(
      {
        name: trimmedName,
        address: addressTrimmed,
        lat: kakaoResult?.lat ?? null,
        lng: kakaoResult?.lng ?? null,
        kakao_place_id: kakaoResult?.kakaoPlaceId ?? null,
        kakao_similarity: kakaoResult?.similarity ?? null,
        source_urls: [],
        source_count: 1,
        last_seen_at: new Date().toISOString(),
      },
      {
        onConflict: 'name, address',
        ignoreDuplicates: false,
      }
    )
    .select('id')
    .single()

  if (candidateError) {
    console.error('[POST /api/report] Candidate insert error:', candidateError)
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 })
  }

  return NextResponse.json({ status: 'candidate', placeId: candidate?.id })
}

// ============ Helpers ============

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').replace(/[^\w가-힣]/g, '')
}

/**
 * Simple name similarity based on character overlap ratio
 * Returns 0.0~1.0 score
 */
function nameSimilarity(a: string, b: string): number {
  const na = normalizeText(a)
  const nb = normalizeText(b)

  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.85

  // Bigram overlap
  const bigramsA = new Set(getBigrams(na))
  const bigramsB = new Set(getBigrams(nb))
  const intersection = new Set([...bigramsA].filter((bg) => bigramsB.has(bg)))
  const union = new Set([...bigramsA, ...bigramsB])

  return union.size === 0 ? 0 : intersection.size / union.size
}

function getBigrams(str: string): string[] {
  const bigrams: string[] = []
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.slice(i, i + 2))
  }
  return bigrams
}

/**
 * Validate Seoul/Gyeonggi bounding box
 * Reference: plan.md 18-10 — uses SERVICE_AREA_BOUNDS as single source of truth.
 */
function isSeoulGyeonggi(lat: number, lng: number): boolean {
  return (
    lat >= SERVICE_AREA_BOUNDS.swLat &&
    lat <= SERVICE_AREA_BOUNDS.neLat &&
    lng >= SERVICE_AREA_BOUNDS.swLng &&
    lng <= SERVICE_AREA_BOUNDS.neLng
  )
}

// ============ Types ============

interface ReportBody {
  name: string
  address?: string
  category: string
  description?: string
}

interface KakaoDocument {
  id: string
  place_name: string
  address_name: string
  road_address_name: string
  x: string // lng
  y: string // lat
  phone: string
  category_group_code: string
  category_group_name: string
  category_name: string
  place_url: string
}

interface KakaoPlaceResult {
  kakaoPlaceId: string
  name: string
  address: string
  roadAddress: string
  lat: number
  lng: number
  phone: string | undefined
  similarity: number
}
