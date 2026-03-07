-- Audit quality improvement columns (plan items #14, #16, #19, #20, #21)

-- #14/#16: is_common_name for places (dynamic threshold + common name penalty)
ALTER TABLE places ADD COLUMN IF NOT EXISTS is_common_name boolean NOT NULL DEFAULT false;

-- Backfill: mark short names (<=2 chars) and generic suffix places as common
UPDATE places SET is_common_name = true
WHERE length(name) <= 2
   OR name ~ '어린이공원$|근린공원$|소공원$|체육공원$|도시공원$|수변공원$|중앙공원$|놀이터$';

-- #19: structured rejection code for poster audit
ALTER TABLE poster_audit_log ADD COLUMN IF NOT EXISTS rejection_code text;
-- Values: WRONG_REGION, BLOG_SNAP, STALE_YEAR, PLACE_PHOTO, PRODUCT_IMAGE, NEWS_PHOTO, STOCK_IMAGE, OTHER

-- #20: poster locked timestamp for auto-expiry
ALTER TABLE events ADD COLUMN IF NOT EXISTS poster_locked_at timestamptz;
-- Backfill existing locked events
UPDATE events SET poster_locked_at = updated_at WHERE poster_locked = true AND poster_locked_at IS NULL;

-- #6: blog_url in mention audit log
ALTER TABLE mention_audit_log ADD COLUMN IF NOT EXISTS blog_url text;

-- #18: recovery attempts counter for poster
ALTER TABLE events ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0;
