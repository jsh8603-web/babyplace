'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart3, MapPin, Users, Zap } from 'lucide-react'
import StatsCard from '@/components/admin/StatsCard'
import DataTable, { Column } from '@/components/admin/DataTable'
import StatusBadge from '@/components/admin/StatusBadge'

interface AdminStats {
  totalPlaces: number
  totalEvents: number
  totalUsers: number
  todayNewPlaces: number
  todayNewUsers: number
  todayReviews: number
  pipeline: Array<{
    collector: string
    lastRun: string
    status: 'success' | 'error' | 'pending'
    errorRate: number
  }>
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats')
      if (!res.ok) throw new Error('Failed to fetch stats')
      return res.json()
    },
    refetchInterval: 60000, // Refetch every minute
  })

  const pipelineColumns: Column<any>[] = [
    {
      key: 'collector',
      label: 'Source',
      width: 'w-40',
      sortable: true,
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-24',
      render: (status) => <StatusBadge status={status} size="sm" />,
    },
    {
      key: 'lastRun',
      label: 'Last Run',
      width: 'w-48',
      sortable: true,
      render: (date) =>
        new Date(date).toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
    {
      key: 'errorRate',
      label: 'Error Rate',
      width: 'w-24',
      sortable: true,
      render: (rate) => `${rate}%`,
    },
  ]

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-warm-800">Dashboard</h1>
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-white rounded-lg border border-warm-200 animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-warm-800 mb-2">Dashboard</h1>
        <p className="text-warm-500">
          {new Date().toLocaleDateString('ko-KR', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-6">
        <StatsCard
          title="Total Places"
          value={stats?.totalPlaces || 0}
          icon={MapPin}
          description={`+${stats?.todayNewPlaces || 0} today`}
          trend={
            (stats?.todayNewPlaces || 0) > 0
              ? 'up'
              : (stats?.todayNewPlaces || 0) < 0
                ? 'down'
                : 'neutral'
          }
        />
        <StatsCard
          title="Total Events"
          value={stats?.totalEvents || 0}
          icon={BarChart3}
        />
        <StatsCard
          title="Total Users"
          value={stats?.totalUsers || 0}
          icon={Users}
          description={`+${stats?.todayNewUsers || 0} today`}
        />
      </div>

      {/* Pipeline status */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Zap size={20} className="text-coral-500" />
          <h2 className="text-xl font-bold text-warm-800">Pipeline Status</h2>
        </div>
        <DataTable<any>
          columns={pipelineColumns}
          data={stats?.pipeline || []}
          defaultSortKey="lastRun"
          defaultSortDir="desc"
          emptyMessage="No pipeline data available"
        />
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-4 mt-8">
        <div className="bg-white rounded-lg border border-warm-200 p-4">
          <p className="text-warm-500 text-sm font-medium mb-2">New Reviews</p>
          <p className="text-2xl font-bold text-warm-800">
            {stats?.todayReviews || 0}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-warm-200 p-4">
          <p className="text-warm-500 text-sm font-medium mb-2">Success Rate</p>
          <p className="text-2xl font-bold text-green-600">
            {stats?.pipeline
              ? (
                  100 -
                  (stats.pipeline.reduce((acc, p) => acc + p.errorRate, 0) /
                    (stats.pipeline.length || 1))
                ).toFixed(1)
              : 0}
            %
          </p>
        </div>
        <div className="bg-white rounded-lg border border-warm-200 p-4">
          <p className="text-warm-500 text-sm font-medium mb-2">
            Active Sources
          </p>
          <p className="text-2xl font-bold text-warm-800">
            {stats?.pipeline?.filter((p) => p.status === 'success').length || 0}/{stats?.pipeline?.length || 0}
          </p>
        </div>
      </div>
    </div>
  )
}
