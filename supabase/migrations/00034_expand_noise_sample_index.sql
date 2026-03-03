-- Expand noise sample index to cover all unreviewed mentions (score >= 0.3)
-- Previously only covered borderline range 0.40~0.65
DROP INDEX IF EXISTS idx_blog_mentions_noise_sample;
CREATE INDEX idx_blog_mentions_noise_sample
  ON blog_mentions(llm_reviewed, relevance_score, collected_at DESC)
  WHERE llm_reviewed = false AND relevance_score >= 0.3;
