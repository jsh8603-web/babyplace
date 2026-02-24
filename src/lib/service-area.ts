/**
 * Shared service area constants — single source of truth for Seoul/Gyeonggi/Incheon bounds.
 * Used by both src/app/api/report/route.ts and server/enrichers/region.ts.
 * Reference: plan.md 18-10
 *
 * NOTE: neLat is 38.0, not 38.3.
 * 38.3 was a bug in report.ts that this file was created to fix.
 */
export const SERVICE_AREA_BOUNDS = {
  swLat: 36.9,
  swLng: 126.5,
  neLat: 38.0,
  neLng: 127.9,
} as const
