-- Blog noise filter: LLM-based blacklist term accumulation
-- Supports automated sampling → classification → term promotion workflow

-- 1a. blog_blacklist_terms table
CREATE TABLE blog_blacklist_terms (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'rejected')),
  occurrence_count INT DEFAULT 1,
  distinct_place_count INT DEFAULT 1,
  sample_titles TEXT[] DEFAULT '{}',
  source TEXT DEFAULT 'llm',
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  activated_at TIMESTAMPTZ
);

CREATE INDEX idx_blacklist_terms_status ON blog_blacklist_terms(status);

-- 1b. llm_reviewed column on blog_mentions
ALTER TABLE blog_mentions
  ADD COLUMN IF NOT EXISTS llm_reviewed BOOLEAN DEFAULT false;

CREATE INDEX idx_blog_mentions_noise_sample
  ON blog_mentions(llm_reviewed, relevance_score, collected_at DESC)
  WHERE llm_reviewed = false AND relevance_score BETWEEN 0.40 AND 0.65;

-- 1c. Atomic term upsert RPC
CREATE OR REPLACE FUNCTION upsert_blacklist_term(
  p_term TEXT, p_place_id INT, p_sample_title TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO blog_blacklist_terms (term, occurrence_count, distinct_place_count, sample_titles)
  VALUES (p_term, 1, 1,
    CASE WHEN p_sample_title IS NOT NULL THEN ARRAY[p_sample_title] ELSE '{}' END)
  ON CONFLICT (term) DO UPDATE SET
    occurrence_count = blog_blacklist_terms.occurrence_count + 1,
    last_seen_at = now(),
    sample_titles = CASE
      WHEN array_length(blog_blacklist_terms.sample_titles, 1) IS NULL
        OR array_length(blog_blacklist_terms.sample_titles, 1) < 5
      THEN array_append(blog_blacklist_terms.sample_titles, p_sample_title)
      ELSE blog_blacklist_terms.sample_titles
    END;
END;
$$;
