-- Phase 3: Add relevance_score column to blog_mentions
-- This enables dynamic relevance calculation in keyword rotation engine (plan.md 9-1)
--
-- relevance_score: 0.0-1.0, representing baby/parenting relevance of the blog mention
-- Default 0.5 (neutral) for existing mentions without explicit scoring

ALTER TABLE blog_mentions
ADD COLUMN relevance_score REAL DEFAULT 0.5;

-- Add index for efficient aggregation in keyword rotation queries
CREATE INDEX idx_blog_mentions_keyword_relevance
  ON blog_mentions(place_id, collected_at DESC, relevance_score);

-- Index for relevance calculation (used by rotation-engine.ts)
CREATE INDEX idx_blog_mentions_recent_relevance
  ON blog_mentions(collected_at DESC, relevance_score);
