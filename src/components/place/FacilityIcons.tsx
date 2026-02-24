import {
  ParkingCircle,
  SmilePlus,
  ArrowUpDown,
  Armchair,
  Accessibility,
  Baby,
} from 'lucide-react'
import type { FacilityTag } from '@/types'

interface FacilityIconsProps {
  tags: string[]
  size?: 'sm' | 'md'
}

interface FacilityConfig {
  label: string
  icon: React.ReactNode
  colorClass: string
}

function getFacilityConfig(tag: FacilityTag | string, iconSize: number): FacilityConfig {
  const configs: Record<string, FacilityConfig> = {
    '수유실': {
      label: '수유실',
      icon: <Baby size={iconSize} />,
      colorClass: 'text-coral-500',
    },
    '기저귀교환대': {
      label: '교환대',
      icon: <NursingIcon size={iconSize} />,
      colorClass: 'text-coral-400',
    },
    '남성화장실교환대': {
      label: '남성교환',
      icon: <NursingIcon size={iconSize} />,
      colorClass: 'text-warm-500',
    },
    '유모차접근': {
      label: '유모차',
      icon: <Accessibility size={iconSize} />,
      colorClass: 'text-indoor',
    },
    '아기의자': {
      label: '의자',
      icon: <Armchair size={iconSize} />,
      colorClass: 'text-warm-500',
    },
    '주차': {
      label: '주차',
      icon: <ParkingCircle size={iconSize} />,
      colorClass: 'text-warm-600',
    },
    '예스키즈존': {
      label: '키즈존',
      icon: <SmilePlus size={iconSize} />,
      colorClass: 'text-success',
    },
    '엘리베이터': {
      label: 'EV',
      icon: <ArrowUpDown size={iconSize} />,
      colorClass: 'text-warm-500',
    },
  }

  return configs[tag] ?? {
    label: tag,
    icon: <Baby size={iconSize} />,
    colorClass: 'text-warm-400',
  }
}

function NursingIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="2" />
      <path d="M8 12c0-2 1.5-4 4-4s4 2 4 4" />
      <path d="M9 17l1-5h4l1 5" />
    </svg>
  )
}

export default function FacilityIcons({ tags, size = 'sm' }: FacilityIconsProps) {
  if (!tags || tags.length === 0) return null

  const iconSize = size === 'sm' ? 16 : 20
  const containerClass = size === 'sm' ? 'gap-1.5' : 'gap-2'
  const tagClass = size === 'sm'
    ? 'px-1.5 py-0.5 rounded-md text-[11px]'
    : 'px-2 py-1 rounded-lg text-xs'

  return (
    <div className={`flex flex-wrap items-center ${containerClass}`} role="list" aria-label="편의시설">
      {tags.map((tag) => {
        const config = getFacilityConfig(tag, iconSize)
        return (
          <div
            key={tag}
            role="listitem"
            title={config.label}
            className={`
              flex items-center gap-1 bg-warm-50 ${config.colorClass}
              ${tagClass} font-medium
            `}
          >
            {config.icon}
            <span className="text-warm-600">{config.label}</span>
          </div>
        )
      })}
    </div>
  )
}
