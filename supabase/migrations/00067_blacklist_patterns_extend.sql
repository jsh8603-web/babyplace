-- Extend place_blacklist_patterns for audit-driven learning
-- Adds description (why this pattern was added) and discovered_at (when)

ALTER TABLE place_blacklist_patterns
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS discovered_at DATE;

-- Update source CHECK to include 'audit' source
-- (no CHECK constraint on source column, so just document the convention:
--  'manual' | 'feedback_loop' | 'audit')
