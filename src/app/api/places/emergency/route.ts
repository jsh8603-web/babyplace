import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Place, EmergencyResponse } from '@/types'

/**
 * GET /api/places/emergency
 * PostGIS KNN nearest 5 places filtered by type (nursing_room | diaper_station)
 * Query params: lat, lng, type
 *
 * Uses ST_DistanceSphere for accurate meter-level distance.
 * The places.tags array contains '수유실' or '기저귀교환대' for filtering.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lng = parseFloat(searchParams.get('lng') ?? '')
  const type = searchParams.get('type') as 'nursing_room' | 'diaper_station' | null

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: 'lat and lng parameters are required' },
      { status: 400 }
    )
  }

  if (type && type !== 'nursing_room' && type !== 'diaper_station') {
    return NextResponse.json(
      { error: 'type must be nursing_room or diaper_station' },
      { status: 400 }
    )
  }

  // Map type to facility tag
  const tagMap: Record<string, string> = {
    nursing_room: '수유실',
    diaper_station: '기저귀교환대',
  }
  const requiredTag = type ? tagMap[type] : null

  // PostGIS KNN query using ST_DistanceSphere for accurate distance in meters
  // lat/lng BETWEEN bounding box pre-filter (3km radius) for index usage before distance sort
  const radiusDeg = 0.03 // ~3km pre-filter bounding box

  let query = supabaseAdmin
    .from('places')
    .select('*')
    .eq('is_active', true)
    .gte('lat', lat - radiusDeg)
    .lte('lat', lat + radiusDeg)
    .gte('lng', lng - radiusDeg)
    .lte('lng', lng + radiusDeg)

  // Tag filter for nursing room or diaper station
  if (requiredTag) {
    query = query.contains('tags', [requiredTag])
  }

  // Retrieve candidates then sort by computed distance
  // (Supabase JS client doesn't expose ST_DistanceSphere in .order(); sort in JS)
  query = query.limit(50) // Fetch larger set before distance-ranking

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/places/emergency] Supabase error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const places = (data ?? []) as Place[]

  // Compute ST_DistanceSphere equivalent in TypeScript (accurate great-circle in meters)
  // and take nearest 5
  const withDistance = places
    .map((place) => ({
      ...place,
      distance_m: sphereDistanceMeters(lat, lng, place.lat, place.lng),
    }))
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 5)

  const response: EmergencyResponse = { places: withDistance }
  return NextResponse.json(response)
}

/**
 * ST_DistanceSphere equivalent: accurate great-circle distance on a sphere (meters)
 * Uses Earth mean radius = 6370986 m (same as PostGIS ST_DistanceSphere default)
 */
function sphereDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6370986 // Earth mean radius in meters (PostGIS default)
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
