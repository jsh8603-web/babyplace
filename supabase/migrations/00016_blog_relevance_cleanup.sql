-- 00016: Clean up irrelevant blog_mentions and sync mention_count
--
-- Problem: Blog posts about unrelated topics (product reviews, other cities)
-- were collected for places with common-word names (e.g. "피크닉" = picnic).
-- This migration penalizes those entries and syncs mention_count to match.

-- Step 1: Penalize mentions that reference cities/provinces outside service area
-- For places in Seoul/Gyeonggi/Incheon, a blog post mentioning Busan/Daegu/etc
-- is almost certainly about a different location.
UPDATE blog_mentions bm
SET relevance_score = LEAST(relevance_score, 0.10)
FROM places p
WHERE bm.place_id = p.id
AND (
  p.road_address LIKE '서울%' OR p.road_address LIKE '경기%' OR p.road_address LIKE '인천%'
  OR p.address LIKE '서울%' OR p.address LIKE '경기%' OR p.address LIKE '인천%'
)
AND (
     bm.title   ILIKE '%부산%' OR bm.snippet ILIKE '%부산%'
  OR bm.title   ILIKE '%대구%' OR bm.snippet ILIKE '%대구%'
  OR bm.title   ILIKE '%광주%' OR bm.snippet ILIKE '%광주%'
  OR bm.title   ILIKE '%대전%' OR bm.snippet ILIKE '%대전%'
  OR bm.title   ILIKE '%울산%' OR bm.snippet ILIKE '%울산%'
  OR bm.title   ILIKE '%제주%' OR bm.snippet ILIKE '%제주%'
  OR bm.title   ILIKE '%진주%' OR bm.snippet ILIKE '%진주%'
  OR bm.title   ILIKE '%김해%' OR bm.snippet ILIKE '%김해%'
  OR bm.title   ILIKE '%창원%' OR bm.snippet ILIKE '%창원%'
  OR bm.title   ILIKE '%전주%' OR bm.snippet ILIKE '%전주%'
  OR bm.title   ILIKE '%춘천%' OR bm.snippet ILIKE '%춘천%'
  OR bm.title   ILIKE '%강릉%' OR bm.snippet ILIKE '%강릉%'
  OR bm.title   ILIKE '%속초%' OR bm.snippet ILIKE '%속초%'
  OR bm.title   ILIKE '%여수%' OR bm.snippet ILIKE '%여수%'
  OR bm.title   ILIKE '%순천%' OR bm.snippet ILIKE '%순천%'
  OR bm.title   ILIKE '%포항%' OR bm.snippet ILIKE '%포항%'
);

-- Step 2: Penalize mentions for short-name places (common words)
-- where the blog post doesn't mention the dong/neighborhood name.
-- This catches product reviews and unrelated posts that just contain
-- the common word (e.g. "피크닉" without "남창동").
UPDATE blog_mentions bm
SET relevance_score = LEAST(relevance_score, 0.15)
FROM places p
WHERE bm.place_id = p.id
AND LENGTH(REPLACE(p.name, ' ', '')) <= 4
AND bm.relevance_score > 0.15
-- Post does NOT contain the dong name from the place's address
AND NOT EXISTS (
  SELECT 1
  WHERE (
    -- Extract dong from parentheses in road_address: "(남창동)" → "남창동"
    COALESCE(
      SUBSTRING(p.road_address FROM '\(([가-힣]+동)\)'),
      -- Or from address field tokens
      SUBSTRING(p.address FROM '([가-힣]+동)\s')
    ) IS NOT NULL
    AND (
      bm.title ILIKE '%' || COALESCE(
        SUBSTRING(p.road_address FROM '\(([가-힣]+동)\)'),
        SUBSTRING(p.address FROM '([가-힣]+동)\s')
      ) || '%'
      OR bm.snippet ILIKE '%' || COALESCE(
        SUBSTRING(p.road_address FROM '\(([가-힣]+동)\)'),
        SUBSTRING(p.address FROM '([가-힣]+동)\s')
      ) || '%'
    )
  )
);

-- Step 3: Sync mention_count to actual qualifying blog_mentions count.
-- This ensures the count shown on place cards matches what's on detail pages.
UPDATE places p
SET mention_count = sub.cnt
FROM (
  SELECT place_id, COUNT(*) AS cnt
  FROM blog_mentions
  WHERE relevance_score >= 0.3
  GROUP BY place_id
) sub
WHERE p.id = sub.place_id
AND p.mention_count != sub.cnt;

-- Also zero out places that have no qualifying mentions at all
UPDATE places p
SET mention_count = 0
WHERE p.mention_count > 0
AND NOT EXISTS (
  SELECT 1 FROM blog_mentions bm
  WHERE bm.place_id = p.id AND bm.relevance_score >= 0.3
);
