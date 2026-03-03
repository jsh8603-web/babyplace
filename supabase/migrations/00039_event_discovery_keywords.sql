-- Seed keywords for blog event discovery (keyword_group='문화행사')
-- These keywords are used by blog-event-discovery.ts to search Naver blogs
-- for baby/child events not listed in public APIs.

INSERT INTO keywords (keyword, provider, keyword_group, status, source)
VALUES
  ('어린이 전시 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('아기 팝업스토어', 'naver', '문화행사', 'NEW', 'seed'),
  ('키즈 테마파크 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('유아 체험전', 'naver', '문화행사', 'NEW', 'seed'),
  ('캐릭터 전시 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('어린이 공연 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('키즈파크', 'naver', '문화행사', 'NEW', 'seed'),
  ('아기 전시회', 'naver', '문화행사', 'NEW', 'seed'),
  ('어린이 팝업', 'naver', '문화행사', 'NEW', 'seed'),
  ('키즈 체험 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('어린이 뮤지컬 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('가족 공연 서울', 'naver', '문화행사', 'NEW', 'seed'),
  ('어린이 인형극', 'naver', '문화행사', 'NEW', 'seed'),
  ('아기랑 전시', 'naver', '문화행사', 'NEW', 'seed'),
  ('유아 공연 경기', 'naver', '문화행사', 'NEW', 'seed')
ON CONFLICT (keyword, provider) DO NOTHING;
