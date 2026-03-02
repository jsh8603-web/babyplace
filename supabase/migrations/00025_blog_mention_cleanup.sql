-- Blog mention noise cleanup: downgrade real estate/spam, delete low-score, recalculate counts.

-- 1. Downgrade real estate/spam pattern mentions
UPDATE blog_mentions SET relevance_score = LEAST(relevance_score, 0.15)
WHERE relevance_score >= 0.3
  AND (title ILIKE ANY(ARRAY['%분양%', '%매매가%', '%시세차익%', '%전세%', '%월세%',
    '%재건축%', '%모델하우스%', '%청약%', '%출장마사지%', '%출장안마%', '%홈타이%'])
    OR snippet ILIKE ANY(ARRAY['%분양정보%', '%오피스텔분양%', '%빌라매매%',
    '%입주자모집%', '%평당가%']));

-- 2. Delete mentions with score < 0.4
DELETE FROM blog_mentions WHERE relevance_score < 0.4;

-- 3. Recalculate mention_count (score >= 0.4 only)
WITH counts AS (
  SELECT place_id, COUNT(*) AS cnt
  FROM blog_mentions WHERE place_id IS NOT NULL
  GROUP BY place_id
)
UPDATE places p SET mention_count = COALESCE(c.cnt, 0)
FROM counts c WHERE p.id = c.place_id;

-- 4. Reset mention_count for places with no remaining mentions
UPDATE places SET mention_count = 0
WHERE id NOT IN (SELECT DISTINCT place_id FROM blog_mentions WHERE place_id IS NOT NULL)
  AND mention_count > 0;
