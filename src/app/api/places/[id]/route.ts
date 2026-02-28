import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Place, BlogMention, PlaceDetailResponse } from '@/types'

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

  const response: PlaceDetailResponse = { place, topPosts, isFavorited }
  return NextResponse.json(response)
}
