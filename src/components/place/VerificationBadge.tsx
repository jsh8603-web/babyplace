'use client'

import { CheckCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

interface VerificationBadgeProps {
  placeId: number
  size?: 'sm' | 'md'
  variant?: 'badge' | 'inline'
}

interface VerificationResponse {
  place_id: number
  is_recently_verified: boolean
  last_verified_at: string | null
  verification_count: number
}

async function fetchVerification(placeId: number): Promise<VerificationResponse> {
  const res = await fetch(`/api/places/verify?place_id=${placeId}`)
  if (!res.ok) throw new Error('Verification status unavailable')
  return res.json()
}

function formatVerificationDate(dateStr: string | null): string {
  if (!dateStr) return '검증 대기 중'

  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '어제'
  if (diffDays < 7) return `${diffDays}일 전`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`
  return `${Math.floor(diffDays / 30)}개월 전`
}

export default function VerificationBadge({
  placeId,
  size = 'md',
  variant = 'badge',
}: VerificationBadgeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['verification', placeId],
    queryFn: () => fetchVerification(placeId),
    staleTime: 60 * 60_000, // 1 hour
  })

  if (isLoading || !data || !data.is_recently_verified) {
    return null
  }

  const verificationText = `최근 검증됨 (${formatVerificationDate(data.last_verified_at)})`

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-1">
        <CheckCircle
          size={size === 'sm' ? 14 : 16}
          className="text-green-500 shrink-0"
        />
        <span
          className={`font-medium text-green-600 ${
            size === 'sm' ? 'text-[11px]' : 'text-[13px]'
          }`}
        >
          {verificationText}
        </span>
      </div>
    )
  }

  // Default: badge variant
  return (
    <span
      className={`
        inline-flex items-center gap-1
        bg-green-50 text-green-600 font-semibold rounded-full
        ${size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-[12px] px-2 py-1'}
      `}
      title={verificationText}
    >
      <CheckCircle size={size === 'sm' ? 12 : 14} className="shrink-0" />
      최근 검증됨
    </span>
  )
}
