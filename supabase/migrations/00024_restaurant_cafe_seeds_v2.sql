-- Migration: Seed 30 additional restaurant/cafe keywords (v2)
-- Fills semantic gaps: cuisine types, events (돌잔치/백일잔치), facilities, meal formats

-- Kakao keywords (15): place-name style
INSERT INTO keywords (keyword, provider, keyword_group, status, source, is_indoor, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  -- 요리 타입 (4)
  ('아기돈까스', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈피자', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈한정식', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기파스타', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  -- 이벤트 (3)
  ('돌잔치', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('돌잔치레스토랑', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('백일잔치', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  -- 포맷 (4)
  ('키즈브런치', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기디저트카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('유아동반카페', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기베이커리', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  -- 식사 (4)
  ('유아밥상', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('키즈세트', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('아기밥집', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0),
  ('이유식맛집', 'kakao', '식당/카페', 'NEW', 'seed', true, 0.5, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;

-- Naver keywords (15): descriptive blog-search style
INSERT INTO keywords (keyword, provider, keyword_group, status, source, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  -- 요리 (3)
  ('아기랑 돈까스 맛집', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('유아 한정식 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기랑 피자집 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  -- 이벤트 (3)
  ('돌잔치 식당 추천', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('백일잔치 레스토랑', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기 생일파티 장소', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  -- 시설 (3)
  ('수유실 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('기저귀 교환대 있는 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('놀이공간 있는 카페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  -- 식사 (3)
  ('유아 정식 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('키즈 세트메뉴 맛집', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기 이유식 제공 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  -- 서술 (3)
  ('아기랑 디저트 카페', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('유모차 가능 맛집', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0),
  ('아기 데리고 가기 좋은 식당', 'naver', '식당/카페', 'NEW', 'seed', 0.5, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;
