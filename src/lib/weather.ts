/**
 * KMA (Korea Meteorological Administration) weather helper
 * Grid conversion algorithm ported from KMA open API technical document (C code → TypeScript)
 * Reference: plan.md 18-6
 */

const RE = 6371.00877    // Earth radius (km)
const GRID = 5.0          // Grid spacing (km)
const SLAT1 = 30.0        // Projection latitude 1 (degree)
const SLAT2 = 60.0        // Projection latitude 2 (degree)
const OLON = 126.0         // Reference longitude (degree)
const OLAT = 38.0          // Reference latitude (degree)
const XO = 43              // X origin offset (grid)
const YO = 136             // Y origin offset (grid)

const DEGRAD = Math.PI / 180.0
const RADDEG = 180.0 / Math.PI

function calcLambert() {
  const re = RE / GRID
  const slat1 = SLAT1 * DEGRAD
  const slat2 = SLAT2 * DEGRAD
  const olon = OLON * DEGRAD
  const olat = OLAT * DEGRAD

  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5)
  ro = (re * sf) / Math.pow(ro, sn)

  return { re, sn, sf, ro, olon }
}

/**
 * Convert lat/lng (WGS84) to KMA grid coordinates (nx, ny)
 */
export function toGridCoord(lat: number, lng: number): { nx: number; ny: number } {
  const { re, sn, sf, ro, olon } = calcLambert()

  const ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5)
  const raVal = (re * sf) / Math.pow(ra, sn)
  let theta = lng * DEGRAD - olon
  if (theta > Math.PI) theta -= 2.0 * Math.PI
  if (theta < -Math.PI) theta += 2.0 * Math.PI
  theta *= sn

  const nx = Math.floor(raVal * Math.sin(theta) + XO + 0.5)
  const ny = Math.floor(ro - raVal * Math.cos(theta) + YO + 0.5)

  return { nx, ny }
}

/**
 * Map KMA PTY (precipitation type) code to isRaining boolean and description
 * PTY codes: 0=없음, 1=비, 2=비/눈, 3=눈, 4=소나기, 5=빗방울, 6=빗방울/눈날림, 7=눈날림
 */
export function parseWeatherCode(pty: number, tmp: number): {
  isRaining: boolean
  description: string
} {
  const descriptions: Record<number, string> = {
    0: '맑음',
    1: '비',
    2: '비/눈',
    3: '눈',
    4: '소나기',
    5: '빗방울',
    6: '빗방울/눈날림',
    7: '눈날림',
  }

  const rainingCodes = new Set([1, 2, 4, 5, 6])
  const isRaining = rainingCodes.has(pty)
  const description = descriptions[pty] ?? '알 수 없음'

  return { isRaining, description }
}

/**
 * Format KMA base_date and base_time from current time
 * KMA updates at 0200, 0500, 0800, 1100, 1400, 1700, 2000, 2300
 */
export function getKmaBaseTime(): { baseDate: string; baseTime: string } {
  const now = new Date()
  const kstOffset = 9 * 60 * 60 * 1000
  const kst = new Date(now.getTime() + kstOffset)

  const hour = kst.getUTCHours()
  const minute = kst.getUTCMinutes()

  // KMA release hours (base times)
  const releaseTimes = [2, 5, 8, 11, 14, 17, 20, 23]

  // Find the most recently published base time
  let baseHour = 23
  let dateOffset = 0

  const currentMinutes = hour * 60 + minute
  let found = false

  for (let i = releaseTimes.length - 1; i >= 0; i--) {
    // Data is available ~10 min after release
    const releaseMinutes = releaseTimes[i] * 60 + 10
    if (currentMinutes >= releaseMinutes) {
      baseHour = releaseTimes[i]
      found = true
      break
    }
  }

  if (!found) {
    // Before 02:10 KST → use yesterday's 23:00
    baseHour = 23
    dateOffset = -1
  }

  const targetDate = new Date(kst)
  targetDate.setUTCDate(targetDate.getUTCDate() + dateOffset)

  const year = targetDate.getUTCFullYear()
  const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(targetDate.getUTCDate()).padStart(2, '0')
  const baseDate = `${year}${month}${day}`
  const baseTime = `${String(baseHour).padStart(2, '0')}00`

  return { baseDate, baseTime }
}
