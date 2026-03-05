-- Poster audit log: tracks every poster enrichment decision for review
CREATE TABLE poster_audit_log (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_source TEXT NOT NULL,
  before_url TEXT,
  after_url TEXT,
  candidates JSONB,
  llm_reason TEXT,
  action TEXT NOT NULL,
  audit_status TEXT DEFAULT 'pending',
  audit_notes TEXT,
  prompt_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_poster_audit_status ON poster_audit_log(audit_status);
CREATE INDEX idx_poster_audit_created ON poster_audit_log(created_at DESC);
