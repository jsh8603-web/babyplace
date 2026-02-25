'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Radio, Play } from 'lucide-react'
import DataTable, { Column } from '@/components/admin/DataTable'
import StatusBadge from '@/components/admin/StatusBadge'

interface CollectionLog {
  id: number
  collector: string
  keyword: string | null
  results_count: number
  new_places: number
  new_events: number
  status: 'success' | 'error' | 'running'
  error: string | null
  duration_ms: number
  ran_at: string
}

interface SourceSummary {
  source: string
  totalRuns: number
  successCount: number
  failCount: number
  avgDuration: number
  lastRun: string
}

const PIPELINE_SOURCES = [
  'kakao_collector',
  'naver_blog_collector',
  'publicdata_collector',
  'kopis_collector',
  'tour_collector',
  'keyword_evaluator',
]

export default function PipelineMonitoring() {
  const queryClient = useQueryClient()
  const [expandedSources, setExpandedSources] = useState<string[]>([])

  const { data: logsData, isLoading } = useQuery<{
    logs: CollectionLog[]
    summary: Array<{
      collector: string
      totalRuns: number
      successCount: number
      failCount: number
      avgDuration: number
      lastRun: string
    }>
  }>({
    queryKey: ['admin', 'pipeline', 'logs'],
    queryFn: async () => {
      const res = await fetch('/api/admin/pipeline')
      if (!res.ok) throw new Error('Failed to fetch logs')
      return res.json()
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  const logs = logsData?.logs || []
  const logSummary = logsData?.summary || []

  const triggerPipelineMutation = useMutation({
    mutationFn: async (source: string) => {
      const res = await fetch(`/api/admin/pipeline/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      })
      if (!res.ok) throw new Error('Failed to trigger pipeline')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'pipeline'] })
    },
  })

  // Convert summary to record for easy lookup
  const sourceSummary: Record<string, SourceSummary> = {}
  logSummary.forEach((item) => {
    sourceSummary[item.collector] = {
      source: item.collector,
      totalRuns: item.totalRuns,
      successCount: item.successCount,
      failCount: item.failCount,
      avgDuration: item.avgDuration,
      lastRun: item.lastRun,
    }
  })

  const logColumns: Column<CollectionLog>[] = [
    {
      key: 'ran_at',
      label: 'Ran At',
      width: 'w-40',
      sortable: true,
      render: (date) =>
        new Date(date).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
    },
    {
      key: 'status',
      label: 'Status',
      width: 'w-24',
      render: (status) => <StatusBadge status={status} size="sm" />,
    },
    {
      key: 'results_count',
      label: 'Results',
      width: 'w-20',
      sortable: true,
    },
    {
      key: 'new_places',
      label: 'New Places',
      width: 'w-24',
      sortable: true,
      render: (count) => (
        <span className="text-sm font-semibold text-green-600">{count}</span>
      ),
    },
    {
      key: 'new_events',
      label: 'New Events',
      width: 'w-24',
      sortable: true,
      render: (count) => (
        <span className="text-sm font-semibold text-blue-600">{count}</span>
      ),
    },
    {
      key: 'duration_ms',
      label: 'Duration',
      width: 'w-24',
      sortable: true,
      render: (ms) => (
        <span className="text-xs text-warm-600">
          {(ms / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      key: 'error',
      label: 'Error',
      width: 'w-48',
      render: (error) =>
        error ? (
          <span className="text-xs text-red-600 truncate">{error}</span>
        ) : (
          <span className="text-xs text-warm-400">-</span>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Radio size={24} className="text-coral-500" />
        <h1 className="text-3xl font-bold text-warm-800">Pipeline Monitoring</h1>
      </div>

      {/* Source summary */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-warm-800">Source Status</h2>
        <div className="grid gap-4">
          {PIPELINE_SOURCES.map((source) => {
            const summary = sourceSummary[source] || {
              source,
              totalRuns: 0,
              successCount: 0,
              failCount: 0,
              avgDuration: 0,
              lastRun: '-',
            }
            const successRate =
              summary.totalRuns > 0
                ? ((summary.successCount / summary.totalRuns) * 100).toFixed(1)
                : 0

            return (
              <div
                key={source}
                className="bg-white border border-warm-200 rounded-lg p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-warm-800 mb-3">
                      {source}
                    </h3>

                    <div className="grid grid-cols-5 gap-4 text-sm mb-3">
                      <div>
                        <p className="text-warm-500 mb-1">Total Runs</p>
                        <p className="text-lg font-bold text-warm-800">
                          {summary.totalRuns}
                        </p>
                      </div>
                      <div>
                        <p className="text-warm-500 mb-1">Success Rate</p>
                        <p className="text-lg font-bold text-green-600">
                          {successRate}%
                        </p>
                      </div>
                      <div>
                        <p className="text-warm-500 mb-1">Failures</p>
                        <p className="text-lg font-bold text-red-600">
                          {summary.failCount}
                        </p>
                      </div>
                      <div>
                        <p className="text-warm-500 mb-1">Avg Duration</p>
                        <p className="text-lg font-bold text-warm-800">
                          {(summary.avgDuration / 1000).toFixed(1)}s
                        </p>
                      </div>
                      <div>
                        <p className="text-warm-500 mb-1">Last Run</p>
                        <p className="text-xs font-medium text-warm-600 truncate">
                          {summary.lastRun === '-'
                            ? '-'
                            : new Date(summary.lastRun).toLocaleString('ko-KR', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                        </p>
                      </div>
                    </div>

                    {/* Success rate bar */}
                    <div className="w-full bg-warm-100 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${successRate}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      triggerPipelineMutation.mutate(source)
                    }
                    disabled={triggerPipelineMutation.isPending}
                    className="
                      ml-4 px-4 py-2 rounded-lg bg-coral-500 text-white
                      font-medium flex items-center gap-2
                      hover:bg-coral-600 disabled:opacity-50 transition
                      whitespace-nowrap
                    "
                  >
                    <Play size={16} />
                    Run Now
                  </button>
                </div>

                {/* Expandable logs */}
                <button
                  onClick={() => {
                    if (expandedSources.includes(source)) {
                      setExpandedSources(
                        expandedSources.filter((s) => s !== source)
                      )
                    } else {
                      setExpandedSources([...expandedSources, source])
                    }
                  }}
                  className="
                    text-sm text-coral-500 font-medium mt-3
                    hover:text-coral-600 transition
                  "
                >
                  {expandedSources.includes(source)
                    ? '▼ Hide Recent Logs'
                    : '▶ Show Recent Logs'}
                </button>

                {expandedSources.includes(source) && (
                  <div className="mt-4 pt-4 border-t border-warm-200">
                    <DataTable<CollectionLog>
                      columns={logColumns}
                      data={logs.filter((l) => l.collector === source).slice(0, 10)}
                      defaultSortKey="ran_at"
                      defaultSortDir="desc"
                      pageSize={5}
                      emptyMessage="No logs available"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* All logs */}
      <div>
        <h2 className="text-lg font-semibold text-warm-800 mb-4">
          All Collection Logs
        </h2>
        <DataTable<CollectionLog>
          columns={logColumns}
          data={logs}
          searchableFields={['collector', 'keyword']}
          defaultSortKey="ran_at"
          defaultSortDir="desc"
          pageSize={20}
          emptyMessage="No logs found"
        />
      </div>
    </div>
  )
}
