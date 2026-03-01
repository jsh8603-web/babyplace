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
  /** When set, the map smoothly pans to this location */
  center?: { lat: number; lng: number } | null
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
      }
    }
  }
}

interface KakaoMapInstance {
  getCenter: () => { getLat: () => number; getLng: () => number }
  getBounds: () => KakaoBoundsInstance
  getLevel: () => number
  panTo: (latlng: object) => void
  setLevel: (level: number) => void
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

const KAKAO_SDK_SRC = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + process.env.NEXT_PUBLIC_KAKAO_JS_KEY + '&autoload=false'

/** Load Kakao Maps SDK once. Always calls load() to ensure full initialization. */
let sdkReady: Promise<void> | null = null
function ensureKakaoSDK(): Promise<void> {
  if (sdkReady) return sdkReady
  sdkReady = new Promise<void>((resolve, reject) => {
    const tryLoad = () => {
      if (window.kakao?.maps?.load) {
        window.kakao.maps.load(() => resolve())
      } else {
        reject(new Error('kakao.maps.load not available'))
      }
    }

    if (window.kakao?.maps) {
      tryLoad()
      return
    }

    // Inject script tag
    const script = document.createElement('script')
    script.src = KAKAO_SDK_SRC
    script.async = true
    script.onload = () => tryLoad()
    script.onerror = () => reject(new Error('Kakao Maps SDK failed to load'))
    document.head.appendChild(script)
  })
  return sdkReady
}

export default function KakaoMap({
  places,
  selectedPlaceId,
  onBoundsChanged,
  onPlaceClick,
  initialCenter = { lat: 37.5665, lng: 126.978 },
  initialZoom = 8,
  center,
}: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<KakaoMapInstance | null>(null)
  const overlaysRef = useRef<KakaoOverlayInstance[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mapError, setMapError] = useState(false)
  const [mapReady, setMapReady] = useState(false)

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

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    ensureKakaoSDK()
      .then(() => {
        if (cancelled || !containerRef.current) return

        const map = new window.kakao.maps.Map(containerRef.current, {
          center: new window.kakao.maps.LatLng(initialCenter.lat, initialCenter.lng),
          level: initialZoom,
        })

        mapRef.current = map

        window.kakao.maps.event.addListener(map, 'bounds_changed', handleBoundsChanged)
        window.kakao.maps.event.addListener(map, 'zoom_changed', handleBoundsChanged)

        setMapReady(true)
        handleBoundsChanged()
      })
      .catch(() => {
        if (!cancelled) setMapError(true)
      })

    return () => { cancelled = true }
  }, [initialCenter.lat, initialCenter.lng, initialZoom, handleBoundsChanged])

  // Pan to center when it changes
  useEffect(() => {
    if (!mapReady || !mapRef.current || !center) return
    const map = mapRef.current
    map.panTo(new window.kakao.maps.LatLng(center.lat, center.lng))
    // Zoom in to neighborhood level if currently zoomed out
    if (map.getLevel() > 5) {
      map.setLevel(5)
    }
  }, [mapReady, center?.lat, center?.lng])

  // Render place overlays
  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    // Clean up previous overlays
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []

    const newOverlays: KakaoOverlayInstance[] = []

    places.forEach((place) => {
      const isSelected = place.id === selectedPlaceId
      const bg = isSelected ? '#E84530' : '#FF5C45'
      const size = isSelected ? 36 : 28
      const fontSize = isSelected ? 16 : 12

      const el = document.createElement('div')
      el.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;'
      el.innerHTML =
        '<div style="background:' + bg + ';color:white;border-radius:50%;width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;font-size:' + fontSize + 'px;box-shadow:0 2px 8px rgba(255,92,69,0.4);border:2px solid white;">\uD83D\uDCCD</div>' +
        '<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ' + bg + ';margin-top:-1px;"></div>'
      el.addEventListener('click', () => {
        if (onPlaceClick) onPlaceClick(place)
      })

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(place.lat, place.lng),
        content: el,
        yAnchor: 1,
        zIndex: isSelected ? 10 : 1,
      })

      overlay.setMap(mapRef.current!)
      newOverlays.push(overlay)
    })

    overlaysRef.current = newOverlays
  }, [mapReady, places, selectedPlaceId, onPlaceClick])

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
