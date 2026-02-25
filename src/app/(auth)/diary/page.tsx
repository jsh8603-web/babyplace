'use client'

import { useCallback, useRef, useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import type { VisitWithPlace } from '@/types'
import VisitCard from '@/components/diary/VisitCard'
import BottomNav from '@/components/BottomNav'

interface VisitsPageResponse {
  visits: VisitWithPlace[]
  nextCursor: number | null
}

async function fetchVisits(cursor: number | null): Promise<VisitsPageResponse> {
  const params = new URLSearchParams()
  if (cursor !== null) {
    params.set('cursor', cursor.toString())
  }

  const res = await fetch(`/api/visits?${params.toString()}`)
  if (!res.ok) throw new Error('방문 기록을 불러오지 못했습니다.')
  return res.json()
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="bg-white rounded-xl p-4 shadow-sm animate-pulse space-y-3"
        >
          <div className="h-4 bg-warm-100 rounded w-24" />
          <div className="h-6 bg-warm-200 rounded w-3/4" />
          <div className="flex gap-2">
            <div className="h-5 bg-warm-100 rounded-full w-16" />
            <div className="h-5 bg-warm-100 rounded-full w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <BookOpen size={56} className="text-warm-200 mb-4" />
      <h2 className="text-[19px] font-semibold text-warm-700 mb-2">
        방문 기록이 없습니다
      </h2>
      <p className="text-[15px] text-warm-400 mb-6">
        아기와 함께 다녀온 장소를 기록하고{'\n'}
        나만의 방문 다이어리를 만들어보세요
      </p>
      <a
        href="/"
        className="inline-block px-6 py-3 bg-coral-500 text-white rounded-xl font-semibold text-[15px] min-h-[48px] shadow-md active:bg-coral-600"
      >
        장소 찾아보기
      </a>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <span className="text-4xl mb-4">😕</span>
      <p className="text-[17px] font-semibold text-warm-700 mb-2">
        방문 기록을 불러올 수 없습니다
      </p>
      <p className="text-[15px] text-warm-400 mb-6">
        잠시 후 다시 시도해주세요
      </p>
      <button
        onClick={onRetry}
        className="px-6 py-3 bg-coral-500 text-white rounded-xl font-semibold text-[15px] min-h-[48px] shadow-md active:bg-coral-600"
      >
        다시 시도
      </button>
    </div>
  )
}

/** Group visits by month (YYYY-MM) */
function groupByMonth(visits: VisitWithPlace[]): Map<string, VisitWithPlace[]> {
  const groups = new Map<string, VisitWithPlace[]>()
  for (const visit of visits) {
    const key = visit.visited_at.substring(0, 7) // "2026-02"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(visit)
  }
  return groups
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-')
  return `${year}년 ${parseInt(month)}월`
}

export default function DiaryPage() {
  const queryClient = useQueryClient()
  const observerTargetRef = useRef<HTMLDivElement>(null)

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery<VisitsPageResponse, Error, InfiniteData<VisitsPageResponse, number | null>, string[], number | null>({
    queryKey: ['visits'],
    queryFn: ({ pageParam }) => fetchVisits(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null,
    staleTime: 5 * 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: async (visitId: number) => {
      const res = await fetch(`/api/visits?visitId=${visitId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] })
    },
  })

  // Infinite scroll observer
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  )

  useEffect(() => {
    const target = observerTargetRef.current
    if (!target) return

    const observer = new IntersectionObserver(observerCallback, {
      rootMargin: '100px',
    })
    observer.observe(target)

    return () => observer.disconnect()
  }, [observerCallback])

  const allVisits =
    data?.pages.flatMap((page) => page.visits.filter((v) => v.places)) ?? []
  const monthGroups = groupByMonth(allVisits)

  return (
    <div className="bg-warm-50 min-h-dvh flex flex-col pb-[56px]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-warm-200">
        <div className="px-4 py-4">
          <h1 className="text-[28px] font-bold text-warm-700">방문 다이어리</h1>
          {allVisits.length > 0 && (
            <p className="text-[14px] text-warm-400 mt-1">
              총 {allVisits.length}곳 방문
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && <LoadingSkeleton />}

        {error && !isLoading && <ErrorState onRetry={() => refetch()} />}

        {!isLoading && !error && allVisits.length === 0 && <EmptyState />}

        {!isLoading && !error && allVisits.length > 0 && (
          <div className="px-4 py-4 space-y-6">
            {Array.from(monthGroups.entries()).map(([month, visits]) => (
              <div key={month}>
                {/* Month header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-coral-400" />
                  <h2 className="text-[16px] font-semibold text-warm-600">
                    {formatMonthLabel(month)}
                  </h2>
                  <span className="text-[13px] text-warm-400">
                    {visits.length}회
                  </span>
                </div>

                {/* Timeline line + cards */}
                <div className="ml-[3px] border-l-2 border-warm-200 pl-4 space-y-3">
                  {visits.map((visit) => (
                    <VisitCard
                      key={visit.id}
                      visit={visit}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Infinite scroll trigger */}
            {hasNextPage && (
              <div ref={observerTargetRef} className="py-8">
                {isFetchingNextPage && (
                  <div className="flex justify-center">
                    <div className="inline-flex items-center gap-2 text-warm-400">
                      <div className="w-3 h-3 rounded-full bg-coral-300 animate-bounce" />
                      <span className="text-[13px] font-medium">로드 중...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
