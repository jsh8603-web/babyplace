-- Add last_resampled_at column to all audit log tables for cycling resampling logic
-- When null or oldest → selected for resampling. After review → set to NOW().

ALTER TABLE poster_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
ALTER TABLE mention_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
ALTER TABLE classification_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
ALTER TABLE place_accuracy_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
ALTER TABLE event_dedup_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
ALTER TABLE candidate_promotion_audit_log ADD COLUMN IF NOT EXISTS last_resampled_at timestamptz;
