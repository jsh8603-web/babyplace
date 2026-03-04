import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Place, BlogMention, Event, PlaceDetailResponse } from '@/types'

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

  // Check if current user has favorited this place
  let isFavorited = false
  const user = userResult.data?.user

  if (user) {
    const { data: favData } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('place_id', placeId)
      .maybeSingle()

    isFavorited = !!favData
  }

  // Fetch nearby running events within 2km radius
  const today = new Date().toISOString().split('T')[0]
  const { data: eventsData } = await supabase
    .from('events')
    .select('id, name, sub_category, category, venue_name, venue_address, start_date, end_date, lat, lng, poster_url, time_info, price_info, age_range, source, source_id, source_url, description, created_at, updated_at')
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
        nearbyEvents.push(ev as Event)
      }
    }
    // Sort by distance (closest first)
    nearbyEvents.sort((a, b) => {
      const da = haversineKm(place.lat, place.lng, a.lat!, a.lng!)
      const db = haversineKm(place.lat, place.lng, b.lat!, b.lng!)
      return da - db
    })
  }

  const response: PlaceDetailResponse = { place, topPosts, nearbyEvents, isFavorited }
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
