-- ============================================================
-- 00013: Deactivate non-baby places + fix category mismatches
-- Based on full audit of 4,823 active places (2026-02-28)
-- Expected: 43 deactivated, 33 re-categorized
-- ============================================================

-- ─── Phase 1: Deactivate non-baby-relevant places ───────────

-- 1a. Palaces (5)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category LIKE '%궁%';

-- 1b. Streets / food alleys / cafe streets (14)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category IN ('테마거리', '먹자골목', '카페거리');

-- 1c. Churches (3)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category IN ('교회', '성당');

-- 1d. Hotels/motels (2)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category IN ('호텔', '여관,모텔', '리조트');

-- 1e. Pet parks — not for children (11)
UPDATE places SET is_active = false
WHERE is_active = true
  AND (sub_category = '반려견놀이터' OR name LIKE '%반려견%' OR name LIKE '%애견%');

-- 1f. Hiking trails (2)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category = '도보여행';

-- 1g. Parking lots that matched as 전시/체험 (6)
UPDATE places SET is_active = false
WHERE is_active = true AND sub_category = '주차장';

-- ─── Phase 2: Fix category mismatches ───────────────────────

-- 2a. 박물관/미술관/과학관/전시관/체험관 → 전시/체험 (18)
UPDATE places SET category = '전시/체험'
WHERE is_active = true
  AND category != '전시/체험'
  AND name ~ '(박물관|미술관|과학관|전시관|체험관)';

-- 2b. 워터파크 → 수영/물놀이 (8)
UPDATE places SET category = '수영/물놀이'
WHERE is_active = true
  AND category != '수영/물놀이'
  AND (sub_category = '워터테마파크' OR name ~ '워터파크');

-- 2c. 아쿠아리움/수족관 → 동물/자연 (2)
UPDATE places SET category = '동물/자연'
WHERE is_active = true
  AND category != '동물/자연'
  AND (sub_category IN ('아쿠아리움', '수족관') OR name ~ '(아쿠아리움|수족관)');

-- 2d. Parks in 동물/자연 → 공원/놀이터 (3)
--     (not zoos, theme parks, or 대공원)
UPDATE places SET category = '공원/놀이터'
WHERE is_active = true
  AND category = '동물/자연'
  AND name LIKE '%공원%'
  AND sub_category NOT IN ('동물원', '테마파크')
  AND name NOT LIKE '%동물%'
  AND name NOT LIKE '%대공원%';

-- ─── Phase 3: Fix Tour API sub_category codes ───────────────
-- Tour API stores raw cat3 codes (A02060100) instead of readable names.
-- Update the most common ones to human-readable names.

UPDATE places SET sub_category = '박물관'
WHERE source = 'tour_api' AND sub_category = 'A02060100';

UPDATE places SET sub_category = '미술관'
WHERE source = 'tour_api' AND sub_category = 'A02060200';

UPDATE places SET sub_category = '공연장'
WHERE source = 'tour_api' AND sub_category = 'A02060500';

UPDATE places SET sub_category = '관광지'
WHERE source = 'tour_api' AND sub_category IN ('A02020700', 'A02020300', 'A02020800');
