'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Calendar, ArrowLeft, ExternalLink, Loader2, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import BottomNav from '@/components/BottomNav'

type Tab = 'place' | 'event'

const PLACE_CATEGORIES = [
  '놀이', '공원/놀이터', '전시/체험', '공연', '동물/자연',
  '식당/카페', '도서관', '수영/물놀이', '문화행사', '편의시설',
]

const EVENT_CATEGORIES = [
  '체험', '전시/체험', '공연', '문화행사', '놀이', '동물/자연',
]

interface KakaoPreview {
  name: string
  address: string
  phone: string | null
  category: string | null
  lat: number
  lng: number
  kakao_place_id: string
}

export default function SubmitPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('place')
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Place fields
  const [placeName, setPlaceName] = useState('')
  const [placeCategory, setPlaceCategory] = useState('놀이')
  const [kakaoUrl, setKakaoUrl] = useState('')
  const [placeAddress, setPlaceAddress] = useState('')
  const [placePhone, setPlacePhone] = useState('')
  const [placeDesc, setPlaceDesc] = useState('')
  const [kakaoPreview, setKakaoPreview] = useState<KakaoPreview | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)

  // Event fields
  const [eventName, setEventName] = useState('')
  const [eventCategory, setEventCategory] = useState('체험')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [venueName, setVenueName] = useState('')
  const [venueAddress, setVenueAddress] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [priceInfo, setPriceInfo] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [eventDesc, setEventDesc] = useState('')

  // Auth check
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(!!data.user)
    })
  }, [])

  // Kakao URL preview with debounce
  const fetchKakaoPreview = useCallback(async (url: string) => {
    if (!url.includes('place.map.kakao.com/')) {
      setKakaoPreview(null)
      return
    }
    setIsPreviewLoading(true)
    try {
      const res = await fetch(`/api/submit/kakao-preview?url=${encodeURIComponent(url)}`)
      if (res.ok) {
        const data = await res.json()
        setKakaoPreview(data)
        if (data.name && !placeName) setPlaceName(data.name)
        if (data.address) setPlaceAddress(data.address)
        if (data.phone) setPlacePhone(data.phone)
      } else {
        setKakaoPreview(null)
      }
    } catch {
      setKakaoPreview(null)
    } finally {
      setIsPreviewLoading(false)
    }
  }, [placeName])

  useEffect(() => {
    if (!kakaoUrl) { setKakaoPreview(null); return }
    const timer = setTimeout(() => fetchKakaoPreview(kakaoUrl), 500)
    return () => clearTimeout(timer)
  }, [kakaoUrl, fetchKakaoPreview])

  const handleSubmitPlace = async () => {
    if (!placeName.trim()) return
    setIsSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/submit/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: placeName,
          category: placeCategory,
          kakao_url: kakaoUrl || undefined,
          address: placeAddress || undefined,
          phone: placePhone || undefined,
          description: placeDesc || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ text: data.message, type: 'success' })
        setPlaceName(''); setKakaoUrl(''); setPlaceAddress('')
        setPlacePhone(''); setPlaceDesc(''); setKakaoPreview(null)
      } else {
        setMessage({ text: data.error, type: 'error' })
      }
    } catch {
      setMessage({ text: '제출에 실패했습니다', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitEvent = async () => {
    if (!eventName.trim()) return
    setIsSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/submit/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: eventName,
          category: eventCategory,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          venue_name: venueName || undefined,
          venue_address: venueAddress || undefined,
          source_url: sourceUrl || undefined,
          price_info: priceInfo || undefined,
          age_range: ageRange || undefined,
          description: eventDesc || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ text: data.message, type: 'success' })
        setEventName(''); setStartDate(''); setEndDate('')
        setVenueName(''); setVenueAddress(''); setSourceUrl('')
        setPriceInfo(''); setAgeRange(''); setEventDesc('')
      } else {
        setMessage({ text: data.error, type: 'error' })
      }
    } catch {
      setMessage({ text: '제출에 실패했습니다', type: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoggedIn === null) {
    return (
      <div className="h-dvh flex items-center justify-center bg-warm-50">
        <Loader2 className="animate-spin text-coral-500" size={32} />
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="h-dvh flex flex-col bg-warm-50">
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <MapPin size={48} className="text-coral-400 mb-4" />
          <h2 className="text-xl font-bold text-warm-800 mb-2">장소/이벤트 추천</h2>
          <p className="text-warm-500 mb-6">
            아기와 함께 가기 좋은 장소나 이벤트를 추천해주세요!
            <br />로그인 후 이용할 수 있습니다.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="px-6 py-3 bg-coral-500 text-white rounded-xl font-medium hover:bg-coral-600 transition"
          >
            로그인하기
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  const inputClass = 'w-full px-3 py-2.5 rounded-lg border border-warm-200 text-sm text-warm-800 placeholder:text-warm-400 focus:outline-none focus:ring-2 focus:ring-coral-300 focus:border-transparent bg-white'
  const labelClass = 'block text-sm font-medium text-warm-700 mb-1'

  return (
    <div className="h-dvh flex flex-col bg-warm-50">
      {/* Header */}
      <header className="bg-white border-b border-warm-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={() => router.back()} className="p-1 text-warm-600">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-lg font-bold text-warm-800">장소/이벤트 추천</h1>
        <button
          onClick={() => router.push('/submit/my')}
          className="ml-auto p-1 text-warm-500"
          title="내 제안 목록"
        >
          <FileText size={20} />
        </button>
      </header>

      {/* Tabs */}
      <div className="flex bg-white border-b border-warm-200 shrink-0">
        {([['place', '장소 추천', MapPin], ['event', '이벤트 추천', Calendar]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setMessage(null) }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors ${
                tab === key
                  ? 'text-coral-600 border-b-2 border-coral-500'
                  : 'text-warm-400'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          )
        )}
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto pb-[80px]">
        <div className="p-4 space-y-4">
          {/* Message */}
          {message && (
            <div
              className={`p-3 rounded-lg text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {message.text}
            </div>
          )}

          {tab === 'place' ? (
            <>
              {/* Kakao URL */}
              <div>
                <label className={labelClass}>
                  카카오맵 URL <span className="text-warm-400 font-normal">(권장)</span>
                </label>
                <input
                  type="url"
                  value={kakaoUrl}
                  onChange={(e) => setKakaoUrl(e.target.value)}
                  placeholder="place.map.kakao.com/..."
                  className={inputClass}
                />
                <p className="text-xs text-warm-400 mt-1 flex items-center gap-1">
                  <ExternalLink size={12} />
                  카카오맵에서 장소를 검색하고 URL을 붙여넣으면 정보가 자동으로 채워집니다
                </p>
                {isPreviewLoading && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-warm-400">
                    <Loader2 size={14} className="animate-spin" /> 정보 불러오는 중...
                  </div>
                )}
                {kakaoPreview && (
                  <div className="mt-2 p-3 rounded-lg bg-coral-50 border border-coral-100 text-sm">
                    <p className="font-medium text-warm-800">{kakaoPreview.name}</p>
                    <p className="text-warm-500 text-xs">{kakaoPreview.address}</p>
                    {kakaoPreview.phone && (
                      <p className="text-warm-500 text-xs">{kakaoPreview.phone}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Name */}
              <div>
                <label className={labelClass}>
                  장소 이름 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  placeholder="예: 키즈카페 놀이나라"
                  className={inputClass}
                />
              </div>

              {/* Category */}
              <div>
                <label className={labelClass}>카테고리</label>
                <select
                  value={placeCategory}
                  onChange={(e) => setPlaceCategory(e.target.value)}
                  className={inputClass}
                >
                  {PLACE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Address */}
              {!kakaoPreview && (
                <div>
                  <label className={labelClass}>주소</label>
                  <input
                    type="text"
                    value={placeAddress}
                    onChange={(e) => setPlaceAddress(e.target.value)}
                    placeholder="주소를 입력하세요"
                    className={inputClass}
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className={labelClass}>설명</label>
                <textarea
                  value={placeDesc}
                  onChange={(e) => setPlaceDesc(e.target.value)}
                  placeholder="이 장소를 추천하는 이유를 알려주세요"
                  rows={3}
                  className={inputClass + ' resize-none'}
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmitPlace}
                disabled={!placeName.trim() || isSubmitting}
                className="w-full py-3 bg-coral-500 text-white rounded-xl font-semibold hover:bg-coral-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 size={18} className="animate-spin" />}
                장소 추천하기
              </button>
            </>
          ) : (
            <>
              {/* Event Name */}
              <div>
                <label className={labelClass}>
                  이벤트 이름 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="예: 어린이 체험전"
                  className={inputClass}
                />
              </div>

              {/* Category */}
              <div>
                <label className={labelClass}>카테고리</label>
                <select
                  value={eventCategory}
                  onChange={(e) => setEventCategory(e.target.value)}
                  className={inputClass}
                >
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>종료일</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Venue */}
              <div>
                <label className={labelClass}>장소명</label>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="예: 코엑스"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>장소 주소</label>
                <input
                  type="text"
                  value={venueAddress}
                  onChange={(e) => setVenueAddress(e.target.value)}
                  placeholder="주소를 입력하세요"
                  className={inputClass}
                />
              </div>

              {/* Source URL */}
              <div>
                <label className={labelClass}>
                  공식 URL <span className="text-warm-400 font-normal">(권장)</span>
                </label>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
                <p className="text-xs text-warm-400 mt-1 flex items-center gap-1">
                  <ExternalLink size={12} />
                  공식 예매/안내 페이지 URL을 추가하면 정확도가 높아집니다
                </p>
              </div>

              {/* Price / Age */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>가격 정보</label>
                  <input
                    type="text"
                    value={priceInfo}
                    onChange={(e) => setPriceInfo(e.target.value)}
                    placeholder="무료 / 10,000원"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>연령</label>
                  <input
                    type="text"
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                    placeholder="예: 3~7세"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className={labelClass}>설명</label>
                <textarea
                  value={eventDesc}
                  onChange={(e) => setEventDesc(e.target.value)}
                  placeholder="이벤트 정보를 알려주세요"
                  rows={3}
                  className={inputClass + ' resize-none'}
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmitEvent}
                disabled={!eventName.trim() || isSubmitting}
                className="w-full py-3 bg-coral-500 text-white rounded-xl font-semibold hover:bg-coral-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 size={18} className="animate-spin" />}
                이벤트 추천하기
              </button>
            </>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
