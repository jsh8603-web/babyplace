'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut, Edit2, Check, X } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import type { Profile } from '@/types'
import BottomNav from '@/components/BottomNav'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function fetchProfile(): Promise<Profile> {
  const res = await fetch('/api/profile')
  if (!res.ok) throw new Error('프로필을 불러오지 못했습니다.')
  const { profile } = await res.json()
  return profile
}

async function updateProfile(displayName: string): Promise<Profile> {
  const res = await fetch('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  })
  if (!res.ok) throw new Error('프로필 업데이트에 실패했습니다.')
  const { profile } = await res.json()
  return profile
}

function LoadingSkeleton() {
  return (
    <div className="bg-warm-50 min-h-dvh animate-pulse">
      {/* Header */}
      <div className="bg-white px-4 py-6 border-b border-warm-200">
        <div className="h-8 bg-warm-200 rounded w-1/4 mb-6" />
        <div className="flex items-center gap-4 pb-4">
          <div className="w-16 h-16 rounded-full bg-warm-200" />
          <div className="flex-1">
            <div className="h-6 bg-warm-200 rounded w-1/2 mb-2" />
            <div className="h-4 bg-warm-100 rounded w-2/3" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white mx-4 mt-4 rounded-xl p-4 space-y-3">
        <div className="h-6 bg-warm-200 rounded w-1/3" />
        <div className="h-10 bg-warm-100 rounded-lg" />
        <div className="h-10 bg-warm-100 rounded-lg" />
      </div>
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-warm-50 min-h-dvh flex flex-col items-center justify-center px-6 text-center">
      <span className="text-4xl mb-4">😕</span>
      <p className="text-[17px] font-semibold text-warm-700 mb-2">
        프로필을 불러올 수 없습니다
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

export default function ProfilePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isEditingName, setIsEditingName] = useState(false)
  const [editValue, setEditValue] = useState('')

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    staleTime: 5 * 60_000,
  })

  const updateMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (updatedProfile) => {
      queryClient.setQueryData(['profile'], updatedProfile)
      setIsEditingName(false)
      setEditValue('')
    },
  })

  const handleStartEdit = useCallback(() => {
    setEditValue(profile?.display_name || '')
    setIsEditingName(true)
  }, [profile?.display_name])

  const handleSaveEdit = useCallback(() => {
    if (!editValue.trim()) {
      return
    }
    updateMutation.mutate(editValue.trim())
  }, [editValue, updateMutation])

  const handleCancelEdit = useCallback(() => {
    setIsEditingName(false)
    setEditValue('')
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (isLoading) {
    return (
      <div className="h-dvh overflow-y-auto pb-[56px]">
        <LoadingSkeleton />
        <BottomNav />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="h-dvh">
        <ErrorState onRetry={() => refetch()} />
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="bg-warm-50 min-h-dvh flex flex-col pb-[56px]">
      {/* Header */}
      <div className="bg-white px-4 py-6 border-b border-warm-200 sticky top-0 z-10">
        <h1 className="text-[28px] font-bold text-warm-700 mb-6">내 정보</h1>

        {/* Profile info */}
        <div className="flex items-start gap-4 pb-4">
          {/* Avatar placeholder */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-coral-300 to-warm-300 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-white">
              {profile.display_name?.[0] || profile.email?.[0] || 'U'}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-[19px] font-semibold text-warm-700 truncate">
              {profile.display_name || '(이름 미설정)'}
            </h2>
            <p className="text-[13px] text-warm-400 truncate">{profile.email}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`
                  text-[11px] font-medium px-2.5 py-1 rounded-full
                  ${profile.role === 'admin'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                  }
                `}
              >
                {profile.role === 'admin' ? '관리자' : '사용자'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4">
        {/* Display name section */}
        <div className="bg-white rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <label htmlFor="display-name" className="text-[15px] font-semibold text-warm-700">
              이름
            </label>
            {!isEditingName && (
              <button
                onClick={handleStartEdit}
                className="
                  inline-flex items-center gap-1.5
                  px-3 py-1.5 rounded-lg
                  text-[13px] font-medium text-coral-600
                  bg-coral-50 active:bg-coral-100
                  transition-colors
                "
                aria-label="이름 수정"
              >
                <Edit2 size={14} />
                수정
              </button>
            )}
          </div>

          {isEditingName ? (
            <div className="space-y-3">
              <input
                id="display-name"
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="이름을 입력하세요 (최대 50자)"
                maxLength={50}
                className="
                  w-full px-3 py-2 border border-warm-200 rounded-lg
                  text-[15px] bg-white focus:outline-none focus:ring-2
                  focus:ring-coral-400 focus:border-transparent
                "
                autoFocus
              />
              <div className="text-[12px] text-warm-400">
                {editValue.length}/50
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={!editValue.trim() || updateMutation.isPending}
                  className="
                    flex-1 flex items-center justify-center gap-1.5
                    px-4 py-2.5 rounded-lg
                    text-[15px] font-semibold text-white
                    bg-coral-500 active:bg-coral-600
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-opacity
                  "
                  aria-label="변경 사항 저장"
                >
                  <Check size={16} />
                  저장
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={updateMutation.isPending}
                  className="
                    flex-1 flex items-center justify-center gap-1.5
                    px-4 py-2.5 rounded-lg
                    text-[15px] font-semibold text-warm-700
                    bg-warm-100 active:bg-warm-200
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-opacity
                  "
                  aria-label="수정 취소"
                >
                  <X size={16} />
                  취소
                </button>
              </div>
              {updateMutation.error && (
                <div className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {updateMutation.error instanceof Error
                    ? updateMutation.error.message
                    : '업데이트에 실패했습니다.'}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[15px] text-warm-700">
              {profile.display_name || '(이름 미설정)'}
            </p>
          )}
        </div>

        {/* Email info */}
        <div className="bg-white rounded-xl p-4 mb-4">
          <label className="text-[15px] font-semibold text-warm-700 block mb-3">
            이메일
          </label>
          <p className="text-[15px] text-warm-600">{profile.email}</p>
          <p className="text-[13px] text-warm-400 mt-2">
            이메일 주소는 변경할 수 없습니다.
          </p>
        </div>

        {/* Account info */}
        <div className="bg-white rounded-xl p-4 mb-4">
          <label className="text-[15px] font-semibold text-warm-700 block mb-3">
            계정 정보
          </label>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-warm-600">가입일</span>
              <span className="text-[13px] font-medium text-warm-700">
                {new Date(profile.created_at).toLocaleDateString('ko-KR')}
              </span>
            </div>
            <div className="border-t border-warm-100 pt-3 flex items-center justify-between">
              <span className="text-[13px] text-warm-600">역할</span>
              <span
                className={`
                  text-[12px] font-medium px-2.5 py-1 rounded-full
                  ${profile.role === 'admin'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                  }
                `}
              >
                {profile.role === 'admin' ? '관리자' : '사용자'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Logout button */}
      <div className="px-4 py-4 bg-white border-t border-warm-200">
        <button
          onClick={handleLogout}
          className="
            w-full flex items-center justify-center gap-2
            px-4 py-3 rounded-xl
            text-[15px] font-semibold text-white
            bg-warm-400 active:bg-warm-500
            transition-colors min-h-[48px]
            shadow-sm
          "
          aria-label="로그아웃"
        >
          <LogOut size={18} />
          로그아웃
        </button>
      </div>

      <BottomNav />
    </div>
  )
}
