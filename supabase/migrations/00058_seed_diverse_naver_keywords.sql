-- 00058: Seed diverse Naver keywords across 7 baby-friendly categories
-- Currently 100% restaurant/cafe keywords — this adds play, parks, exhibits, animals, libraries, pools, medical

INSERT INTO keywords (keyword, provider, keyword_group, status, source, efficiency_score, cycle_count, consecutive_zero_new)
VALUES
  -- 놀이 (10)
  ('아기랑 키즈카페 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('실내놀이터 아기 가볼만한곳', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('돌아기 키즈카페', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('아기 볼풀장 후기', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('유아 실내놀이 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('아기랑 트램폴린', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('24개월 키즈카페', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('아기 놀이공간 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('유아 키즈파크 후기', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),
  ('영아 놀이시설 추천', 'naver', '놀이', 'NEW', 'template', 0, 0, 0),

  -- 공원/놀이터 (8)
  ('아기랑 공원 추천', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('유아숲체험원 후기', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('모래놀이터 아기', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('아기 산책 코스 추천', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('유아 놀이터 깨끗한 곳', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('아기랑 한강공원', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('어린이대공원 아기', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),
  ('유모차 산책 추천', 'naver', '공원/놀이터', 'NEW', 'template', 0, 0, 0),

  -- 전시/체험 (10)
  ('아기랑 박물관 추천', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('유아 체험 프로그램', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('아기 과학관 방문 후기', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('어린이 미술관 추천', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('아기 전시회 갈만한곳', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('유아 요리 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('아기 만들기 체험', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('키즈 체험관 후기', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('아기랑 놀이전시', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),
  ('유아 교육 체험 추천', 'naver', '전시/체험', 'NEW', 'template', 0, 0, 0),

  -- 동물/자연 (8)
  ('아기랑 동물원 후기', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('아기 아쿠아리움 후기', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('아이랑 체험목장', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('유아 동물 먹이주기', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('아기 곤충체험 후기', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('아기 토끼카페 추천', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('아기랑 생태공원', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),
  ('유아 농장체험 추천', 'naver', '동물/자연', 'NEW', 'template', 0, 0, 0),

  -- 도서관 (6)
  ('아기 도서관 추천', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),
  ('그림책 도서관 후기', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),
  ('영아 도서관 추천', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),
  ('유아 책읽기 프로그램', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),
  ('아기 책방 추천', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),
  ('어린이 도서관 가볼만한곳', 'naver', '도서관', 'NEW', 'template', 0, 0, 0),

  -- 수영/물놀이 (8)
  ('아기 수영장 추천', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('베이비 스위밍 추천', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('키즈풀 있는곳', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('아기 수영 교실', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('유아 물놀이 추천', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('아기 풀장 있는 곳', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('영아 수영 가능한곳', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),
  ('아기랑 수영장 후기', 'naver', '수영/물놀이', 'NEW', 'template', 0, 0, 0),

  -- 의료/편의 (10)
  ('소아과 추천 후기', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('수유실 있는 곳', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('아기 예방접종 소아과', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('아기 치과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('유아 안과 후기', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('기저귀갈이대 있는곳', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('아기 한의원 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('소아청소년과 잘하는곳', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('수유실 깨끗한 곳', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0),
  ('아기 피부과 추천', 'naver', '의료/편의', 'NEW', 'template', 0, 0, 0)
ON CONFLICT (keyword, provider) DO NOTHING;
