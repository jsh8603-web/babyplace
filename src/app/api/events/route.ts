import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import type { Event } from '@/types'

/**
 * Cursor payload encoded as a base64 JSON string in query params.
 * - recent sort: { type: 'recent', createdAt: string, id: number }
 */
type CursorPayload = {
  type: 'recent'
  createdAt: string
  id: number
}

interface EventsResponse {
  events: Event[]
  nextCursor: string | null
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CursorPayload
  } catch {
    return null
  }
}

/**
 * GET /api/events
 * Query params: category?, sub_category?, status?, cursor?, limit?
 * - status=running → start_date <= today AND (end_date >= today OR end_date IS NULL)
 * - sub_category=전시,체험 → comma-separated filter
 * Returns: paginated events list
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const categoryParam = searchParams.get('category')
  const categories = categoryParam ? categoryParam.split(',').map((c) => c.trim()).filter(Boolean) : []

  const subCategoryParam = searchParams.get('sub_category')
  const subCategories = subCategoryParam ? subCategoryParam.split(',').map((c) => c.trim()).filter(Boolean) : []

  const status = searchParams.get('status')
  const sort = searchParams.get('sort')

  const cursorRaw = searchParams.get('cursor') ?? null
  const cursorPayload = cursorRaw ? decodeCursor(cursorRaw) : null
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  // Fetch 1 extra to determine if next page exists
  const fetchLimit = limit + 1

  const supabase = await createServerSupabase()

  const today = new Date().toISOString().split('T')[0]

  // When status=running, sort by end_date ASC (ending soonest first)
  const isRunning = status === 'running'

  let query = supabase
    .from('events')
    .select('*')
    .eq('is_hidden', false)

  if (isRunning) {
    query = query
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.gte.${today},end_date.is.null`)

    if (sort === 'popularity') {
      query = query
        .order('popularity_score', { ascending: false })
        .order('id', { ascending: false })
    } else {
      query = query
        .order('end_date', { ascending: true, nullsFirst: false })
        .order('id', { ascending: false })
    }
  } else {
    query = query
      .order('start_date', { ascending: false })
      .order('id', { ascending: false })
  }

  query = query.limit(fetchLimit)

  // Category filter
  if (categories.length > 0) {
    query = query.in('category', categories)
  }

  // Sub-category filter
  if (subCategories.length > 0) {
    query = query.in('sub_category', subCategories)
  }

  // Keyset pagination cursor filter (only for non-running queries)
  if (!isRunning && cursorPayload?.type === 'recent') {
    const { createdAt, id } = cursorPayload
    query = query.or(
      `start_date.lt.${createdAt},and(start_date.eq.${createdAt},id.lt.${id})`
    )
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/events] Supabase error:', error)
    return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
  }

  let events = (data as Event[]) ?? []

  // Keyset cursor: encode the sort key + id of the last returned item
  let nextCursor: string | null = null
  if (events.length > limit) {
    const lastItem = events[limit - 1]
    nextCursor = encodeCursor({ type: 'recent', createdAt: lastItem.start_date || '1970-01-01', id: lastItem.id })
    events = events.slice(0, limit)
  }

  const response: EventsResponse = { events, nextCursor }
  return NextResponse.json(response)
}
