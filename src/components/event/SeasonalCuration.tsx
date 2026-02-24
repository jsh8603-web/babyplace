'use client'

import { useQuery } from '@tanstack/react-query'
import type { Event, EventsResponse } from '@/types'
import EventCard from './EventCard'

interface SeasonalCurationProps {
  onEventClick?: (event: Event) => void
}

function getSeason(): {
  name: string
  months: number[]
  keywords: string[]
  emoji: string
  description: string
} {
  const month = new Date().getMonth() + 1 // 1-12

  if (month >= 3 && month <= 5) {
    return {
      name: '봄',
      months: [3, 4, 5],
      keywords: ['벚꽃', '봄', '생태', '개나리', '튤립'],
      emoji: '🌸',
      description: '이달의 봄 나들이 추천',
    }
  } else if (month >= 6 && month <= 8) {
    return {
      name: '여름',
      months: [6, 7, 8],
      keywords: ['물', '수영', '야외', '축제', '여름'],
      emoji: '☀️',
      description: '이달의 여름 물놀이 추천',
    }
  } else if (month >= 9 && month <= 11) {
    return {
      name: '가을',
      months: [9, 10, 11],
      keywords: ['단풍', '가을', '수확', '체험', '산책'],
      emoji: '🍂',
      description: '이달의 가을 단풍 추천',
    }
  } else {
    return {
      name: '겨울',
      months: [12, 1, 2],
      keywords: ['실내', '전시', '스키', '눈', '겨울'],
      emoji: '❄️',
      description: '이달의 겨울 실내 추천',
    }
  }
}

async function fetchSeasonalEvents(): Promise<EventsResponse> {
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1)

  const params = new URLSearchParams({
    limit: '12',
  })

  const res = await fetch(`/api/events?${params}`)
  if (!res.ok) throw new Error('계절 이벤트를 불러오지 못했습니다.')
  return res.json()
}

export default function SeasonalCuration({ onEventClick }: SeasonalCurationProps) {
  const season = getSeason()

  const { data, isLoading } = useQuery({
    queryKey: ['seasonal-events'],
    queryFn: fetchSeasonalEvents,
    staleTime: 60 * 60_000, // 1 hour
  })

  const events = data?.events ?? []

  // Filter events by current season and upcoming (within next 3 months)
  const seasonalEvents = events.filter((event) => {
    const eventDate = new Date(event.start_date)
    const eventMonth = eventDate.getMonth() + 1

    // Check if event is in current season
    const isInSeason = season.months.includes(eventMonth)

    // Check if it's happening soon (within 3 months from now)
    const now = new Date()
    const threeMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 3, 1)
    const isUpcoming = eventDate <= threeMonthsFromNow

    return isInSeason || isUpcoming
  })

  // Limit to 6 items for display
  const displayedEvents = seasonalEvents.slice(0, 6)

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="px-4 py-3">
          <h3 className="text-[15px] font-bold text-warm-700 mb-1 flex items-center gap-2">
            <span>{season.emoji}</span>
            {season.description}
          </h3>
          <p className="text-[13px] text-warm-500">{season.name} 시즌의 추천 이벤트입니다.</p>
        </div>
        <div className="px-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl h-[180px] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (displayedEvents.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <span className="text-3xl mb-2 block">{season.emoji}</span>
        <p className="text-[15px] font-semibold text-warm-600 mb-1">
          {season.name} 이벤트를 준비 중입니다
        </p>
        <p className="text-[13px] text-warm-400">곧 새로운 이벤트가 등록될 예정입니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="px-4 py-3">
        <h3 className="text-[15px] font-bold text-warm-700 mb-1 flex items-center gap-2">
          <span>{season.emoji}</span>
          {season.description}
        </h3>
        <p className="text-[13px] text-warm-500">{season.name} 시즌의 추천 이벤트입니다.</p>
      </div>

      {/* Event list */}
      <div className="px-4 space-y-3">
        {displayedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onClick={(e) => {
              onEventClick?.(e)
            }}
          />
        ))}
      </div>

      {/* View all link */}
      {seasonalEvents.length > displayedEvents.length && (
        <div className="px-4 pb-3">
          <a
            href="/events"
            className="text-[13px] font-semibold text-coral-500 underline"
          >
            모든 이벤트 보기 ({seasonalEvents.length})
          </a>
        </div>
      )}
    </div>
  )
}
