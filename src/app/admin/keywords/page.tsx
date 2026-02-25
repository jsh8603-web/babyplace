'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2, Plus } from 'lucide-react'
import DataTable, { Column } from '@/components/admin/DataTable'
import StatusBadge from '@/components/admin/StatusBadge'

interface Keyword {
  id: number
  keyword: string
  keyword_group: string | null
  status: 'ACTIVE' | 'DECLINING' | 'EXHAUSTED' | 'SEASONAL' | 'NEW'
  efficiency_score: number
  new_places_found: number
  duplicate_ratio: number
  total_results: number
  seasonal_months: number[] | null
  created_at: string
}

export default function KeywordsManagement() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<Keyword['status'] | ''>('')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [newKeyword, setNewKeyword] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [newSeasonalMonths, setNewSeasonalMonths] = useState<number[]>([])

  const { data: keywords = [], isLoading } = useQuery<Keyword[]>({
    queryKey: ['admin', 'keywords', { status: statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.append('status', statusFilter)

      const res = await fetch(`/api/admin/keywords?${params}`)
      if (!res.ok) throw new Error('Failed to fetch keywords')
      return res.json()
    },
  })

  const addKeywordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: newKeyword,
          keyword_group: newGroup || null,
          seasonal_months: newSeasonalMonths.length > 0 ? newSeasonalMonths : null,
        }),
      })
      if (!res.ok) throw new Error('Failed to add keyword')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'keywords'] })
      setAddModalOpen(false)
      setNewKeyword('')
      setNewGroup('')
      setNewSeasonalMonths([])
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: async (data: { keywordId: number; status: Keyword['status'] }) => {
      const res = await fetch(`/api/admin/keywords`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update keyword')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'keywords'] })
    },
  })

  const deleteKeywordMutation = useMutation({
    mutationFn: async (keywordId: number) => {
      const res = await fetch(`/api/admin/keywords?keywordId=${keywordId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete keyword')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'keywords'] })
    },
  })

  const columns: Column<Keyword>[] = [
    {
      key: 'keyword',
      label: 'Keyword',
      width: 'w-32',
      sortable: true,
    },
    {
      key: 'keyword_group',
      label: 'Group',
      width: 'w-24',
      render: (group) => group || '-',
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-32',
      sortable: true,
      render: (status, row) => (
        <select
          value={status}
          onChange={(e) =>
            updateStatusMutation.mutate({
              keywordId: row.id,
              status: e.target.value as Keyword['status'],
            })
          }
          className="
            px-2 py-1 rounded border border-warm-200 bg-white
            text-sm focus:outline-none focus:ring-2 focus:ring-coral-400
          "
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="DECLINING">DECLINING</option>
          <option value="EXHAUSTED">EXHAUSTED</option>
          <option value="SEASONAL">SEASONAL</option>
          <option value="NEW">NEW</option>
        </select>
      ),
    },
    {
      key: 'efficiency_score',
      label: 'Efficiency',
      width: 'w-28',
      sortable: true,
      render: (score) => (
        <div className="flex items-center">
          <div className="w-full bg-warm-100 rounded-full h-2 mr-2">
            <div
              className="bg-coral-500 h-2 rounded-full"
              style={{ width: `${Math.min(score * 100, 100)}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-warm-700">
            {score.toFixed(2)}
          </span>
        </div>
      ),
    },
    {
      key: 'new_places_found',
      label: 'New Places',
      width: 'w-24',
      sortable: true,
      render: (count) => (
        <span className="text-sm font-semibold text-green-600">{count}</span>
      ),
    },
    {
      key: 'duplicate_ratio',
      label: 'Dup. Rate',
      width: 'w-24',
      sortable: true,
      render: (ratio) => (
        <span className="text-sm text-warm-600">
          {(ratio * 100).toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'total_results',
      label: 'Results',
      width: 'w-20',
      sortable: true,
    },
    {
      key: 'actions',
      label: 'Actions',
      width: 'w-20',
      render: (_, row) => (
        <button
          onClick={() => deleteKeywordMutation.mutate(row.id)}
          className="p-1 hover:bg-red-50 rounded text-red-600 transition"
        >
          <Trash2 size={16} />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={24} className="text-coral-500" />
          <h1 className="text-3xl font-bold text-warm-800">Keywords Management</h1>
        </div>
        <button
          onClick={() => setAddModalOpen(true)}
          className="
            flex items-center gap-2 px-4 py-2 rounded-lg
            bg-coral-500 text-white font-medium
            hover:bg-coral-600 transition
          "
        >
          <Plus size={18} />
          Add Keyword
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-4 gap-4 bg-white p-4 rounded-lg border border-warm-200">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Status Filter
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Keyword['status'])}
            className="
              w-full px-3 py-2 rounded border border-warm-200 bg-white
              text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
            "
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="DECLINING">DECLINING</option>
            <option value="EXHAUSTED">EXHAUSTED</option>
            <option value="SEASONAL">SEASONAL</option>
            <option value="NEW">NEW</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Total Keywords
          </label>
          <p className="text-2xl font-bold text-warm-800">{keywords.length}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Active
          </label>
          <p className="text-2xl font-bold text-green-600">
            {keywords.filter((k) => k.status === 'ACTIVE').length}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-2">
            Avg. Efficiency
          </label>
          <p className="text-2xl font-bold text-warm-800">
            {(
              keywords.reduce((acc, k) => acc + k.efficiency_score, 0) /
              keywords.length
            ).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Data table */}
      <DataTable<Keyword>
        columns={columns}
        data={keywords}
        searchableFields={['keyword', 'keyword_group']}
        defaultSortKey="efficiency_score"
        defaultSortDir="desc"
        pageSize={15}
        emptyMessage="No keywords found"
      />

      {/* Add keyword modal */}
      {addModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h2 className="text-xl font-bold text-warm-800 mb-4">Add Keyword</h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  Keyword
                </label>
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded border border-warm-200 bg-white
                    text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
                  "
                  placeholder="e.g., 아기 카페"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  Group (optional)
                </label>
                <input
                  type="text"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded border border-warm-200 bg-white
                    text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
                  "
                  placeholder="e.g., cafe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-warm-600 mb-2">
                  Seasonal Months (optional)
                </label>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                    <button
                      key={month}
                      onClick={() => {
                        if (newSeasonalMonths.includes(month)) {
                          setNewSeasonalMonths(
                            newSeasonalMonths.filter((m) => m !== month)
                          )
                        } else {
                          setNewSeasonalMonths([...newSeasonalMonths, month].sort())
                        }
                      }}
                      className={`
                        px-2 py-1 rounded text-xs font-medium transition
                        ${
                          newSeasonalMonths.includes(month)
                            ? 'bg-coral-500 text-white'
                            : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                        }
                      `}
                    >
                      {month}M
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setAddModalOpen(false)}
                className="
                  flex-1 px-4 py-2 rounded-lg border border-warm-200 bg-white
                  text-warm-700 font-medium hover:bg-warm-50 transition
                "
              >
                Cancel
              </button>
              <button
                onClick={() => addKeywordMutation.mutate()}
                disabled={!newKeyword || addKeywordMutation.isPending}
                className="
                  flex-1 px-4 py-2 rounded-lg bg-coral-500 text-white
                  font-medium hover:bg-coral-600 disabled:opacity-50 transition
                "
              >
                {addKeywordMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
