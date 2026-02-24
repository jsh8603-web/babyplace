'use client'

import type { Place } from '@/types'

interface PlaceMarkerProps {
  place: Place
  isSelected?: boolean
  onClick?: (place: Place) => void
}

/**
 * PlaceMarker — rendered as a CustomOverlay via KakaoMap.
 * This component exports the HTML content string for use in KakaoMap's CustomOverlay,
 * and also exports a React component for storybook / preview purposes.
 */
export function getMarkerContent(place: Place, isSelected = false): string {
  const bg = isSelected ? '#E84530' : '#FF5C45'
  const size = isSelected ? '36px' : '28px'
  const fontSize = isSelected ? '14px' : '11px'

  const categoryEmoji: Record<string, string> = {
    '놀이': '🎪',
    '공원/놀이터': '🌳',
    '전시/체험': '🏛',
    '공연': '🎭',
    '동물/자연': '🐾',
    '식당/카페': '🍽',
    '도서관': '📚',
    '수영/물놀이': '🏊',
    '문화행사': '🎉',
    '편의시설': '🚼',
  }

  const emoji = categoryEmoji[place.category] ?? '📍'

  return `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      user-select: none;
    ">
      <div style="
        background: ${bg};
        color: white;
        border-radius: 50%;
        width: ${size};
        height: ${size};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${fontSize};
        box-shadow: 0 2px 8px rgba(255,92,69,0.35);
        border: 2px solid white;
      ">${emoji}</div>
      <div style="
        width: 0; height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 6px solid ${bg};
        margin-top: -1px;
      "></div>
    </div>
  `
}

export default function PlaceMarker({ place, isSelected = false, onClick }: PlaceMarkerProps) {
  const categoryEmoji: Record<string, string> = {
    '놀이': '🎪',
    '공원/놀이터': '🌳',
    '전시/체험': '🏛',
    '공연': '🎭',
    '동물/자연': '🐾',
    '식당/카페': '🍽',
    '도서관': '📚',
    '수영/물놀이': '🏊',
    '문화행사': '🎉',
    '편의시설': '🚼',
  }

  const emoji = categoryEmoji[place.category] ?? '📍'

  return (
    <button
      onClick={() => onClick?.(place)}
      className="flex flex-col items-center cursor-pointer"
      aria-label={`${place.name} 마커`}
    >
      <div
        className={`
          flex items-center justify-center rounded-full
          border-2 border-white text-white font-semibold
          shadow-md transition-all duration-200
          ${isSelected
            ? 'w-9 h-9 bg-coral-600 text-sm'
            : 'w-7 h-7 bg-coral-500 text-xs'
          }
        `}
      >
        {emoji}
      </div>
      <div
        className={`
          w-0 h-0 -mt-px
          border-l-[5px] border-r-[5px] border-l-transparent border-r-transparent
          ${isSelected ? 'border-t-[6px] border-t-coral-600' : 'border-t-[6px] border-t-coral-500'}
        `}
      />
    </button>
  )
}
