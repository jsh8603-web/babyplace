-- Add date_confirmed column to events table
-- false = dates are estimated (LLM couldn't extract, using today+30 default)
-- true = dates confirmed from source or enrichment

ALTER TABLE events ADD COLUMN IF NOT EXISTS date_confirmed BOOLEAN DEFAULT true;

-- Mark existing blog_discovery/exhibition_extraction events with default dates as unconfirmed
-- Pattern: end_date = start_date + 30 days (the parseDates default)
UPDATE events SET date_confirmed = false
WHERE source IN ('blog_discovery', 'exhibition_extraction')
  AND end_date = (start_date + INTERVAL '30 days')::date;
