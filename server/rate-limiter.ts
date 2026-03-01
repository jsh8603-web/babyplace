/**
 * Rate limiter for external API calls.
 * Enforces per-second and per-day quotas for Kakao and Naver APIs.
 *
 * Daily quota is tracked in the `rate_limit_counters` Supabase table so that
 * counts persist across GitHub Actions process restarts (each cron spawns a
 * fresh process, making in-memory counters useless for daily limits).
 *
 * Performance: daily count is cached in memory after a single DB read at
 * pipeline start. Flushed back to DB once at pipeline end.
 * This eliminates ~7,000 DB round-trips per run (~18 min overhead).
 *
 * Schema (created in 00002_place_candidates_unique.sql):
 *   rate_limit_counters(id, provider TEXT, date DATE, count INT, UNIQUE(provider, date))
 */
import { supabaseAdmin } from './lib/supabase-admin'

interface RateLimiterOptions {
  maxPerSecond: number
  maxPerDay: number
  /** Logical provider name stored in rate_limit_counters.provider */
  provider: string
}

export class RateLimiter {
  private readonly maxPerSecond: number
  private readonly maxPerDay: number
  private readonly provider: string

  // Sliding window: timestamps (ms) of requests in the last second
  private windowTimestamps: number[] = []

  // Cached daily counter (loaded once, flushed once)
  private cachedCount: number | null = null
  private cachedDate: string | null = null
  private countSinceLoad = 0

  constructor(options: RateLimiterOptions) {
    this.maxPerSecond = options.maxPerSecond
    this.maxPerDay = options.maxPerDay
    this.provider = options.provider
  }

  /**
   * Load daily count from DB into memory cache.
   * Call once at pipeline start. Skipping this is safe —
   * throttle() will lazy-load on first call.
   */
  async initialize(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)
    this.cachedDate = today
    this.cachedCount = await this.fetchDailyCount(today)
    this.countSinceLoad = 0
  }

  /**
   * Flush accumulated count back to DB.
   * Call once at pipeline end.
   */
  async flush(): Promise<void> {
    if (this.countSinceLoad === 0 || !this.cachedDate) return

    const { error: rpcError } = await supabaseAdmin.rpc('increment_rate_limit_counter', {
      p_provider: this.provider,
      p_date: this.cachedDate,
      p_increment: this.countSinceLoad,
    })

    if (rpcError) {
      // Fallback: try single-increment RPC N times? No — just upsert the total.
      const totalCount = (this.cachedCount ?? 0) + this.countSinceLoad
      await supabaseAdmin
        .from('rate_limit_counters')
        .upsert(
          { provider: this.provider, date: this.cachedDate, count: totalCount },
          { onConflict: 'provider, date', ignoreDuplicates: false }
        )
    }

    this.countSinceLoad = 0
  }

  /**
   * Wraps an async function with rate-limiting.
   * Waits until the request can be dispatched within quota.
   */
  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot()
    return fn()
  }

  private async waitForSlot(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)

    // Lazy-initialize cache if not done or date rolled over
    if (this.cachedCount === null || this.cachedDate !== today) {
      await this.initialize()
    }

    // Daily quota check (in-memory)
    const currentTotal = (this.cachedCount ?? 0) + this.countSinceLoad
    if (currentTotal >= this.maxPerDay) {
      throw new Error(
        `Daily API quota exceeded for "${this.provider}" ` +
          `(${currentTotal}/${this.maxPerDay}). Quota resets at midnight UTC.`
      )
    }

    // Per-second enforcement: sliding window
    while (true) {
      const now = Date.now()
      this.windowTimestamps = this.windowTimestamps.filter((ts) => now - ts < 1000)

      if (this.windowTimestamps.length < this.maxPerSecond) {
        this.windowTimestamps.push(now)
        this.countSinceLoad++
        return
      }

      // Wait until the oldest timestamp in the window expires
      const oldestTs = this.windowTimestamps[0]
      const waitMs = 1000 - (now - oldestTs) + 1
      await sleep(waitMs)
    }
  }

  /**
   * Returns the current daily call count from Supabase.
   * Returns 0 if no row exists yet for today.
   */
  private async fetchDailyCount(date: string): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from('rate_limit_counters')
      .select('count')
      .eq('provider', this.provider)
      .eq('date', date)
      .maybeSingle()

    if (error) {
      console.warn(`[RateLimiter] Failed to fetch daily count for "${this.provider}":`, error)
      return 0
    }

    return data?.count ?? 0
  }

  /** Current daily call count (cached + in-flight). */
  async getDailyCount(): Promise<number> {
    if (this.cachedCount !== null) {
      return (this.cachedCount ?? 0) + this.countSinceLoad
    }
    const today = new Date().toISOString().slice(0, 10)
    return this.fetchDailyCount(today)
  }

  /** Remaining daily calls. */
  async getRemainingDaily(): Promise<number> {
    const count = await this.getDailyCount()
    return Math.max(0, this.maxPerDay - count)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Singleton instances ──────────────────────────────────────────────────────

export const kakaoLimiter = new RateLimiter({
  maxPerSecond: 10,
  maxPerDay: 100_000,
  provider: 'kakao',
})

export const kakaoSearchLimiter = new RateLimiter({
  maxPerSecond: 10,
  maxPerDay: 10_000,
  provider: 'kakao-search',
})

export const naverLimiter = new RateLimiter({
  maxPerSecond: 10,
  maxPerDay: 25_000,
  provider: 'naver',
})

export const dataLabLimiter = new RateLimiter({
  maxPerSecond: 2,
  maxPerDay: 1_000,
  provider: 'naver-datalab',
})

export const tourLimiter = new RateLimiter({
  maxPerSecond: 5,
  maxPerDay: 800,
  provider: 'tour',
})

// ─── Batch initialize / flush helpers ─────────────────────────────────────────

const ALL_LIMITERS = [kakaoLimiter, kakaoSearchLimiter, naverLimiter, dataLabLimiter, tourLimiter]

/** Initialize all rate limiters (call once at pipeline start). */
export async function initializeAllLimiters(): Promise<void> {
  await Promise.all(ALL_LIMITERS.map((l) => l.initialize()))
}

/** Flush all rate limiters (call once at pipeline end). */
export async function flushAllLimiters(): Promise<void> {
  await Promise.all(ALL_LIMITERS.map((l) => l.flush()))
}
