import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../../lib/admin-utils'

/**
 * PATCH /api/admin/submissions/[id]
 * Approve or reject a submission
 *
 * Body: { type: 'place' | 'event', action: 'approve' | 'reject' }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { id } = await params
  const numericId = parseInt(id, 10)
  if (isNaN(numericId)) {
    return errorResponse('Invalid ID', 400)
  }

  let body: { type: 'place' | 'event'; action: 'approve' | 'reject' }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  if (!['place', 'event'].includes(body.type) || !['approve', 'reject'].includes(body.action)) {
    return errorResponse('Invalid type or action', 400)
  }

  const table = body.type === 'event' ? 'events' : 'places'
  const now = new Date().toISOString()

  try {
    // Verify item exists and is pending
    const { data: item, error: fetchError } = await supabaseAdmin
      .from(table)
      .select('id, name, submission_status')
      .eq('id', numericId)
      .single()

    if (fetchError || !item) {
      return errorResponse('Item not found', 404)
    }

    if (item.submission_status !== 'pending') {
      return errorResponse(`Already ${item.submission_status}`, 400)
    }

    // Build update
    const updateData: Record<string, unknown> = {
      submission_status: body.action === 'approve' ? 'approved' : 'rejected',
      updated_at: now,
    }

    if (body.action === 'approve') {
      if (body.type === 'place') {
        updateData.is_active = true
      } else {
        updateData.is_hidden = false
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from(table)
      .update(updateData)
      .eq('id', numericId)

    if (updateError) {
      console.error('[PATCH /api/admin/submissions] Update error:', updateError)
      return errorResponse('Failed to update', 500)
    }

    await logAuditAction(
      adminCheck.user!.id,
      `submission_${body.action}`,
      `${body.type}_submission`,
      id,
      { name: item.name }
    )

    return successResponse({
      message: body.action === 'approve' ? '승인되었습니다' : '반려되었습니다',
    })
  } catch (err) {
    console.error('[PATCH /api/admin/submissions] Error:', err)
    return errorResponse('Failed to process submission', 500)
  }
}
