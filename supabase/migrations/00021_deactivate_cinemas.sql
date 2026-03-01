-- Deactivate movie theaters (not baby-relevant facilities)
UPDATE places
SET is_active = false
WHERE is_active = true
  AND (
    sub_category IN ('CGV', '롯데시네마', '메가박스', '영화관')
    OR name ILIKE '%시네마%'
  )
  AND name NOT ILIKE '%트램폴린%'
  AND name NOT ILIKE '%레드버튼%';
