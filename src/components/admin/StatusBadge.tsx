type KeywordStatus = 'ACTIVE' | 'DECLINING' | 'EXHAUSTED' | 'SEASONAL' | 'NEW'
type PipelineStatus = 'success' | 'error' | 'running'

interface StatusBadgeProps {
  status: KeywordStatus | PipelineStatus
  size?: 'sm' | 'md'
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const styleMap: Record<string, { bg: string; text: string; label: string }> = {
    ACTIVE: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      label: 'ACTIVE',
    },
    DECLINING: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-700',
      label: 'DECLINING',
    },
    EXHAUSTED: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      label: 'EXHAUSTED',
    },
    SEASONAL: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      label: 'SEASONAL',
    },
    NEW: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      label: 'NEW',
    },
    success: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      label: 'Success',
    },
    error: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      label: 'Error',
    },
    running: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      label: 'Running',
    },
  }

  const style = styleMap[status] || styleMap.NEW
  const padding = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  const fontWeight = size === 'sm' ? 'font-medium' : 'font-semibold'

  return (
    <span
      className={`
        inline-flex items-center rounded-full
        ${padding} ${fontWeight} ${style.bg} ${style.text}
      `}
    >
      {style.label}
    </span>
  )
}
