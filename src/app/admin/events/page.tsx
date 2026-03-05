'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Image, ImageOff, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Event } from '@/types'

const SOURCE_LABELS: Record<string, string> = {
  tour_api: 'Tour API',
  seoul_events: '서울시',
  interpark: '인터파크',
  babygo: '베이비고',
  blog_discovery: '블로그',
  exhibition_extraction: '전시추출',
}

export default function AdminEventsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sourceFilter, setSourceFilter] = useState('')
  const [posterFilter, setPosterFilter] = useState<'' | 'with' | 'without' | 'hidden'>('')
  const limit = 20

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'events', search, page, sourceFilter, posterFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) params.append('search', search)
      if (sourceFilter) params.append('source', sourceFilter)
      if (posterFilter) params.append('poster', posterFilter)
      const res = await fetch(`/api/admin/events?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ events: Event[]; total: number }>
    },
  })

  const togglePosterMutation = useMutation({
    mutationFn: async ({ id, poster_hidden }: { id: number; poster_hidden: boolean }) => {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, poster_hidden }),
      })
      if (!res.ok) throw new Error('Failed to update')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'events'] })
    },
  })

  const events = data?.events ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Image size={24} className="text-coral-500" />
        <h1 className="text-3xl font-bold text-warm-800">Events & Posters</h1>
        <span className="text-warm-400 text-sm ml-2">({total})</span>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-warm-200 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="이벤트명, 장소 검색..."
            className="w-full pl-9 pr-3 py-2 rounded border border-warm-200 text-warm-700 text-sm focus:outline-none focus:ring-2 focus:ring-coral-400"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 rounded border border-warm-200 text-warm-600 text-sm"
        >
          <option value="">All Sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={posterFilter}
          onChange={(e) => { setPosterFilter(e.target.value as any); setPage(1) }}
          className="px-3 py-2 rounded border border-warm-200 text-warm-600 text-sm"
        >
          <option value="">All Posters</option>
          <option value="with">With Poster</option>
          <option value="without">Without Poster</option>
          <option value="hidden">Poster Hidden</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-warm-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-warm-400">Loading...</div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-warm-400">No events found</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-warm-50 border-b border-warm-200">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-warm-600 w-16">Poster</th>
                <th className="text-left px-3 py-3 font-medium text-warm-600">Name</th>
                <th className="text-left px-3 py-3 font-medium text-warm-600 w-20">Source</th>
                <th className="text-left px-3 py-3 font-medium text-warm-600 w-40">Venue</th>
                <th className="text-left px-3 py-3 font-medium text-warm-600 w-32">Dates</th>
                <th className="text-center px-3 py-3 font-medium text-warm-600 w-28">Action</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-warm-100 hover:bg-warm-50">
                  {/* Poster thumbnail */}
                  <td className="px-3 py-2">
                    {event.poster_url && !event.poster_hidden ? (
                      <img
                        src={event.poster_url}
                        alt=""
                        className="w-12 h-12 object-cover rounded border border-warm-200"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : event.poster_url && event.poster_hidden ? (
                      <div className="relative w-12 h-12">
                        <img
                          src={event.poster_url}
                          alt=""
                          className="w-12 h-12 object-cover rounded border border-red-300 opacity-40"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageOff size={16} className="text-red-500" />
                        </div>
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded border flex items-center justify-center text-xs bg-warm-50 border-warm-200 text-warm-300">
                        ?
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-warm-800 line-clamp-1">{event.name}</p>
                    <p className="text-warm-400 text-xs">{event.sub_category || event.category}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warm-100 text-warm-600">
                      {SOURCE_LABELS[event.source] || event.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-warm-500 truncate max-w-[160px]">
                    {event.venue_name || '-'}
                  </td>
                  <td className="px-3 py-2 text-warm-500 text-xs">
                    {event.start_date || '-'}
                    {event.end_date ? ` ~ ${event.end_date}` : ''}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {event.poster_url ? (
                      <button
                        onClick={() => togglePosterMutation.mutate({
                          id: event.id,
                          poster_hidden: !event.poster_hidden,
                        })}
                        disabled={togglePosterMutation.isPending}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium text-xs transition disabled:opacity-50 ${
                          event.poster_hidden
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                      >
                        {event.poster_hidden ? (
                          <><Image size={12} /> Show</>
                        ) : (
                          <><ImageOff size={12} /> Hide</>
                        )}
                      </button>
                    ) : (
                      <span className="text-warm-300 text-xs">No poster</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg border border-warm-200 text-warm-600 hover:bg-warm-50 disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-warm-600 px-3">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-lg border border-warm-200 text-warm-600 hover:bg-warm-50 disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
