'use client'

import { X } from 'lucide-react'
import { Drawer } from 'vaul'
import type { PlaceCategory, FacilityTag, SortOption } from '@/types'

const CATEGORIES: { value: PlaceCategory; emoji: string; label: string }[] = [
  { value: '놀이', emoji: '🎪', label: '놀이' },
  { value: '공원/놀이터', emoji: '🌳', label: '공원/놀이터' },
  { value: '전시/체험', emoji: '🏛', label: '전시/체험' },
  { value: '공연', emoji: '🎭', label: '공연' },
  { value: '동물/자연', emoji: '🐾', label: '동물/자연' },
  { value: '식당/카페', emoji: '🍽', label: '식당/카페' },
  { value: '도서관', emoji: '📚', label: '도서관' },
  { value: '수영/물놀이', emoji: '🏊', label: '수영/물놀이' },
  { value: '문화행사', emoji: '🎉', label: '문화행사' },
  { value: '편의시설', emoji: '🚼', label: '편의시설' },
]

const FACILITY_TAGS: { value: FacilityTag; emoji: string; label: string }[] = [
  { value: '수유실', emoji: '🍼', label: '수유실' },
  { value: '기저귀교환대', emoji: '🚼', label: '기저귀교환대' },
  { value: '남성화장실교환대', emoji: '👨', label: '남성교환대' },
  { value: '유모차접근', emoji: '👶', label: '유모차접근' },
  { value: '아기의자', emoji: '🪑', label: '아기의자' },
  { value: '주차', emoji: '🅿', label: '주차' },
  { value: '예스키즈존', emoji: '😊', label: '예스키즈존' },
  { value: '엘리베이터', emoji: '🛗', label: '엘리베이터' },
]

interface FilterState {
  categories: PlaceCategory[]
  tags: FacilityTag[]
  sort: SortOption
}

interface FilterPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
}

export default function FilterPanel({
  open,
  onOpenChange,
  filters,
  onFiltersChange,
}: FilterPanelProps) {
  const totalActive = filters.categories.length + filters.tags.length

  const toggleCategory = (cat: PlaceCategory) => {
    const next = filters.categories.includes(cat)
      ? filters.categories.filter((c) => c !== cat)
      : [...filters.categories, cat]
    onFiltersChange({ ...filters, categories: next })
  }

  const toggleTag = (tag: FacilityTag) => {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag]
    onFiltersChange({ ...filters, tags: next })
  }

  const handleApply = () => {
    onOpenChange(false)
  }

  const handleReset = () => {
    onFiltersChange({ categories: [], tags: [], sort: 'distance' })
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Drawer.Content
          className="
            fixed bottom-0 left-0 right-0 z-50
            bg-white rounded-t-[20px] max-h-[85dvh]
            flex flex-col
            shadow-lg
          "
          aria-label="필터 패널"
        >
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 bg-warm-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-warm-200">
            <Drawer.Title className="text-[17px] font-semibold text-warm-800">
              필터
            </Drawer.Title>
            <div className="flex items-center gap-2">
              {totalActive > 0 && (
                <button
                  onClick={handleReset}
                  className="text-[13px] text-warm-400 px-2 py-1 min-h-[36px]"
                >
                  초기화
                </button>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-warm-500"
                aria-label="필터 닫기"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            {/* Categories */}
            <section>
              <h3 className="text-[13px] font-semibold text-warm-500 uppercase tracking-wide mb-3">
                카테고리
              </h3>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="카테고리 선택"
              >
                {CATEGORIES.map(({ value, emoji, label }) => {
                  const isSelected = filters.categories.includes(value)
                  return (
                    <button
                      key={value}
                      onClick={() => toggleCategory(value)}
                      className={`
                        flex items-center gap-1.5 h-9 px-3 rounded-full
                        text-[13px] font-medium border transition-all
                        ${isSelected
                          ? 'bg-coral-200 border-coral-400 text-coral-700'
                          : 'bg-warm-100 border-warm-200 text-warm-600'
                        }
                      `}
                      aria-pressed={isSelected}
                    >
                      <span>{emoji}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Facility tags */}
            <section>
              <h3 className="text-[13px] font-semibold text-warm-500 uppercase tracking-wide mb-3">
                편의시설
              </h3>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="편의시설 선택"
              >
                {FACILITY_TAGS.map(({ value, emoji, label }) => {
                  const isSelected = filters.tags.includes(value)
                  return (
                    <button
                      key={value}
                      onClick={() => toggleTag(value)}
                      className={`
                        flex items-center gap-1.5 h-9 px-3 rounded-full
                        text-[13px] font-medium border transition-all
                        ${isSelected
                          ? 'bg-coral-200 border-coral-400 text-coral-700'
                          : 'bg-warm-100 border-warm-200 text-warm-600'
                        }
                      `}
                      aria-pressed={isSelected}
                    >
                      <span>{emoji}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Sort */}
            <section>
              <h3 className="text-[13px] font-semibold text-warm-500 uppercase tracking-wide mb-3">
                정렬
              </h3>
              <div
                className="flex gap-3"
                role="radiogroup"
                aria-label="정렬 방식"
              >
                {(
                  [
                    { value: 'distance' as SortOption, label: '거리순' },
                    { value: 'popularity' as SortOption, label: '인기순' },
                    { value: 'recent' as SortOption, label: '최신순' },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 cursor-pointer min-h-[48px]"
                  >
                    <input
                      type="radio"
                      name="sort"
                      value={value}
                      checked={filters.sort === value}
                      onChange={() => onFiltersChange({ ...filters, sort: value })}
                      className="w-4 h-4 accent-coral-500"
                    />
                    <span className="text-[15px] text-warm-700">{label}</span>
                  </label>
                ))}
              </div>
            </section>
          </div>

          {/* Apply button */}
          <div className="px-4 py-4 border-t border-warm-200 pb-safe-bottom">
            <button
              onClick={handleApply}
              className="
                w-full h-14 bg-coral-500 text-white
                rounded-xl font-semibold text-[16px]
                shadow-md active:bg-coral-600 transition-colors
              "
            >
              필터 적용{totalActive > 0 ? ` (${totalActive}개)` : ''}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
