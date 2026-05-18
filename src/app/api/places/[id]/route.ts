import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Place, BlogMention, Event, PlaceDetailResponse } from '@/types'

/**
 * 이벤트 source 노출 우선순위 (값이 작을수록 먼저).
 * 신뢰 소스(공식 API)는 babyplace 타깃(아기 동반) 적합성 순:
 *   babygo > seoul_events > tour_api > interpark.
 * 그 외(blog_discovery, exhibition_extraction 등)는 비신뢰로 후순위.
 * poster-audit-rules.md OFFICIAL_POSTER_SOURCES 정의 기반.
 */
const EVENT_SOURCE_RANK: Record<string, number> = {
  babygo: 0,
  seoul_events: 1,
  tour_api: 2,
  interpark: 3,
}
const UNTRUSTED_SOURCE_RANK = 4

/** 인근 이벤트 노출 상한 */
const NEARBY_EVENTS_LIMIT = 20

function eventSourceRank(source: string): number {
  return EVENT_SOURCE_RANK[source] ?? UNTRUSTED_SOURCE_RANK
}

/** 정상 대표 이미지 보유 여부 (URL 존재 + 숨김 아님) */
function hasValidPoster(ev: Pick<Event, 'poster_url' | 'poster_hidden'>): boolean {
  return !!ev.poster_url && !ev.poster_hidden
}

/**
 * GET /api/places/[id]
 * Returns: place row + top 5 blog_mentions (by post_date DESC) + isFavorited (login user)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const placeId = parseInt(id, 10)

  if (isNaN(placeId)) {
    return NextResponse.json({ error: 'Invalid place id' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  // Fetch place + top 5 blog mentions in parallel
  const [placeResult, mentionsResult, userResult] = await Promise.all([
    supabase.from('places').select('*').eq('id', placeId).eq('is_active', true).single(),
    supabase
      .from('blog_mentions')
      .select('*')
      .eq('place_id', placeId)
      .in('source_type', ['naver_blog', 'daum_blog'])
      .gte('relevance_score', 0.3)
      .order('relevance_score', { ascending: false })
      .order('post_date', { ascending: false })
      .limit(5),
    supabase.auth.getUser(),
  ])

  if (placeResult.error || !placeResult.data) {
    if (placeResult.error?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 })
    }
    console.error('[GET /api/places/[id]] place error:', placeResult.error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const place = placeResult.data as Place
  const topPosts = (mentionsResult.data ?? []) as BlogMention[]

  // Check if current user has favorited / hidden this place
  let isFavorited = false
  let isHidden = false
  const user = userResult.data?.user

  if (user) {
    const [favResult, hideResult] = await Promise.all([
      supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('place_id', placeId)
        .maybeSingle(),
      supabase
        .from('user_hidden_items')
        .select('id')
        .eq('user_id', user.id)
        .eq('place_id', placeId)
        .maybeSingle(),
    ])

    isFavorited = !!favResult.data
    isHidden = !!hideResult.data
  }

  // Fetch nearby running events within 2km radius
  const today = new Date().toISOString().split('T')[0]
  const { data: eventsData } = await supabase
    .from('events')
    .select('id, name, sub_category, category, venue_name, venue_address, start_date, end_date, date_confirmed, lat, lng, poster_url, poster_hidden, time_info, price_info, age_range, source, source_id, source_url, description, created_at, updated_at')
    .gte('end_date', today)
    .lte('start_date', today)
    .not('lat', 'is', null)
    .not('lng', 'is', null)

  const nearbyEvents: Event[] = []
  if (eventsData && place.lat && place.lng) {
    const RADIUS_KM = 2
    for (const ev of eventsData) {
      if (ev.lat == null || ev.lng == null) continue
      const dist = haversineKm(place.lat, place.lng, ev.lat, ev.lng)
      if (dist <= RADIUS_KM) {
        nearbyEvents.push({ ...ev, distance: Math.round(dist * 100) / 100 } as Event)
      }
    }
    // 1) source priority  2) untrusted: valid-poster first  3) distance
    nearbyEvents.sort((a, b) => {
      const ra = eventSourceRank(a.source)
      const rb = eventSourceRank(b.source)
      if (ra !== rb) return ra - rb
      if (ra === UNTRUSTED_SOURCE_RANK) {
        const pa = hasValidPoster(a) ? 0 : 1
        const pb = hasValidPoster(b) ? 0 : 1
        if (pa !== pb) return pa - pb
      }
      return (a.distance ?? 0) - (b.distance ?? 0)
    })
  }

  const response: PlaceDetailResponse = {
    place,
    topPosts,
    nearbyEvents: nearbyEvents.slice(0, NEARBY_EVENTS_LIMIT),
    isFavorited,
    isHidden,
  }
  return NextResponse.json(response)
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
