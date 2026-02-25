-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 사용자 프로필 (Supabase Auth 확장)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 장소
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sub_category TEXT,
  address TEXT,
  road_address TEXT,
  district_code TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  phone TEXT,
  source TEXT NOT NULL,
  source_id TEXT,
  kakao_place_id TEXT UNIQUE,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  is_indoor BOOLEAN,
  mention_count INT DEFAULT 0,
  popularity_score REAL DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  source_count INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 장소 후보 (자동 승격 대기)
CREATE TABLE place_candidates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  kakao_place_id TEXT,
  kakao_similarity REAL,
  source_urls TEXT[] DEFAULT '{}',
  source_count INT DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);

-- 공연/행사
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  venue_name TEXT,
  venue_address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  start_date DATE NOT NULL,
  end_date DATE,
  time_info TEXT,
  price_info TEXT,
  age_range TEXT,
  source TEXT NOT NULL,
  source_id TEXT UNIQUE,
  source_url TEXT,
  poster_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 즐겨찾기 (계정별)
CREATE TABLE favorites (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  place_id INT REFERENCES places(id) ON DELETE CASCADE,
  event_id INT REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (place_id IS NOT NULL OR event_id IS NOT NULL),
  UNIQUE (user_id, place_id),
  UNIQUE (user_id, event_id)
);

-- 블로그/카페 언급
CREATE TABLE blog_mentions (
  id SERIAL PRIMARY KEY,
  place_id INT REFERENCES places(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  title TEXT,
  url TEXT UNIQUE,
  post_date DATE,
  snippet TEXT,
  collected_at TIMESTAMPTZ DEFAULT now()
);

-- 키워드
CREATE TABLE keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT UNIQUE NOT NULL,
  keyword_group TEXT,
  status TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACTIVE', 'DECLINING', 'EXHAUSTED', 'SEASONAL')),
  efficiency_score REAL DEFAULT 0,
  total_results INT DEFAULT 0,
  new_places_found INT DEFAULT 0,
  duplicate_ratio REAL DEFAULT 0,
  cycle_count INT DEFAULT 0,
  consecutive_zero_new INT DEFAULT 0,
  seasonal_months INT[],
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- 키워드 사이클 로그
CREATE TABLE keyword_logs (
  id SERIAL PRIMARY KEY,
  keyword_id INT REFERENCES keywords(id) ON DELETE CASCADE,
  api_results INT,
  new_places INT,
  duplicates INT,
  ran_at TIMESTAMPTZ DEFAULT now()
);

-- 수집 로그
CREATE TABLE collection_logs (
  id SERIAL PRIMARY KEY,
  collector TEXT NOT NULL,
  keyword TEXT,
  results_count INT DEFAULT 0,
  new_places INT DEFAULT 0,
  new_events INT DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  duration_ms INT,
  ran_at TIMESTAMPTZ DEFAULT now()
);

-- 검색 로그
CREATE TABLE search_logs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  results_count INT,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 인덱스 ============

CREATE INDEX idx_places_category ON places(category);
CREATE INDEX idx_places_location ON places USING gist (
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)
);
CREATE INDEX idx_places_district ON places(district_code);
CREATE INDEX idx_places_score ON places(popularity_score DESC);
CREATE INDEX idx_places_active ON places(is_active);
CREATE INDEX idx_places_name_trgm ON places USING gin (name gin_trgm_ops);

CREATE INDEX idx_candidates_seen ON place_candidates(last_seen_at);

CREATE INDEX idx_events_dates ON events(start_date, end_date);

CREATE INDEX idx_favorites_user ON favorites(user_id);

CREATE INDEX idx_blog_mentions_place ON blog_mentions(place_id);
CREATE INDEX idx_blog_mentions_url ON blog_mentions(url);

CREATE INDEX idx_keywords_status ON keywords(status);

CREATE INDEX idx_collection_logs_ran ON collection_logs(ran_at DESC);

-- ============ RLS 정책 ============

ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Places are publicly readable"
  ON places FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify places"
  ON places FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Only service_role can update places"
  ON places FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "Only service_role can delete places"
  ON places FOR DELETE USING (auth.role() = 'service_role');

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Events are publicly readable"
  ON events FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify events"
  ON events FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Only service_role can update events"
  ON events FOR UPDATE USING (auth.role() = 'service_role');

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites"
  ON favorites FOR ALL USING (auth.uid() = user_id);

ALTER TABLE blog_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Blog mentions are publicly readable"
  ON blog_mentions FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify blog_mentions"
  ON blog_mentions FOR INSERT WITH CHECK (auth.role() = 'service_role');

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role manages profiles"
  ON profiles FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert search_logs"
  ON search_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Only service_role can read search_logs"
  ON search_logs FOR SELECT USING (auth.role() = 'service_role');

-- place_candidates, keywords, keyword_logs, collection_logs: 서버 전용 (RLS 불필요, service_role만 접근)

-- ============ Trigger: updated_at 자동 갱신 ============

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER places_updated_at
  BEFORE UPDATE ON places
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============ Trigram 확장 (검색용) ============

CREATE EXTENSION IF NOT EXISTS pg_trgm;
