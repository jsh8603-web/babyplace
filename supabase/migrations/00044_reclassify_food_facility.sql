-- Reclassify 식품접객업소 (A004) from '놀이' to '식당/카페'
-- These are restaurants with kids play zones, not dedicated kids cafes
-- Also fix sub_category from raw API value to user-friendly label

UPDATE places
SET category = '식당/카페',
    sub_category = '키즈존식당'
WHERE source = 'children-facility'
  AND sub_category = '식품접객업소';

-- Also fix other raw API sub_category values to user-friendly labels
UPDATE places
SET sub_category = '실내놀이터'
WHERE source = 'children-facility'
  AND sub_category = '놀이제공영업소';

UPDATE places
SET sub_category = '어린이놀이터'
WHERE source = 'children-facility'
  AND sub_category = '도시공원';

UPDATE places
SET sub_category = '대형점포 놀이시설'
WHERE source = 'children-facility'
  AND sub_category = '대규모점포';

UPDATE places
SET sub_category = '육아지원센터'
WHERE source = 'children-facility'
  AND sub_category = '육아종합지원센터';
