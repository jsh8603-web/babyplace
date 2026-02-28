-- Migration: Kakao keyword management
-- Add provider column to keywords table, seed kakao keywords

-- 1. Add provider column (default 'naver' for existing rows)
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'naver';

-- 2. Add is_indoor column for kakao keywords
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS is_indoor BOOLEAN;

-- 3. Drop old UNIQUE constraint on keyword, replace with (keyword, provider)
ALTER TABLE keywords DROP CONSTRAINT IF EXISTS keywords_keyword_key;
ALTER TABLE keywords ADD CONSTRAINT keywords_keyword_provider_key UNIQUE (keyword, provider);

-- 4. Index for provider + status queries
CREATE INDEX IF NOT EXISTS idx_keywords_provider_status ON keywords (provider, status);

-- 5. Seed kakao keywords (existing 24 from SEARCH_TARGETS)
INSERT INTO keywords (keyword, provider, keyword_group, status, source, is_indoor, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  ('키즈카페', 'kakao', '놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('실내놀이터', 'kakao', '놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('볼풀', 'kakao', '놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('어린이공원', 'kakao', '공원/놀이터', 'NEW', 'seed', false, 0, 0, 0),
  ('놀이터', 'kakao', '공원/놀이터', 'NEW', 'seed', false, 0, 0, 0),
  ('어린이도서관', 'kakao', '도서관', 'NEW', 'seed', true, 0, 0, 0),
  ('유아수영장', 'kakao', '수영/물놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('키즈풀', 'kakao', '수영/물놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('키즈존 식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0, 0, 0),
  ('이유식카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0, 0, 0),
  ('이유식', 'kakao', '식당/카페', 'NEW', 'seed', true, 0, 0, 0),
  ('어린이박물관', 'kakao', '전시/체험', 'NEW', 'seed', true, 0, 0, 0),
  ('과학관', 'kakao', '전시/체험', 'NEW', 'seed', true, 0, 0, 0),
  ('동물원', 'kakao', '동물/자연', 'NEW', 'seed', false, 0, 0, 0),
  ('아쿠아리움', 'kakao', '동물/자연', 'NEW', 'seed', true, 0, 0, 0),
  ('유아체험', 'kakao', '전시/체험', 'NEW', 'seed', true, 0, 0, 0),
  ('키즈수영', 'kakao', '수영/물놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('트램폴린파크', 'kakao', '놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('키즈레스토랑', 'kakao', '식당/카페', 'NEW', 'seed', true, 0, 0, 0),
  ('어린이미술관', 'kakao', '전시/체험', 'NEW', 'seed', true, 0, 0, 0),
  ('유아놀이', 'kakao', '놀이', 'NEW', 'seed', true, 0, 0, 0),
  ('어린이체험관', 'kakao', '전시/체험', 'NEW', 'seed', true, 0, 0, 0),
  ('아기카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0, 0, 0),
  ('가족나들이', 'kakao', '동물/자연', 'NEW', 'seed', false, 0, 0, 0),
  ('워터파크 키즈', 'kakao', '수영/물놀이', 'NEW', 'seed', NULL, 0, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;
