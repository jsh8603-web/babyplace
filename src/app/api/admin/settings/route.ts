import { NextRequest, NextResponse } from 'next/server'
import { verifyAdmin } from '@/app/api/admin/lib/admin-utils'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/admin/settings
 * Returns all app_settings rows.
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAdmin(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('*')
    .order('key')

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }

  return NextResponse.json({ settings: data })
}

/**
 * PATCH /api/admin/settings
 * Body: { key: string, value: any }
 * Upserts a single setting.
 */
export async function PATCH(request: NextRequest) {
  const auth = await verifyAdmin(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { key, value } = body as { key: string; value: unknown }

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert(
      { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

  if (error) {
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
