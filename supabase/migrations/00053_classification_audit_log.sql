-- Classification audit log: event baby-relevance classification tracking
CREATE TABLE classification_audit_log (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  event_source TEXT NOT NULL,
  use_target TEXT,
  classifier_step TEXT NOT NULL,     -- 'blacklist' | 'whitelist' | 'llm'
  classifier_decision TEXT NOT NULL, -- 'included' | 'excluded'
  audit_verdict TEXT,                -- 'correct' | 'false_positive' | 'false_negative'
  audit_notes TEXT,
  audit_status TEXT DEFAULT 'pending',
  prompt_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_classification_audit_status ON classification_audit_log(audit_status);
