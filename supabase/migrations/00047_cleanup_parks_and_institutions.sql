-- 00047: Clean up park name prefixes, broken text, and non-baby institutions
--
-- 1. Fix short park names (prefix only → append 어린이공원 suffix)
-- 2. Delete entries with broken UTF-8 text (mojibake)
-- 3. Deactivate non-baby institutional places

-- 1. Append "어린이공원" to short park names from public-data-go.kr
-- These names are just prefixes like "소담", "견우", "도담" — the API returns the short name
UPDATE places
SET name = name || ' 어린이공원'
WHERE source = 'public-data-go.kr'
  AND sub_category = '어린이공원'
  AND name NOT LIKE '%어린이공원%'
  AND name NOT LIKE '%공원%'
  AND is_active = true;

-- 2. Delete entries with broken UTF-8 (mojibake characters like 궁��, ��패)
DELETE FROM places
WHERE name ~ '[\uFFFD]'
   OR name ~ '��';

-- 3. Deactivate non-baby institutional places by name patterns
UPDATE places
SET is_active = false
WHERE is_active = true
  AND (
    name ~ '물류센터|데이터센터|행정복지센터|관광안내소|무인민원발급|자전거인증센터|국방벤처|미디어센터'
    OR name ~ '삼성전자서비스|LG전자서비스'
    OR name ~ '한국건강관리협회|사이즈코리아'
  )
  AND name !~ '키즈|어린이|유아|베이비|아기|아동|육아|키움|돌봄';

-- 4. Deactivate places with institutional sub_categories (단체,협회 etc.)
UPDATE places
SET is_active = false
WHERE is_active = true
  AND (
    sub_category ~ '단체,협회|협회,단체|사회단체|시민단체'
    OR (sub_category ~ '연구소' AND name !~ '키즈|어린이|유아|베이비|아기|아동|육아|키움|돌봄|놀이')
  );
