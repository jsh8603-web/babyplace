# Progress: 감사 패턴 Qwen 자동화 파이프라인

> plan: [plan.md](./plan.md) · 인계: [handoff-model-switch-fix-20260515.md](./handoff-model-switch-fix-20260515.md)

## §진입 스냅샷

- **세션**: btn-babyplace (Opus 4.7 1M context)
- **다음 작업**: S1-1 — `collectRejectedPatterns()` 함수 추가 (place-accuracy-audit.ts)
- **선행 완료**: model-switch 버그 해결 (claude-opus-4-7[1m] 정확 ID, ECHO_PAT 분리). 전역 스크립트 2개 미커밋.
- **검증 기준**: place-gate.test.ts 전부 통과 + 캠핑장 차단

## Steps

### S1: place 패턴 Qwen 위임

- [x] S1-1: `collectRejectedPatterns(threshold=50)` 함수 추가 — `place-accuracy-audit.ts`
  - place_accuracy_audit_log에서 not-baby-friendly flagged/rejected 장소명 수집
  - 기존 place_blacklist_patterns 중복 제거
  - `learnPatternsFromDeactivated()` (L548~644) 구조 재활용
  - model: opus
  - **검증**: 613건 수집 (handoff 실측 613 정확 일치) → dedup 260개 → JSON 저장 OK
  - **회귀**: 직교 — 신규 함수+CLI else-if 분기만 추가, fs/path import 신규(기존 미사용), 기존 함수 0 변경

- [x] S1-2: Qwen 프롬프트 파일 — `scripts/qwen-prompts/place-pattern-gen.txt`
  - 장소명 목록 → name/brand 정규식 생성 스펙 (7 규칙: 2건+커버, 한글경계$, 3자금지, brand접두사, 화이트리스트충돌, 유형접미사금지, 중복회피)
  - model: opus
  - **검증**: place-gate.test.ts baseline = 33 pass / 2 **pre-existing fail** (place-gate.ts S1 미변경 git diff 확인). 2건="고우가 여의도점"식당 오차단 + brand 중간위치 오차단 — S1과 직교
  - **회귀**: 직교 — txt 파일만 신규 추가, 코드 0 변경
  - **S1-3 회귀 기준선**: `33 pass / 2 pre-existing fail` — 패턴 추가 후 이보다 악화 없으면 회귀 0

- [x] S1-3: audit-all.ts Phase 4 통합 — `--collect-rejected-patterns` 플래그
  - model: opus
  - runAnalysis(Phase4) 끝 child 호출 + main parser 독립 플래그 + help
  - **검증**: `audit-all.ts --collect-rejected-patterns` → child 정상 호출 → 613→260 JSON OK
  - **회귀**: 직교 — runAnalysis 끝 append only(기존 penalty/coverage 로직 0 변경), 신규 else-if 분기, `await import('child_process')`는 L280 기존 동일 패턴

### S2: classification 패턴 자동화

- [x] S2-1: DB migration — `00068_classification_blacklist_staging.sql`
  - 필드: id(BIGSERIAL), pattern, verdict(fp/fn CHECK), event_name, classifier_step, created_at, processed_at
  - +unprocessed 부분 인덱스 +pending unique 인덱스(중복 staging 방지)
  - model: opus
  - **검증**: 컨벤션 일치(00063/00064 BIGSERIAL+TIMESTAMPTZ), 표준 Postgres 문법. CREATE IF NOT EXISTS 비파괴
  - **DB 실적용**: Supabase 대시보드/CLI 사용자 워크플로 (기존 00057~00067 동일 — repo에 apply 스크립트 없음)
  - **회귀**: 직교 — 신규 SQL 파일, 기존 스키마 0 변경

- [x] S2-2: classification-audit.ts — FP/FN staging 로직 추가
  - setVerdict에 FP/FN 분기 → stageClassificationPattern() (matched_pattern 우선, LLM step은 event_name fallback)
  - dedup = migration partial unique index 23505 반응
  - model: opus
  - **검증**: S2 일괄 tsc (런타임은 테이블 적용 후)
  - **회귀**: 직교 — setVerdict append 분기(기존 update 0 변경, error early-return 개선), 신규 함수

- [x] S2-3: classifier-config.json 갱신 스크립트 — `refine-classifier-patterns.ts` + `classification-pattern-refine.txt`
  - `--collect`(staging≥threshold→Qwen입력) / `--apply <out.json>`(병합+version++ +changelog unshift+staging processed) — S1 흐름 대칭
  - model: opus
  - **검증**: S2 일괄 tsc. config 스키마 정합 — version++/changelog{version,date,change} unshift/blacklist_patterns·whitelist_title_patterns push
  - **회귀**: 직교 — 신규 ts+txt 2파일, 기존 0 변경 (config는 --apply 실행 시에만 변경, 현재 미실행)

- [x] S2-4: audit-all.ts 통합
  - runAnalysis(Phase4) S1 블록 다음 S2 블록 append + main parser `--refine-classifier-patterns` + help
  - model: opus
  - **검증**: tsc 0 errors(전체). 런타임 graceful — 테이블 미적용 시 collect() error 로깅+return, audit-all try/catch로 파이프라인 무중단
  - **회귀**: 직교 — S2 블록 append(S1·기존 0 변경), 신규 else-if 분기, help 1줄

## 완료 (2026-05-15)

S1(place 패턴 Qwen 위임) + S2(classification 패턴 자동화) 7 step 전부 완료.
- **tsc**: 0 errors (전체 프로젝트)
- **place-gate.test.ts**: 33 pass / 2 pre-existing fail (S1 미변경, 회귀 0)
- **S1 런타임**: 613→260 dedup, JSON 정상
- **미적용**: `00068_classification_blacklist_staging.sql` DB 실적용은 Supabase 워크플로 (S2-2/S2-3 런타임은 적용 후)
- **미커밋**: 전역 `model-switch-and-send.sh`+`psmux-send.sh` (별도) / 프로젝트 변경분 (커밋 미지시)

## Working Notes

- 2026-05-15: progress.md 생성. model-switch 버그 해결 완료, S1-1 착수.
