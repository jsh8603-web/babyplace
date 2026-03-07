-- #6: audit_metadata table for tracking audit rounds and inter-audit gaps

CREATE TABLE IF NOT EXISTS audit_metadata (
  id BIGSERIAL PRIMARY KEY,
  audit_round TEXT NOT NULL,              -- e.g. '2026-03-07-full'
  audit_type TEXT NOT NULL DEFAULT 'full', -- full, quick
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Snapshot of audit table counts at completion
  poster_total INT DEFAULT 0,
  poster_pending INT DEFAULT 0,
  poster_approved INT DEFAULT 0,
  poster_rejected INT DEFAULT 0,

  mention_total INT DEFAULT 0,
  mention_pending INT DEFAULT 0,
  mention_approved INT DEFAULT 0,
  mention_rejected INT DEFAULT 0,

  classification_total INT DEFAULT 0,
  place_total INT DEFAULT 0,
  event_dedup_total INT DEFAULT 0,
  candidate_total INT DEFAULT 0,

  -- Config versions at snapshot time
  mention_config_version INT,
  classifier_config_version INT,
  poster_prompt_version INT,

  -- Collection counts since last audit
  new_mentions_since_last INT,
  new_events_since_last INT,
  new_places_since_last INT,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_metadata_round ON audit_metadata(audit_round);
CREATE INDEX idx_audit_metadata_created ON audit_metadata(created_at DESC);
