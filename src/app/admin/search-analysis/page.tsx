'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, AlertTriangle } from 'lucide-react'
import DataTable, { Column } from '@/components/admin/DataTable'
import StatsCard from '@/components/admin/StatsCard'

interface TopQuery {
  query: string
  count: number
  avg_results: number
}

interface GapQuery {
  query: string
  count: number
}

interface AnalysisResponse {
  topQueries: TopQuery[]
  gapQueries: GapQuery[]
}

export default function SearchAnalysisPage() {
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery<AnalysisResponse>({
    queryKey: ['admin', 'search-analysis', days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/search-analysis?days=${days}`)
      if (!res.ok) throw new Error('Failed to fetch search analysis')
      return res.json()
    },
  })

  const topQueries = data?.topQueries ?? []
  const gapQueries = data?.gapQueries ?? []

  const totalSearches = topQueries.reduce((acc, q) => acc + q.count, 0)
  const uniqueQueries = topQueries.length
  const gapCount = gapQueries.length

  const topColumns: Column<TopQuery>[] = [
    {
      key: 'query',
      label: 'Search Query',
      width: 'w-48',
      sortable: true,
    },
    {
      key: 'count',
      label: 'Searches',
      width: 'w-24',
      sortable: true,
      render: (count) => (
        <span className="font-semibold text-warm-700">{count}</span>
      ),
    },
    {
      key: 'avg_results',
      label: 'Avg Results',
      width: 'w-28',
      sortable: true,
      render: (avg) => (
        <span className={`font-medium ${avg === 0 ? 'text-red-500' : 'text-green-600'}`}>
          {avg}
        </span>
      ),
    },
  ]

  const gapColumns: Column<GapQuery>[] = [
    {
      key: 'query',
      label: 'Search Query',
      width: 'w-48',
      sortable: true,
    },
    {
      key: 'count',
      label: 'Searches',
      width: 'w-24',
      sortable: true,
      render: (count) => (
        <span className="font-semibold text-red-600">{count}</span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={24} className="text-coral-500" />
          <h1 className="text-3xl font-bold text-warm-800">Search Analysis</h1>
        </div>

        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="
            px-3 py-2 rounded-lg border border-warm-200 bg-white
            text-warm-700 focus:outline-none focus:ring-2 focus:ring-coral-400
          "
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatsCard
          title="Total Searches"
          value={isLoading ? '...' : totalSearches}
          icon={TrendingUp}
        />
        <StatsCard
          title="Unique Queries"
          value={isLoading ? '...' : uniqueQueries}
          icon={TrendingUp}
        />
        <StatsCard
          title="Gap Queries"
          value={isLoading ? '...' : gapCount}
          icon={AlertTriangle}
          trend={gapCount > 10 ? 'down' : 'neutral'}
          description={gapCount > 0 ? `${gapCount} queries with 0 results` : 'All queries have results'}
        />
      </div>

      {/* Top queries table */}
      <div>
        <h2 className="text-xl font-bold text-warm-800 mb-4">Top Search Queries</h2>
        <DataTable<TopQuery>
          columns={topColumns}
          data={topQueries}
          searchableFields={['query']}
          defaultSortKey="count"
          defaultSortDir="desc"
          pageSize={15}
          emptyMessage="No search data yet"
        />
      </div>

      {/* Gap queries table */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={20} className="text-amber-500" />
          <h2 className="text-xl font-bold text-warm-800">Zero-Result Queries (Data Gap)</h2>
        </div>
        <DataTable<GapQuery>
          columns={gapColumns}
          data={gapQueries}
          searchableFields={['query']}
          defaultSortKey="count"
          defaultSortDir="desc"
          pageSize={15}
          emptyMessage="No gap queries found"
        />
      </div>
    </div>
  )
}
