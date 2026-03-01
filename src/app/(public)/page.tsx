'use client'

import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { Filter, MapPin } from 'lucide-react'
import type {
  Place,
  PlaceCategory,
  FacilityTag,
  SortOption,
  PlacesResponse,
  WeatherResponse,
  EmergencyResponse,
  Event,
} from '@/types'
import BottomSheet from '@/components/BottomSheet'
import PlaceCard from '@/components/place/PlaceCard'
import EventCard from '@/components/event/EventCard'
import SeasonalCuration from '@/components/event/SeasonalCuration'
import CategoryChips from '@/components/CategoryChips'
import FilterPanel from '@/components/FilterPanel'
import EmergencyOverlay, { EmergencyFAB } from '@/components/EmergencyOverlay'
import WeatherBadge from '@/components/WeatherBadge'
import SearchBar from '@/components/SearchBar'
import BottomNav from '@/components/BottomNav'

// KakaoMap must be loaded client-side only (requires window.kakao)
const KakaoMap = dynamic(() => import('@/components/map/KakaoMap'), { ssr: false })

interface MapBounds {
  swLat: number
  swLng: number
  neLat: number
  neLng: number
  zoom: number
}

interface FilterState {
  categories: PlaceCategory[]
  tags: FacilityTag[]
  sort: SortOption
}

type SnapPoint = number | string

const DEFAULT_SNAP: SnapPoint = 0.12
const LIST_SNAP: SnapPoint = 0.5

