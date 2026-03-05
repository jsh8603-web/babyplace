import { describe, it, expect } from 'vitest'
import { SERVICE_AREA_BOUNDS } from './service-area'

describe('SERVICE_AREA_BOUNDS', () => {
  it('has all 4 required properties', () => {
    expect(SERVICE_AREA_BOUNDS).toHaveProperty('swLat')
    expect(SERVICE_AREA_BOUNDS).toHaveProperty('swLng')
    expect(SERVICE_AREA_BOUNDS).toHaveProperty('neLat')
    expect(SERVICE_AREA_BOUNDS).toHaveProperty('neLng')
  })

  it('swLat is less than neLat', () => {
    expect(SERVICE_AREA_BOUNDS.swLat).toBeLessThan(SERVICE_AREA_BOUNDS.neLat)
  })

  it('swLng is less than neLng', () => {
    expect(SERVICE_AREA_BOUNDS.swLng).toBeLessThan(SERVICE_AREA_BOUNDS.neLng)
  })

  it('neLat is exactly 38.0 (regression guard against 38.3 bug)', () => {
    expect(SERVICE_AREA_BOUNDS.neLat).toBe(38.0)
  })

  it('has the expected exact boundary values', () => {
    expect(SERVICE_AREA_BOUNDS.swLat).toBe(36.9)
    expect(SERVICE_AREA_BOUNDS.swLng).toBe(126.5)
    expect(SERVICE_AREA_BOUNDS.neLat).toBe(38.0)
    expect(SERVICE_AREA_BOUNDS.neLng).toBe(127.9)
  })
})
