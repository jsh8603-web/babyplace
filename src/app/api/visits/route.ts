import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

/**
 * GET /api/visits
 * Returns paginated list of user's visit diary entries
 * Cursor pagination by id DESC, joined with places
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
  const cursor = searchParams.get('cursor') ? parseInt(searchParams.get('cursor')!, 10) : null
  const limit = 20
  const fetchLimit = limit + 1

  let query = supabase
    .from('visits')
    .select('*, places(*)')
    .eq('user_id', user.id)
    .order('visited_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(fetchLimit)

  if (cursor !== null && !isNaN(cursor)) {
    query = query.lt('id', cursor)
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/visits] Supabase error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const visits = data ?? []
  let nextCursor: number | null = null

  if (visits.length > limit) {
    nextCursor = visits[limit - 1].id
    visits.splice(limit)
  }

  return NextResponse.json({ visits, nextCursor })
}

/**
 * POST /api/visits
 * Add a visit record
 * Body: { placeId: number, visitedAt?: string, memo?: string, willReturn?: boolean }
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { placeId: number; visitedAt?: string; memo?: string; willReturn?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { placeId, visitedAt, memo, willReturn } = body

  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('visits')
    .insert({
      user_id: user.id,
      place_id: placeId,
      visited_at: visitedAt || new Date().toISOString().split('T')[0],
      memo: memo || null,
      will_return: willReturn ?? false,
    })
    .select('*, places(*)')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already recorded visit for this date' }, { status: 409 })
    }
    console.error('[POST /api/visits] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 })
  }

  return NextResponse.json({ visit: data }, { status: 201 })
}

/**
 * PATCH /api/visits
 * Update a visit record (memo, willReturn)
 * Body: { visitId: number, memo?: string, willReturn?: boolean }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { visitId: number; memo?: string; willReturn?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visitId, memo, willReturn } = body

  if (!visitId) {
    return NextResponse.json({ error: 'visitId is required' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {}
  if (memo !== undefined) updateData.memo = memo
  if (willReturn !== undefined) updateData.will_return = willReturn

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('visits')
    .update(updateData)
    .eq('id', visitId)
    .eq('user_id', user.id)
    .select('*, places(*)')
    .single()

  if (error) {
    console.error('[PATCH /api/visits] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to update visit' }, { status: 500 })
  }

  return NextResponse.json({ visit: data })
}

/**
 * DELETE /api/visits
 * Delete a visit record
 * Query: ?visitId=123
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const visitId = parseInt(request.nextUrl.searchParams.get('visitId') ?? '', 10)

  if (isNaN(visitId)) {
    return NextResponse.json({ error: 'visitId is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('visits')
    .delete()
    .eq('id', visitId)
    .eq('user_id', user.id)

  if (error) {
    console.error('[DELETE /api/visits] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to delete visit' }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
