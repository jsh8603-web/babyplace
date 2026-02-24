-- Fix events table source_id UNIQUE constraint
--
-- Current issue: source_id is globally UNIQUE, which prevents different sources
-- from having the same ID value (e.g., KOPIS "12345" vs Tour API "12345").
--
-- Solution: Create a composite UNIQUE constraint on (source, source_id)
-- to allow same ID across different sources.

-- Drop the old global UNIQUE constraint on source_id
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_source_id_key;

-- Add new composite UNIQUE constraint on (source, source_id)
ALTER TABLE events ADD CONSTRAINT events_source_source_id_unique UNIQUE (source, source_id);

-- Add index for faster lookups on the composite key
CREATE INDEX IF NOT EXISTS idx_events_source_source_id ON events(source, source_id);
