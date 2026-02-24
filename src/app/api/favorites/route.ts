import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

/**
 * POST /api/favorites
 * Toggle favorite: if exists → delete (unfavorite), if not → insert (favorite)
 * Body: { placeId?: number, eventId?: number }
 * Response: { favorited: boolean }
 *
 * Requires authentication (enforced by RLS: auth.uid() = user_id)
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()

  // Check authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { placeId?: number; eventId?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { placeId, eventId } = body

  if (!placeId && !eventId) {
    return NextResponse.json(
      { error: 'placeId or eventId is required' },
      { status: 400 }
    )
  }

  if (placeId && eventId) {
    return NextResponse.json(
      { error: 'Provide either placeId or eventId, not both' },
      { status: 400 }
    )
  }

  // Build query to check existing favorite
  let existingQuery = supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)

  if (placeId) {
    existingQuery = existingQuery.eq('place_id', placeId)
  } else {
    existingQuery = existingQuery.eq('event_id', eventId!)
  }

  const { data: existing, error: selectError } = await existingQuery.maybeSingle()

  if (selectError) {
    console.error('[POST /api/favorites] Select error:', selectError)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  if (existing) {
    // Already favorited → remove (toggle off)
    const { error: deleteError } = await supabase
      .from('favorites')
      .delete()
      .eq('id', existing.id)
      .eq('user_id', user.id) // Ensure user owns the record (belt + suspenders with RLS)

    if (deleteError) {
      console.error('[POST /api/favorites] Delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to remove favorite' }, { status: 500 })
    }

    return NextResponse.json({ favorited: false })
  } else {
    // Not favorited → insert (toggle on)
    const insertData: { user_id: string; place_id?: number; event_id?: number } = {
      user_id: user.id,
    }
    if (placeId) insertData.place_id = placeId
    if (eventId) insertData.event_id = eventId

    const { error: insertError } = await supabase.from('favorites').insert(insertData)

    if (insertError) {
      console.error('[POST /api/favorites] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to add favorite' }, { status: 500 })
    }

    return NextResponse.json({ favorited: true })
  }
}

/**
 * GET /api/favorites
 * Returns paginated list of user's favorited places
 * Used by the /favorites page
 */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const sort = searchParams.get('sort') === 'distance' ? 'distance' : 'created_at'
  const cursor = searchParams.get('cursor') ? parseInt(searchParams.get('cursor')!, 10) : null
  const limit = 20
  const fetchLimit = limit + 1

  let query = supabase
    .from('favorites')
    .select('*, places(*)')
    .eq('user_id', user.id)
    .not('place_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(fetchLimit)

  if (cursor !== null && !isNaN(cursor)) {
    query = query.lt('id', cursor)
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/favorites] Supabase error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const favorites = data ?? []
  let nextCursor: number | null = null

  if (favorites.length > limit) {
    nextCursor = favorites[limit - 1].id
    favorites.splice(limit)
  }

  return NextResponse.json({ favorites, nextCursor })
}
