-- Mention audit log: blog ↔ place matching quality tracking
CREATE TABLE mention_audit_log (
  id SERIAL PRIMARY KEY,
  mention_id INTEGER REFERENCES blog_mentions(id) ON DELETE CASCADE,
  place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
  place_name TEXT NOT NULL,
  mention_title TEXT,
  mention_url TEXT,
  mention_snippet TEXT,
  relevance_score REAL,
  audit_verdict TEXT NOT NULL,    -- 'correct' | 'wrong_match' | 'wrong_place' | 'borderline'
  audit_notes TEXT,
  audit_status TEXT DEFAULT 'pending',
  config_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_mention_audit_status ON mention_audit_log(audit_status);

-- Lock individual mentions from pipeline re-processing
ALTER TABLE blog_mentions ADD COLUMN mention_locked BOOLEAN DEFAULT false;
