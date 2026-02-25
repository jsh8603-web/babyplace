'use client'

import { Heart, Share2, Phone, Clock, MapPin, Navigation, ExternalLink, CalendarCheck } from 'lucide-react'
import type { Place, BlogMention } from '@/types'
import FacilityIcons from './FacilityIcons'
import PopularityBar from './PopularityBar'

interface PlaceDetailProps {
  place: Place
  topPosts: BlogMention[]
  isFavorited?: boolean
  distance?: number
  onFavoriteToggle?: () => void
  onVisitRecord?: () => void
  onShare?: () => void
  onBack?: () => void
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`
  return `${(meters / 1000).toFixed(1)}km`
}

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

export default function PlaceDetail({
  place,
  topPosts,
  isFavorited = false,
  distance,
  onFavoriteToggle,
  onVisitRecord,
  onShare,
  onBack,
}: PlaceDetailProps) {
  const kakaoNavUrl = `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`

  return (
    <div className="bg-warm-50 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top pt-4 pb-3 bg-white border-b border-warm-200">
        <button
          onClick={onBack}
          className="min-w-[48px] min-h-[48px] flex items-center justify-center -ml-2 text-warm-600"
          aria-label="뒤로가기"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        {/* Hero image placeholder */}
        <div className="w-full h-[200px] bg-gradient-to-br from-coral-100 to-coral-50 flex items-center justify-center">
          <span className="text-5xl opacity-50">
            {place.category === '놀이' ? '🎪' :
             place.category === '공원/놀이터' ? '🌳' :
             place.category === '전시/체험' ? '🏛' :
             place.category === '동물/자연' ? '🐾' :
             place.category === '식당/카페' ? '🍽' :
             place.category === '도서관' ? '📚' :
             place.category === '수영/물놀이' ? '🏊' :
             '📍'}
          </span>
        </div>

        {/* Name + favorite */}
        <div className="bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h1 className="text-[20px] font-bold text-warm-800 leading-snug flex-1">
              {place.name}
            </h1>
            <div className="flex items-center gap-1">
              <button
                onClick={onVisitRecord}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform active:scale-90"
                aria-label="방문 기록"
              >
                <CalendarCheck size={22} className="text-warm-300" />
              </button>
              <button
                onClick={onFavoriteToggle}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 transition-transform active:scale-90"
                aria-label={isFavorited ? '즐겨찾기 해제' : '즐겨찾기 추가'}
              >
                <Heart
                  size={24}
                  className={isFavorited ? 'text-coral-500 fill-coral-500' : 'text-warm-300'}
                />
              </button>
            </div>
          </div>

          {/* Category + distance */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[13px] font-medium text-warm-500 bg-warm-100 px-2 py-0.5 rounded-full">
              {place.category}
            </span>
            {place.is_indoor !== null && (
              <span className={`text-[13px] font-medium px-2 py-0.5 rounded-full ${place.is_indoor ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                {place.is_indoor ? '실내' : '실외'}
              </span>
            )}
            {distance !== undefined && (
              <span className="flex items-center gap-1 text-[13px] font-semibold text-warm-600 ml-auto">
                <Navigation size={13} className="text-coral-400" />
                {formatDistance(distance)}
              </span>
            )}
          </div>

          {/* Facility icons */}
          {place.tags && place.tags.length > 0 && (
            <FacilityIcons tags={place.tags} size="md" />
          )}
        </div>

        {/* Popularity bar */}
        {place.popularity_score > 0 && (
          <div className="bg-white px-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-semibold text-warm-600">소셜 인기도</span>
            </div>
            <PopularityBar
              score={place.popularity_score}
              mentionCount={place.mention_count}
              showLabel={true}
            />
          </div>
        )}

        {/* Contact + hours */}
        <div className="bg-white px-4 py-4 space-y-3">
          {place.road_address && (
            <div className="flex items-start gap-3">
              <MapPin size={18} className="text-warm-400 shrink-0 mt-0.5" />
              <span className="text-[15px] text-warm-600 leading-relaxed">
                {place.road_address}
              </span>
            </div>
          )}
          {place.phone && (
            <div className="flex items-center gap-3">
              <Phone size={18} className="text-warm-400 shrink-0" />
              <a
                href={`tel:${place.phone}`}
                className="text-[15px] text-info"
              >
                {place.phone}
              </a>
            </div>
          )}
          {place.description && (
            <div className="flex items-start gap-3">
              <Clock size={18} className="text-warm-400 shrink-0 mt-0.5" />
              <span className="text-[15px] text-warm-600 leading-relaxed">
                {place.description}
              </span>
            </div>
          )}

          {/* Navigation CTA */}
          <a
            href={kakaoNavUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="
              mt-2 flex items-center justify-center gap-2
              w-full py-3.5 rounded-xl
              bg-coral-500 text-white text-[15px] font-semibold
              shadow-md active:bg-coral-600 transition-colors
            "
            aria-label="카카오맵에서 길찾기"
          >
            <Navigation size={18} />
            카카오맵에서 길찾기
          </a>
        </div>

        {/* Top 5 blog posts */}
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
      </div>
    </div>
  )
}
