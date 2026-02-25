import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Place } from '@/types'

/**
 * Cursor payload encoded as a base64 JSON string in query params.
 * - popularity sort: { type: 'popularity', score: number, id: number }
 * - recent sort:     { type: 'recent', createdAt: string, id: number }
 * - distance sort:   { type: 'id', id: number }  (no stable sort key; fall back to id)
 */
type CursorPayload =
  | { type: 'popularity'; score: number; id: number }
  | { type: 'recent'; createdAt: string; id: number }
  | { type: 'id'; id: number }

interface PlacesResponse {
  places: Place[]
  nextCursor: string | null
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload
  } catch {
    return null
  }
}

/**
 * GET /api/places
 * Query params: swLat, swLng, neLat, neLng, zoom, category?, tags?, sort?, lat?, lng?, cursor?, limit?, indoor?
 * Cursor pagination: query 21 rows → return 20 + nextCursor if row 21 exists
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // --- Parse parameters ---
  const swLat = parseFloat(searchParams.get('swLat') ?? '')
  const swLng = parseFloat(searchParams.get('swLng') ?? '')
  const neLat = parseFloat(searchParams.get('neLat') ?? '')
  const neLng = parseFloat(searchParams.get('neLng') ?? '')
  const zoom = parseInt(searchParams.get('zoom') ?? '12', 10)

  if (isNaN(swLat) || isNaN(swLng) || isNaN(neLat) || isNaN(neLng)) {
    return NextResponse.json(
      { error: 'bbox parameters (swLat, swLng, neLat, neLng) are required' },
      { status: 400 }
    )
  }

  const categoryParam = searchParams.get('category')
  const categories = categoryParam ? categoryParam.split(',').map((c) => c.trim()).filter(Boolean) : []

  const tagsParam = searchParams.get('tags')
  const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : []

  const sort = (searchParams.get('sort') ?? 'popularity') as 'distance' | 'popularity' | 'recent'
  const userLat = parseFloat(searchParams.get('lat') ?? '')
  const userLng = parseFloat(searchParams.get('lng') ?? '')

  const cursorRaw = searchParams.get('cursor') ?? null
  const cursorPayload = cursorRaw ? decodeCursor(cursorRaw) : null
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const indoor = searchParams.get('indoor') === 'true' ? true : searchParams.get('indoor') === 'false' ? false : undefined
  const queryText = searchParams.get('query')?.trim() || null

  // Fetch 1 extra to determine if next page exists
  const fetchLimit = limit + 1

  const supabase = await createServerSupabase()

  // Base query — bbox + active filter
  let query = supabase
    .from('places')
    .select('*')
    .eq('is_active', true)
    .gte('lat', swLat)
    .lte('lat', neLat)
    .gte('lng', swLng)
    .lte('lng', neLng)
    .limit(fetchLimit)

  // Zoom-based density control: at low zoom show only high-popularity places
  if (zoom <= 9) {
    query = query.gte('popularity_score', 50)
  } else if (zoom <= 11) {
    query = query.gte('popularity_score', 20)
  } else if (zoom <= 13) {
    query = query.gte('popularity_score', 5)
  }
  // zoom >= 14: show all places (no popularity filter)

  // Category filter
  if (categories.length > 0) {
    query = query.in('category', categories)
  }

  // Tags filter — tags is a text[] column; use overlap (&&) operator
  if (tags.length > 0) {
    query = query.overlaps('tags', tags)
  }

  // Indoor filter (weather integration)
  if (indoor !== undefined) {
    query = query.eq('is_indoor', indoor)
  }

  // Text search filter
  if (queryText) {
    query = query.or(`name.ilike.%${queryText}%,road_address.ilike.%${queryText}%,address.ilike.%${queryText}%`)
  }

  // Keyset pagination — apply cursor filter matching the sort key to avoid jumps/skips.
  // Each sort uses a (primary_key, id) composite cursor so ties are broken consistently.
  switch (sort) {
    case 'popularity': {
      // ORDER BY popularity_score DESC, id DESC
      // Cursor filter: rows where (popularity_score, id) < (cursorScore, cursorId)
      // PostgREST doesn't support tuple comparison directly, so we use the equivalent:
      //   popularity_score < cursorScore
      //   OR (popularity_score = cursorScore AND id < cursorId)
      query = query.order('popularity_score', { ascending: false }).order('id', { ascending: false })
      if (cursorPayload?.type === 'popularity') {
        const { score, id } = cursorPayload
        query = query.or(
          `popularity_score.lt.${score},and(popularity_score.eq.${score},id.lt.${id})`
        )
      }
      break
    }
    case 'recent': {
      // ORDER BY created_at DESC, id DESC
      // Cursor filter: (created_at, id) < (cursorDate, cursorId)
      query = query.order('created_at', { ascending: false }).order('id', { ascending: false })
      if (cursorPayload?.type === 'recent') {
        const { createdAt, id } = cursorPayload
        query = query.or(
          `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`
        )
      }
      break
    }
    case 'distance':
    default: {
      // Distance sort is done in-memory after fetching; DB query orders by popularity_score
      // so the page is deterministic, then re-sorted by distance client-side.
      // Cursor is id-based (simple) because we re-sort after fetch anyway.
      query = query.order('popularity_score', { ascending: false }).order('id', { ascending: false })
      if (cursorPayload?.type === 'id') {
        query = query.lt('id', cursorPayload.id)
      }
      break
    }
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/places] Supabase error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  let places = (data as Place[]) ?? []

  // Client-side distance sort when user coords are provided
  if (sort === 'distance' && !isNaN(userLat) && !isNaN(userLng)) {
    places = places.sort((a, b) => {
      const distA = haversineMeters(userLat, userLng, a.lat, a.lng)
      const distB = haversineMeters(userLat, userLng, b.lat, b.lng)
      return distA - distB
    })
  }

  // Keyset cursor: encode the sort key + id of the last returned item
  let nextCursor: string | null = null
  if (places.length > limit) {
    const lastItem = places[limit - 1]
    switch (sort) {
      case 'popularity':
        nextCursor = encodeCursor({ type: 'popularity', score: lastItem.popularity_score, id: lastItem.id })
        break
      case 'recent':
        nextCursor = encodeCursor({ type: 'recent', createdAt: lastItem.created_at, id: lastItem.id })
        break
      default:
        nextCursor = encodeCursor({ type: 'id', id: lastItem.id })
    }
    places = places.slice(0, limit)
  }

  // Fire-and-forget: log search query to search_logs
  if (queryText) {
    const userId = (await supabase.auth.getUser()).data.user?.id ?? null
    supabase
      .from('search_logs')
      .insert({
        query: queryText,
        results_count: places.length,
        user_id: userId,
      })
      .then(({ error: logError }) => {
        if (logError) console.error('[search_logs] Insert error:', logError)
      })
  }

  const response: PlacesResponse = { places, nextCursor }
  return NextResponse.json(response)
}

/** Haversine distance in meters (for in-memory sort) */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
