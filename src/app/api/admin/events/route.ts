import { NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../lib/admin-utils'
import type { Event } from '@/types'

/**
 * GET /api/admin/events
 * List events with optional filtering and search
 *
 * Query params:
 * - search?: string (searches name, venue_name, venue_address)
 * - status?: string ('hidden' | 'all')
 * - page?: number (default 1)
 * - limit?: number (default 20, max 100)
 */
export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const search = searchParams.get('search') || ''
  const status = searchParams.get('status') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10))
  const offset = (page - 1) * limit

  const supabase = await createServerSupabase()

  try {
    let query = supabase.from('events').select('*', { count: 'exact' })

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,venue_name.ilike.%${search}%,venue_address.ilike.%${search}%`
      )
    }

    if (status === 'hidden') {
      query = query.eq('is_hidden', true)
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: events, count, error } = await query

    if (error) throw error

    return successResponse({
      events: (events as Event[]) || [],
      total: count || 0,
    })
  } catch (err) {
    console.error('[GET /api/admin/events] Error:', err)
    return errorResponse('Failed to fetch events', 500)
  }
}

/**
 * PATCH /api/admin/events
 * Edit an event and record in audit_logs
 *
 * Body: { id: number, is_hidden?: boolean, ... }
 */
export async function PATCH(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  const { id, ...updateFields } = body as any

  if (!id || typeof id !== 'number') {
    return errorResponse('Event id is required and must be a number', 400)
  }

  const supabase = await createServerSupabase()

  try {
    const { data: currentEvent, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !currentEvent) {
      return errorResponse('Event not found', 404)
    }

    const { data: updatedEvent, error: updateError } = await supabaseAdmin
      .from('events')
      .update({ ...updateFields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /api/admin/events] Update error:', updateError)
      return errorResponse('Failed to update event', 500)
    }

    await logAuditAction(adminCheck.user!.id, 'event_edit', 'event', id.toString(), {
      before: currentEvent,
      after: updatedEvent,
      changedFields: Object.keys(updateFields),
    })

    return successResponse({ event: updatedEvent })
  } catch (err) {
    console.error('[PATCH /api/admin/events] Error:', err)
    return errorResponse('Failed to update event', 500)
  }
}
