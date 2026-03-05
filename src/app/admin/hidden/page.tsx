'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Eye, Image, ImageOff } from 'lucide-react'
import type { Place, Event } from '@/types'

type Tab = 'places' | 'events' | 'posters'

export default function HiddenManagement() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('places')
  const [search, setSearch] = useState('')

  const { data: placesData, isLoading: placesLoading } = useQuery({
    queryKey: ['admin', 'hidden-places', search],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'hidden' })
      if (search) params.append('search', search)
      const res = await fetch(`/api/admin/places?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ places: Place[]; total: number }>
    },
    enabled: tab === 'places',
  })

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['admin', 'hidden-events', search],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'hidden' })
      if (search) params.append('search', search)
      const res = await fetch(`/api/admin/events?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ events: Event[]; total: number }>
    },
    enabled: tab === 'events',
  })

  const { data: posterData, isLoading: posterLoading } = useQuery({
    queryKey: ['admin', 'hidden-posters', search],
    queryFn: async () => {
      const params = new URLSearchParams({ poster: 'hidden' })
      if (search) params.append('search', search)
      const res = await fetch(`/api/admin/events?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json() as Promise<{ events: Event[]; total: number }>
    },
    enabled: tab === 'posters',
  })

  const unhidePlaceMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch('/api/admin/places', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_hidden: false }),
      })
      if (!res.ok) throw new Error('Failed to unhide')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'hidden-places'] })
    },
  })

  const unhideEventMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_hidden: false }),
      })
      if (!res.ok) throw new Error('Failed to unhide')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'hidden-events'] })
    },
  })

  const unhidePosterMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, poster_hidden: false }),
      })
      if (!res.ok) throw new Error('Failed to unhide poster')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'hidden-posters'] })
    },
  })

  const places = placesData?.places ?? []
  const events = eventsData?.events ?? []
  const posterEvents = posterData?.events ?? []
  const isLoading = tab === 'places' ? placesLoading : tab === 'events' ? eventsLoading : posterLoading

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <EyeOff size={24} className="text-coral-500" />
        <h1 className="text-3xl font-bold text-warm-800">Hidden Items</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setTab('places'); setSearch('') }}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            tab === 'places'
              ? 'bg-coral-500 text-white'
              : 'bg-white text-warm-600 border border-warm-200 hover:bg-warm-50'
          }`}
        >
          Places ({placesData?.total ?? 0})
        </button>
        <button
          onClick={() => { setTab('events'); setSearch('') }}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            tab === 'events'
              ? 'bg-coral-500 text-white'
              : 'bg-white text-warm-600 border border-warm-200 hover:bg-warm-50'
          }`}
        >
          Events ({eventsData?.total ?? 0})
        </button>
        <button
          onClick={() => { setTab('posters'); setSearch('') }}
          className={`px-4 py-2 rounded-lg font-medium transition flex items-center gap-1.5 ${
            tab === 'posters'
              ? 'bg-coral-500 text-white'
              : 'bg-white text-warm-600 border border-warm-200 hover:bg-warm-50'
          }`}
        >
          <ImageOff size={14} />
          Posters ({posterData?.total ?? 0})
        </button>
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-lg border border-warm-200">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="w-full px-3 py-2 rounded border border-warm-200 text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-warm-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-warm-400">Loading...</div>
        ) : tab === 'places' ? (
          places.length === 0 ? (
            <div className="p-8 text-center text-warm-400">No hidden places</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-warm-50 border-b border-warm-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Address</th>
                  <th className="text-center px-4 py-3 font-medium text-warm-600 w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {places.map((place) => (
                  <tr key={place.id} className="border-b border-warm-100 hover:bg-warm-50">
                    <td className="px-4 py-3 font-medium text-warm-800">{place.name}</td>
                    <td className="px-4 py-3 text-warm-600">{place.category}</td>
                    <td className="px-4 py-3 text-warm-500 truncate max-w-xs">{place.address || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => unhidePlaceMutation.mutate(place.id)}
                        disabled={unhidePlaceMutation.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium text-xs hover:bg-green-100 transition disabled:opacity-50"
                      >
                        <Eye size={14} />
                        Unhide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'events' ? (
          events.length === 0 ? (
            <div className="p-8 text-center text-warm-400">No hidden events</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-warm-50 border-b border-warm-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Venue</th>
                  <th className="text-left px-4 py-3 font-medium text-warm-600">Dates</th>
                  <th className="text-center px-4 py-3 font-medium text-warm-600 w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-warm-100 hover:bg-warm-50">
                    <td className="px-4 py-3 font-medium text-warm-800">{event.name}</td>
                    <td className="px-4 py-3 text-warm-600">{event.category}</td>
                    <td className="px-4 py-3 text-warm-500 truncate max-w-xs">{event.venue_name || '-'}</td>
                    <td className="px-4 py-3 text-warm-500">
                      {event.start_date || '-'}
                      {event.end_date ? ` ~ ${event.end_date}` : ''}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => unhideEventMutation.mutate(event.id)}
                        disabled={unhideEventMutation.isPending}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium text-xs hover:bg-green-100 transition disabled:opacity-50"
                      >
                        <Eye size={14} />
                        Unhide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          posterEvents.length === 0 ? (
            <div className="p-8 text-center text-warm-400">No hidden posters</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-warm-50 border-b border-warm-200">
                <tr>
                  <th className="text-left px-3 py-3 font-medium text-warm-600 w-16">Poster</th>
                  <th className="text-left px-3 py-3 font-medium text-warm-600">Name</th>
                  <th className="text-left px-3 py-3 font-medium text-warm-600 w-40">Venue</th>
                  <th className="text-left px-3 py-3 font-medium text-warm-600 w-32">Dates</th>
                  <th className="text-center px-3 py-3 font-medium text-warm-600 w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {posterEvents.map((event) => (
                  <tr key={event.id} className="border-b border-warm-100 hover:bg-warm-50">
                    <td className="px-3 py-2">
                      {event.poster_url ? (
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
                    <td className="px-3 py-2 text-warm-500 truncate max-w-[160px]">{event.venue_name || '-'}</td>
                    <td className="px-3 py-2 text-warm-500 text-xs">
                      {event.start_date || '-'}
                      {event.end_date ? ` ~ ${event.end_date}` : ''}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => unhidePosterMutation.mutate(event.id)}
                        disabled={unhidePosterMutation.isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 font-medium text-xs hover:bg-green-100 transition disabled:opacity-50"
                      >
                        <Image size={12} />
                        Show Poster
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
