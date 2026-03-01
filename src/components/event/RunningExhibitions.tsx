'use client'

import { useQuery } from '@tanstack/react-query'
import type { Event, EventsResponse } from '@/types'
import EventCard from './EventCard'

interface RunningExhibitionsProps {
  onEventClick?: (event: Event) => void
}

async function fetchRunningExhibitions(): Promise<EventsResponse> {
  const params = new URLSearchParams({
    status: 'running',
    sub_category: '전시,체험',
    limit: '6',
  })

  const res = await fetch(`/api/events?${params}`)
  if (!res.ok) throw new Error('진행중인 전시/체험을 불러오지 못했습니다.')
  return res.json()
}

export default function RunningExhibitions({ onEventClick }: RunningExhibitionsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['running-exhibitions-experiences'],
    queryFn: fetchRunningExhibitions,
    staleTime: 60 * 60_000, // 1 hour
  })

  const events = data?.events ?? []

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="px-4 py-3">
          <h3 className="text-[15px] font-bold text-warm-700 mb-1">
            진행중인 전시/체험
          </h3>
        </div>
        <div className="px-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl h-[180px] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="px-4 py-3">
        <h3 className="text-[15px] font-bold text-warm-700 mb-1">
          진행중인 전시/체험 {events.length}건
        </h3>
        <p className="text-[13px] text-warm-500">곧 끝나는 순으로 보여드립니다.</p>
      </div>

      {/* Event list */}
      <div className="px-4 space-y-3">
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onClick={(e) => onEventClick?.(e)}
          />
        ))}
      </div>
    </div>
  )
}
