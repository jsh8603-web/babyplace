-- 00045: Event blog scoring — blog mentions for events + popularity scoring + auto-hide

-- 1. blog_mentions: event_id FK (place_id와 동급)
ALTER TABLE blog_mentions ADD COLUMN event_id INT REFERENCES events(id) ON DELETE CASCADE;
CREATE INDEX idx_blog_mentions_event ON blog_mentions(event_id);

-- 2. events: 스코어링 컬럼 추가
ALTER TABLE events ADD COLUMN mention_count INT DEFAULT 0;
ALTER TABLE events ADD COLUMN popularity_score REAL DEFAULT 0;
ALTER TABLE events ADD COLUMN last_mentioned_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN auto_hidden BOOLEAN DEFAULT false;
CREATE INDEX idx_events_score ON events(popularity_score DESC);

-- 3. app_settings KV 테이블 (관리자 설정)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('event_auto_hide_count', '20')
ON CONFLICT (key) DO NOTHING;

-- RLS for app_settings
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read app_settings"
  ON app_settings FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify app_settings"
  ON app_settings FOR ALL USING (auth.role() = 'service_role');

-- 4. 이벤트 스코어 배치 업데이트 RPC
CREATE OR REPLACE FUNCTION update_event_scores_batch(updates_json TEXT)
RETURNS void AS $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT * FROM json_populate_recordset(
    null::record, updates_json::json
  ) AS x(id INT, score REAL)
  LOOP
    UPDATE events SET popularity_score = rec.score WHERE id = rec.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. increment_event_mention_count RPC
CREATE OR REPLACE FUNCTION increment_event_mention_count(
  p_event_id INT, p_increment INT, p_last_mentioned_at TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  UPDATE events SET
    mention_count = mention_count + p_increment,
    last_mentioned_at = GREATEST(last_mentioned_at, p_last_mentioned_at)
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
