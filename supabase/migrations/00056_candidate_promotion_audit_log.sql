-- Candidate promotion audit log: auto-promote quality tracking
CREATE TABLE candidate_promotion_audit_log (
  id SERIAL PRIMARY KEY,
  place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
  candidate_id INTEGER,
  place_name TEXT NOT NULL,
  place_category TEXT NOT NULL,
  source_count INTEGER,
  kakao_similarity REAL,
  promotion_reason TEXT,             -- 'public_data' | 'multi_blog' | 'manual'
  audit_verdict TEXT,                -- 'correct' | 'not_baby_friendly' | 'bad_data' | 'duplicate'
  audit_notes TEXT,
  audit_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_candidate_promotion_audit_status ON candidate_promotion_audit_log(audit_status);
