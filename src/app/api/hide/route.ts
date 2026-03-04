import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

/**
 * POST /api/hide
 * Toggle hide: if exists → delete (unhide), if not → insert (hide)
 * Body: { placeId?: number, eventId?: number }
 * Response: { hidden: boolean }
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

  let body: { placeId?: number; eventId?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { placeId, eventId } = body

  if (!placeId && !eventId) {
    return NextResponse.json({ error: 'placeId or eventId is required' }, { status: 400 })
  }

  if (placeId && eventId) {
    return NextResponse.json({ error: 'Provide either placeId or eventId, not both' }, { status: 400 })
  }

  let existingQuery = supabase
    .from('user_hidden_items')
    .select('id')
    .eq('user_id', user.id)

  if (placeId) {
    existingQuery = existingQuery.eq('place_id', placeId)
  } else {
    existingQuery = existingQuery.eq('event_id', eventId!)
  }

  const { data: existing, error: selectError } = await existingQuery.maybeSingle()

  if (selectError) {
    console.error('[POST /api/hide] Select error:', selectError)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  if (existing) {
    const { error: deleteError } = await supabase
      .from('user_hidden_items')
      .delete()
      .eq('id', existing.id)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[POST /api/hide] Delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to unhide' }, { status: 500 })
    }

    return NextResponse.json({ hidden: false })
  } else {
    const insertData: { user_id: string; place_id?: number; event_id?: number } = {
      user_id: user.id,
    }
    if (placeId) insertData.place_id = placeId
    if (eventId) insertData.event_id = eventId

    const { error: insertError } = await supabase.from('user_hidden_items').insert(insertData)

    if (insertError) {
      console.error('[POST /api/hide] Insert error:', insertError)
      return NextResponse.json({ error: 'Failed to hide' }, { status: 500 })
    }

    return NextResponse.json({ hidden: true })
  }
}
