-- 00059: Seed location × multi-category keywords
-- Current: 10 locations × restaurant only → New: 15 locations × 4 categories × 2 patterns = 120

INSERT INTO keywords (keyword, provider, keyword_group, status, source, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  -- ── 강남역 ──
  ('강남역 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('강남역 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('강남역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('강남역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('강남역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('강남역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('강남역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('강남역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 용산역 ──
  ('용산역 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('용산역 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('용산역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('용산역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('용산역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('용산역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('용산역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('용산역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 목동 ──
  ('목동 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('목동 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('목동 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('목동 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('목동 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('목동 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('목동 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('목동 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 노원역 ──
  ('노원역 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('노원역 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('노원역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('노원역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('노원역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('노원역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('노원역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('노원역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 송파역 ──
  ('송파역 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('송파역 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('송파역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('송파역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('송파역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('송파역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('송파역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('송파역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 분당 ──
  ('분당 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('분당 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('분당 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('분당 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('분당 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('분당 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('분당 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('분당 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 용인 ──
  ('용인 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('용인 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('용인 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('용인 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('용인 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('용인 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('용인 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('용인 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 고양 ──
  ('고양 아기랑 식당', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('고양 키즈존 카페', 'naver', '식당/카페', 'NEW', 'template', 0, 0, 0),
  ('고양 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('고양 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('고양 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('고양 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('고양 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('고양 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 잠실역 (기존 지역, 신규 카테고리) ──
  ('잠실역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('잠실역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('잠실역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('잠실역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('잠실역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('잠실역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 홍대입구역 (기존 지역, 신규 카테고리) ──
  ('홍대입구역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('홍대입구역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('홍대입구역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('홍대입구역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('홍대입구역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('홍대입구역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 건대입구역 (기존 지역, 신규 카테고리) ──
  ('건대입구역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('건대입구역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('건대입구역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('건대입구역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('건대입구역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('건대입구역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 성수동 (기존 지역, 신규 카테고리) ──
  ('성수동 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('성수동 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('성수동 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('성수동 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('성수동 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('성수동 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 여의도역 (기존 지역, 신규 카테고리) ──
  ('여의도역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('여의도역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('여의도역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('여의도역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('여의도역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('여의도역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 판교역 (기존 지역, 신규 카테고리) ──
  ('판교역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('판교역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('판교역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('판교역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('판교역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('판교역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),

  -- ── 수원역 (기존 지역, 신규 카테고리) ──
  ('수원역 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('수원역 아기 놀곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('수원역 아기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('수원역 어린이 박물관', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('수원역 소아과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('수원역 수유실', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;
