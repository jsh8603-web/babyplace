import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  let body: {
    name: string
    category?: string
    kakao_url?: string
    address?: string
    description?: string
    phone?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '장소 이름은 필수입니다' }, { status: 400 })
  }

  // Check if user is admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.role === 'admin'

  // Extract kakao place info if URL provided
  let kakaoData: {
    kakao_place_id?: string
    road_address?: string
    lat?: number
    lng?: number
    phone?: string
    category?: string
  } = {}

  if (body.kakao_url) {
    const kakaoPlaceId = extractKakaoPlaceId(body.kakao_url)
    if (kakaoPlaceId) {
      kakaoData = await fetchKakaoPlaceInfo(kakaoPlaceId, body.name)
    }
  }

  // Duplicate check
  if (kakaoData.kakao_place_id) {
    const { data: existing } = await supabaseAdmin
      .from('places')
      .select('id, name')
      .eq('kakao_place_id', kakaoData.kakao_place_id)
      .limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `이미 등록된 장소입니다: ${existing[0].name}` },
        { status: 409 }
      )
    }
  }

  const now = new Date().toISOString()
  const insertData = {
    name: body.name.trim(),
    category: body.category || '놀이',
    address: kakaoData.road_address || body.address || null,
    road_address: kakaoData.road_address || null,
    lat: kakaoData.lat || null,
    lng: kakaoData.lng || null,
    phone: kakaoData.phone || body.phone || null,
    kakao_place_id: kakaoData.kakao_place_id || null,
    description: body.description || null,
    source: 'user_submission',
    source_id: `submit_${user.id}_${Date.now()}`,
    tags: [],
    mention_count: 0,
    popularity_score: 0,
    source_count: 0,
    // Admin: immediate publish; User: pending
    is_active: isAdmin,
    submission_status: isAdmin ? null : 'pending',
    submitted_by: isAdmin ? null : user.id,
    submitted_at: isAdmin ? null : now,
    submission_note: null,
    created_at: now,
    updated_at: now,
  }

  const { data: place, error } = await supabaseAdmin
    .from('places')
    .insert(insertData)
    .select('id')
    .single()

  if (error) {
    console.error('[POST /api/submit/place] Insert error:', error)
    return NextResponse.json({ error: '장소 등록에 실패했습니다' }, { status: 500 })
  }

  return NextResponse.json({
    id: place.id,
    message: isAdmin ? '장소가 등록되었습니다' : '제안이 접수되었습니다. 관리자 승인 후 공개됩니다.',
  })
}

function extractKakaoPlaceId(url: string): string | null {
  // place.map.kakao.com/{id}
  const placeMatch = url.match(/place\.map\.kakao\.com\/(\d+)/)
  if (placeMatch) return placeMatch[1]
  // map.kakao.com/link/{hash} — cannot extract numeric ID
  return null
}

async function fetchKakaoPlaceInfo(
  kakaoPlaceId: string,
  name: string
): Promise<{
  kakao_place_id?: string
  road_address?: string
  lat?: number
  lng?: number
  phone?: string
  category?: string
}> {
  const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY
  if (!KAKAO_REST_KEY) return {}

  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword?query=${encodeURIComponent(name)}&size=5`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
    )
    if (!res.ok) return {}
    const data = await res.json()
    const docs = data.documents || []

    // Find by kakao place id
    const exact = docs.find((d: Record<string, string>) => d.id === kakaoPlaceId)
    const doc = exact || docs[0]
    if (!doc) return {}

    return {
      kakao_place_id: doc.id,
      road_address: doc.road_address_name || doc.address_name,
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      phone: doc.phone || undefined,
      category: doc.category_group_name || undefined,
    }
  } catch {
    return {}
  }
}
