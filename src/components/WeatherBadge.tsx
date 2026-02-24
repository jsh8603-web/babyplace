import { CloudRain, Sun, Cloud } from 'lucide-react'
import type { WeatherResponse } from '@/types'

interface WeatherBadgeProps {
  weather: WeatherResponse | null
  isLoading?: boolean
  onIndoorFilterToggle?: (indoor: boolean) => void
  isIndoorFilterActive?: boolean
}

export default function WeatherBadge({
  weather,
  isLoading,
  onIndoorFilterToggle,
  isIndoorFilterActive,
}: WeatherBadgeProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 bg-warm-100 px-3 py-2 rounded-xl animate-pulse">
        <div className="w-4 h-4 bg-warm-200 rounded-full" />
        <div className="w-12 h-3 bg-warm-200 rounded" />
      </div>
    )
  }

  if (!weather) return null

  const isRaining = weather.isRaining
  const temp = Math.round(weather.temperature)

  return (
    <button
      onClick={() => onIndoorFilterToggle?.(!isIndoorFilterActive)}
      className={`
        flex items-center gap-1.5 px-3 py-2 rounded-xl
        text-[13px] font-semibold transition-all duration-200
        min-h-[36px]
        ${isRaining && isIndoorFilterActive
          ? 'bg-coral-100 text-coral-600 ring-1 ring-coral-300'
          : isRaining
          ? 'bg-blue-50 text-blue-600'
          : 'bg-warm-100 text-warm-600'
        }
      `}
      aria-label={`현재 날씨: ${weather.description}, ${temp}°. ${isRaining ? '실내 필터 적용 가능' : ''}`}
      title={isRaining ? '탭하면 실내 장소만 표시' : weather.description}
    >
      {isRaining ? (
        <CloudRain size={16} className="text-blue-500 shrink-0" />
      ) : temp > 25 ? (
        <Sun size={16} className="text-amber-500 shrink-0" />
      ) : (
        <Cloud size={16} className="text-warm-400 shrink-0" />
      )}
      <span>{temp}°</span>
      {isRaining && (
        <span className="text-[11px]">
          {isIndoorFilterActive ? '실내만' : '비'}
        </span>
      )}
    </button>
  )
}
