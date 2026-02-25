import { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  description?: string
  trend?: 'up' | 'down' | 'neutral'
}

export default function StatsCard({
  title,
  value,
  icon: Icon,
  description,
  trend = 'neutral',
}: StatsCardProps) {
  const trendColor = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-warm-400',
  }[trend]

  return (
    <div className="bg-white rounded-lg border border-warm-200 p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-warm-500 text-sm font-medium mb-1">{title}</p>
          <p className="text-3xl font-bold text-warm-800">{value}</p>
          {description && (
            <p className={`text-sm mt-2 ${trendColor}`}>{description}</p>
          )}
        </div>
        <div className="bg-coral-50 p-3 rounded-lg">
          <Icon size={24} className="text-coral-500" />
        </div>
      </div>
    </div>
  )
}
