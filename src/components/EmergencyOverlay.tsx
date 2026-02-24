'use client'

import { X, Navigation, Baby } from 'lucide-react'
import type { Place } from '@/types'

interface EmergencyPlace extends Place {
  distance_m: number
}

interface EmergencyOverlayProps {
  isOpen: boolean
  onClose: () => void
  places: EmergencyPlace[]
  isLoading?: boolean
  errorMessage?: string
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

function getKakaoNavUrl(place: Place): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`
}

function EmergencyPlaceItem({
  place,
  rank,
}: {
  place: EmergencyPlace
  rank: number
}) {
  return (
    <div className="bg-white rounded-xl p-4 flex items-center gap-3 shadow-sm">
      <div className="w-8 h-8 rounded-full bg-coral-100 flex items-center justify-center shrink-0">
        <span className="text-[13px] font-bold text-coral-600">{rank}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-semibold text-warm-800 truncate">
          {place.name}
        </p>
        <p className="text-[13px] text-warm-500 truncate">
          {place.road_address ?? place.address ?? ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[13px] font-bold text-coral-500">
          {formatDistance(place.distance_m)}
        </span>
        <a
          href={getKakaoNavUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          className="
            flex items-center gap-1 text-[12px] font-semibold
            bg-coral-500 text-white px-2.5 py-1.5 rounded-lg
            min-h-[36px] active:bg-coral-600 transition-colors
          "
          aria-label={`${place.name} 길찾기`}
        >
          <Navigation size={12} />
          길찾기
        </a>
      </div>
    </div>
  )
}

export default function EmergencyOverlay({
  isOpen,
  onClose,
  places,
  isLoading,
  errorMessage,
}: EmergencyOverlayProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="비상 모드: 가장 가까운 수유실"
    >
      {/* Background */}
      <div className="absolute inset-0 bg-coral-600" />

      {/* Content */}
      <div className="relative flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-safe-top pt-12 pb-4">
          <div className="flex items-center gap-2">
            <Baby size={28} className="text-white" />
            <div>
              <h1 className="text-[20px] font-bold text-white leading-tight">
                가장 가까운 수유실
              </h1>
              <p className="text-[13px] text-coral-100">
                현재 위치 기준 최근접 5곳
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="
              min-w-[48px] min-h-[48px] flex items-center justify-center
              text-white bg-coral-700 rounded-full
            "
            aria-label="비상 모드 닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* Places list */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
          {isLoading && (
            <div className="space-y-3 pt-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl p-4 animate-pulse"
                >
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-warm-200 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-warm-200 rounded w-3/4" />
                      <div className="h-3 bg-warm-100 rounded w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && errorMessage && (
            <div className="bg-white rounded-xl p-6 text-center">
              <p className="text-warm-500 text-[15px]">{errorMessage}</p>
            </div>
          )}

          {!isLoading && !errorMessage && places.length === 0 && (
            <div className="bg-white rounded-xl p-6 text-center">
              <Baby size={32} className="text-warm-300 mx-auto mb-2" />
              <p className="text-warm-500 text-[15px]">
                근처에 수유실 정보가 없습니다.
              </p>
              <p className="text-warm-400 text-[13px] mt-1">
                백화점이나 대형마트를 이용해보세요.
              </p>
            </div>
          )}

          {!isLoading && places.map((place, idx) => (
            <EmergencyPlaceItem
              key={place.id}
              place={place}
              rank={idx + 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** EmergencyFAB — the floating action button that triggers emergency mode */
interface EmergencyFABProps {
  onClick: () => void
}

export function EmergencyFAB({ onClick }: EmergencyFABProps) {
  return (
    <button
      onClick={onClick}
      className="
        flex items-center gap-2
        bg-coral-600 text-white
        px-4 py-3 rounded-2xl
        shadow-lg min-h-[48px]
        font-semibold text-[14px]
        active:bg-coral-700 transition-all
        active:scale-95
      "
      aria-label="수유실 비상 찾기"
    >
      <Baby size={20} />
      <span>🍼 급해요!</span>
    </button>
  )
}