async function fetchPlaces(
  bounds: MapBounds,
  filters: FilterState,
  userLat?: number,
  userLng?: number,
  indoor?: boolean,
  query?: string,
): Promise<PlacesResponse> {
  const params = new URLSearchParams({
    swLat: String(bounds.swLat),
    swLng: String(bounds.swLng),
    neLat: String(bounds.neLat),
    neLng: String(bounds.neLng),
    zoom: String(bounds.zoom),
    sort: filters.sort,
  })
  if (filters.categories.length > 0) params.set('category', filters.categories.join(','))
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (userLat !== undefined) params.set('lat', String(userLat))
  if (userLng !== undefined) params.set('lng', String(userLng))
  if (indoor !== undefined) params.set('indoor', String(indoor))
  if (query) params.set('query', query)

  const res = await fetch(`/api/places?${params}`)
  if (!res.ok) throw new Error('장소 데이터를 불러오지 못했습니다.')
  return res.json()
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherResponse> {
  const res = await fetch(`/api/weather?lat=${lat}&lng=${lng}`)
  if (!res.ok) throw new Error('날씨 정보를 불러오지 못했습니다.')
  return res.json()
}

async function fetchEmergency(lat: number, lng: number): Promise<EmergencyResponse> {
  const res = await fetch(`/api/places/emergency?lat=${lat}&lng=${lng}&type=nursing_room`)
  if (!res.ok) throw new Error('수유실 정보를 불러오지 못했습니다.')
  return res.json()
}

export default function HomePage() {
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false)
  const [isIndoorFilter, setIsIndoorFilter] = useState(false)
  const [activeTab, setActiveTab] = useState<'places' | 'events'>('places')
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    tags: [],
    sort: 'distance',
  })
  const [snapPoint, setSnapPoint] = useState<SnapPoint>(DEFAULT_SNAP)
  const listScrollRef = useRef<HTMLDivElement>(null)

  // Fetch places when map bounds change
  const {
    data: placesData,
    isLoading: isPlacesLoading,
  } = useQuery({
    queryKey: ['places', mapBounds, filters, userLocation?.lat, userLocation?.lng, isIndoorFilter, searchQuery],
    queryFn: () =>
      mapBounds
        ? fetchPlaces(
            mapBounds,
            filters,
            userLocation?.lat,
            userLocation?.lng,
            isIndoorFilter || undefined,
            searchQuery.trim() || undefined,
          )
        : Promise.resolve({ places: [], nextCursor: null }),
    enabled: !!mapBounds,
    staleTime: 30_000,
  })

  // Fetch weather
  const { data: weatherData, isLoading: isWeatherLoading } = useQuery({
    queryKey: ['weather', userLocation?.lat, userLocation?.lng],
    queryFn: () =>
      userLocation ? fetchWeather(userLocation.lat, userLocation.lng) : null,
    enabled: !!userLocation,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  })

  // Fetch emergency places when overlay opens
  const {
    data: emergencyData,
    isLoading: isEmergencyLoading,
    error: emergencyError,
  } = useQuery({
    queryKey: ['emergency', userLocation?.lat, userLocation?.lng],
    queryFn: () =>
      userLocation
        ? fetchEmergency(userLocation.lat, userLocation.lng)
        : Promise.resolve({ places: [] }),
    enabled: isEmergencyOpen && !!userLocation,
    staleTime: 60_000,
  })

  const places = placesData?.places ?? []

  // When a place is selected, sort remaining places by distance from it
  // and only show places within 2km radius
  const filteredPlaces = selectedPlace
    ? places
        .filter((p) => p.id !== selectedPlace.id)
        .map((p) => ({
          ...p,
          _distFromSelected: haversineMeters(selectedPlace.lat, selectedPlace.lng, p.lat, p.lng),
        }))
        .filter((p) => p._distFromSelected <= 2000) // 2km radius
        .sort((a, b) => a._distFromSelected - b._distFromSelected)
    : places

  const handleBoundsChanged = useCallback((bounds: MapBounds) => {
    setMapBounds(bounds)
  }, [])

  const handlePlaceClick = useCallback((place: Place) => {
    setSelectedPlace(place)
    setSnapPoint(LIST_SNAP)
    // Scroll list to top on map marker click
    listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const handleGetLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setUserLocation(loc)
        setMapCenter(loc)
        setSelectedPlace(null)
      },
      () => {
        // Fallback: Seoul city hall
        const loc = { lat: 37.5665, lng: 126.978 }
        setUserLocation(loc)
        setMapCenter(loc)
      },
      { enableHighAccuracy: true, timeout: 5000 },
    )
  }

  const handleEmergencyOpen = () => {
    if (!userLocation) {
      handleGetLocation()
    }
    setIsEmergencyOpen(true)
  }

  const totalActiveFilters = filters.categories.length + filters.tags.length

  return (
    <main className="h-dvh flex flex-col relative overflow-hidden bg-warm-50">
      {/* Map fills entire viewport — z-0 creates stacking context to contain SDK z-indices */}
      <div className="absolute inset-0 z-0">
        <KakaoMap
          places={places}
          selectedPlaceId={selectedPlace?.id}
          onBoundsChanged={handleBoundsChanged}
          onPlaceClick={handlePlaceClick}
          center={mapCenter}
        />
      </div>

      {/* Top bar — search + weather + filter */}
      <div className="relative z-20 px-4 pt-safe-top pt-3 pb-2 flex items-center gap-2">
        {/* Location button */}
        <button
          onClick={handleGetLocation}
          className="
            shrink-0 min-w-[40px] min-h-[40px] flex items-center justify-center
            bg-white rounded-xl shadow-sm border border-warm-200
            text-warm-600 active:bg-warm-50 transition-colors
          "
          aria-label="현재 위치 가져오기"
        >
          <MapPin size={18} className="text-coral-500" />
        </button>

        {/* Search */}
        <div className="flex-1">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={setSearchQuery}
          />
        </div>

        {/* Weather */}
        {(weatherData ?? isWeatherLoading) && (
          <WeatherBadge
            weather={weatherData ?? null}
            isLoading={isWeatherLoading}
            isIndoorFilterActive={isIndoorFilter}
            onIndoorFilterToggle={(indoor) => {
              setIsIndoorFilter(indoor)
            }}
          />
        )}

        {/* Filter button */}
        <button
          onClick={() => setIsFilterOpen(true)}
          className="
            shrink-0 min-w-[48px] min-h-[48px] flex items-center justify-center
            bg-white rounded-xl shadow-sm border border-warm-200
            text-warm-600 active:bg-warm-50 transition-colors relative
          "
          aria-label={`필터 열기${totalActiveFilters > 0 ? ` (${totalActiveFilters}개 적용됨)` : ''}`}
        >
          <Filter size={18} />
          {totalActiveFilters > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-coral-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {totalActiveFilters}
            </span>
          )}
        </button>
      </div>

      {/* Category chips row */}
      <div className="relative z-20 py-1">
        <CategoryChips
          selected={filters.categories}
          onChange={(cats) => setFilters((f) => ({ ...f, categories: cats }))}
        />
      </div>

      {/* Emergency FAB — bottom right above bottom sheet */}
      <div className="absolute bottom-[200px] right-4 z-20">
        <EmergencyFAB onClick={handleEmergencyOpen} />
      </div>

      {/* Bottom Sheet with tabs */}
      <BottomSheet
        open={true}
        onOpenChange={() => {}}
        snapPoints={[0.12, 0.5, 0.9]}
        activeSnapPoint={snapPoint}
        setActiveSnapPoint={(snap) => {
          if (snap !== null) setSnapPoint(snap)
        }}
        title="장소 및 이벤트"
      >
        {/* Tab buttons */}
        <div className="flex gap-1 px-4 py-2 shrink-0 border-b border-warm-200">
          <button
            onClick={() => {
              setActiveTab('places')
              setSnapPoint(LIST_SNAP)
            }}
            className={`
              px-4 py-2 text-[14px] font-semibold rounded-t-lg transition-colors
              ${
                activeTab === 'places'
                  ? 'text-coral-600 border-b-2 border-coral-500 bg-coral-50'
                  : 'text-warm-500 hover:text-warm-600'
              }
            `}
          >
            장소
          </button>
          <button
            onClick={() => {
              setActiveTab('events')
              setSnapPoint(LIST_SNAP)
            }}
            className={`
              px-4 py-2 text-[14px] font-semibold rounded-t-lg transition-colors
              ${
                activeTab === 'events'
                  ? 'text-coral-600 border-b-2 border-coral-500 bg-coral-50'
                  : 'text-warm-500 hover:text-warm-600'
              }
            `}
          >
            이벤트
          </button>
        </div>

        {/* Places tab */}
        {activeTab === 'places' && (
          <>
            {/* Summary row */}
            <div className="px-4 py-2 flex items-center justify-between shrink-0">
              <span className="text-[13px] font-semibold text-warm-600">
                {isPlacesLoading
                  ? '장소 불러오는 중...'
                  : selectedPlace
                    ? `${selectedPlace.name} 주변 ${filteredPlaces.length}개 장소`
                    : `주변 ${filteredPlaces.length.toLocaleString()}개 장소`}
              </span>
              {selectedPlace && (
                <button
                  onClick={() => setSelectedPlace(null)}
                  className="text-[12px] text-coral-500 font-medium min-h-[36px] px-2"
                >
                  전체보기
                </button>
              )}
              <button
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    sort: f.sort === 'distance' ? 'popularity' : 'distance',
                  }))
                }
                className="text-[12px] text-warm-400 underline min-h-[36px] px-2"
              >
                {filters.sort === 'distance'
                  ? '거리순'
                  : filters.sort === 'popularity'
                    ? '인기순'
                    : '최신순'}
              </button>
            </div>

            {/* Place list */}
            <div
              ref={listScrollRef}
              className="flex-1 overflow-y-auto px-4 pb-[80px] space-y-2"
            >
              {isPlacesLoading ? (
                // Skeleton placeholders
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl p-4 animate-pulse space-y-2">
                    <div className="h-5 bg-warm-200 rounded w-2/3" />
                    <div className="h-4 bg-warm-100 rounded w-1/2" />
                    <div className="h-3 bg-warm-100 rounded w-full" />
                  </div>
                ))
              ) : filteredPlaces.length === 0 && !selectedPlace ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MapPin size={32} className="text-warm-300 mb-3" />
                  <p className="text-[15px] text-warm-500 font-medium">
                    {searchQuery
                      ? '검색 결과가 없습니다.'
                      : '이 지역에 등록된 장소가 없습니다.'}
                  </p>
                  <p className="text-[13px] text-warm-400 mt-1">
                    지도를 이동하거나 필터를 변경해보세요.
                  </p>
                </div>
              ) : (
                <>
                  {/* Selected place pinned at top */}
                  {selectedPlace && (
                    <PlaceCard
                      key={`selected-${selectedPlace.id}`}
                      place={selectedPlace}
                      isSelected={true}
                      label="현재장소"
                      onClick={(p) => {
                        window.location.href = `/place/${p.id}`
                      }}
                    />
                  )}
                  {/* Nearby or all places */}
                  {filteredPlaces.map((place) => (
                    <PlaceCard
                      key={place.id}
                      place={place}
                      distance={'_distFromSelected' in place ? (place as Place & { _distFromSelected: number })._distFromSelected : undefined}
                      onClick={(p) => {
                        setSelectedPlace(p)
                        window.location.href = `/place/${p.id}`
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          </>
        )}

        {/* Events tab */}
        {activeTab === 'events' && (
          <div className="flex-1 overflow-y-auto pb-[80px]">
            <SeasonalCuration
              onEventClick={(event: Event) => {
                window.location.href = `/event/${event.id}`
              }}
            />
          </div>
        )}
      </BottomSheet>

      {/* Filter panel */}
      <FilterPanel
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Emergency overlay */}
      <EmergencyOverlay
        isOpen={isEmergencyOpen}
        onClose={() => setIsEmergencyOpen(false)}
        places={emergencyData?.places ?? []}
        isLoading={isEmergencyLoading}
        errorMessage={emergencyError ? '수유실 정보를 불러올 수 없습니다.' : undefined}
      />

      {/* Bottom navigation */}
      <BottomNav />
    </main>
  )
}

/** Haversine distance in meters */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
