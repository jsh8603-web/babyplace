'use client'

import type { PlaceCategory } from '@/types'

const CATEGORIES: { value: PlaceCategory; emoji: string; label: string }[] = [
  { value: '놀이', emoji: '🎪', label: '놀이' },
  { value: '공원/놀이터', emoji: '🌳', label: '공원' },
  { value: '전시/체험', emoji: '🏛', label: '전시' },
  { value: '공연', emoji: '🎭', label: '공연' },
  { value: '동물/자연', emoji: '🐾', label: '동물' },
  { value: '식당/카페', emoji: '🍽', label: '식당' },
  { value: '도서관', emoji: '📚', label: '도서관' },
  { value: '수영/물놀이', emoji: '🏊', label: '수영' },
  { value: '문화행사', emoji: '🎉', label: '행사' },
  { value: '편의시설', emoji: '🚼', label: '편의' },
]

interface CategoryChipsProps {
  selected: PlaceCategory[]
  onChange: (selected: PlaceCategory[]) => void
}

export default function CategoryChips({ selected, onChange }: CategoryChipsProps) {
  const toggle = (cat: PlaceCategory) => {
    if (selected.includes(cat)) {
      onChange(selected.filter((c) => c !== cat))
    } else {
      onChange([...selected, cat])
    }
  }

  return (
    <div
      className="flex gap-2 px-4 overflow-x-auto scrollbar-hide py-1"
      role="group"
      aria-label="카테고리 필터"
    >
      {CATEGORIES.map(({ value, emoji, label }) => {
        const isSelected = selected.includes(value)
        return (
          <button
            key={value}
            onClick={() => toggle(value)}
            className={`
              flex items-center gap-1 shrink-0 h-8 px-3 rounded-full
              text-[13px] font-medium transition-all duration-150
              border
              ${isSelected
                ? 'bg-coral-200 border-coral-400 text-coral-700'
                : 'bg-warm-100 border-warm-200 text-warm-600 hover:bg-warm-200'
              }
            `}
            aria-pressed={isSelected}
            aria-label={`${label} 카테고리 ${isSelected ? '선택됨' : '선택 안됨'}`}
          >
            <span>{emoji}</span>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
