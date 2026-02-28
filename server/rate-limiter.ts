/**
 * Rate limiter for external API calls.
 * Enforces per-second and per-day quotas for Kakao and Naver APIs.
 *
 * Daily quota is tracked in the `rate_limit_counters` Supabase table so that
 * counts persist across GitHub Actions process restarts (each cron spawns a
 * fresh process, making in-memory counters useless for daily limits).
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

  constructor(options: RateLimiterOptions) {
    this.maxPerSecond = options.maxPerSecond
    this.maxPerDay = options.maxPerDay
    this.provider = options.provider
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
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

    // --- Daily quota check (DB-backed, cross-process) ---
    const currentCount = await this.fetchDailyCount(today)
    if (currentCount >= this.maxPerDay) {
      throw new Error(
        `Daily API quota exceeded for "${this.provider}" ` +
          `(${currentCount}/${this.maxPerDay}). Quota resets at midnight UTC.`
      )
    }

    // --- Per-second enforcement: sliding window ---
    while (true) {
      const now = Date.now()
      this.windowTimestamps = this.windowTimestamps.filter((ts) => now - ts < 1000)

      if (this.windowTimestamps.length < this.maxPerSecond) {
        // Slot available — register timestamp and atomically increment DB counter
        this.windowTimestamps.push(now)
        await this.incrementDailyCount(today)
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
      // Non-fatal: if the table is missing or unreachable, fall back to allowing
      // the request (in-memory limits will still apply per-second).
      console.warn(`[RateLimiter] Failed to fetch daily count for "${this.provider}":`, error)
      return 0
    }

    return data?.count ?? 0
  }

  /**
   * Atomically increments the daily counter by 1, upserting the row if absent.
   */
  private async incrementDailyCount(date: string): Promise<void> {
    // Use an RPC for atomic increment to avoid race conditions between concurrent
    // process runs. Falls back to a client-side upsert if the RPC is unavailable.
    const { error: rpcError } = await supabaseAdmin.rpc('increment_rate_limit_counter', {
      p_provider: this.provider,
      p_date: date,
    })

    if (rpcError) {
      // Fallback: upsert with count=1 (safe enough for low-concurrency pipelines)
      const { error: upsertError } = await supabaseAdmin
        .from('rate_limit_counters')
        .upsert(
          { provider: this.provider, date, count: 1 },
          { onConflict: 'provider, date', ignoreDuplicates: false }
        )

      if (upsertError) {
        console.warn(`[RateLimiter] Failed to increment daily count for "${this.provider}":`, upsertError)
      }
    }
  }

  /** Current daily call count (live DB read — for logging/monitoring). */
  async getDailyCount(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10)
    return this.fetchDailyCount(today)
  }

  /** Remaining daily calls (live DB read). */
  async getRemainingDaily(): Promise<number> {
    const count = await this.getDailyCount()
    return Math.max(0, this.maxPerDay - count)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Singleton instances — shared across all collectors in one process run.
// Per-second window is still in-memory (fine for single-process concurrency).
// Daily quota is DB-backed to survive across GitHub Actions cron runs.
export const kakaoLimiter = new RateLimiter({
  maxPerSecond: 10,
  maxPerDay: 100_000,
  provider: 'kakao',
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
