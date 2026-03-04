import { NextRequest } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { verifyAdmin, errorResponse, successResponse } from '../lib/admin-utils'

/**
 * GET /api/admin/submissions
 * List place/event submissions with filtering
 *
 * Query params:
 * - type: 'place' | 'event'
 * - status: 'pending' | 'approved' | 'rejected' (default: 'pending')
 * - page: number (default 1)
 */
export async function GET(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const type = searchParams.get('type') || 'place'
  const status = searchParams.get('status') || 'pending'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = 20
  const offset = (page - 1) * limit

  const supabase = await createServerSupabase()
  const table = type === 'event' ? 'events' : 'places'

  try {
    const { data, count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact' })
      .eq('submission_status', status)
      .order('submitted_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    // Fetch submitter emails
    const submitterIds = [...new Set((data || []).map((d: Record<string, unknown>) => d.submitted_by).filter(Boolean))]
    let profiles: Record<string, string> = {}
    if (submitterIds.length > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', submitterIds)
      if (profileData) {
        profiles = Object.fromEntries(profileData.map((p) => [p.id, p.email || '']))
      }
    }

    const items = (data || []).map((item: Record<string, unknown>) => ({
      ...item,
      submitter_email: profiles[item.submitted_by as string] || null,
    }))

    return successResponse({ items, total: count || 0 })
  } catch (err) {
    console.error(`[GET /api/admin/submissions] Error:`, err)
    return errorResponse('Failed to fetch submissions', 500)
  }
}
