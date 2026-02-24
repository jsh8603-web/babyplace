/**
 * Supabase admin client for server-side pipeline use.
 * Uses service_role key — bypasses RLS for all tables.
 * This file re-exports the canonical admin client from src/lib/supabase-admin.ts
 * so server/ modules can import without @/* path alias (which is excluded from tsconfig).
 */
import { createClient } from '@supabase/supabase-js'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL')
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY')
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
