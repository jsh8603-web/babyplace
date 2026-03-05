-- Event dedup audit log: merge decision tracking
CREATE TABLE event_dedup_audit_log (
  id SERIAL PRIMARY KEY,
  kept_event_id INTEGER,
  removed_event_id INTEGER,
  kept_event_name TEXT NOT NULL,
  removed_event_name TEXT NOT NULL,
  similarity_score REAL,
  match_reason TEXT,                 -- 'name_date' | 'venue_name' | 'source_id'
  audit_verdict TEXT,                -- 'correct_merge' | 'false_merge' | 'missed_dupe'
  audit_notes TEXT,
  audit_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_event_dedup_audit_status ON event_dedup_audit_log(audit_status);
