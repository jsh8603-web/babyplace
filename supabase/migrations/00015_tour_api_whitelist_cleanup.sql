-- ============================================================
-- 00015: Tour API whitelist-based cleanup
-- Fundamental fix: deactivate ALL tour_api places with raw cat3
-- codes NOT in the baby-relevant whitelist, then convert remaining
-- raw codes to human-readable names.
--
-- Baby-relevant cat3 whitelist:
--   A02060100 박물관, A02060300 전시관, A02060500 미술관,
--   A02060600 공연장, A02060900 도서관,
--   A02030100 체험마을, A02030400 이색체험,
--   A01010500 생태관광지, A01010700 수목원,
--   A02020600 테마공원
-- ============================================================

-- ─── Phase 1: Deactivate non-whitelisted raw-coded places ────

-- Deactivate all tour_api places with raw cat codes (A followed by digits)
-- that are NOT in the baby-relevant whitelist
UPDATE places SET is_active = false
WHERE is_active = true
  AND source = 'tour_api'
  AND sub_category ~ '^A\d{2}'
  AND sub_category NOT IN (
    'A02060100', -- 박물관
    'A02060300', -- 전시관
    'A02060500', -- 미술관
    'A02060600', -- 공연장
    'A02060900', -- 도서관
    'A02030100', -- 체험마을
    'A02030400', -- 이색체험
    'A01010500', -- 생태관광지
    'A01010700', -- 수목원
    'A02020600'  -- 테마공원
  );

-- ─── Phase 2: Convert remaining raw codes to human-readable ──

UPDATE places SET sub_category = '박물관'
WHERE source = 'tour_api' AND sub_category = 'A02060100';

UPDATE places SET sub_category = '전시관'
WHERE source = 'tour_api' AND sub_category = 'A02060300';

UPDATE places SET sub_category = '미술관'
WHERE source = 'tour_api' AND sub_category = 'A02060500';

UPDATE places SET sub_category = '공연장'
WHERE source = 'tour_api' AND sub_category = 'A02060600';

UPDATE places SET sub_category = '도서관'
WHERE source = 'tour_api' AND sub_category = 'A02060900';

UPDATE places SET sub_category = '체험마을'
WHERE source = 'tour_api' AND sub_category = 'A02030100';

UPDATE places SET sub_category = '이색체험'
WHERE source = 'tour_api' AND sub_category = 'A02030400';

UPDATE places SET sub_category = '생태관광지'
WHERE source = 'tour_api' AND sub_category = 'A01010500';

UPDATE places SET sub_category = '수목원'
WHERE source = 'tour_api' AND sub_category = 'A01010700';

UPDATE places SET sub_category = '테마공원'
WHERE source = 'tour_api' AND sub_category = 'A02020600';

-- ─── Phase 3: Fix migration 00013 error ──────────────────────
-- A02060200 = 기념관 (NOT 미술관). Fix wrongly labeled places.
UPDATE places SET sub_category = '기념관'
WHERE source = 'tour_api' AND sub_category = '미술관'
  AND name NOT LIKE '%미술관%' AND name NOT LIKE '%화랑%' AND name NOT LIKE '%갤러리%';

-- ─── Phase 4: Fix category mapping for converted places ──────

-- 도서관 sub_category should be category 도서관
UPDATE places SET category = '도서관'
WHERE is_active = true AND source = 'tour_api' AND sub_category = '도서관' AND category != '도서관';

-- 이색체험 → 놀이 (체험 activities for kids)
UPDATE places SET category = '놀이'
WHERE is_active = true AND source = 'tour_api' AND sub_category = '이색체험' AND category != '놀이';

-- 테마공원 → 놀이
UPDATE places SET category = '놀이'
WHERE is_active = true AND source = 'tour_api' AND sub_category = '테마공원' AND category != '놀이';

-- 생태관광지/수목원 → 동물/자연
UPDATE places SET category = '동물/자연'
WHERE is_active = true AND source = 'tour_api'
  AND sub_category IN ('생태관광지', '수목원') AND category != '동물/자연';

-- ─── Phase 5: Deactivate already-converted non-baby places ───
-- 관광지 (catch-all from migration 00013) — re-check individually
-- Deactivate 관광지 sub_category that are actually landmarks
UPDATE places SET is_active = false
WHERE is_active = true
  AND source = 'tour_api'
  AND sub_category = '관광지'
  AND name !~ '(키즈|어린이|아이|유아|가족|체험|놀이|동물|아쿠아|수족|농장|목장|수영|워터|공원|숲|생태|수목|식물)';

-- Deactivate 기념관 (historical memorial halls — not baby-relevant)
UPDATE places SET is_active = false
WHERE is_active = true AND source = 'tour_api' AND sub_category = '기념관';
