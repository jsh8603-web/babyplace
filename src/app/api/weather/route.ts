import { NextRequest, NextResponse } from 'next/server'
import { toGridCoord, parseWeatherCode, getKmaBaseTime } from '@/lib/weather'
import type { WeatherResponse } from '@/types'

/**
 * GET /api/weather
 * Query params: lat, lng
 * Calls KMA Ultra-Short-Range Forecast API → extracts PTY (precipitation type) + TMP (temperature)
 * Returns: { isRaining: boolean, temperature: number, description: string }
 *
 * KMA API: getUltraSrtFcst (초단기예보)
 * Reference: plan.md 18-6
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const lat = parseFloat(searchParams.get('lat') ?? '')
  const lng = parseFloat(searchParams.get('lng') ?? '')

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { error: 'lat and lng parameters are required' },
      { status: 400 }
    )
  }

  const apiKey = process.env.KMA_API_KEY
  if (!apiKey) {
    console.error('[GET /api/weather] KMA_API_KEY not set')
    return NextResponse.json({ error: 'Weather service not configured' }, { status: 503 })
  }

  const { nx, ny } = toGridCoord(lat, lng)
  const { baseDate, baseTime } = getKmaBaseTime()

  const params = new URLSearchParams({
    serviceKey: apiKey,
    pageNo: '1',
    numOfRows: '60',
    dataType: 'JSON',
    base_date: baseDate,
    base_time: baseTime,
    nx: String(nx),
    ny: String(ny),
  })

  const kmaUrl = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?${params.toString()}`

  let kmaResponse: Response
  try {
    kmaResponse = await fetch(kmaUrl, {
      next: { revalidate: 600 }, // Cache 10 minutes
    })
  } catch (err) {
    console.error('[GET /api/weather] KMA API fetch error:', err)
    return NextResponse.json({ error: 'Weather API request failed' }, { status: 502 })
  }

  if (!kmaResponse.ok) {
    console.error('[GET /api/weather] KMA API HTTP error:', kmaResponse.status)
    return NextResponse.json({ error: 'Weather API returned error' }, { status: 502 })
  }

  let kmaData: KmaApiResponse
  try {
    kmaData = await kmaResponse.json()
  } catch {
    console.error('[GET /api/weather] KMA API JSON parse error')
    return NextResponse.json({ error: 'Weather API response parse failed' }, { status: 502 })
  }

  const resultCode = kmaData?.response?.header?.resultCode
  if (resultCode !== '00') {
    console.error('[GET /api/weather] KMA API error code:', resultCode, kmaData?.response?.header?.resultMsg)
    return NextResponse.json({ error: 'Weather API error' }, { status: 502 })
  }

  const items = kmaData?.response?.body?.items?.item ?? []

  // Extract PTY (precipitation type) and T1H (temperature) for the nearest forecast time
  // Ultra-short-range forecast: first available fcstTime is the earliest forecast
  let ptyValue = 0 // default: no precipitation
  let temperature = 0

  // Find the first (earliest) fcstTime's PTY and T1H values
  const firstFcstTime = items.find((i) => i.category === 'PTY')?.fcstTime
  if (firstFcstTime) {
    const ptyItem = items.find((i) => i.category === 'PTY' && i.fcstTime === firstFcstTime)
    const tmpItem = items.find((i) => i.category === 'T1H' && i.fcstTime === firstFcstTime)

    if (ptyItem) ptyValue = parseInt(ptyItem.fcstValue, 10) || 0
    if (tmpItem) temperature = parseFloat(tmpItem.fcstValue) || 0
  }

  const { isRaining, description } = parseWeatherCode(ptyValue, temperature)

  const response: WeatherResponse = { isRaining, temperature, description }
  return NextResponse.json(response)
}

// KMA API response type
interface KmaApiResponse {
  response: {
    header: {
      resultCode: string
      resultMsg: string
    }
    body?: {
      items?: {
        item: Array<{
          baseDate: string
          baseTime: string
          category: string
          fcstDate: string
          fcstTime: string
          fcstValue: string
          nx: number
          ny: number
        }>
      }
    }
  }
}
