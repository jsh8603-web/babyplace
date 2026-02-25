'use client'

import { MapPin, RotateCcw, Trash2 } from 'lucide-react'
import type { VisitWithPlace } from '@/types'

interface VisitCardProps {
  visit: VisitWithPlace
  onDelete?: (visitId: number) => void
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  const weekday = weekdays[d.getDay()]
  return `${month}월 ${day}일 (${weekday})`
}

export default function VisitCard({ visit, onDelete }: VisitCardProps) {
  const place = visit.places

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Date */}
          <p className="text-[13px] font-medium text-warm-400 mb-1">
            {formatDate(visit.visited_at)}
          </p>

          {/* Place name */}
          <a
            href={`/place/${place.id}`}
            className="block"
          >
            <h3 className="text-[17px] font-semibold text-warm-700 leading-snug truncate hover:text-coral-500 transition-colors">
              {place.name}
            </h3>
          </a>

          {/* Category + address */}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span
              className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${getCategoryColor(place.category)}`}
            >
              {place.category}
            </span>
            {place.road_address && (
              <span className="flex items-center gap-0.5 text-[12px] text-warm-400">
                <MapPin size={11} />
                <span className="truncate max-w-[140px]">
                  {place.road_address.split(' ').slice(0, 3).join(' ')}
                </span>
              </span>
            )}
          </div>

          {/* Memo */}
          {visit.memo && (
            <p className="text-[14px] text-warm-500 mt-2 leading-relaxed line-clamp-2">
              {visit.memo}
            </p>
          )}

          {/* Will return badge */}
          {visit.will_return && (
            <div className="flex items-center gap-1 mt-2">
              <RotateCcw size={13} className="text-coral-400" />
              <span className="text-[12px] font-medium text-coral-500">
                다시 갈래요
              </span>
            </div>
          )}
        </div>

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.preventDefault()
              onDelete(visit.id)
            }}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center text-warm-300 hover:text-red-400 transition-colors"
            aria-label="삭제"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
