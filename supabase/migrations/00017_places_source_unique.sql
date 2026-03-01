-- Prevent duplicate places from the same data source.
-- Same pattern as 00005_fix_events_source_unique.sql.
-- Nulls are treated as distinct by PostgreSQL, so places without source_id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_source_source_id
  ON places (source, source_id)
  WHERE source_id IS NOT NULL;
