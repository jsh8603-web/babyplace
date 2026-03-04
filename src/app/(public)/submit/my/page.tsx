'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Calendar, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

interface Submission {
  id: number
  name: string
  category: string
  submission_status: 'pending' | 'approved' | 'rejected'
  submitted_at: string
  type: 'place' | 'event'
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: '대기중', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  approved: { label: '승인', className: 'bg-green-50 text-green-700 border-green-200' },
  rejected: { label: '반려', className: 'bg-red-50 text-red-700 border-red-200' },
}

export default function MySubmissionsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Submission[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      const [placesRes, eventsRes] = await Promise.all([
        supabase
          .from('places')
          .select('id, name, category, submission_status, submitted_at')
          .eq('submitted_by', user.id)
          .not('submission_status', 'is', null)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('events')
          .select('id, name, category, submission_status, submitted_at')
          .eq('submitted_by', user.id)
          .not('submission_status', 'is', null)
          .order('submitted_at', { ascending: false }),
      ])

      const places = (placesRes.data || []).map((p) => ({ ...p, type: 'place' as const }))
      const events = (eventsRes.data || []).map((e) => ({ ...e, type: 'event' as const }))

      setItems(
        [...places, ...events].sort(
          (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
        )
      )
      setIsLoading(false)
    }
    load()
  }, [router])

  return (
    <div className="h-dvh flex flex-col bg-warm-50">
      {/* Header */}
      <header className="bg-white border-b border-warm-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1 text-warm-600">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-warm-800">내 제안 목록</h1>
      </header>

      <div className="flex-1 overflow-y-auto pb-[80px]">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-coral-500" size={32} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <MapPin size={32} className="text-warm-300 mx-auto mb-3" />
            <p className="text-warm-500">아직 제안한 항목이 없습니다</p>
            <button
              onClick={() => router.push('/submit')}
              className="mt-4 px-4 py-2 bg-coral-500 text-white rounded-lg text-sm font-medium"
            >
              장소/이벤트 추천하기
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {items.map((item) => {
              const badge = STATUS_BADGE[item.submission_status]
              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className="bg-white rounded-xl border border-warm-200 p-4"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {item.type === 'place' ? (
                      <MapPin size={14} className="text-coral-500" />
                    ) : (
                      <Calendar size={14} className="text-coral-500" />
                    )}
                    <span className="font-medium text-warm-800 text-sm truncate flex-1">
                      {item.name}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-warm-400 mt-1">
                    <span>{item.type === 'place' ? '장소' : '이벤트'}</span>
                    <span>{item.category}</span>
                    <span>{new Date(item.submitted_at).toLocaleDateString('ko-KR')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
