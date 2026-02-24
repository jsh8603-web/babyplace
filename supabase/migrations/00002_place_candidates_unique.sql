-- Add unique constraint on place_candidates(name, address) for upsert support.
-- address is coalesced to '' for nulls via the unique index so that
-- (name='foo', address=NULL) and (name='foo', address=NULL) are treated as the same row.
-- We use a unique index with COALESCE rather than a plain UNIQUE constraint
-- because UNIQUE constraints treat NULLs as distinct.

CREATE UNIQUE INDEX IF NOT EXISTS uq_place_candidates_name_address
  ON place_candidates (name, COALESCE(address, ''));

-- Rate limit counters: cross-process daily quota tracking.
-- Allows shared quota enforcement across GitHub Actions cron runs.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  date DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  UNIQUE (provider, date)
);

-- Atomic increment RPC for rate_limit_counters.
-- Upserts the (provider, date) row and increments count by 1.
-- Used by server/rate-limiter.ts to avoid race conditions between concurrent pipeline runs.
CREATE OR REPLACE FUNCTION increment_rate_limit_counter(
  p_provider TEXT,
  p_date DATE
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rate_limit_counters (provider, date, count)
    VALUES (p_provider, p_date, 1)
  ON CONFLICT (provider, date)
    DO UPDATE SET count = rate_limit_counters.count + 1;
END;
$$;
