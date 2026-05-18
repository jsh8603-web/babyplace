import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { PlaceCategory, PlaceFeedbackReason, PlaceFeedbackType } from '@/types'

const VALID_CATEGORIES: PlaceCategory[] = [
  '놀이', '공원/놀이터', '전시/체험', '공연', '동물/자연',
  '식당/카페', '도서관', '수영/물놀이', '문화행사', '편의시설',
]
const VALID_REASONS: PlaceFeedbackReason[] = ['not_baby', 'closed', 'wrong_category', 'other']

/**
 * POST /api/places/feedback
 * 사용자 가리기/재분류 피드백.
 *  - recategorize → places.category 즉시 UPDATE + place_feedback(applied=true)
 *  - hide         → user_hidden_items(+reason) + place_feedback(applied=false)
 * place audit wf 가 place_feedback(audit_status='pending') 을 매 라운드 인지하여
 * 원인추적 → 코드 패치 → 동일원인 장소 일괄수정 한다 (plan-place-feedback.md).
 *
 * Body: { placeId: number, type: 'hide'|'recategorize',
 *         reason: PlaceFeedbackReason, newCategory?: PlaceCategory }
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

  let body: {
    placeId?: number
    type?: PlaceFeedbackType
    reason?: PlaceFeedbackReason
    newCategory?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { placeId, type, reason, newCategory } = body

  if (!placeId || typeof placeId !== 'number') {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  }
  if (type !== 'hide' && type !== 'recategorize') {
    return NextResponse.json({ error: 'type must be hide or recategorize' }, { status: 400 })
  }
  if (!reason || !VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: 'invalid reason' }, { status: 400 })
  }

  // ── recategorize: places.category 즉시 반영 (service_role, RLS 우회) ──
  if (type === 'recategorize') {
    if (!newCategory || !VALID_CATEGORIES.includes(newCategory as PlaceCategory)) {
      return NextResponse.json({ error: 'invalid newCategory' }, { status: 400 })
    }

    const { data: place, error: fetchError } = await supabaseAdmin
      .from('places')
      .select('category')
      .eq('id', placeId)
      .single()

    if (fetchError || !place) {
      return NextResponse.json({ error: 'Place not found' }, { status: 404 })
    }

    const prevCategory = place.category as string

    if (prevCategory !== newCategory) {
      const { error: updError } = await supabaseAdmin
        .from('places')
        .update({ category: newCategory, updated_at: new Date().toISOString() })
        .eq('id', placeId)

      if (updError) {
        console.error('[POST /api/places/feedback] places update error:', updError)
        return NextResponse.json({ error: 'Failed to update category' }, { status: 500 })
      }
    }

    const { error: fbError } = await supabaseAdmin.from('place_feedback').insert({
      place_id: placeId,
      user_id: user.id,
      feedback_type: 'recategorize',
      reason: 'wrong_category',
      prev_category: prevCategory,
      new_category: newCategory,
      applied: true,
    })

    if (fbError) {
      console.error('[POST /api/places/feedback] feedback insert error:', fbError)
      return NextResponse.json({ error: 'Failed to log feedback' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, applied: true, prevCategory, newCategory })
  }

  // ── hide: user_hidden_items(+reason) — 본인 행 RLS (user 세션) ──
  const { data: existing } = await supabase
    .from('user_hidden_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('place_id', placeId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('user_hidden_items')
      .update({ reason })
      .eq('id', existing.id)
      .eq('user_id', user.id)
  } else {
    const { error: hideError } = await supabase
      .from('user_hidden_items')
      .insert({ user_id: user.id, place_id: placeId, reason })

    if (hideError) {
      console.error('[POST /api/places/feedback] hide insert error:', hideError)
      return NextResponse.json({ error: 'Failed to hide' }, { status: 500 })
    }
  }

  // place_feedback (감사 입력) — 동일 user+place pending 있으면 갱신 (rate guard)
  const { data: existingFb } = await supabaseAdmin
    .from('place_feedback')
    .select('id')
    .eq('user_id', user.id)
    .eq('place_id', placeId)
    .eq('feedback_type', 'hide')
    .eq('audit_status', 'pending')
    .maybeSingle()

  if (existingFb) {
    await supabaseAdmin
      .from('place_feedback')
      .update({ reason, created_at: new Date().toISOString() })
      .eq('id', existingFb.id)
  } else {
    const { error: fbError } = await supabaseAdmin.from('place_feedback').insert({
      place_id: placeId,
      user_id: user.id,
      feedback_type: 'hide',
      reason,
      applied: false,
    })

    if (fbError) {
      console.error('[POST /api/places/feedback] feedback insert error:', fbError)
      return NextResponse.json({ error: 'Failed to log feedback' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, hidden: true })
}
