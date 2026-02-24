/**
 * Seoul/Gyeonggi region detection.
 *
 * Two-layer verification (plan.md 18-10):
 *   1. Coordinate bounding box check
 *   2. Address string prefix check (보조 검증)
 *
 * Both must pass for a place to be accepted into the service area.
 */
import { SERVICE_AREA_BOUNDS } from '../../src/lib/service-area'

export { SERVICE_AREA_BOUNDS }

/** Matches addresses starting with 서울, 경기, 인천 (주요 자치도시 포함). */
const SERVICE_AREA_REGEX = /^(서울|경기|인천)/

/**
 * Returns true if the coordinate falls within the Seoul/Gyeonggi service area.
 */
export function isInServiceArea(lat: number, lng: number): boolean {
  return (
    lat >= SERVICE_AREA_BOUNDS.swLat &&
    lat <= SERVICE_AREA_BOUNDS.neLat &&
    lng >= SERVICE_AREA_BOUNDS.swLng &&
    lng <= SERVICE_AREA_BOUNDS.neLng
  )
}

/**
 * Returns true if the address string belongs to the service area.
 * Used as a secondary check when coordinates are uncertain.
 */
export function isValidServiceAddress(address: string): boolean {
  if (!address || address.trim() === '') return false
  return SERVICE_AREA_REGEX.test(address.trim())
}

/**
 * Combined verification: both coordinate bounds AND address prefix must pass.
 * Returns false if either check fails.
 * When address is null/empty, only the coordinate check is applied.
 */
export function isInServiceRegion(
  lat: number,
  lng: number,
  address: string | null
): boolean {
  if (!isInServiceArea(lat, lng)) return false
  if (address && address.trim() !== '') {
    return isValidServiceAddress(address)
  }
  // No address provided — coordinate check alone is sufficient
  return true
}
