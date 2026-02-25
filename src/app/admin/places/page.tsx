'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Trash2, Copy } from 'lucide-react'
import DataTable, { Column } from '@/components/admin/DataTable'
import type { Place, PlaceCategory } from '@/types'

interface PlaceRow extends Place {
  actions?: string
}

const CATEGORIES: PlaceCategory[] = [
  '놀이',
  '공원/놀이터',
  '전시/체험',
  '공연',
  '동물/자연',
  '식당/카페',
  '도서관',
  '수영/물놀이',
  '문화행사',
  '편의시설',
]

export default function PlacesManagement() {
  const queryClient = useQueryClient()
  const [selectedPlaces, setSelectedPlaces] = useState<number[]>([])
  const [mergeModalOpen, setMergeModalOpen] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<PlaceCategory | ''>('')
  const [activeFilter, setActiveFilter] = useState<boolean | null>(null)

  const { data: places = [], isLoading } = useQuery<Place[]>({
    queryKey: ['admin', 'places', { categoryFilter, activeFilter }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (categoryFilter) params.append('category', categoryFilter)
      if (activeFilter !== null)
        params.append('is_active', activeFilter.toString())

      const res = await fetch(`/api/admin/places?${params}`)
      if (!res.ok) throw new Error('Failed to fetch places')
      return res.json()
    },
  })

  const updatePlaceMutation = useMutation({
    mutationFn: async (data: { placeId: number; updates: Partial<Place> }) => {
      const res = await fetch(`/api/admin/places`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update place')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'places'] })
    },
  })

  const mergePlacesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/places/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: parseInt(sourceId),
          targetId: parseInt(targetId),
        }),
      })
      if (!res.ok) throw new Error('Failed to merge places')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'places'] })
      setMergeModalOpen(false)
      setSourceId('')
      setTargetId('')
    },
  })

  const deletePlaceMutation = useMutation({
    mutationFn: async (placeId: number) => {
      const res = await fetch(`/api/admin/places?placeId=${placeId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete place')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'places'] })
    },
  })

  const columns: Column<PlaceRow>[] = [
    {
      key: 'name',
      label: 'Place Name',
      width: 'w-48',
      sortable: true,
    },
    {
      key: 'category',
      label: 'Category',
      width: 'w-32',
      sortable: true,
      render: (category, row) => (
        <select
          value={category}
          onChange={(e) =>
            updatePlaceMutation.mutate({
              placeId: row.id,
              updates: { category: e.target.value as PlaceCategory },
            })
          }
          className="
            px-2 py-1 rounded border border-warm-200 bg-white
            text-sm text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
          "
        >
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'address',
      label: 'Address',
      width: 'w-56',
      render: (address) =>
        address ? (
          <span className="text-xs text-warm-600 truncate">{address}</span>
        ) : (
          <span className="text-xs text-warm-300">-</span>
        ),
    },
    {
      key: 'popularity_score',
      label: 'Popularity',
      width: 'w-24',
      sortable: true,
      render: (score) => (
        <span className="text-sm font-semibold text-coral-600">
          {score.toFixed(2)}
        </span>
      ),
    },
    {
      key: 'is_active',
      label: 'Status',
      width: 'w-24',
      render: (active, row) => (
        <button
          onClick={() =>
            updatePlaceMutation.mutate({
              placeId: row.id,
              updates: { is_active: !active },
            })
          }
          className={`
            px-2 py-1 rounded text-xs font-medium transition
            ${
              active
                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }
          `}
        >
          {active ? 'Active' : 'Inactive'}
        </button>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      width: 'w-28',
      render: (_, row) => (
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSourceId(row.id.toString())
              setMergeModalOpen(true)
            }}
            className="p-1 hover:bg-blue-50 rounded text-blue-600 transition"
            title="Merge with another place"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={() => deletePlaceMutation.mutate(row.id)}
            className="p-1 hover:bg-red-50 rounded text-red-600 transition"
            title="Delete place"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <MapPin size={24} className="text-coral-500" />
        <h1 className="text-3xl font-bold text-warm-800">Places Management</h1>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-3 gap-4 bg-white p-4 rounded-lg border border-warm-200">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Category
          </label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as PlaceCategory)}
            className="
              w-full px-3 py-2 rounded border border-warm-200 bg-white
              text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
            "
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Status
          </label>
          <select
            value={activeFilter === null ? '' : activeFilter.toString()}
            onChange={(e) =>
              setActiveFilter(
                e.target.value === ''
                  ? null
                  : e.target.value === 'true'
              )
            }
            className="
              w-full px-3 py-2 rounded border border-warm-200 bg-white
              text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
            "
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Total Places
          </label>
          <p className="text-2xl font-bold text-warm-800">{places.length}</p>
        </div>
      </div>

      {/* Data table */}
      <DataTable<PlaceRow>
        columns={columns}
        data={places as PlaceRow[]}
        searchableFields={['name', 'address', 'category']}
        pageSize={15}
        emptyMessage="No places found"
      />

      {/* Merge modal */}
      {mergeModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold text-warm-800 mb-4">
              Merge Places
            </h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  Source Place ID
                </label>
                <input
                  type="number"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded border border-warm-200 bg-white
                    text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
                  "
                  placeholder="Will be merged into target"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  Target Place ID
                </label>
                <input
                  type="number"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded border border-warm-200 bg-white
                    text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
                  "
                  placeholder="Target place to keep"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setMergeModalOpen(false)}
                className="
                  flex-1 px-4 py-2 rounded-lg border border-warm-200 bg-white
                  text-warm-700 font-medium hover:bg-warm-50 transition
                "
              >
                Cancel
              </button>
              <button
                onClick={() => mergePlacesMutation.mutate()}
                disabled={!sourceId || !targetId || mergePlacesMutation.isPending}
                className="
                  flex-1 px-4 py-2 rounded-lg bg-coral-500 text-white
                  font-medium hover:bg-coral-600 disabled:opacity-50 transition
                "
              >
                {mergePlacesMutation.isPending ? 'Merging...' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
