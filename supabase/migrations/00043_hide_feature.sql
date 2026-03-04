-- Admin global hide (separate from is_active which is pipeline data quality)
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE places ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Per-user hide (same pattern as favorites)
CREATE TABLE IF NOT EXISTS user_hidden_items (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  place_id INT REFERENCES places(id) ON DELETE CASCADE,
  event_id INT REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, place_id),
  UNIQUE (user_id, event_id)
);

ALTER TABLE user_hidden_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hidden items" ON user_hidden_items
  FOR ALL USING (auth.uid() = user_id);
