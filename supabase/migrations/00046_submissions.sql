-- 00046: User submissions for places and events
-- submission_status: NULL (pipeline data), 'pending', 'approved', 'rejected'

-- 1. places: submission columns
ALTER TABLE places ADD COLUMN IF NOT EXISTS submission_status TEXT CHECK (submission_status IN ('pending','approved','rejected'));
ALTER TABLE places ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id);
ALTER TABLE places ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE places ADD COLUMN IF NOT EXISTS submission_note TEXT;
CREATE INDEX IF NOT EXISTS idx_places_submission ON places(submission_status) WHERE submission_status IS NOT NULL;

-- 2. events: submission columns
ALTER TABLE events ADD COLUMN IF NOT EXISTS submission_status TEXT CHECK (submission_status IN ('pending','approved','rejected'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS submission_note TEXT;
CREATE INDEX IF NOT EXISTS idx_events_submission ON events(submission_status) WHERE submission_status IS NOT NULL;

-- 3. places: lat/lng nullable (user may not know coordinates)
ALTER TABLE places ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE places ALTER COLUMN lng DROP NOT NULL;
