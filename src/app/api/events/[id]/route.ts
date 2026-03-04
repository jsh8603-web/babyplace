import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Event, BlogMention } from '@/types'

export interface EventDetailResponse {
  event: Event
  topPosts: BlogMention[]
  isFavorited: boolean
  isHidden: boolean
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

  // Fetch event + top blog posts + user session
  const [eventResult, mentionsResult, userResult] = await Promise.all([
    supabase.from('events').select('*').eq('id', eventId).single(),
    supabase
      .from('blog_mentions')
      .select('*')
      .eq('event_id', eventId)
      .in('source_type', ['naver_blog', 'daum_blog'])
      .gte('relevance_score', 0.3)
      .order('relevance_score', { ascending: false })
      .order('post_date', { ascending: false })
      .limit(5),
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

  // Check if current user has favorited / hidden this event
  let isFavorited = false
  let isHidden = false
  const user = userResult.data?.user

  if (user) {
    const [favResult, hideResult] = await Promise.all([
      supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('user_hidden_items')
        .select('id')
        .eq('user_id', user.id)
        .eq('event_id', eventId)
        .maybeSingle(),
    ])

    isFavorited = !!favResult.data
    isHidden = !!hideResult.data
  }

  const topPosts = (mentionsResult.data as BlogMention[]) ?? []
  const response: EventDetailResponse = { event, topPosts, isFavorited, isHidden }
  return NextResponse.json(response)
}
