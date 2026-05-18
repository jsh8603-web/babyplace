'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Drawer } from 'vaul'
import type { PlaceCategory, PlaceFeedbackReason } from '@/types'

const CATEGORIES: { value: PlaceCategory; emoji: string }[] = [
  { value: '놀이', emoji: '🎪' },
  { value: '공원/놀이터', emoji: '🌳' },
  { value: '전시/체험', emoji: '🏛' },
  { value: '공연', emoji: '🎭' },
  { value: '동물/자연', emoji: '🐾' },
  { value: '식당/카페', emoji: '🍽' },
  { value: '도서관', emoji: '📚' },
  { value: '수영/물놀이', emoji: '🏊' },
  { value: '문화행사', emoji: '🎉' },
  { value: '편의시설', emoji: '🚼' },
]

const REASONS: { value: PlaceFeedbackReason; label: string }[] = [
  { value: 'not_baby', label: '아기에게 부적합' },
  { value: 'closed', label: '폐업·이전' },
  { value: 'wrong_category', label: '분류가 틀림' },
  { value: 'other', label: '기타' },
]

export interface HideTarget {
  id: number
  name: string
  category: string
}

interface PlaceHideSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  place: HideTarget | null
  onSubmit: (payload: {
    type: 'hide' | 'recategorize'
    reason: PlaceFeedbackReason
    newCategory?: PlaceCategory
  }) => void
}

export default function PlaceHideSheet({
  open,
  onOpenChange,
  place,
  onSubmit,
}: PlaceHideSheetProps) {
  const [reason, setReason] = useState<PlaceFeedbackReason | null>(null)
  const [newCategory, setNewCategory] = useState<PlaceCategory | null>(null)

  if (!place) return null

  const isRecat = reason === 'wrong_category'
  const canSubmit =
    reason != null && (!isRecat || (newCategory != null && newCategory !== place.category))

  const reset = () => {
    setReason(null)
    setNewCategory(null)
  }

  const handleSubmit = () => {
    if (!canSubmit || !reason) return
    if (isRecat && newCategory) {
      onSubmit({ type: 'recategorize', reason, newCategory })
    } else {
      onSubmit({ type: 'hide', reason })
    }
    reset()
    onOpenChange(false)
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="
            fixed bottom-0 left-0 right-0 z-50
            bg-white rounded-t-[20px] max-h-[85dvh]
            flex flex-col
            shadow-lg
          "
          aria-label="장소 가리기"
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-warm-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-warm-200">
            <Drawer.Title className="text-[17px] font-semibold text-warm-800 truncate pr-2">
              {place.name} 가리기
            </Drawer.Title>
            <button
              onClick={() => onOpenChange(false)}
              className="min-w-[48px] min-h-[48px] flex items-center justify-center text-warm-500"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            <section>
              <h3 className="text-[13px] font-semibold text-warm-500 uppercase tracking-wide mb-3">
                가리는 이유
              </h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label="이유 선택">
                {REASONS.map(({ value, label }) => {
                  const sel = reason === value
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        setReason(value)
                        if (value !== 'wrong_category') setNewCategory(null)
                      }}
                      className={`
                        flex items-center h-9 px-3 rounded-full
                        text-[13px] font-medium border transition-all
                        ${sel
                          ? 'bg-coral-200 border-coral-400 text-coral-700'
                          : 'bg-warm-100 border-warm-200 text-warm-600'
                        }
                      `}
                      aria-pressed={sel}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </section>

            {isRecat && (
              <section>
                <h3 className="text-[13px] font-semibold text-warm-500 uppercase tracking-wide mb-1">
                  올바른 분류
                </h3>
                <p className="text-[12px] text-warm-400 mb-3">현재: {place.category}</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="분류 선택">
                  {CATEGORIES.filter((c) => c.value !== place.category).map(
                    ({ value, emoji }) => {
                      const sel = newCategory === value
                      return (
                        <button
                          key={value}
                          onClick={() => setNewCategory(value)}
                          className={`
                            flex items-center gap-1.5 h-9 px-3 rounded-full
                            text-[13px] font-medium border transition-all
                            ${sel
                              ? 'bg-coral-200 border-coral-400 text-coral-700'
                              : 'bg-warm-100 border-warm-200 text-warm-600'
                            }
                          `}
                          aria-pressed={sel}
                        >
                          <span>{emoji}</span>
                          <span>{value}</span>
                        </button>
                      )
                    }
                  )}
                </div>
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-warm-200">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`
                w-full h-12 rounded-xl text-[15px] font-semibold transition-colors
                ${canSubmit
                  ? 'bg-coral-500 text-white active:bg-coral-600'
                  : 'bg-warm-200 text-warm-400'
                }
              `}
            >
              {isRecat ? '분류 변경하고 가리기' : '가리기'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
