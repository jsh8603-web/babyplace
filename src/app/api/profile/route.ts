import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Profile } from '@/types'

/**
 * GET /api/profile
 * Returns current authenticated user's profile
 * Response: { profile: Profile }
 *
 * Requires authentication
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[GET /api/profile] Supabase error:', profileError)
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      created_at: profile.created_at,
    } as Profile,
  })
}

/**
 * PATCH /api/profile
 * Updates user's display_name
 * Body: { display_name: string }
 * Response: { profile: Profile }
 *
 * Requires authentication
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

  let body: { display_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { display_name } = body

  if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
    return NextResponse.json(
      { error: 'display_name is required and must be a non-empty string' },
      { status: 400 }
    )
  }

  if (display_name.length > 50) {
    return NextResponse.json(
      { error: 'display_name must be 50 characters or less' },
      { status: 400 }
    )
  }

  const { data: profile, error: updateError } = await supabase
    .from('profiles')
    .update({ display_name: display_name.trim() })
    .eq('id', user.id)
    .select('*')
    .single()

  if (updateError) {
    console.error('[PATCH /api/profile] Update error:', updateError)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      created_at: profile.created_at,
    } as Profile,
  })
}
