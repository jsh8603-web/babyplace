-- 00069_place_feedback.sql
-- 사용자 가리기/재분류 피드백 → place audit wf 원인추적 루프
-- plan: plan-place-feedback.md

-- 1) 가리기 사유 컬럼 (기존 user_hidden_items 확장)
ALTER TABLE user_hidden_items ADD COLUMN IF NOT EXISTS reason TEXT;

-- 2) 피드백 로그 테이블
--    재분류는 places.category 즉시 반영 후 이 테이블에 applied=true 로 기록.
--    place audit wf 가 audit_status='pending' 건을 매 라운드 인지하여
--    원인추적 → 코드 패치 → 동일원인 장소 일괄수정 수행.
CREATE TABLE IF NOT EXISTS place_feedback (
  id            SERIAL PRIMARY KEY,
  place_id      INT  NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('hide','recategorize')),
  reason        TEXT NOT NULL,                   -- not_baby | closed | wrong_category | other
  prev_category TEXT,                            -- recategorize: 변경 전 category
  new_category  TEXT,                            -- recategorize: 사용자가 고른 값
  applied       BOOLEAN NOT NULL DEFAULT false,  -- 즉시 반영 여부 (recategorize=true)
  audit_status  TEXT NOT NULL DEFAULT 'pending'
                CHECK (audit_status IN ('pending','approved','rejected','flagged')),
  root_cause    TEXT,                            -- 감사 기록: 원인 코드 (예: kakao_default_fallback)
  audit_notes   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  audited_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_place_feedback_status ON place_feedback(audit_status);
CREATE INDEX IF NOT EXISTS idx_place_feedback_place  ON place_feedback(place_id);

-- 3) RLS — 00043 user_hidden_items 패턴 (본인 행만 관리, service_role 은 우회)
ALTER TABLE place_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own place feedback" ON place_feedback
  FOR ALL USING (auth.uid() = user_id);
