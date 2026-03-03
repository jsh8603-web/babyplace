-- Feedback loop: track irrelevant mention counts per place
-- Used by blog-noise-filter to flag places with persistent noise

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS irrelevant_mention_count INTEGER DEFAULT 0;

-- RPC to increment irrelevant count atomically
CREATE OR REPLACE FUNCTION increment_irrelevant_count(p_place_id INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE places
  SET irrelevant_mention_count = irrelevant_mention_count + 1
  WHERE id = p_place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
