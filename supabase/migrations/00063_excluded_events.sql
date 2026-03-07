-- #3: excluded_events table for classification audit coverage
-- Records events excluded by blacklist/LLM so classification audit can verify false negatives

CREATE TABLE IF NOT EXISTS excluded_events (
  id BIGSERIAL PRIMARY KEY,
  source_event_id TEXT,           -- original source ID (e.g. seoul API event ID)
  name TEXT NOT NULL,
  source TEXT NOT NULL,           -- collector name (seoul_events, blog_discovery, etc.)
  use_target TEXT,                -- USE_TRGT field
  classifier_step TEXT NOT NULL,  -- blacklist, whitelist, llm
  matched_pattern TEXT,           -- which pattern triggered exclusion
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_excluded_events_source ON excluded_events(source);
CREATE INDEX idx_excluded_events_step ON excluded_events(classifier_step);
CREATE INDEX idx_excluded_events_created ON excluded_events(created_at DESC);
