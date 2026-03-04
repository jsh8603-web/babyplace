-- 1. Allow NULL start_date for events with unconfirmed dates
ALTER TABLE events ALTER COLUMN start_date DROP NOT NULL;

-- 2. Remove estimated dates for unconfirmed events (30-day default dates are misleading)
UPDATE events
SET start_date = NULL, end_date = NULL
WHERE date_confirmed = false;

-- 3. Remove duplicate events (same name + venue, keep best: date_confirmed=true preferred, then newest)
DELETE FROM events
WHERE id NOT IN (
  SELECT DISTINCT ON (LOWER(TRIM(name)), LOWER(TRIM(COALESCE(venue_name, ''))))
    id
  FROM events
  ORDER BY
    LOWER(TRIM(name)), LOWER(TRIM(COALESCE(venue_name, ''))),
    date_confirmed DESC NULLS LAST,
    created_at DESC
);
