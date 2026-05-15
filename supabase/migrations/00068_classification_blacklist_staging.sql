-- classification_blacklist_staging: FP/FN patterns harvested from classification audit
-- Feeds S2-3 Qwen refinement → classifier-config.json when unprocessed rows reach threshold.
-- verdict: 'fp' = false positive (wrongly included → blacklist candidate)
--          'fn' = false negative (wrongly excluded → whitelist candidate)

CREATE TABLE IF NOT EXISTS classification_blacklist_staging (
  id BIGSERIAL PRIMARY KEY,
  pattern TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('fp', 'fn')),
  event_name TEXT,
  classifier_step TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Fast lookup of unprocessed rows (S2-3 batch trigger counts WHERE processed_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_clf_staging_unprocessed
  ON classification_blacklist_staging (created_at)
  WHERE processed_at IS NULL;

-- Prevent duplicate staging of the same pattern+verdict before it is processed
CREATE UNIQUE INDEX IF NOT EXISTS idx_clf_staging_unique_pending
  ON classification_blacklist_staging (pattern, verdict)
  WHERE processed_at IS NULL;
