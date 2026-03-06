-- 00060: Seed seasonal Naver keywords (24) + retire junk keywords

-- ── 봄 (3~5월) ──
INSERT INTO keywords (keyword, provider, keyword_group, status, source, efficiency_score, cycle_count, consecutive_zero_new, seasonal_months)
VALUES
  ('아기랑 벚꽃 나들이 후기', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),
  ('아기 딸기 체험 농장', 'naver', '전시/체험', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),
  ('봄 아기 피크닉 추천', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),
  ('유아 봄나들이 갈만한곳', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),
  ('아기랑 꽃구경 추천', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),
  ('봄 아기 체험학습 추천', 'naver', '전시/체험', 'SEASONAL', 'template', 0, 0, 0, '{3,4,5}'),

  -- ── 여름 (6~8월) ──
  ('아기 물놀이장 추천', 'naver', '수영/물놀이', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),
  ('여름 키즈카페 물놀이', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),
  ('아기 실내 워터파크', 'naver', '수영/물놀이', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),
  ('유아 여름 물놀이 후기', 'naver', '수영/물놀이', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),
  ('아기랑 계곡 추천', 'naver', '동물/자연', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),
  ('여름 아기 실내놀이 추천', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{6,7,8}'),

  -- ── 가을 (9~11월) ──
  ('아기 단풍 구경', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),
  ('아기 고구마 캐기', 'naver', '전시/체험', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),
  ('가을 숲체험 아기', 'naver', '동물/자연', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),
  ('유아 가을 나들이 추천', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),
  ('아기랑 억새축제', 'naver', '공원/놀이터', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),
  ('아기 밤줍기 체험', 'naver', '전시/체험', 'SEASONAL', 'template', 0, 0, 0, '{9,10,11}'),

  -- ── 겨울 (12~2월) ──
  ('아기 눈썰매장 추천', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}'),
  ('겨울 실내 키즈카페', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}'),
  ('아기 온실 식물원', 'naver', '동물/자연', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}'),
  ('겨울 아기 실내놀이 추천', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}'),
  ('유아 스키장 추천', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}'),
  ('아기랑 겨울 가볼만한곳', 'naver', '놀이', 'SEASONAL', 'template', 0, 0, 0, '{12,1,2}')
ON CONFLICT (keyword, provider) DO NOTHING;

-- ── Retire junk keywords (cycle_count=20 → permanent) ──
UPDATE keywords SET status = 'EXHAUSTED', cycle_count = 20
WHERE provider = 'naver'
  AND keyword IN ('개인전', '탕남읍', '존놀집', '항남점', '분가화')
  AND status != 'EXHAUSTED';
