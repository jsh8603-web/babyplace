'use client'

import { Calendar, MapPin, Clock, DollarSign, Users } from 'lucide-react'
import type { Event } from '@/types'

interface EventCardProps {
  event: Event
  onClick?: (event: Event) => void
  isSelected?: boolean
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

export default function EventCard({ event, onClick, isSelected }: EventCardProps) {
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
      {event.poster_url ? (
        <div className="w-full h-[140px] overflow-hidden bg-warm-200">
          <img
            src={event.poster_url}
            alt={event.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="w-full h-[140px] bg-gradient-to-br from-coral-100 to-coral-50 flex items-center justify-center">
          <span className="text-4xl opacity-50">🎪</span>
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {/* Title */}
        <h3 className="text-[16px] font-bold text-warm-700 leading-snug mb-2 line-clamp-2">
          {event.name}
        </h3>

        {/* Category */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span
            className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${getCategoryColor(
              event.category
            )}`}
          >
            {event.category}
          </span>

          {/* Date badge */}
          <span className="flex items-center gap-1 text-[12px] font-medium text-warm-500 bg-warm-50 px-2 py-0.5 rounded-full">
            <Calendar size={12} />
            {formatDateRange(event.start_date, event.end_date)}
          </span>
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
      </div>
    </button>
  )
}
