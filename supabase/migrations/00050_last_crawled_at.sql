-- Pipeline B coverage improvement: separate crawl tracking from mention tracking
-- last_mentioned_at = blog mention found (business metric, unchanged)
-- last_crawled_at = crawl attempted (operational, updated even on 0 results)

ALTER TABLE places ADD COLUMN last_crawled_at TIMESTAMPTZ;

-- Backfill: places with mentions have already been crawled
UPDATE places SET last_crawled_at = last_mentioned_at
WHERE last_mentioned_at IS NOT NULL;

CREATE INDEX idx_places_last_crawled ON places(last_crawled_at ASC NULLS FIRST);
