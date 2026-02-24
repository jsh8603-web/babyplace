import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export interface VerificationResponse {
  place_id: number
  is_recently_verified: boolean
  last_verified_at: string | null
  verification_count: number
}

/**
 * GET /api/places/verify?place_id=123
 * Returns: verification status for a place
 * Checks if verified in last 90 days (as per Item 22 requirement)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const placeIdStr = searchParams.get('place_id')

  if (!placeIdStr) {
    return NextResponse.json({ error: 'place_id parameter is required' }, { status: 400 })
  }

  const placeId = parseInt(placeIdStr, 10)
  if (isNaN(placeId)) {
    return NextResponse.json({ error: 'Invalid place_id' }, { status: 400 })
  }

  const supabase = await createServerSupabase()

  // Get most recent verification within last 90 days
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const [recentVerification, totalCount] = await Promise.all([
    supabase
      .from('verification_checks')
      .select('verified_at')
      .eq('place_id', placeId)
      .gte('verified_at', ninetyDaysAgo.toISOString())
      .order('verified_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('verification_checks')
      .select('id', { count: 'exact' })
      .eq('place_id', placeId),
  ])

  const isRecentlyVerified = !!recentVerification.data
  const lastVerifiedAt = recentVerification.data?.verified_at ?? null
  const verificationCount = totalCount.count ?? 0

  const response: VerificationResponse = {
    place_id: placeId,
    is_recently_verified: isRecentlyVerified,
    last_verified_at: lastVerifiedAt,
    verification_count: verificationCount,
  }

  return NextResponse.json(response)
}
