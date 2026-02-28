import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../lib/admin-utils'

interface Keyword {
  id: number
  keyword: string
  keyword_group: string | null
  status: string
  efficiency_score: number
  total_results: number
  new_places_found: number
  duplicate_ratio: number
  cycle_count: number
  consecutive_zero_new: number
  seasonal_months: number[] | null
  source: string
  provider: string
  is_indoor: boolean | null
  created_at: string
  last_used_at: string | null
}

interface KeywordsListResponse {
  keywords: Keyword[]
  total: number
}

/**
 * GET /api/admin/keywords
 * List keywords with filtering and sorting
 *
 * Query params:
 * - status?: string ('NEW' | 'ACTIVE' | 'DECLINING' | 'EXHAUSTED' | 'SEASONAL')
 * - provider?: string ('naver' | 'kakao')
 * - sortBy?: 'efficiency' | 'recent' | 'cycle_count' (default: 'efficiency')
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
  const status = searchParams.get('status') || ''
  const provider = searchParams.get('provider') || ''
  const sortBy = (searchParams.get('sortBy') || 'efficiency') as 'efficiency' | 'recent' | 'cycle_count'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10))
  const offset = (page - 1) * limit

  const supabase = await createServerSupabase()

  try {
    let query = supabase.from('keywords').select('*', { count: 'exact' })

    // Status filter
    if (status) {
      query = query.eq('status', status)
    }

    // Provider filter
    if (provider) {
      query = query.eq('provider', provider)
    }

    // Sorting
    switch (sortBy) {
      case 'recent':
        query = query.order('last_used_at', { ascending: false, nullsFirst: false })
        break
      case 'cycle_count':
        query = query.order('cycle_count', { ascending: false })
        break
      case 'efficiency':
      default:
        query = query.order('efficiency_score', { ascending: false })
    }

    // Pagination
    query = query.range(offset, offset + limit - 1)

    const { data: keywords, count, error } = await query

    if (error) throw error

    const response: KeywordsListResponse = {
      keywords: (keywords as Keyword[]) || [],
      total: count || 0,
    }

    return successResponse(response)
  } catch (err) {
    console.error('[GET /api/admin/keywords] Error:', err)
    return errorResponse('Failed to fetch keywords', 500)
  }
}

/**
 * POST /api/admin/keywords
 * Create a new keyword
 *
 * Body:
 * {
 *   keyword: string,
 *   keyword_group?: string,
 *   seasonal_months?: number[] (1-12)
 * }
 *
 * Admin role required
 */
export async function POST(request: NextRequest) {
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

  const { keyword, keyword_group, seasonal_months, provider, is_indoor } = body

  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
    return errorResponse('keyword is required and must be a non-empty string', 400)
  }

  try {
    const { data: newKeyword, error: insertError } = await supabaseAdmin
      .from('keywords')
      .insert({
        keyword: keyword.trim(),
        keyword_group: keyword_group || null,
        provider: provider || 'naver',
        is_indoor: is_indoor ?? null,
        status: 'NEW',
        seasonal_months: seasonal_months || null,
        source: 'manual',
        efficiency_score: 0,
      })
      .select()
      .single()

    if (insertError) {
      // PostgreSQL UNIQUE constraint violation error code is 23505
      if ((insertError as any).code === '23505') {
        return errorResponse('Keyword already exists', 400)
      }
      throw insertError
    }

    // Log audit action
    await logAuditAction(adminCheck.user!.id, 'keyword_add', 'keyword', newKeyword.id.toString(), {
      keyword: keyword.trim(),
      group: keyword_group || null,
    })

    return successResponse({ keyword: newKeyword })
  } catch (err) {
    console.error('[POST /api/admin/keywords] Error:', err)
    return errorResponse('Failed to create keyword', 500)
  }
}

/**
 * PATCH /api/admin/keywords
 * Update keyword status or properties
 *
 * Body:
 * {
 *   id: number,
 *   status?: 'NEW' | 'ACTIVE' | 'DECLINING' | 'EXHAUSTED' | 'SEASONAL',
 *   keyword_group?: string | null,
 *   seasonal_months?: number[] | null
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
    return errorResponse('Keyword id is required and must be a number', 400)
  }

  try {
    // Fetch current keyword
    const { data: currentKeyword, error: fetchError } = await supabaseAdmin
      .from('keywords')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !currentKeyword) {
      return errorResponse('Keyword not found', 404)
    }

    // Update keyword
    const { data: updatedKeyword, error: updateError } = await supabaseAdmin
      .from('keywords')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    // Log audit action
    await logAuditAction(adminCheck.user!.id, 'keyword_update', 'keyword', id.toString(), {
      before: currentKeyword,
      after: updatedKeyword,
      changedFields: Object.keys(updateFields),
    })

    return successResponse({ keyword: updatedKeyword })
  } catch (err) {
    console.error('[PATCH /api/admin/keywords] Error:', err)
    return errorResponse('Failed to update keyword', 500)
  }
}

/**
 * DELETE /api/admin/keywords
 * Delete a keyword
 *
 * Query params:
 * - id: number
 *
 * Admin role required
 */
export async function DELETE(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  const { searchParams } = request.nextUrl
  const idStr = searchParams.get('id')

  if (!idStr) {
    return errorResponse('Keyword id is required', 400)
  }

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return errorResponse('Keyword id must be a valid number', 400)
  }

  try {
    // Fetch keyword before deletion
    const { data: keyword, error: fetchError } = await supabaseAdmin
      .from('keywords')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !keyword) {
      return errorResponse('Keyword not found', 404)
    }

    // Delete keyword (cascade will handle keyword_logs)
    const { error: deleteError } = await supabaseAdmin.from('keywords').delete().eq('id', id)

    if (deleteError) throw deleteError

    // Log audit action
    await logAuditAction(adminCheck.user!.id, 'keyword_delete', 'keyword', id.toString(), {
      keyword: keyword.keyword,
      status: keyword.status,
    })

    return successResponse({ message: 'Keyword deleted' })
  } catch (err) {
    console.error('[DELETE /api/admin/keywords] Error:', err)
    return errorResponse('Failed to delete keyword', 500)
  }
}
