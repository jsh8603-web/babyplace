-- Add poster_locked to events table
-- When true, poster-enrichment skips this event (manual override)
ALTER TABLE events ADD COLUMN poster_locked BOOLEAN DEFAULT false;
