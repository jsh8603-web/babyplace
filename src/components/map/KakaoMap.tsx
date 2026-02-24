'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import type { Place } from '@/types'

interface KakaoMapProps {
  places: Place[]
  selectedPlaceId?: number | null
  onBoundsChanged?: (params: {
    swLat: number
    swLng: number
    neLat: number
    neLng: number
    zoom: number
  }) => void
  onPlaceClick?: (place: Place) => void
  initialCenter?: { lat: number; lng: number }
  initialZoom?: number
}

declare global {
  interface Window {
    kakao: {
      maps: {
        load: (callback: () => void) => void
        Map: new (container: HTMLElement, options: object) => KakaoMapInstance
        LatLng: new (lat: number, lng: number) => object
        LatLngBounds: new () => KakaoBoundsInstance
        Marker: new (options: object) => KakaoMarkerInstance
        CustomOverlay: new (options: object) => KakaoOverlayInstance
        event: {
          addListener: (target: object, type: string, handler: () => void) => void
        }
        clusterer: {
          MarkerClusterer: new (options: object) => KakaoClustererInstance
        }
      }
    }
  }
}

interface KakaoMapInstance {
  getCenter: () => { getLat: () => number; getLng: () => number }
  getBounds: () => KakaoBoundsInstance
  getLevel: () => number
}

interface KakaoBoundsInstance {
  getSouthWest: () => { getLat: () => number; getLng: () => number }
  getNorthEast: () => { getLat: () => number; getLng: () => number }
}

interface KakaoMarkerInstance {
  setMap: (map: KakaoMapInstance | null) => void
}

interface KakaoOverlayInstance {
  setMap: (map: KakaoMapInstance | null) => void
}

interface KakaoClustererInstance {
  clear: () => void
  addMarkers: (markers: KakaoMarkerInstance[]) => void
}

const CLUSTER_STYLES = [
  {
    width: '40px',
    height: '40px',
    background: 'rgba(255, 92, 69, 0.85)',
    borderRadius: '20px',
    color: 'white',
    textAlign: 'center',
    lineHeight: '40px',
    fontSize: '14px',
    fontWeight: '600',
  },
  {
    width: '50px',
    height: '50px',
    background: 'rgba(232, 69, 48, 0.9)',
    borderRadius: '25px',
    color: 'white',
    textAlign: 'center',
    lineHeight: '50px',
    fontSize: '15px',
    fontWeight: '700',
  },
]

export default function KakaoMap({
  places,
  selectedPlaceId,
  onBoundsChanged,
  onPlaceClick,
  initialCenter = { lat: 37.5665, lng: 126.978 },
  initialZoom = 13,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<KakaoMapInstance | null>(null)
  const clustererRef = useRef<KakaoClustererInstance | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markersRef = useRef<KakaoMarkerInstance[]>([])
  const [mapError, setMapError] = useState(false)

  const handleBoundsChanged = useCallback(() => {
    if (!mapRef.current || !onBoundsChanged) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      const bounds = map.getBounds()
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      onBoundsChanged({
        swLat: sw.getLat(),
        swLng: sw.getLng(),
        neLat: ne.getLat(),
        neLng: ne.getLng(),
        zoom: map.getLevel(),
      })
    }, 300)
  }, [onBoundsChanged])

  useEffect(() => {
    if (!containerRef.current) return

    const initMap = () => {
      window.kakao.maps.load(() => {
        if (!containerRef.current) return

        const map = new window.kakao.maps.Map(containerRef.current, {
          center: new window.kakao.maps.LatLng(initialCenter.lat, initialCenter.lng),
          level: initialZoom,
        })

        mapRef.current = map

        const clusterer = new window.kakao.maps.clusterer.MarkerClusterer({
          map,
          gridSize: 60,
          minClusterSize: 3,
          averageCenter: true,
          minLevel: 5,
          styles: CLUSTER_STYLES,
        })

        clustererRef.current = clusterer

        window.kakao.maps.event.addListener(map, 'bounds_changed', handleBoundsChanged)
        window.kakao.maps.event.addListener(map, 'zoom_changed', handleBoundsChanged)

        handleBoundsChanged()
      })
    }

    if (window.kakao && window.kakao.maps) {
      initMap()
    } else {
      let retries = 0
      const maxRetries = 100
      const interval = setInterval(() => {
        if (window.kakao && window.kakao.maps) {
          clearInterval(interval)
          initMap()
        } else if (retries++ >= maxRetries) {
          clearInterval(interval)
          setMapError(true)
        }
      }, 100)
      return () => clearInterval(interval)
    }
  }, [initialCenter.lat, initialCenter.lng, initialZoom, handleBoundsChanged])

  useEffect(() => {
    if (!mapRef.current || !clustererRef.current) return

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    clustererRef.current.clear()

    const newMarkers = places.map((place) => {
      const isSelected = place.id === selectedPlaceId

      const content = `
        <div style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        ">
          <div style="
            background: ${isSelected ? '#E84530' : '#FF5C45'};
            color: white;
            border-radius: 50%;
            width: ${isSelected ? '36px' : '28px'};
            height: ${isSelected ? '36px' : '28px'};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${isSelected ? '16px' : '12px'};
            box-shadow: 0 2px 8px rgba(255,92,69,0.4);
            border: 2px solid white;
            transition: all 0.2s;
          ">📍</div>
          <div style="
            width: 0; height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid ${isSelected ? '#E84530' : '#FF5C45'};
            margin-top: -1px;
          "></div>
        </div>
      `

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(place.lat, place.lng),
        content,
        yAnchor: 1,
        zIndex: isSelected ? 10 : 1,
      })

      overlay.setMap(mapRef.current!)

      const marker = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(place.lat, place.lng),
        image: undefined,
      })

      window.kakao.maps.event.addListener(overlay as unknown as object, 'click', () => {
        if (onPlaceClick) onPlaceClick(place)
      })

      return marker
    })

    markersRef.current = newMarkers
    clustererRef.current.addMarkers(newMarkers)
  }, [places, selectedPlaceId, onPlaceClick])

  if (mapError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-warm-50 gap-3">
        <p className="text-[14px] text-warm-500 font-medium">지도를 불러오지 못했습니다.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-[13px] bg-coral-500 text-white rounded-lg active:bg-coral-600"
        >
          새로고침
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      aria-label="장소 지도"
    />
  )
}
