'use client'

import { useState } from 'react'
import { Calendar, MapPin, Clock, DollarSign, Users, EyeOff } from 'lucide-react'
import type { Event } from '@/types'
import PopularityBar from '@/components/place/PopularityBar'

interface EventCardProps {
  event: Event
  onClick?: (event: Event) => void
  onHide?: (event: Event) => void
  isSelected?: boolean
  distance?: number | null // meters from reference point
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = new Date(startDate)
  const startStr = `${start.getMonth() + 1}.${start.getDate()}`

  if (!endDate) return startStr

  const end = new Date(endDate)
  const endStr = `${end.getMonth() + 1}.${end.getDate()}`

  // Same day or consecutive days
  if (startStr === endStr) return startStr
  if (start.getFullYear() === end.getFullYear()) {
    return `${startStr} ~ ${endStr}`
  }
  return `${start.getFullYear()}.${startStr} ~ ${end.getFullYear()}.${endStr}`
}

function formatTimeInfo(timeInfo: string | null): string {
  if (!timeInfo) return '시간 정보 없음'
  return timeInfo
}

function isRunning(startDate: string, endDate: string | null): boolean {
  const today = new Date().toISOString().split('T')[0]
  return startDate <= today && (endDate === null || endDate >= today)
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    '전시': 'bg-purple-100 text-purple-700',
    '공연': 'bg-pink-100 text-pink-700',
    '체험': 'bg-blue-100 text-blue-700',
    '축제': 'bg-coral-100 text-coral-700',
    '교육': 'bg-amber-100 text-amber-700',
    '기타': 'bg-warm-100 text-warm-600',
  }
  return colors[category] ?? 'bg-warm-100 text-warm-600'
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

export default function EventCard({ event, onClick, onHide, isSelected, distance }: EventCardProps) {
  const [imgError, setImgError] = useState(false)
  const hasLocation = event.venue_address || (event.lat !== null && event.lng !== null)
  const hasPriceInfo = event.price_info && event.price_info.trim() !== ''
  const hasAgeRange = event.age_range && event.age_range.trim() !== ''
  const hasTimeInfo = event.time_info && event.time_info.trim() !== ''

  return (
    <button
      onClick={() => onClick?.(event)}
      className={`
        w-full text-left bg-white rounded-xl overflow-hidden shadow-sm
        transition-all duration-150 active:scale-[0.98]
        ${isSelected ? 'ring-2 ring-coral-400 shadow-md' : 'hover:shadow-md'}
      `}
      aria-label={`${event.name} 이벤트, ${event.category}`}
    >
      {/* Poster image or placeholder */}
      {event.poster_url && !imgError ? (
        <div className="w-full max-h-[750px] overflow-hidden bg-warm-100 flex items-center justify-center">
          <img
            src={event.poster_url}
            alt={event.name}
            className="w-full h-full object-contain max-h-[750px]"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div className="w-full h-[200px] bg-gradient-to-br from-coral-100 to-coral-50 flex items-center justify-center">
          <span className="text-4xl opacity-50">🎪</span>
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {/* Title */}
        <h3 className="text-[16px] font-bold text-warm-700 leading-snug mb-2 line-clamp-2">
          {event.name}
        </h3>

        {/* Category + status + distance badges */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span
            className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${getCategoryColor(
              event.sub_category || event.category
            )}`}
          >
            {event.sub_category || event.category}
          </span>

          {/* Running badge */}
          {event.start_date && isRunning(event.start_date, event.end_date) && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              진행중
            </span>
          )}

          {/* Date badge */}
          {event.start_date && event.date_confirmed !== false ? (
            <span className="flex items-center gap-1 text-[12px] font-medium text-warm-500 bg-warm-50 px-2 py-0.5 rounded-full">
              <Calendar size={12} />
              {formatDateRange(event.start_date, event.end_date)}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              일정 미확인
            </span>
          )}

          {/* Distance badge */}
          {distance != null && (
            <span className="flex items-center gap-1 text-[12px] font-medium text-coral-500 bg-coral-50 px-2 py-0.5 rounded-full ml-auto">
              <MapPin size={12} />
              {formatDistance(distance)}
            </span>
          )}
        </div>

        {/* Meta info (time, location, price, age) */}
        <div className="space-y-1 text-[13px] text-warm-600">
          {hasTimeInfo && (
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-warm-400 shrink-0" />
              <span className="truncate">{formatTimeInfo(event.time_info)}</span>
            </div>
          )}

          {hasLocation && (
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-warm-400 shrink-0" />
              <span className="truncate">
                {event.venue_address
                  ? event.venue_address.split(' ').slice(0, 3).join(' ')
                  : '위치 정보 미확인'}
              </span>
            </div>
          )}

          {hasPriceInfo && (
            <div className="flex items-center gap-2">
              <DollarSign size={14} className="text-warm-400 shrink-0" />
              <span className="truncate">{event.price_info}</span>
            </div>
          )}

          {hasAgeRange && (
            <div className="flex items-center gap-2">
              <Users size={14} className="text-warm-400 shrink-0" />
              <span className="truncate">{event.age_range}</span>
            </div>
          )}
        </div>

        {/* Popularity bar + hide button */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1">
            {event.popularity_score > 0 && (
              <PopularityBar
                score={event.popularity_score}
                mentionCount={event.mention_count}
                showLabel={true}
              />
            )}
          </div>
          {onHide && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onHide(event)
              }}
              className="p-1.5 rounded-lg text-warm-300 hover:text-warm-500 hover:bg-warm-100 transition-colors shrink-0"
              aria-label="숨기기"
            >
              <EyeOff size={16} />
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
