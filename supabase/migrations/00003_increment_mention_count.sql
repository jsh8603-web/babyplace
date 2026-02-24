-- Atomic mention_count increment to prevent race conditions in concurrent updates.
-- Called from server/collectors/naver-blog.ts via supabaseAdmin.rpc().
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
    last_mentioned_at   = p_last_mentioned_at
  WHERE id = p_place_id;
$$;
