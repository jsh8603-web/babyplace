-- Fix last_mentioned_at: use GREATEST to prevent date regression,
-- and recalculate existing data from actual blog post dates.

-- 1. Update RPC to use GREATEST (never go backwards)
CREATE OR REPLACE FUNCTION increment_mention_count(
  p_place_id INT,
  p_increment INT,
  p_last_mentioned_at TIMESTAMPTZ
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE places
  SET
    mention_count       = mention_count + p_increment,
    last_mentioned_at   = GREATEST(last_mentioned_at, p_last_mentioned_at)
  WHERE id = p_place_id;
$$;

-- 2. Recalculate last_mentioned_at from actual blog post dates
UPDATE places p
SET last_mentioned_at = sub.max_post_date
FROM (
  SELECT place_id, MAX(post_date)::timestamptz AS max_post_date
  FROM blog_mentions
  WHERE post_date IS NOT NULL
  GROUP BY place_id
) sub
WHERE p.id = sub.place_id;
