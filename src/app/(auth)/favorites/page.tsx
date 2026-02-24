'use client'

import { useCallback, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { MapPin, Heart } from 'lucide-react'
import type { Place } from '@/types'
import PlaceCard from '@/components/place/PlaceCard'
import BottomNav from '@/components/BottomNav'

interface FavoritesResponse {
  favorites: Array<{
    id: number
    user_id: string
    place_id: number | null
    event_id: number | null
    created_at: string
    places: Place | null
  }>
  nextCursor: number | null
}

async function fetchFavorites(
  sort: 'distance' | 'created_at',
  cursor: number | null
): Promise<FavoritesResponse> {
  const params = new URLSearchParams()
  params.set('sort', sort)
  if (cursor !== null) {
    params.set('cursor', cursor.toString())
  }

  const res = await fetch(`/api/favorites?${params.toString()}`)
  if (!res.ok) throw new Error('찜한 목록을 불러오지 못했습니다.')
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
          <div className="h-6 bg-warm-200 rounded w-3/4" />
          <div className="flex gap-2">
            <div className="h-5 bg-warm-100 rounded-full w-20" />
            <div className="h-5 bg-warm-100 rounded-full w-24" />
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map((j) => (
              <div key={j} className="h-6 bg-warm-100 rounded-full w-12" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <Heart size={56} className="text-warm-200 mb-4" />
      <h2 className="text-[19px] font-semibold text-warm-700 mb-2">
        찜한 장소가 없습니다
      </h2>
      <p className="text-[15px] text-warm-400 mb-6">
        아기와 함께 갈 만한 장소를 찜하고{'\n'}
        언제 어디서나 확인해보세요
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
        찜한 목록을 불러올 수 없습니다
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

export default function FavoritesPage() {
  const sortRef = useRef<'distance' | 'created_at'>('created_at')
  const observerTargetRef = useRef<HTMLDivElement>(null)

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery<FavoritesResponse, Error, InfiniteData<FavoritesResponse, number | null>, string[], number | null>({
    queryKey: ['favorites'],
    queryFn: ({ pageParam }) =>
      fetchFavorites(sortRef.current, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null,
    staleTime: 5 * 60_000,
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

  // Set up observer
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useCallback(() => {
      const observer = new IntersectionObserver(observerCallback, {
        rootMargin: '100px',
      })

      if (observerTargetRef.current) {
        observer.observe(observerTargetRef.current)
      }

      return () => {
        if (observerTargetRef.current) {
          observer.unobserve(observerTargetRef.current)
        }
      }
    }, [observerCallback])()
  }

  const places =
    data?.pages.flatMap((page) => page.favorites.filter((fav) => fav.places)) ?? []

  const handleSortChange = (newSort: 'distance' | 'created_at') => {
    sortRef.current = newSort
    refetch()
  }

  return (
    <div className="bg-warm-50 min-h-dvh flex flex-col pb-[56px]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white border-b border-warm-200">
        <div className="px-4 py-4">
          <h1 className="text-[28px] font-bold text-warm-700 mb-4">찜한 장소</h1>

          {/* Sort buttons */}
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2">
            <button
              onClick={() => handleSortChange('created_at')}
              className={`
                shrink-0 px-4 py-2 rounded-full font-medium text-[14px]
                transition-all duration-150 min-h-[36px]
                ${sortRef.current === 'created_at'
                  ? 'bg-coral-500 text-white shadow-sm'
                  : 'bg-warm-100 text-warm-600 active:bg-warm-200'
                }
              `}
            >
              최신순
            </button>
            <button
              onClick={() => handleSortChange('distance')}
              className={`
                shrink-0 px-4 py-2 rounded-full font-medium text-[14px]
                transition-all duration-150 min-h-[36px] flex items-center gap-1
                ${sortRef.current === 'distance'
                  ? 'bg-coral-500 text-white shadow-sm'
                  : 'bg-warm-100 text-warm-600 active:bg-warm-200'
                }
              `}
            >
              <MapPin size={14} />
              거리순
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && <LoadingSkeleton />}

        {error && !isLoading && <ErrorState onRetry={() => refetch()} />}

        {!isLoading && !error && places.length === 0 && <EmptyState />}

        {!isLoading && !error && places.length > 0 && (
          <>
            {places.map((favorite) => (
              <a
                key={favorite.id}
                href={`/place/${favorite.place_id}`}
                className="block transition-transform active:scale-[0.98]"
              >
                <PlaceCard place={favorite.places!} />
              </a>
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
          </>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
