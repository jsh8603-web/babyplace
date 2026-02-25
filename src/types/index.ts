export interface Place {
  id: number
  name: string
  category: string
  sub_category: string | null
  address: string | null
  road_address: string | null
  district_code: string | null
  lat: number
  lng: number
  phone: string | null
  source: string
  source_id: string | null
  kakao_place_id: string | null
  description: string | null
  tags: string[]
  is_indoor: boolean | null
  mention_count: number
  popularity_score: number
  last_mentioned_at: string | null
  source_count: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PlaceCandidate {
  id: number
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  kakao_place_id: string | null
  kakao_similarity: number | null
  source_urls: string[]
  source_count: number
  first_seen_at: string
  last_seen_at: string
}

export interface Event {
  id: number
  name: string
  category: string
  venue_name: string | null
  venue_address: string | null
  lat: number | null
  lng: number | null
  start_date: string
  end_date: string | null
  time_info: string | null
  price_info: string | null
  age_range: string | null
  source: string
  source_id: string
  source_url: string | null
  poster_url: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface BlogMention {
  id: number
  place_id: number
  source_type: 'naver_blog' | 'naver_cafe'
  title: string | null
  url: string
  post_date: string | null
  snippet: string | null
  collected_at: string
}

export interface Profile {
  id: string
  email: string | null
  display_name: string | null
  role: 'user' | 'admin'
  created_at: string
}

export interface Favorite {
  id: number
  user_id: string
  place_id: number | null
  event_id: number | null
  created_at: string
}

export type PlaceCategory =
  | '놀이'
  | '공원/놀이터'
  | '전시/체험'
  | '공연'
  | '동물/자연'
  | '식당/카페'
  | '도서관'
  | '수영/물놀이'
  | '문화행사'
  | '편의시설'

export type FacilityTag =
  | '수유실'
  | '기저귀교환대'
  | '남성화장실교환대'
  | '유모차접근'
  | '아기의자'
  | '주차'
  | '예스키즈존'
  | '엘리베이터'

export type SortOption = 'distance' | 'popularity' | 'recent'

export interface PlacesQueryParams {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
  zoom: number
  category?: PlaceCategory[]
  tags?: FacilityTag[]
  sort?: SortOption
  lat?: number
  lng?: number
  /** Opaque base64url-encoded keyset cursor returned by the API. */
  cursor?: string
  limit?: number
  indoor?: boolean
}

export interface PlacesResponse {
  places: Place[]
  /** Opaque base64url-encoded keyset cursor. Pass as `cursor` param to fetch next page. */
  nextCursor: string | null
}

export interface PlaceDetailResponse {
  place: Place
  topPosts: BlogMention[]
  isFavorited: boolean
}

export interface EmergencyResponse {
  places: (Place & { distance_m: number })[]
}

export interface WeatherResponse {
  isRaining: boolean
  temperature: number
  description: string
}

export interface EventsResponse {
  events: Event[]
  /** Opaque base64url-encoded keyset cursor. Pass as `cursor` param to fetch next page. */
  nextCursor: string | null
}

export interface EventDetailResponse {
  event: Event
  isFavorited: boolean
}

export interface AuditLog {
  id: number
  admin_id: string | null
  action: string
  target_type: string
  target_id: string
  details: Record<string, unknown> | null
  created_at: string
}
