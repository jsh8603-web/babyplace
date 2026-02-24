-- Phase 2: 시설 검증 + 스코어링 테이블

-- 시설 확인 기록 (22: 최근 3개월 내 사용자 확인 → "최근 검증됨" 배지)
CREATE TABLE verification_checks (
  id SERIAL PRIMARY KEY,
  place_id INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  verified_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스: place_id별 최신 확인 빠른 조회
CREATE INDEX idx_verification_checks_place_id_verified_at
  ON verification_checks(place_id, verified_at DESC);

CREATE INDEX idx_verification_checks_place_id_recent
  ON verification_checks(place_id)
  WHERE verified_at > now() - interval '3 months';

-- 스코어링 이력 (19: 인기도 스코어링 배치)
CREATE TABLE scoring_logs (
  id SERIAL PRIMARY KEY,
  places_count INT,
  min_score REAL,
  max_score REAL,
  avg_score REAL,
  bayesian_constant INT,
  duration_ms INT,
  run_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스: 스코어링 실행 시간별 조회
CREATE INDEX idx_scoring_logs_run_at
  ON scoring_logs(run_at DESC);

-- RLS (Row Level Security) - 필요시 활성화
ALTER TABLE verification_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_logs ENABLE ROW LEVEL SECURITY;

-- 검증 기록: 모두 읽기 가능 (공개 정보), 자신 데이터만 쓰기
CREATE POLICY "verification_checks_read_all"
  ON verification_checks FOR SELECT
  USING (true);

CREATE POLICY "verification_checks_insert_own"
  ON verification_checks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 스코어링 로그: admin 만 조회/쓰기
CREATE POLICY "scoring_logs_admin_all"
  ON scoring_logs FOR ALL
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
