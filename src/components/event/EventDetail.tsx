'use client'

import { useState } from 'react'
import { Heart, Share2, Calendar, Clock, MapPin, DollarSign, Users, ExternalLink, EyeOff, Eye } from 'lucide-react'
import type { Event, BlogMention } from '@/types'

function formatPostDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  const isNaver = sourceType.startsWith('naver')
  const isBlog = sourceType.includes('blog')

  return (
    <span
      className={`
        inline-flex items-center justify-center
        w-5 h-5 rounded text-[9px] font-bold shrink-0
        ${isNaver ? 'bg-green-500 text-white' : 'bg-warm-400 text-white'}
      `}
      title={isBlog ? '네이버 블로그' : '네이버 카페'}
    >
      {isNaver ? 'N' : 'C'}
    </span>
  )
}

interface EventDetailProps {
  event: Event
  topPosts?: BlogMention[]
  isFavorited?: boolean
  isHidden?: boolean
  onFavoriteToggle?: () => void
  onHideToggle?: () => void
  onShare?: () => void
  onBack?: () => void
}

function formatDateRange(startDate: string, endDate: string | null): string {
  const start = new Date(startDate)
  const end = endDate ? new Date(endDate) : null

  const formatDate = (d: Date) => {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
      d.getDate()
    ).padStart(2, '0')}`
  }

  if (!end) return formatDate(start)

  // Same day
  if (formatDate(start) === formatDate(end)) return formatDate(start)

  // Same year
  if (start.getFullYear() === end.getFullYear()) {
    return `${formatDate(start)} ~ ${formatDate(end)}`
  }

  return `${formatDate(start)} ~ ${formatDate(end)}`
}

function getSourceLabel(source: string): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    tour_api: { label: 'Tour API', className: 'bg-indigo-50 text-indigo-500 border-indigo-200' },
    seoul_events: { label: '서울시', className: 'bg-indigo-50 text-indigo-500 border-indigo-200' },
    interpark: { label: '인터파크', className: 'bg-teal-50 text-teal-600 border-teal-200' },
    babygo: { label: '베이비고', className: 'bg-teal-50 text-teal-600 border-teal-200' },
    blog_discovery: { label: '블로그', className: 'bg-warm-50 text-warm-500 border-warm-200' },
    exhibition_extraction: { label: '전시추출', className: 'bg-warm-50 text-warm-500 border-warm-200' },
  }
  return map[source] ?? { label: source, className: 'bg-warm-50 text-warm-500 border-warm-200' }
}

function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    '전시': '🖼️',
    '공연': '🎭',
    '체험': '🎨',
    '축제': '🎪',
    '교육': '📚',
    '기타': '📍',
  }
  return emojis[category] ?? '📍'
}

export default function EventDetail({
  event,
  topPosts,
  isFavorited = false,
  isHidden = false,
  onFavoriteToggle,
  onHideToggle,
  onShare,
  onBack,
}: EventDetailProps) {
  const [imgError, setImgError] = useState(false)
  const eventUrl = event.source_url ? new URL(event.source_url).hostname : null

  return (
    <div className="bg-warm-50 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top pt-4 pb-3 bg-white border-b border-warm-200">
        <button
          onClick={onBack}
          className="min-w-[48px] min-h-[48px] flex items-center justify-center -ml-2 text-warm-600"
          aria-label="뒤로가기"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <button
          onClick={onShare}
          className="min-w-[48px] min-h-[48px] flex items-center justify-center -mr-2 text-warm-500"
          aria-label="공유하기"
        >
          <Share2 size={20} />
        </button>
      </div>

      <div className="space-y-3 pb-8">
        {/* Poster image */}
        {event.poster_url && !imgError ? (
          <div className="w-full max-h-[750px] overflow-hidden bg-warm-100 flex items-center justify-center">
            <img
              src={event.poster_url}
              alt={event.name}
              className="max-w-full max-h-[750px] object-contain"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div className="w-full h-[200px] bg-gradient-to-br from-coral-100 to-coral-50 flex items-center justify-center">
            <span className="text-6xl opacity-50">{getCategoryEmoji(event.category)}</span>
          </div>
        )}

        {/* Title + favorite */}
        <div className="bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h1 className="text-[20px] font-bold text-warm-800 leading-snug flex-1">
              {event.name}
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={onHideToggle}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform active:scale-90"
                aria-label={isHidden ? '숨김 해제' : '숨기기'}
              >
                {isHidden ? (
                  <Eye size={22} className="text-warm-500" />
                ) : (
                  <EyeOff size={22} className="text-warm-300" />
                )}
              </button>
              <button
                onClick={onFavoriteToggle}
                className="min-w-[48px] min-h-[48px] flex items-center justify-center -mr-2 transition-transform active:scale-90"
                aria-label={isFavorited ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              >
                <Heart
                  size={24}
                  className={isFavorited ? 'text-coral-500 fill-coral-500' : 'text-warm-300'}
                />
              </button>
            </div>
          </div>

          {/* Category + source + venue */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[13px] font-medium text-warm-500 bg-warm-100 px-2 py-0.5 rounded-full">
              {event.category}
            </span>
            {(() => {
              const src = getSourceLabel(event.source)
              return (
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${src.className}`}>
                  {src.label}
                </span>
              )
            })()}
            {event.venue_name && (
              <span className="text-[13px] font-medium text-coral-600 bg-coral-50 px-2 py-0.5 rounded-full">
                {event.venue_name}
              </span>
            )}
          </div>
        </div>

        {/* Event details */}
        <div className="bg-white px-4 py-4 space-y-3">
          {/* Date range */}
          <div className="flex items-start gap-3">
            <Calendar size={18} className="text-warm-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              {event.start_date && event.date_confirmed !== false ? (
                <p className="text-[15px] font-semibold text-warm-600">
                  {formatDateRange(event.start_date, event.end_date)}
                </p>
              ) : (
                <p className="text-[15px] font-medium text-amber-600">
                  일정 미확인
                </p>
              )}
              {event.time_info && (
                <p className="text-[13px] text-warm-500 mt-0.5">{event.time_info}</p>
              )}
            </div>
          </div>

          {/* Address */}
          {event.venue_address && (
            <div className="flex items-start gap-3">
              <MapPin size={18} className="text-warm-400 shrink-0 mt-0.5" />
              <span className="text-[15px] text-warm-600 leading-relaxed">
                {event.venue_address}
              </span>
            </div>
          )}

          {/* Price info */}
          {event.price_info && (
            <div className="flex items-start gap-3">
              <DollarSign size={18} className="text-warm-400 shrink-0 mt-0.5" />
              <span className="text-[15px] text-warm-600">{event.price_info}</span>
            </div>
          )}

          {/* Age range */}
          {event.age_range && (
            <div className="flex items-start gap-3">
              <Users size={18} className="text-warm-400 shrink-0 mt-0.5" />
              <span className="text-[15px] text-warm-600">{event.age_range}</span>
            </div>
          )}
        </div>

        {/* Description */}
        {event.description && (
          <div className="bg-white px-4 py-4">
            <h2 className="text-[15px] font-semibold text-warm-700 mb-2">행사 소개</h2>
            <p className="text-[14px] text-warm-600 leading-relaxed whitespace-pre-wrap">
              {event.description}
            </p>
          </div>
        )}

        {/* Top blog posts */}
        {topPosts && topPosts.length > 0 && (
          <div className="bg-white px-4 py-4">
            <h2 className="text-[15px] font-semibold text-warm-700 mb-3">
              인기 포스팅 TOP {topPosts.length}
            </h2>
            <div className="space-y-0">
              {topPosts.map((post, idx) => (
                <a
                  key={post.id}
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="
                    flex items-start gap-3 py-3
                    border-b border-warm-200 last:border-0
                    hover:bg-warm-50 transition-colors -mx-4 px-4
                  "
                  aria-label={`${idx + 1}번째 포스팅: ${post.title ?? '제목 없음'}`}
                >
                  <span className="text-[13px] font-semibold text-warm-400 w-4 shrink-0 pt-0.5">
                    {idx + 1}
                  </span>
                  <SourceBadge sourceType={post.source_type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-warm-700 leading-snug line-clamp-2">
                      {post.title ?? '(제목 없음)'}
                    </p>
                    {post.snippet && (
                      <p className="text-[12px] text-warm-400 mt-0.5 line-clamp-1">
                        {post.snippet}
                      </p>
                    )}
                    <p className="text-[12px] text-warm-400 mt-0.5">
                      {formatPostDate(post.post_date)}
                    </p>
                  </div>
                  <ExternalLink size={14} className="text-warm-300 shrink-0 mt-1" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Source link */}
        {event.source_url && (
          <div className="bg-white px-4 py-4">
            <a
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center justify-between gap-3
                w-full py-3.5 px-3 rounded-xl
                bg-gradient-to-r from-coral-50 to-coral-100 text-coral-600 font-semibold
                border border-coral-200
                hover:bg-gradient-to-r hover:from-coral-100 hover:to-coral-200
                transition-colors
                active:bg-coral-200
              "
            >
              <span className="text-[14px]">원본 사이트에서 보기</span>
              <ExternalLink size={18} className="shrink-0" />
            </a>
            <p className="text-[12px] text-warm-400 mt-2 text-center">{eventUrl || '링크'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
