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
 * Query params: category?, cursor?, limit?
 * Returns: paginated events list (ordered by start_date DESC, then id DESC)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const categoryParam = searchParams.get('category')
  const categories = categoryParam ? categoryParam.split(',').map((c) => c.trim()).filter(Boolean) : []

  const cursorRaw = searchParams.get('cursor') ?? null
  const cursorPayload = cursorRaw ? decodeCursor(cursorRaw) : null
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  // Fetch 1 extra to determine if next page exists
  const fetchLimit = limit + 1

  const supabase = await createServerSupabase()

  let query = supabase
    .from('events')
    .select('*')
    .order('start_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(fetchLimit)

  // Category filter
  if (categories.length > 0) {
    query = query.in('category', categories)
  }

  // Keyset pagination cursor filter
  if (cursorPayload?.type === 'recent') {
    const { createdAt, id } = cursorPayload
    // Rows where (start_date, id) < (cursorDate, cursorId)
    // Since we're ordering by start_date DESC, we want start_date < cursorDate OR (start_date = cursorDate AND id < cursorId)
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
    nextCursor = encodeCursor({ type: 'recent', createdAt: lastItem.start_date, id: lastItem.id })
    events = events.slice(0, limit)
  }

  const response: EventsResponse = { events, nextCursor }
  return NextResponse.json(response)
}
