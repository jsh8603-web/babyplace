-- Backfill relevance_score for existing blog_mentions:
-- Set to 0.8 if title contains place name, 0.1 if not.
-- This cleans up irrelevant posts that were collected without relevance filtering.

UPDATE blog_mentions bm
SET relevance_score = CASE
  WHEN bm.title ILIKE '%' || p.name || '%' THEN 0.8
  ELSE 0.1
END
FROM places p
WHERE bm.place_id = p.id
  AND bm.relevance_score = 0.5;  -- only update default/unchecked rows
