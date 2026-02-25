import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Verify admin role from request cookies
 * Returns authenticated user if admin, else rejects with 401/403
 */
export async function verifyAdmin(request: NextRequest) {
  const supabase = await createServerSupabase()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return {
      error: 'Authentication required',
      status: 401,
      user: null,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      error: 'Profile not found',
      status: 404,
      user: null,
    }
  }

  if (profile.role !== 'admin') {
    return {
      error: 'Admin role required',
      status: 403,
      user: null,
    }
  }

  return {
    error: null,
    status: 200,
    user,
  }
}

/**
 * Log admin action to audit_logs table
 * Uses service_role to bypass RLS
 */
export async function logAuditAction(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>
) {
  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details: details || null,
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[logAuditAction] Supabase error:', error)
    }
  } catch (err) {
    console.error('[logAuditAction] Exception:', err)
  }
}

/**
 * Create error response with consistent format
 */
export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Create success response with consistent format
 */
export function successResponse<T>(data: T) {
  return NextResponse.json(data)
}
