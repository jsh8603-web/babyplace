'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  MapPin, Calendar, Users, MessageCircle, Zap,
  AlertTriangle, Tag, Search, EyeOff, MessageSquare,
} from 'lucide-react'
import StatsCard from '@/components/admin/StatsCard'
import DataTable, { Column } from '@/components/admin/DataTable'
import StatusBadge from '@/components/admin/StatusBadge'

interface AuditQualityItem {
  judged: number
  pending: number
  approved?: number
  correct?: number
  accurate?: number
  correctMerge?: number
}

interface AdminStats {
  activePlaces: number
  activeEvents: number
  expiringSoon: number
  totalMentions: number
  recentMentions: number
  totalUsers: number
  todayNewPlaces: number
  todayFavorites: number
  alerts: {
    pendingSubmissions: number
    failedPipelines: number
    hiddenPosters: number
    recoveryPending: number
    candidatesPending: number
    pendingAudits: {
      poster: number
      mention: number
      classification: number
      place: number
      dedup: number
      candidate: number
    }
    pendingAuditsTotal: number
  }
  pipeline: Array<{
    collector: string
    lastRun: string
    status: 'success' | 'error' | 'pending'
    errorRate: number
    resultsCount: number
    newPlaces: number
    newEvents: number
  }>
  auditQuality: {
    poster: AuditQualityItem
    mention: AuditQualityItem
    classification: AuditQualityItem
    place: AuditQualityItem
    dedup: AuditQualityItem
    candidate: AuditQualityItem
  }
  placesByCategory: Array<{ category: string; count: number }>
  eventsBySource: Array<{ source: string; count: number }>
}

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}분 전`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

function getQualityRate(item: AuditQualityItem, key: 'approved' | 'correct' | 'accurate' | 'correctMerge') {
  const positive = (item as unknown as Record<string, number>)[key] || 0
  if (item.judged === 0) return null
  return Math.round((positive / item.judged) * 100)
}

function qualityColor(rate: number | null) {
  if (rate === null) return 'text-warm-400'
  if (rate >= 80) return 'text-green-600'
  if (rate >= 60) return 'text-yellow-600'
  return 'text-red-600'
}

function qualityBg(rate: number | null) {
  if (rate === null) return 'bg-warm-50'
  if (rate >= 80) return 'bg-green-50'
  if (rate >= 60) return 'bg-yellow-50'
  return 'bg-red-50'
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats')
      if (!res.ok) throw new Error('Failed to fetch stats')
      return res.json()
    },
    refetchInterval: 60000,
  })

  const pipelineColumns: Column<any>[] = [
    { key: 'collector', label: '수집기', width: 'w-36', sortable: true },
    { key: 'status', label: '상태', width: 'w-20', render: (status) => <StatusBadge status={status} size="sm" /> },
    { key: 'lastRun', label: '최근 실행', width: 'w-28', sortable: true, render: (d) => formatRelativeTime(d) },
    { key: 'resultsCount', label: '수집', width: 'w-16', sortable: true },
    { key: 'newPlaces', label: '신규 장소', width: 'w-20', sortable: true },
    { key: 'newEvents', label: '신규 이벤트', width: 'w-20', sortable: true },
    { key: 'errorRate', label: '에러율', width: 'w-16', sortable: true, render: (r) => `${r}%` },
  ]

  const distColumns: Column<any>[] = [
    { key: 'label', label: '항목', sortable: true },
    { key: 'count', label: '건수', width: 'w-20', sortable: true },
  ]

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-warm-800">대시보드</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-white rounded-lg border border-warm-200 animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white rounded-lg border border-warm-200 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 bg-white rounded-lg border border-warm-200 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // Section 2: Build alerts
  const alerts: Array<{ color: string; text: string; href?: string }> = []
  if (stats?.alerts.pendingSubmissions) {
    alerts.push({ color: 'yellow', text: `${stats.alerts.pendingSubmissions}건 사용자 제보 대기중`, href: '/admin/submissions' })
  }
  if (stats?.alerts.failedPipelines) {
    alerts.push({ color: 'red', text: `${stats.alerts.failedPipelines}개 수집기 최근 24시간 내 오류`, href: '/admin/pipeline' })
  }
  if (stats?.alerts.hiddenPosters) {
    alerts.push({ color: 'blue', text: `숨긴 포스터 ${stats.alerts.hiddenPosters}건 (복구 대기 ${stats.alerts.recoveryPending}건)`, href: '/admin/hidden' })
  }
  if (stats?.alerts.candidatesPending) {
    alerts.push({ color: 'blue', text: `장소 후보 ${stats.alerts.candidatesPending}건 승격 대기` })
  }
  if (stats?.alerts.pendingAuditsTotal) {
    const a = stats.alerts.pendingAudits
    const parts = [
      a.poster && `포스터 ${a.poster}`,
      a.mention && `멘션 ${a.mention}`,
      a.classification && `분류 ${a.classification}`,
      a.place && `장소 ${a.place}`,
      a.dedup && `중복 ${a.dedup}`,
      a.candidate && `후보 ${a.candidate}`,
    ].filter(Boolean)
    alerts.push({ color: 'yellow', text: `감사 대기: ${parts.join(', ')}` })
  }

  const alertColorMap: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  }

  // Section 4: Audit quality cards
  const auditCards = stats ? [
    { label: '포스터 승인율', ...stats.auditQuality.poster, key: 'approved' as const },
    { label: '멘션 정확률', ...stats.auditQuality.mention, key: 'correct' as const },
    { label: '분류 정확률', ...stats.auditQuality.classification, key: 'correct' as const },
    { label: '장소 정확률', ...stats.auditQuality.place, key: 'accurate' as const },
    { label: '병합 정확률', ...stats.auditQuality.dedup, key: 'correctMerge' as const },
    { label: '승격 품질', ...stats.auditQuality.candidate, key: 'correct' as const },
  ] : []

  // Section 6: Quick links
  const quickLinks = [
    { href: '/admin/places', label: '장소 관리', icon: MapPin },
    { href: '/admin/events', label: '이벤트 관리', icon: Calendar },
    { href: '/admin/keywords', label: '키워드 관리', icon: Tag },
    { href: '/admin/pipeline', label: '파이프라인', icon: Zap },
    { href: '/admin/submissions', label: '사용자 제보', icon: MessageSquare },
    { href: '/admin/search-analysis', label: '검색 분석', icon: Search },
    { href: '/admin/hidden', label: '숨김 관리', icon: EyeOff },
    { href: '/admin/users', label: '사용자 관리', icon: Users },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-warm-800 mb-2">대시보드</h1>
        <p className="text-warm-500">
          {new Date().toLocaleDateString('ko-KR', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </p>
      </div>

      {/* Section 1: KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          title="활성 장소"
          value={stats?.activePlaces || 0}
          icon={MapPin}
          description={`+${stats?.todayNewPlaces || 0} 오늘`}
          trend={(stats?.todayNewPlaces || 0) > 0 ? 'up' : 'neutral'}
        />
        <StatsCard
          title="진행 이벤트"
          value={stats?.activeEvents || 0}
          icon={Calendar}
          description={`${stats?.expiringSoon || 0}건 7일 내 종료`}
        />
        <StatsCard
          title="블로그 멘션"
          value={stats?.totalMentions || 0}
          icon={MessageCircle}
          description={`${stats?.recentMentions || 0} 최근 7일`}
        />
        <StatsCard
          title="사용자"
          value={stats?.totalUsers || 0}
          icon={Users}
          description={`${stats?.todayFavorites || 0} 즐겨찾기 오늘`}
        />
      </div>

      {/* Section 2: Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={18} className="text-yellow-500" />
            <h2 className="text-lg font-bold text-warm-800">확인 필요</h2>
          </div>
          {alerts.map((alert, i) => {
            const inner = (
              <div
                key={i}
                className={`px-4 py-2.5 rounded-lg border text-sm font-medium ${alertColorMap[alert.color]} ${alert.href ? 'hover:opacity-80 cursor-pointer' : ''}`}
              >
                {alert.text}
              </div>
            )
            return alert.href ? <Link key={i} href={alert.href}>{inner}</Link> : <div key={i}>{inner}</div>
          })}
        </div>
      )}

      {/* Section 3: Pipeline Status */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Zap size={20} className="text-coral-500" />
          <h2 className="text-xl font-bold text-warm-800">파이프라인 상태</h2>
        </div>
        <DataTable<any>
          columns={pipelineColumns}
          data={stats?.pipeline || []}
          defaultSortKey="lastRun"
          defaultSortDir="desc"
          emptyMessage="파이프라인 데이터 없음"
        />
      </div>

      {/* Section 4: Data Quality */}
      <div>
        <h2 className="text-xl font-bold text-warm-800 mb-4">데이터 품질</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {auditCards.map((card) => {
            const rate = getQualityRate(card, card.key)
            return (
              <div key={card.label} className={`rounded-lg border border-warm-200 p-4 ${qualityBg(rate)}`}>
                <p className="text-warm-500 text-sm font-medium mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${qualityColor(rate)}`}>
                  {rate !== null ? `${rate}%` : '-'}
                </p>
                <p className="text-warm-400 text-xs mt-1">{card.pending}건 대기</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Section 5: Content Distribution */}
      <div>
        <h2 className="text-xl font-bold text-warm-800 mb-4">콘텐츠 분포</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-warm-600 mb-2">장소 카테고리별</h3>
            <DataTable<any>
              columns={distColumns}
              data={(stats?.placesByCategory || []).map((r) => ({ label: r.category, count: r.count }))}
              defaultSortKey="count"
              defaultSortDir="desc"
              pageSize={8}
              emptyMessage="데이터 없음"
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-warm-600 mb-2">이벤트 소스별</h3>
            <DataTable<any>
              columns={distColumns}
              data={(stats?.eventsBySource || []).map((r) => ({ label: r.source, count: r.count }))}
              defaultSortKey="count"
              defaultSortDir="desc"
              pageSize={8}
              emptyMessage="데이터 없음"
            />
          </div>
        </div>
      </div>

      {/* Section 6: Quick Links */}
      <div>
        <h2 className="text-xl font-bold text-warm-800 mb-4">바로가기</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 p-4 bg-white rounded-lg border border-warm-200 hover:border-coral-300 hover:shadow-sm transition"
            >
              <link.icon size={20} className="text-coral-500 shrink-0" />
              <span className="text-sm font-medium text-warm-700">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
