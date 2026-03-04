/**
 * Event blog search collector.
 *
 * Searches Naver Blog API for blog posts about active events,
 * inserts relevant mentions into blog_mentions with event_id,
 * and updates event mention_count via RPC.
 */

import { supabaseAdmin } from '../lib/supabase-admin'
import {
  fetchNaverSearch,
  stripHtml,
  parseNaverPostDate,
  computePostRelevance,
  NaverBlogItem,
  AddressComponents,
} from './naver-blog'

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json'
const DISPLAY_COUNT = 20
const RELEVANCE_THRESHOLD = 0.35

export interface EventBlogSearchResult {
  eventsSearched: number
  mentionsInserted: number
  errors: number
}

/**
 * Parse venue_address into AddressComponents for relevance scoring.
 * Returns empty components if no address is available.
 */
function parseVenueAddress(venueAddress: string | null): AddressComponents {
  if (!venueAddress) {
    return { city: '', district: '', dong: null, road: null }
  }

  const parts = venueAddress.split(/\s+/)
  let city = ''
  let district = ''
  let dong: string | null = null
  let road: string | null = null

  for (const part of parts) {
    if (/^(서울|경기|인천)/.test(part)) {
      city = part.replace(/특별시|광역시|시$/, '')
    } else if (/구$|시$|군$/.test(part) && !city) {
      // If city wasn't found but we see a district
      district = part
    } else if (/구$/.test(part)) {
      district = part
    } else if (/[동읍면리]$/.test(part) && part.length >= 2) {
      dong = part
    } else if (/[로길대]$/.test(part) || /로\d|길\d/.test(part)) {
      road = part.replace(/\d+$/, '')
    }
  }

  return { city, district, dong, road }
}

export async function runEventBlogSearch(): Promise<EventBlogSearchResult> {
  const result: EventBlogSearchResult = {
    eventsSearched: 0,
    mentionsInserted: 0,
    errors: 0,
  }

  const today = new Date().toISOString().split('T')[0]
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch active events that need blog search
  const { data: events, error: fetchError } = await supabaseAdmin
    .from('events')
    .select('id, name, venue_name, venue_address')
    .eq('is_hidden', false)
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.gte.${today},end_date.is.null`)
    .or(`last_mentioned_at.is.null,last_mentioned_at.lt.${threeDaysAgo}`)
    .order('last_mentioned_at', { ascending: true, nullsFirst: true })
    .limit(200)

  if (fetchError) {
    console.error('[event-blog-search] Failed to fetch events:', fetchError)
    result.errors++
    return result
  }

  if (!events || events.length === 0) {
    console.log('[event-blog-search] No events need blog search')
    return result
  }

  console.log(`[event-blog-search] Searching blogs for ${events.length} events`)

  // Pre-fetch existing URLs for dedup
  const { data: existingUrls } = await supabaseAdmin
    .from('blog_mentions')
    .select('url')
    .not('event_id', 'is', null)

  const existingUrlSet = new Set((existingUrls ?? []).map((r) => r.url))

  const currentYear = new Date().getFullYear()

  for (const event of events) {
    try {
      const addr = parseVenueAddress(event.venue_address)
      let totalInserted = 0
      let maxDate: string | null = null

      // 1st query: "이벤트명" + current year
      const query1 = encodeURIComponent(`"${event.name}" ${currentYear}`)
      const items1 = await fetchNaverSearch<NaverBlogItem>(
        `${NAVER_BLOG_URL}?query=${query1}&display=${DISPLAY_COUNT}&sort=sim`
      )

      if (items1) {
        const { count, latestDate } = await insertRelevantMentions(
          event.id, event.name, addr, items1, existingUrlSet
        )
        totalInserted += count
        if (latestDate && (!maxDate || latestDate > maxDate)) maxDate = latestDate
      }

      // 2nd query if venue_name exists and 1st query returned < 3 results
      if (event.venue_name && (items1?.length ?? 0) < 3) {
        const query2 = encodeURIComponent(`"${event.name}" ${event.venue_name}`)
        const items2 = await fetchNaverSearch<NaverBlogItem>(
          `${NAVER_BLOG_URL}?query=${query2}&display=${DISPLAY_COUNT}&sort=sim`
        )

        if (items2) {
          const { count, latestDate } = await insertRelevantMentions(
            event.id, event.name, addr, items2, existingUrlSet
          )
          totalInserted += count
          if (latestDate && (!maxDate || latestDate > maxDate)) maxDate = latestDate
        }
      }

      // Update event mention count via RPC
      if (totalInserted > 0) {
        const { error: rpcError } = await supabaseAdmin.rpc('increment_event_mention_count', {
          p_event_id: event.id,
          p_increment: totalInserted,
          p_last_mentioned_at: maxDate ? new Date(maxDate).toISOString() : new Date().toISOString(),
        })

        if (rpcError) {
          console.error(`[event-blog-search] RPC error for event ${event.id}:`, rpcError)
          result.errors++
        }
      } else {
        // Mark as searched even with 0 results (update last_mentioned_at to avoid re-searching)
        await supabaseAdmin
          .from('events')
          .update({ last_mentioned_at: new Date().toISOString() })
          .eq('id', event.id)
          .is('last_mentioned_at', null)
      }

      result.mentionsInserted += totalInserted
      result.eventsSearched++
    } catch (err) {
      console.error(`[event-blog-search] Error processing event ${event.id}:`, err)
      result.errors++
    }
  }

  console.log(
    `[event-blog-search] Done: ${result.eventsSearched} events, ${result.mentionsInserted} mentions inserted, ${result.errors} errors`
  )
  return result
}

async function insertRelevantMentions(
  eventId: number,
  eventName: string,
  addr: AddressComponents,
  items: NaverBlogItem[],
  existingUrlSet: Set<string>
): Promise<{ count: number; latestDate: string | null }> {
  let count = 0
  let latestDate: string | null = null

  for (const item of items) {
    if (!item.link) continue
    if (existingUrlSet.has(item.link)) continue

    const title = stripHtml(item.title)
    const snippet = stripHtml(item.description).slice(0, 500)
    const relevance = computePostRelevance(eventName, addr, false, title, snippet)

    if (relevance < RELEVANCE_THRESHOLD) continue

    const postDate = parseNaverPostDate(item.postdate)

    const { error } = await supabaseAdmin.from('blog_mentions').insert({
      event_id: eventId,
      source_type: 'naver_blog',
      title,
      url: item.link,
      post_date: postDate,
      snippet,
      relevance_score: relevance,
    })

    if (!error) {
      count++
      existingUrlSet.add(item.link)
      if (postDate && (!latestDate || postDate > latestDate)) latestDate = postDate
    }
  }

  return { count, latestDate }
}
