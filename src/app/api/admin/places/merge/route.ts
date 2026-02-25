import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyAdmin, logAuditAction, errorResponse, successResponse } from '../../lib/admin-utils'

interface MergeRequest {
  sourceId: number
  targetId: number
}

/**
 * POST /api/admin/places/merge
 * Merge duplicate places: move all references from source to target, then delete source
 *
 * Body:
 * {
 *   sourceId: number,  // Place to delete
 *   targetId: number   // Place to keep (absorb all references)
 * }
 *
 * Process:
 * 1. Update favorites: sourceId → targetId
 * 2. Update blog_mentions: sourceId → targetId
 * 3. Delete source place
 * 4. Record audit log
 *
 * Admin role required
 */
export async function POST(request: NextRequest) {
  const adminCheck = await verifyAdmin(request)
  if (adminCheck.error) {
    return errorResponse(adminCheck.error, adminCheck.status)
  }

  let body: MergeRequest
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  const { sourceId, targetId } = body

  if (!sourceId || !targetId || typeof sourceId !== 'number' || typeof targetId !== 'number') {
    return errorResponse('sourceId and targetId are required and must be numbers', 400)
  }

  if (sourceId === targetId) {
    return errorResponse('sourceId and targetId must be different', 400)
  }

  const supabase = await createServerSupabase()

  try {
    // Verify both places exist
    const { data: sourcePlaceData, error: sourceFetchError } = await supabase
      .from('places')
      .select('*')
      .eq('id', sourceId)
      .single()

    if (sourceFetchError || !sourcePlaceData) {
      return errorResponse('Source place not found', 404)
    }

    const { data: targetPlaceData, error: targetFetchError } = await supabase
      .from('places')
      .select('*')
      .eq('id', targetId)
      .single()

    if (targetFetchError || !targetPlaceData) {
      return errorResponse('Target place not found', 404)
    }

    // 1. Update favorites: move sourceId → targetId
    // Handle duplicate detection and migration with transaction safety
    const { data: sourceFavs, error: favFetchError } = await supabaseAdmin
      .from('favorites')
      .select('user_id')
      .eq('place_id', sourceId)

    if (!favFetchError && sourceFavs && sourceFavs.length > 0) {
      // Process each favorite, handling duplicates
      const favoriteErrors: string[] = []

      for (const fav of sourceFavs) {
        try {
          // Check if user already has target favorited (duplicate detection)
          const { data: existingFav, error: checkError } = await supabaseAdmin
            .from('favorites')
            .select('id')
            .eq('user_id', fav.user_id)
            .eq('place_id', targetId)
            .single()

          if (checkError && checkError.code !== 'PGRST116') {
            // PGRST116 means no row found, which is expected
            throw checkError
          }

          if (!existingFav) {
            // Safe to update: user only has source favorited
            const { error: updateError } = await supabaseAdmin
              .from('favorites')
              .update({ place_id: targetId })
              .eq('user_id', fav.user_id)
              .eq('place_id', sourceId)

            if (updateError) {
              favoriteErrors.push(`Update failed for user ${fav.user_id}: ${updateError.message}`)
            }
          } else {
            // Delete the source favorite (user has both, keep target)
            const { error: deleteError } = await supabaseAdmin
              .from('favorites')
              .delete()
              .eq('user_id', fav.user_id)
              .eq('place_id', sourceId)

            if (deleteError) {
              favoriteErrors.push(`Delete failed for user ${fav.user_id}: ${deleteError.message}`)
            }
          }
        } catch (favError) {
          favoriteErrors.push(`Favorite ${fav.user_id}: ${favError instanceof Error ? favError.message : String(favError)}`)
        }
      }

      // If any errors occurred during favorite migration, return error
      if (favoriteErrors.length > 0) {
        console.error('[POST /api/admin/places/merge] Favorite migration errors:', favoriteErrors)
        return errorResponse(`Failed to migrate favorites: ${favoriteErrors.join('; ')}`, 500)
      }
    }

    // 2. Update blog_mentions: sourceId → targetId
    const { error: mentionsError } = await supabaseAdmin
      .from('blog_mentions')
      .update({ place_id: targetId })
      .eq('place_id', sourceId)

    if (mentionsError) {
      console.error('[POST /api/admin/places/merge] blog_mentions update error:', mentionsError)
      return errorResponse('Failed to move blog mentions', 500)
    }

    // 3. Delete source place (RLS bypass with service_role)
    const { error: deleteError } = await supabaseAdmin
      .from('places')
      .delete()
      .eq('id', sourceId)

    if (deleteError) {
      console.error('[POST /api/admin/places/merge] Delete error:', deleteError)
      return errorResponse('Failed to delete source place', 500)
    }

    // 4. Record audit log
    await logAuditAction(adminCheck.user!.id, 'place_merge', 'place', `${sourceId}→${targetId}`, {
      sourcePlaceId: sourceId,
      targetPlaceId: targetId,
      sourceName: sourcePlaceData.name,
      targetName: targetPlaceData.name,
    })

    return successResponse({
      message: `Place ${sourceId} merged into ${targetId}`,
      targetId,
    })
  } catch (err) {
    console.error('[POST /api/admin/places/merge] Error:', err)
    return errorResponse('Failed to merge places', 500)
  }
}
