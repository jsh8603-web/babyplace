-- Place blacklist patterns: dynamic pattern storage for Place Gate
-- Allows adding patterns without code deployment

CREATE TABLE IF NOT EXISTS place_blacklist_patterns (
  id SERIAL PRIMARY KEY,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('name', 'brand', 'category')),
  pattern TEXT NOT NULL,
  source TEXT DEFAULT 'manual', -- 'manual' | 'feedback_loop'
  hit_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pattern_type, pattern)
);

-- Seed initial patterns from known problematic places
INSERT INTO place_blacklist_patterns (pattern_type, pattern, source) VALUES
  ('name', '전기차충전', 'manual'),
  ('name', '노상공영주차', 'manual'),
  ('name', '사업단$', 'manual'),
  ('name', '관리사무소$', 'manual'),
  ('name', '운영위원회$', 'manual')
ON CONFLICT (pattern_type, pattern) DO NOTHING;
