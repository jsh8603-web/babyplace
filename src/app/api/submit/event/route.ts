import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  let body: {
    name: string
    category?: string
    start_date?: string
    end_date?: string
    venue_name?: string
    venue_address?: string
    source_url?: string
    price_info?: string
    age_range?: string
    description?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: '이벤트 이름은 필수입니다' }, { status: 400 })
  }

  // Check if user is admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.role === 'admin'

  // Duplicate check: same name + start_date
  if (body.start_date) {
    const { data: existing } = await supabaseAdmin
      .from('events')
      .select('id, name')
      .eq('name', body.name.trim())
      .eq('start_date', body.start_date)
      .limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `이미 등록된 이벤트입니다: ${existing[0].name}` },
        { status: 409 }
      )
    }
  }

  const now = new Date().toISOString()
  const insertData = {
    name: body.name.trim(),
    category: body.category || '체험',
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    venue_name: body.venue_name || null,
    venue_address: body.venue_address || null,
    source_url: body.source_url || null,
    price_info: body.price_info || null,
    age_range: body.age_range || null,
    description: body.description || null,
    source: 'user_submission',
    source_id: `submit_${user.id}_${Date.now()}`,
    mention_count: 0,
    popularity_score: 0,
    auto_hidden: false,
    // Admin: immediate publish; User: pending
    is_hidden: !isAdmin,
    submission_status: isAdmin ? null : 'pending',
    submitted_by: isAdmin ? null : user.id,
    submitted_at: isAdmin ? null : now,
    submission_note: null,
    created_at: now,
    updated_at: now,
  }

  const { data: event, error } = await supabaseAdmin
    .from('events')
    .insert(insertData)
    .select('id')
    .single()

  if (error) {
    console.error('[POST /api/submit/event] Insert error:', error)
    return NextResponse.json({ error: '이벤트 등록에 실패했습니다' }, { status: 500 })
  }

  return NextResponse.json({
    id: event.id,
    message: isAdmin ? '이벤트가 등록되었습니다' : '제안이 접수되었습니다. 관리자 승인 후 공개됩니다.',
  })
}
