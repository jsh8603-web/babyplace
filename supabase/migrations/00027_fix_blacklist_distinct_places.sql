-- Fix: track distinct place_ids for promotion threshold
ALTER TABLE blog_blacklist_terms
  ADD COLUMN IF NOT EXISTS seen_place_ids INT[] DEFAULT '{}';

-- Update existing rows: set seen_place_ids from distinct_place_count
UPDATE blog_blacklist_terms SET seen_place_ids = '{}' WHERE seen_place_ids IS NULL;

-- Replace RPC to properly track distinct places
CREATE OR REPLACE FUNCTION upsert_blacklist_term(
  p_term TEXT, p_place_id INT, p_sample_title TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO blog_blacklist_terms (term, occurrence_count, distinct_place_count, seen_place_ids, sample_titles)
  VALUES (
    p_term, 1, 1,
    CASE WHEN p_place_id IS NOT NULL THEN ARRAY[p_place_id] ELSE '{}' END,
    CASE WHEN p_sample_title IS NOT NULL THEN ARRAY[p_sample_title] ELSE '{}' END
  )
  ON CONFLICT (term) DO UPDATE SET
    occurrence_count = blog_blacklist_terms.occurrence_count + 1,
    last_seen_at = now(),
    -- Track distinct places
    seen_place_ids = CASE
      WHEN p_place_id IS NOT NULL AND NOT (blog_blacklist_terms.seen_place_ids @> ARRAY[p_place_id])
      THEN array_append(blog_blacklist_terms.seen_place_ids, p_place_id)
      ELSE blog_blacklist_terms.seen_place_ids
    END,
    distinct_place_count = CASE
      WHEN p_place_id IS NOT NULL AND NOT (blog_blacklist_terms.seen_place_ids @> ARRAY[p_place_id])
      THEN blog_blacklist_terms.distinct_place_count + 1
      ELSE blog_blacklist_terms.distinct_place_count
    END,
    -- Cap sample titles at 5
    sample_titles = CASE
      WHEN array_length(blog_blacklist_terms.sample_titles, 1) IS NULL
        OR array_length(blog_blacklist_terms.sample_titles, 1) < 5
      THEN array_append(blog_blacklist_terms.sample_titles, p_sample_title)
      ELSE blog_blacklist_terms.sample_titles
    END;
END;
$$;
