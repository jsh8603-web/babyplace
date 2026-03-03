-- One-time cleanup: deactivate existing non-baby-relevant places
-- Categories: parking/charging, admin offices, blacklisted brands, non-baby museums

-- 1. Parking, charging stations, admin offices
UPDATE places SET is_active = false
WHERE is_active = true
  AND (
    name ~ '주차장|충전소|사업단|관리사무소|행정기관|관리공단|운영사무국'
    OR name ~ '지구대|파출소|교도소|소방서|우체국|세무서'
  );

-- 2. Blacklisted brands (re-entered despite code-level filters)
UPDATE places SET is_active = false
WHERE is_active = true
  AND (
    name LIKE '놀숲%'
    OR name LIKE '벌툰%'
    OR name LIKE '레드버튼%'
    OR name LIKE '홈즈앤루팡%'
    OR name LIKE '히어로보드게임%'
    OR name LIKE '나인블럭%'
  );

-- 3. Coffee chains (re-entered)
UPDATE places SET is_active = false
WHERE is_active = true
  AND (
    name LIKE '스타벅스%'
    OR name LIKE '이디야%'
    OR name LIKE '투썸플레이스%'
    OR name LIKE '할리스%'
    OR name LIKE '메가커피%'
    OR name LIKE '컴포즈%'
    OR name LIKE '빽다방%'
  );

-- 4. Non-baby museums (war, military, industry-specific)
UPDATE places SET is_active = false
WHERE is_active = true
  AND category = '전시/체험'
  AND (
    name ~ '전쟁|군사|안보|호국|순국|독립운동|항일|3.1'
    OR name ~ '산업|섬유|철강|석탄|광업|농업|수산'
  );
