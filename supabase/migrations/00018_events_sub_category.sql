-- Add sub_category column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS sub_category TEXT;

-- Backfill sub_category from event name keywords
UPDATE events SET sub_category = '전시'
WHERE sub_category IS NULL
  AND (name ~* '전시|展|갤러리|미술|아트페어');

UPDATE events SET sub_category = '축제'
WHERE sub_category IS NULL
  AND (name ~* '축제|페스타|페스티벌|마켓|박람회');

UPDATE events SET sub_category = '체험'
WHERE sub_category IS NULL
  AND (name ~* '체험|워크숍|클래스|만들기');

UPDATE events SET sub_category = '공연'
WHERE sub_category IS NULL
  AND (name ~* '공연|콘서트|뮤지컬|연극');

-- Index for "currently running" queries
CREATE INDEX IF NOT EXISTS idx_events_running ON events(start_date, end_date);
