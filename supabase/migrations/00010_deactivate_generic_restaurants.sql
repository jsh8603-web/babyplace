-- Deactivate generic restaurants/cafes collected via Kakao CE7/FD6 category codes.
-- These are non-baby-friendly places with zero blog mentions.
-- Baby-relevant places (키즈, 아이, 유아, 이유식 etc.) are preserved.

UPDATE places
SET is_active = false,
    updated_at = now()
WHERE source = 'kakao'
  AND category = '식당/카페'
  AND mention_count = 0
  AND name !~* '키즈|아이|유아|이유식|아기|베이비|baby|kids|놀이|어린이'
  AND (sub_category IS NULL
       OR sub_category !~* '키즈|아이|유아|이유식|아기|베이비|baby|kids|놀이|어린이');
