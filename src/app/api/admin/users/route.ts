import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../lib/admin-utils'
import type { Profile } from '@/types'

interface UsersListResponse {
  users: Profile[]
  total: number
}

/**
 * GET /api/admin/users
 * List users with optional filtering
 *
 * Query params:
 * - search?: string (search by email or display_name)
 * - role?: string ('user' | 'admin')
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
  const role = searchParams.get('role') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10))
  const offset = (page - 1) * limit

  const supabase = await createServerSupabase()

  try {
    let query = supabase.from('profiles').select('*', { count: 'exact' })

    // Search filter
    if (search) {
      query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`)
    }

    // Role filter
    if (role === 'user' || role === 'admin') {
      query = query.eq('role', role)
    }

    // Pagination
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: users, count, error } = await query

    if (error) throw error

    const response: UsersListResponse = {
      users: (users as Profile[]) || [],
      total: count || 0,
    }

    return successResponse(response)
  } catch (err) {
    console.error('[GET /api/admin/users] Error:', err)
    return errorResponse('Failed to fetch users', 500)
  }
}

/**
 * PATCH /api/admin/users
 * Update user role (admin only)
 *
 * Body:
 * {
 *   id: string (UUID),
 *   role: 'user' | 'admin'
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

  const { id, role } = body as any

  if (!id || typeof id !== 'string') {
    return errorResponse('User id is required and must be a string (UUID)', 400)
  }

  if (!role || !['user', 'admin'].includes(role)) {
    return errorResponse("role must be 'user' or 'admin'", 400)
  }

  // Prevent self-demotion
  if (adminCheck.user?.id === id && role === 'user') {
    return errorResponse('You cannot demote yourself from admin', 403)
  }

  try {
    // Fetch current profile
    const { data: currentProfile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !currentProfile) {
      return errorResponse('User not found', 404)
    }

    if (currentProfile.role === role) {
      return successResponse({
        message: 'No changes made (user already has this role)',
        user: currentProfile,
      })
    }

    // Update user role
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    // Log audit action
    await logAuditAction(adminCheck.user!.id, 'role_change', 'user', id, {
      before: { role: currentProfile.role },
      after: { role: updatedProfile.role },
      targetEmail: currentProfile.email,
      targetDisplayName: currentProfile.display_name,
    })

    return successResponse({ user: updatedProfile })
  } catch (err) {
    console.error('[PATCH /api/admin/users] Error:', err)
    return errorResponse('Failed to update user', 500)
  }
}
