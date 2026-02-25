-- Phase 4: Visit diary
CREATE TABLE visits (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  place_id INT REFERENCES places(id) ON DELETE CASCADE NOT NULL,
  visited_at DATE NOT NULL DEFAULT CURRENT_DATE,
  memo TEXT,
  will_return BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, place_id, visited_at)
);

ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own visits"
  ON visits FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_visits_user ON visits(user_id, visited_at DESC);
CREATE INDEX idx_visits_place ON visits(place_id);
