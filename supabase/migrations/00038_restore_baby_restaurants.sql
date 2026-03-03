-- Restore wrongly deactivated restaurants from 00010 + 00014
--
-- Root cause:
--   00010: mention_count=0 + no 키즈/아이 in name → deactivated
--     Problem: places are registered before blog mentions arrive (timing gap)
--   00014 Phase 3: sub_category IN (한식,갈비,...) → deactivated
--     Problem: restaurants found via baby keywords (키즈존식당, 이유식카페)
--     are baby-relevant regardless of their food sub_category
--
-- Approach: Restore ALL kakao-source 식당/카페 except:
--   - Brand blacklist (놀숲, 벌툰, 레드버튼, coffee chains, etc.)
--   - Truly irrelevant (애견카페, 칵테일바, 주점, 예식장, 보드게임카페)
--
-- Total restored: 438건 (115 + 323)
-- Already applied via direct UPDATE on 2026-03-03.

-- Phase 1: Family chains + baby food + kids restaurants (115건)
UPDATE places SET is_active = true
WHERE id IN (
  30038,30112,23688,23679,23678,23683,23666,23668,23680,23681,
  23757,22309,30025,23676,23675,23671,23672,23677,23665,23667,
  23686,23684,23685,23689,23690,23694,23696,23692,23693,23691,
  23695,23703,23723,23702,23706,23705,23724,23777,23726,23733,
  23735,23748,23750,23767,23766,23770,23771,23773,23701,23707,
  23760,30121,23698,23670,23682,23782,400,23741,23783,23765,
  253,1948,1947,1945,1959,30021,1952,1929,1930,1976,
  1953,1956,1957,1978,1981,2010,2014,1955,2015,29971,
  1934,1950,1963,1974,1951,1988,1999,2008,1940,1936,
  1941,1967,1992,1998,1966,1946,2012,1964,1984,1991,
  2011,2005,1996,2004,1965,1993,1985,1987,2006,30016,
  30513,5046,5048,5049,23790
)
AND is_active = false;

-- Phase 2: All remaining kakao restaurants (323건)
-- Restore everything except brand blacklist + truly irrelevant sub_categories
UPDATE places SET is_active = true
WHERE is_active = false
  AND source = 'kakao'
  AND category = '식당/카페'
  AND name !~ '^(놀숲|벌툰|레드버튼|홈즈앤루팡|히어로보드게임|나인블럭|스타벅스|이디야|투썸플레이스|할리스|메가커피|컴포즈|빽다방|커피빈|엔제리너스|탐앤탐스|파스쿠찌|더벤티|폴바셋|카페베네|요거프레소|공차|쥬시)'
  AND COALESCE(sub_category, '') !~ '레드버튼|놀숲|벌툰|히어로보드게임|홈즈앤루팡|나인블럭|보드게임|방탈출|만화카페|애견카페|고양이카페|칵테일바|호프|요리주점|예식장|웨딩|사진관|포토스튜디오|펜션'
  AND name !~ '애견|고양이카페|칵테일|웨딩|예식|사진관|포토스튜디오|펜션';
