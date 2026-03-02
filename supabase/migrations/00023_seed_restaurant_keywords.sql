-- Migration: Seed 30 restaurant/cafe keywords for better FD6/CE7 coverage
-- Current: 329/9,062 active places (3.6%) are restaurants — need more keywords

-- Kakao keywords (15): place-name style for Kakao keyword search
INSERT INTO keywords (keyword, provider, keyword_group, status, source, is_indoor, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  ('키즈존식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기의자식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('놀이방카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈카페식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('패밀리레스토랑', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('이유식식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('뷔페키즈', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈뷔페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기랑브런치', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈플레이트', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('유아식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('놀이방레스토랑', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기식당', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈존카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('이유식카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;

-- Naver keywords (15): descriptive blog-search style
INSERT INTO keywords (keyword, provider, keyword_group, status, source, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  ('아기랑 외식 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('유아 식당 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('키즈존 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기 의자 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('놀이방 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기랑 브런치 카페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('이유식 먹을 수 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('유아 동반 맛집', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('키즈 메뉴 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기랑 뷔페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('가족 외식 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아이랑 갈만한 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('유모차 가능 카페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기 환영 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('키즈 프렌들리 카페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;
