interface PopularityBarProps {
  score: number
  mentionCount?: number
  showLabel?: boolean
}

export default function PopularityBar({
  score,
  mentionCount,
  showLabel = true,
}: PopularityBarProps) {
  const clampedScore = Math.min(1, Math.max(0, score))
  const percent = Math.round(clampedScore * 100)

  const getBarColor = (s: number) => {
    if (s >= 0.7) return 'bg-coral-500'
    if (s >= 0.4) return 'bg-coral-400'
    if (s >= 0.2) return 'bg-coral-300'
    return 'bg-warm-300'
  }

  const getLabel = (s: number) => {
    if (s >= 0.8) return '핫플'
    if (s >= 0.6) return '인기'
    if (s >= 0.4) return '보통'
    return ''
  }

  const label = getLabel(clampedScore)

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 h-2 bg-warm-200 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`인기도 ${percent}%`}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${getBarColor(clampedScore)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <div className="flex items-center gap-1 shrink-0">
          {label && (
            <span className="text-xs font-semibold text-coral-500">{label}</span>
          )}
          <span className="text-xs font-semibold text-warm-600">
            {clampedScore.toFixed(2)}
          </span>
          {mentionCount !== undefined && (
            <span className="text-xs text-warm-400">
              ({mentionCount.toLocaleString()}건)
            </span>
          )}
        </div>
      )}
    </div>
  )
}
