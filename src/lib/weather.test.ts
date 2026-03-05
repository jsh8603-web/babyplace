import { describe, it, expect } from 'vitest'
import { toGridCoord, parseWeatherCode } from './weather'

describe('toGridCoord', () => {
  it('converts Seoul city hall coordinates to approximately (60, 127)', () => {
    const { nx, ny } = toGridCoord(37.5665, 126.978)
    // KMA official reference: Seoul city hall ≈ (60, 127)
    expect(nx).toBeGreaterThanOrEqual(59)
    expect(nx).toBeLessThanOrEqual(61)
    expect(ny).toBeGreaterThanOrEqual(126)
    expect(ny).toBeLessThanOrEqual(128)
  })

  it('returns integer grid coordinates', () => {
    const { nx, ny } = toGridCoord(37.5665, 126.978)
    expect(Number.isInteger(nx)).toBe(true)
    expect(Number.isInteger(ny)).toBe(true)
  })

  it('returns different values for different coordinates', () => {
    const seoulResult = toGridCoord(37.5665, 126.978)
    const busanResult = toGridCoord(35.1796, 129.0756)
    expect(seoulResult.nx).not.toBe(busanResult.nx)
    expect(seoulResult.ny).not.toBe(busanResult.ny)
  })
})

describe('parseWeatherCode', () => {
  it('PTY 0 returns not raining, 맑음', () => {
    const result = parseWeatherCode(0, 20)
    expect(result.isRaining).toBe(false)
    expect(result.description).toBe('맑음')
  })

  it('PTY 1 returns raining, 비', () => {
    const result = parseWeatherCode(1, 15)
    expect(result.isRaining).toBe(true)
    expect(result.description).toBe('비')
  })

  it('PTY 2 returns raining, 비/눈', () => {
    const result = parseWeatherCode(2, 2)
    expect(result.isRaining).toBe(true)
    expect(result.description).toBe('비/눈')
  })

  it('PTY 3 returns not raining, 눈', () => {
    const result = parseWeatherCode(3, -1)
    expect(result.isRaining).toBe(false)
    expect(result.description).toBe('눈')
  })

  it('PTY 4 returns raining, 소나기', () => {
    const result = parseWeatherCode(4, 25)
    expect(result.isRaining).toBe(true)
    expect(result.description).toBe('소나기')
  })

  it('PTY 5 returns raining, 빗방울', () => {
    const result = parseWeatherCode(5, 18)
    expect(result.isRaining).toBe(true)
    expect(result.description).toBe('빗방울')
  })

  it('PTY 6 returns raining, 빗방울/눈날림', () => {
    const result = parseWeatherCode(6, 1)
    expect(result.isRaining).toBe(true)
    expect(result.description).toBe('빗방울/눈날림')
  })

  it('PTY 7 returns not raining, 눈날림', () => {
    const result = parseWeatherCode(7, -3)
    expect(result.isRaining).toBe(false)
    expect(result.description).toBe('눈날림')
  })

  it('unknown PTY code returns 알 수 없음', () => {
    const result = parseWeatherCode(99, 20)
    expect(result.description).toBe('알 수 없음')
  })

  it('tmp parameter is passed through and does not affect PTY classification', () => {
    const cold = parseWeatherCode(1, -10)
    const hot = parseWeatherCode(1, 35)
    expect(cold.isRaining).toBe(hot.isRaining)
    expect(cold.description).toBe(hot.description)
  })
})
