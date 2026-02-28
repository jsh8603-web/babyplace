import { MapPin, Navigation } from 'lucide-react'
import type { Place } from '@/types'
import FacilityIcons from './FacilityIcons'
import PopularityBar from './PopularityBar'

interface PlaceCardProps {
  place: Place
  distance?: number
  onClick?: (place: Place) => void
  isSelected?: boolean
  label?: string
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    '놀이': 'bg-coral-100 text-coral-600',
    '공원/놀이터': 'bg-green-100 text-green-700',
    '전시/체험': 'bg-blue-100 text-blue-700',
    '공연': 'bg-purple-100 text-purple-700',
    '동물/자연': 'bg-amber-100 text-amber-700',
    '식당/카페': 'bg-orange-100 text-orange-700',
    '도서관': 'bg-teal-100 text-teal-700',
    '수영/물놀이': 'bg-sky-100 text-sky-700',
    '문화행사': 'bg-pink-100 text-pink-700',
    '편의시설': 'bg-warm-100 text-warm-600',
  }
  return colors[category] ?? 'bg-warm-100 text-warm-600'
}

export default function PlaceCard({ place, distance, onClick, isSelected, label }: PlaceCardProps) {
  return (
    <button
      onClick={() => onClick?.(place)}
      className={`
        w-full text-left bg-white rounded-xl p-4 shadow-sm
        transition-all duration-150 active:scale-[0.98]
        ${isSelected
          ? 'ring-2 ring-coral-400 shadow-md'
          : 'hover:shadow-md'
        }
      `}
      aria-label={`${place.name} 카드, ${place.category}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[17px] font-semibold text-warm-700 leading-snug truncate">
              {place.name}
            </h3>
            {label && (
              <span className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded bg-coral-500 text-white">
                {label}
              </span>
            )}
            {place.is_indoor !== null && (
              <span
                className={`
                  shrink-0 text-[11px] font-medium px-1.5 py-0.5 rounded
                  ${place.is_indoor
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-green-50 text-green-600'
                  }
                `}
              >
                {place.is_indoor ? '실내' : '실외'}
              </span>
            )}
          </div>

          {/* Category + address */}
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span
              className={`text-[13px] font-medium px-2 py-0.5 rounded-full ${getCategoryColor(place.category)}`}
            >
              {place.category}
            </span>
            {place.road_address && (
              <span className="flex items-center gap-0.5 text-[13px] text-warm-400">
                <MapPin size={12} />
                <span className="truncate max-w-[140px]">
                  {place.road_address.split(' ').slice(0, 3).join(' ')}
                </span>
              </span>
            )}
          </div>

          {/* Facility icons */}
          {place.tags && place.tags.length > 0 && (
            <div className="mb-2">
              <FacilityIcons tags={place.tags} size="sm" />
            </div>
          )}

          {/* Popularity bar */}
          {place.popularity_score > 0 && (
            <PopularityBar
              score={place.popularity_score}
              mentionCount={place.mention_count}
              showLabel={true}
            />
          )}
        </div>

        {/* Distance */}
        {distance !== undefined && (
          <div className="flex flex-col items-end shrink-0">
            <div className="flex items-center gap-1 text-[13px] font-semibold text-warm-600">
              <Navigation size={12} className="text-coral-400" />
              {formatDistance(distance)}
            </div>
          </div>
        )}
      </div>
    </button>
  )
}
