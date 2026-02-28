-- ============================================================
-- 00014: Deactivate non-baby franchise chains + generic restaurants
-- Based on audit of 470 active 식당/카페 places (2026-02-28)
-- Expected: ~310 deactivated (101 franchises + 5 coffee chains + 204 generic restaurants)
-- ============================================================

-- ─── Phase 1: Non-baby franchise chains ──────────────────────

-- 1a. 벌툰 — 만화카페 (46)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '벌툰%';

UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '만화카페 벌툰%';

-- 1b. 놀숲 — 보드게임카페 (26)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '놀숲%';

-- 1c. 레드버튼 — 보드게임카페 (19)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '레드버튼%';

UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '보드게임카페 레드버튼%';

-- 1d. 홈즈앤루팡 — 방탈출카페 (7)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '홈즈앤루팡%';

-- 1e. 히어로보드게임카페 (5)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '히어로보드게임%';

UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '보드게임카페 히어로%';

-- 1f. 나인블럭 (2)
UPDATE places SET is_active = false
WHERE is_active = true AND name LIKE '나인블럭%';

-- ─── Phase 2: Generic coffee chains ─────────────────────────

UPDATE places SET is_active = false
WHERE is_active = true
  AND (name LIKE '스타벅스%'
    OR name LIKE '이디야%'
    OR name LIKE '투썸플레이스%'
    OR name LIKE '할리스%'
    OR name LIKE '메가커피%'
    OR name LIKE '컴포즈%'
    OR name LIKE '빽다방%'
    OR name LIKE '커피빈%'
    OR name LIKE '엔제리너스%'
    OR name LIKE '탐앤탐스%'
    OR name LIKE '파스쿠찌%');

-- ─── Phase 3: Generic restaurants (not baby-specific) ───────
-- These have food-specific sub_categories and are in 식당/카페.
-- Keep: 카페, 커피전문점, 키즈카페, 테마카페, 디저트카페, 갤러리카페,
--       식품판매, 반찬가게, 제과/베이커리, 유아 (baby food stores)

UPDATE places SET is_active = false
WHERE is_active = true
  AND category = '식당/카페'
  AND sub_category IN (
    '한식', '육류,고기', '한정식', '갈비', '국수',
    '중국요리', '양식', '닭요리', '냉면', '해장국',
    '국밥', '찌개,전골', '장어', '칼국수', '해물,생선',
    '설렁탕', '순대', '돈까스,우동', '불고기,두루치기',
    '중식', '두부전문점', '감자탕', '샤브샤브', '곰탕',
    '패스트푸드', '곱창,막창', '수제비', '한식뷔페',
    '초밥,롤', '햄버거', '치킨', '쌈밥', '일식집',
    '일식', '뷔페', '떡볶이', '죽', '퓨전한식'
  );
