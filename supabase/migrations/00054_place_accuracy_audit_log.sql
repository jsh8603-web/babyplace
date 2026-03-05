-- Place accuracy audit log: data accuracy + closed/moved + duplicate detection
CREATE TABLE place_accuracy_audit_log (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id) ON DELETE CASCADE,
  place_name TEXT NOT NULL,
  place_category TEXT NOT NULL,
  check_type TEXT NOT NULL,         -- 'data_accuracy' | 'closed_moved' | 'duplicate_suspect'
  check_result JSONB,
  audit_verdict TEXT,                -- 'accurate' | 'inaccurate' | 'closed' | 'moved' | 'duplicate'
  audit_notes TEXT,
  audit_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_place_accuracy_audit_status ON place_accuracy_audit_log(audit_status);
