import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'url parameter required' }, { status: 400 })
  }

  const kakaoPlaceId = extractKakaoPlaceId(url)
  if (!kakaoPlaceId) {
    return NextResponse.json(
      { error: '유효한 카카오맵 URL이 아닙니다. place.map.kakao.com/{id} 형식이어야 합니다.' },
      { status: 400 }
    )
  }

  const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY
  if (!KAKAO_REST_KEY) {
    return NextResponse.json({ error: 'Kakao API key not configured' }, { status: 500 })
  }

  try {
    // Search by place ID using keyword search
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword?query=${kakaoPlaceId}&size=1`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'Kakao API 호출 실패' }, { status: 502 })
    }

    const data = await res.json()
    const doc = data.documents?.[0]

    if (!doc) {
      return NextResponse.json({ error: '장소 정보를 찾을 수 없습니다' }, { status: 404 })
    }

    return NextResponse.json({
      name: doc.place_name,
      address: doc.road_address_name || doc.address_name,
      phone: doc.phone || null,
      category: doc.category_group_name || null,
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      kakao_place_id: doc.id,
    })
  } catch (err) {
    console.error('[GET /api/submit/kakao-preview] Error:', err)
    return NextResponse.json({ error: '장소 정보 조회 실패' }, { status: 500 })
  }
}

function extractKakaoPlaceId(url: string): string | null {
  const placeMatch = url.match(/place\.map\.kakao\.com\/(\d+)/)
  if (placeMatch) return placeMatch[1]
  return null
}
