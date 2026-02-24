'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import type { PlaceDetailResponse } from '@/types'
import PlaceDetail from '@/components/place/PlaceDetail'
import BottomNav from '@/components/BottomNav'

interface PlacePageProps {
  params: Promise<{ id: string }>
}

async function fetchPlaceDetail(id: string): Promise<PlaceDetailResponse> {
  const res = await fetch(`/api/places/${id}`)
  if (!res.ok) throw new Error('장소 정보를 불러오지 못했습니다.')
  return res.json()
}

function LoadingSkeleton() {
  return (
    <div className="bg-warm-50 min-h-dvh animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-4 py-4 bg-white border-b border-warm-200">
        <div className="w-10 h-10 bg-warm-200 rounded-full" />
        <div className="w-10 h-10 bg-warm-200 rounded-full" />
      </div>
      {/* Image skeleton */}
      <div className="w-full h-[200px] bg-warm-200" />
      {/* Content skeleton */}
      <div className="bg-white px-4 py-4 mt-3 space-y-3">
        <div className="h-7 bg-warm-200 rounded w-3/4" />
        <div className="flex gap-2">
          <div className="h-6 bg-warm-100 rounded-full w-20" />
          <div className="h-6 bg-warm-100 rounded-full w-14" />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 bg-warm-100 rounded-lg w-16" />
          ))}
        </div>
      </div>
      <div className="bg-white px-4 py-4 mt-3 space-y-3">
        <div className="h-2 bg-warm-200 rounded-full" />
        <div className="h-4 bg-warm-100 rounded w-1/2" />
      </div>
      <div className="bg-white px-4 py-4 mt-3 space-y-3">
        <div className="h-4 bg-warm-100 rounded w-full" />
        <div className="h-4 bg-warm-100 rounded w-3/4" />
        <div className="h-12 bg-coral-100 rounded-xl mt-2" />
      </div>
    </div>
  )
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="bg-warm-50 min-h-dvh flex flex-col">
      <div className="flex items-center px-4 py-4 bg-white border-b border-warm-200">
        <button
          onClick={onBack}
          className="min-w-[48px] min-h-[48px] flex items-center justify-center -ml-2 text-warm-600"
          aria-label="뒤로가기"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-4xl mb-4">😕</span>
        <p className="text-[17px] font-semibold text-warm-700 mb-2">
          장소를 불러올 수 없습니다
        </p>
        <p className="text-[15px] text-warm-400">{message}</p>
        <button
          onClick={onBack}
          className="
            mt-6 px-6 py-3 bg-coral-500 text-white
            rounded-xl font-semibold text-[15px]
            min-h-[48px] shadow-md active:bg-coral-600
          "
        >
          돌아가기
        </button>
      </div>
    </div>
  )
}

export default function PlacePage({ params }: PlacePageProps) {
  const { id } = use(params)
  const router = useRouter()

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['place', id],
    queryFn: () => fetchPlaceDetail(id),
    staleTime: 5 * 60_000,
  })

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  const handleShare = async () => {
    if (!data) return
    const shareData = {
      title: data.place.name,
      text: `${data.place.name} - BabyPlace에서 찾은 아기 친화 장소`,
      url: window.location.href,
    }
    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData)
      } catch {
        // Aborted by user - ignore
      }
    } else {
      await navigator.clipboard.writeText(window.location.href)
    }
  }

  if (isLoading) {
    return (
      <div className="h-dvh overflow-y-auto pb-[56px]">
        <LoadingSkeleton />
        <BottomNav />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="h-dvh">
        <ErrorState
          message={error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'}
          onBack={handleBack}
        />
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="h-dvh overflow-y-auto pb-[56px]">
      <PlaceDetail
        place={data.place}
        topPosts={data.topPosts}
        isFavorited={data.isFavorited}
        onBack={handleBack}
        onShare={handleShare}
        onFavoriteToggle={() => {
          // Favorite toggle logic handled by Logic Coder (Module B)
        }}
      />
      <BottomNav />
    </div>
  )
}
