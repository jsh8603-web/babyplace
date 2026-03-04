'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, MapPin, Calendar } from 'lucide-react'

type SubmissionType = 'place' | 'event'
type SubmissionStatus = 'pending' | 'approved' | 'rejected'

interface SubmissionItem {
  id: number
  name: string
  category: string
  submission_status: SubmissionStatus
  submitted_at: string
  submitter_email: string | null
  // Place fields
  address?: string | null
  road_address?: string | null
  phone?: string | null
  kakao_place_id?: string | null
  description?: string | null
  // Event fields
  start_date?: string | null
  end_date?: string | null
  venue_name?: string | null
  venue_address?: string | null
  source_url?: string | null
  price_info?: string | null
  age_range?: string | null
}

async function fetchSubmissions(type: SubmissionType, status: SubmissionStatus, page: number) {
  const res = await fetch(`/api/admin/submissions?type=${type}&status=${status}&page=${page}`)
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json() as Promise<{ items: SubmissionItem[]; total: number }>
}

async function processSubmission(id: number, type: SubmissionType, action: 'approve' | 'reject') {
  const res = await fetch(`/api/admin/submissions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, action }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Failed')
  }
  return res.json()
}

export default function SubmissionsPage() {
  const [type, setType] = useState<SubmissionType>('place')
  const [status, setStatus] = useState<SubmissionStatus>('pending')
  const [page, setPage] = useState(1)
  const [confirmAction, setConfirmAction] = useState<{
    id: number
    action: 'approve' | 'reject'
    name: string
  } | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-submissions', type, status, page],
    queryFn: () => fetchSubmissions(type, status, page),
  })

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      processSubmission(id, type, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-submissions'] })
      setConfirmAction(null)
    },
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 20)

  const statusTabs: { value: SubmissionStatus; label: string; color: string }[] = [
    { value: 'pending', label: '대기중', color: 'bg-yellow-50 text-yellow-700' },
    { value: 'approved', label: '승인', color: 'bg-green-50 text-green-700' },
    { value: 'rejected', label: '반려', color: 'bg-red-50 text-red-700' },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-warm-800 mb-6">Submissions</h1>

      {/* Type tabs */}
      <div className="flex gap-2 mb-4">
        {(['place', 'event'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setType(t); setPage(1) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              type === t
                ? 'bg-coral-500 text-white'
                : 'bg-white text-warm-600 border border-warm-200 hover:bg-warm-50'
            }`}
          >
            {t === 'place' ? '장소' : '이벤트'}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatus(tab.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              status === tab.value ? tab.color + ' ring-2 ring-offset-1 ring-warm-300' : 'bg-warm-100 text-warm-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-warm-500 self-center">
          {total}건
        </span>
      </div>

      {/* Items */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-warm-400">
          {status === 'pending' ? '대기중인 제안이 없습니다' : '항목이 없습니다'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-warm-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {type === 'place' ? (
                      <MapPin size={16} className="text-coral-500 shrink-0" />
                    ) : (
                      <Calendar size={16} className="text-coral-500 shrink-0" />
                    )}
                    <h3 className="font-semibold text-warm-800 truncate">{item.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-warm-100 text-warm-500 shrink-0">
                      {item.category}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="text-sm text-warm-500 space-y-0.5 mt-1">
                    {type === 'place' && (
                      <>
                        {(item.road_address || item.address) && (
                          <p className="truncate">{item.road_address || item.address}</p>
                        )}
                        {item.phone && <p>{item.phone}</p>}
                        {item.kakao_place_id && (
                          <p className="text-xs text-warm-400">Kakao ID: {item.kakao_place_id}</p>
                        )}
                      </>
                    )}
                    {type === 'event' && (
                      <>
                        {item.venue_name && <p>{item.venue_name}</p>}
                        {(item.start_date || item.end_date) && (
                          <p>{item.start_date} ~ {item.end_date}</p>
                        )}
                        {item.source_url && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-coral-500 hover:underline text-xs"
                          >
                            공식 URL
                          </a>
                        )}
                      </>
                    )}
                    {item.description && (
                      <p className="text-xs text-warm-400 line-clamp-2">{item.description}</p>
                    )}
                  </div>

                  {/* Submitter info */}
                  <div className="flex items-center gap-3 mt-2 text-xs text-warm-400">
                    <span>{item.submitter_email || '알 수 없음'}</span>
                    <span>{new Date(item.submitted_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>

                {/* Actions */}
                {status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setConfirmAction({ id: item.id, action: 'approve', name: item.name })}
                      className="p-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition"
                      title="승인"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={() => setConfirmAction({ id: item.id, action: 'reject', name: item.name })}
                      className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition"
                      title="반려"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm border border-warm-200 disabled:opacity-30"
          >
            이전
          </button>
          <span className="text-sm text-warm-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm border border-warm-200 disabled:opacity-30"
          >
            다음
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg">
            <h3 className="text-lg font-bold text-warm-800 mb-2">
              {confirmAction.action === 'approve' ? '승인' : '반려'} 확인
            </h3>
            <p className="text-sm text-warm-600 mb-4">
              <strong>{confirmAction.name}</strong>을(를){' '}
              {confirmAction.action === 'approve' ? '승인' : '반려'}하시겠습니까?
              {confirmAction.action === 'approve' && ' 승인 시 즉시 공개됩니다.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg text-sm border border-warm-200 text-warm-600"
              >
                취소
              </button>
              <button
                onClick={() => mutation.mutate({ id: confirmAction.id, action: confirmAction.action })}
                disabled={mutation.isPending}
                className={`px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50 ${
                  confirmAction.action === 'approve'
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {mutation.isPending ? '처리중...' : confirmAction.action === 'approve' ? '승인' : '반려'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
