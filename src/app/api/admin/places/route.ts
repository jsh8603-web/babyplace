import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../lib/admin-utils'
import type { Place } from '@/types'

interface PlacesListResponse {
  places: Place[]
  total: number
}

/**
 * GET /api/admin/places
 * List places with optional filtering and search
 *
 * Query params:
 * - search?: string (searches name, address, description)
 * - category?: string (exact category match)
 * - status?: string ('active' | 'inactive')
 * - page?: number (default 1)
 * - limit?: number (default 20, max 100)
 *
 * Admin role required
 */
export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const search = searchParams.get('search') || ''
  const category = searchParams.get('category') || ''
  const status = searchParams.get('status') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10))
  const offset = (page - 1) * limit

  const supabase = await createServerSupabase()

  try {
    // Build query
    let query = supabase.from('places').select('*', { count: 'exact' })

    // Search filter: name, address, or description
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,address.ilike.%${search}%,description.ilike.%${search}%`
      )
    }

    // Category filter
    if (category) {
      query = query.eq('category', category)
    }

    // Status filter
    if (status === 'active') {
      query = query.eq('is_active', true)
    } else if (status === 'inactive') {
      query = query.eq('is_active', false)
    } else if (status === 'hidden') {
      query = query.eq('is_hidden', true)
    }

    // Pagination
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: places, count, error } = await query

    if (error) throw error

    const response: PlacesListResponse = {
      places: (places as Place[]) || [],
      total: count || 0,
    }

    return successResponse(response)
  } catch (err) {
    console.error('[GET /api/admin/places] Error:', err)
    return errorResponse('Failed to fetch places', 500)
  }
}

/**
 * PATCH /api/admin/places
 * Edit a place and record in audit_logs
 *
 * Body:
 * {
 *   id: number,
 *   category?: string,
 *   sub_category?: string | null,
 *   tags?: string[],
 *   name?: string,
 *   description?: string,
 *   phone?: string | null,
 *   is_active?: boolean,
 *   is_indoor?: boolean | null
 * }
 *
 * Admin role required
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
    return errorResponse('Place id is required and must be a number', 400)
  }

  const supabase = await createServerSupabase()

  try {
    // Fetch current place to record before/after
    const { data: currentPlace, error: fetchError } = await supabase
      .from('places')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !currentPlace) {
      return errorResponse('Place not found', 404)
    }

    // Update place
    const { data: updatedPlace, error: updateError } = await supabaseAdmin
      .from('places')
      .update({ ...updateFields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('[PATCH /api/admin/places] Update error:', updateError)
      return errorResponse('Failed to update place', 500)
    }

    // Log audit action
    await logAuditAction(adminCheck.user!.id, 'place_edit', 'place', id.toString(), {
      before: currentPlace,
      after: updatedPlace,
      changedFields: Object.keys(updateFields),
    })

    return successResponse({ place: updatedPlace })
  } catch (err) {
    console.error('[PATCH /api/admin/places] Error:', err)
    return errorResponse('Failed to update place', 500)
  }
}

/**
 * DELETE /api/admin/places
 * Delete a place by id
 *
 * Query params:
 * - placeId: number
 */
export async function DELETE(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const idStr = searchParams.get('placeId')

  if (!idStr) {
    return errorResponse('Place id is required', 400)
  }

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return errorResponse('Place id must be a valid number', 400)
  }

  try {
    const { data: place, error: fetchError } = await supabaseAdmin
      .from('places')
      .select('id, name')
      .eq('id', id)
      .single()

    if (fetchError || !place) {
      return errorResponse('Place not found', 404)
    }

    const { error: deleteError } = await supabaseAdmin
      .from('places')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    await logAuditAction(adminCheck.user!.id, 'delete_place', 'place', String(id), {
      placeName: place.name,
    })

    return successResponse({ message: 'Place deleted' })
  } catch (err) {
    console.error('[DELETE /api/admin/places] Error:', err)
    return errorResponse('Failed to delete place', 500)
  }
}
