-- Enrich audit log tables with additional context for thorough review

-- 1. mention_audit_log: relevance score breakdown + source info
ALTER TABLE mention_audit_log
  ADD COLUMN IF NOT EXISTS relevance_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS penalty_flags TEXT[],
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS post_date DATE;

-- 2. classification_audit_log: which pattern matched + LLM details
ALTER TABLE classification_audit_log
  ADD COLUMN IF NOT EXISTS matched_pattern TEXT,
  ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN DEFAULT false;

-- 3. event_dedup_audit_log: source + dates + venue for both events
ALTER TABLE event_dedup_audit_log
  ADD COLUMN IF NOT EXISTS kept_source TEXT,
  ADD COLUMN IF NOT EXISTS removed_source TEXT,
  ADD COLUMN IF NOT EXISTS kept_dates JSONB,
  ADD COLUMN IF NOT EXISTS removed_dates JSONB,
  ADD COLUMN IF NOT EXISTS venue_name TEXT;

-- 4. candidate_promotion_audit_log: source URLs + Kakao verification details
ALTER TABLE candidate_promotion_audit_log
  ADD COLUMN IF NOT EXISTS source_urls JSONB,
  ADD COLUMN IF NOT EXISTS kakao_name TEXT,
  ADD COLUMN IF NOT EXISTS kakao_address TEXT;

-- 5. poster_audit_log: event dates + venue for context
ALTER TABLE poster_audit_log
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS venue_name TEXT,
  ADD COLUMN IF NOT EXISTS event_dates JSONB;

-- 6. place_accuracy_audit_log: source origin + creation time
ALTER TABLE place_accuracy_audit_log
  ADD COLUMN IF NOT EXISTS place_source TEXT,
  ADD COLUMN IF NOT EXISTS place_created_at TIMESTAMPTZ;
