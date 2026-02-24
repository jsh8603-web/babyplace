import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Event, Favorite } from '@/types'

export interface EventDetailResponse {
  event: Event
  isFavorited: boolean
}

/**
 * GET /api/events/[id]
 * Returns: event row + isFavorited (login user)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const eventId = parseInt(id, 10)

  if (isNaN(eventId)) {
    return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  // Fetch event + user session
  const [eventResult, userResult] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).single(),
    supabase.auth.getUser(),
  ])

  if (eventResult.error || !eventResult.data) {
    if (eventResult.error?.code === 'PGRST116') {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }
    console.error('[GET /api/events/[id]] event error:', eventResult.error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  const event = eventResult.data as Event

  // Check if current user has favorited this event
  let isFavorited = false
  const user = userResult.data?.user

  if (user) {
    const { data: favData } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .maybeSingle()

    isFavorited = !!favData
  }

  const response: EventDetailResponse = { event, isFavorited }
  return NextResponse.json(response)
}
