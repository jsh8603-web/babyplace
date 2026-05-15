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

### S3: Qwen 실호출 바인딩 + 키워드 정제 (2026-05-15 추가, 사용자 지시)

- [x] S3-0: `server/lib/qwen.ts` — callQwen()/isQwenAvailable() (extractWithGemini 시그니처 drop-in, qwen-task.sh child)
  - **검증**: ping `["ping","ok"]` exit 0
- [x] S1-Q: place-accuracy-audit.ts `applyQwenPlacePatterns(apply=false)` + `--apply-qwen-patterns [--apply]`
  - 3중 게이트: malformed / `new RegExp` invalid / 활성 places 역방향 오탐 > FP_LIMIT(3) reject
  - **검증 dry-run**: Qwen 260 names → 12 patterns → **7 accepted / 5 rejected**. 게이트가 `공원$`(fp=3900) `캠핑장$`(149) `수목원$`(27) `삼성화재`(143) `브런치빈`(17) 자동 차단 = **자동 에러검출 실증**
- [x] S2-Q: refine-classifier-patterns.ts `--refine` — collect→callQwen→JSON parse gate→apply 재사용
  - **검증**: 테이블 미적용 시 graceful skip (크래시 0)
- [x] S3-K: candidate-generator.ts `extractWithGemini` → callQwen (`QWEN_KEYWORDS=1` gate + Qwen 실패 시 Gemini fallback, 기존 validateGeneratedKeyword 게이트 유지)
  - **검증**: tsc 0, env off 시 기존 Gemini 경로 drop-in 보존
- [x] S3-T: 전체 — **tsc 0 errors**, **place-gate.test.ts 33 pass / 2 pre-existing fail = baseline 정확 일치 (회귀 0)**

**검증 전략 실증**: "자동 에러검출 가능?" → **예**. S1-Q 역방향 오탐 게이트가 Qwen 규칙위반 산출물(`공원$` 3900건 과차단)을 DB 도달 전 자동 폐기.

### 실동작 검증 (2026-05-15, 사용자 "전체 파이프라인 동작" 지시)

- **0-insert 버그 발견·수정**: place_blacklist_patterns 실제 컬럼 = id,pattern_type,pattern,source,hit_count,is_active,created_at. `description`/`discovered_at` 부재(00067 DB 미적용)로 S1-Q + 기존 learnPatternsFromDeactivated 둘 다 전건 insert 실패(silent). → 실제 스키마 컬럼만 사용 + error 로깅으로 수정. unique constraint `place_blacklist_patterns_pattern_type_pattern_key` 존재 확인(onConflict 정상).
- **S1-Q 실동작 ✅**: `--apply` → Qwen 260 names → 7 accepted/4 rejected → **7 패턴 실제 DB insert 성공** (등산로\s?입구$/묘역제단$/저수지마당바위분기점$/롤링핀/웨이팅/등산로입구$/자전거길$). 역방향 게이트 브런치빈/삼성화재/캠핑장$/수목원$ 자동 차단.
- **S3-K 실동작 ✅**: Qwen 140 생성 → validateGeneratedKeyword 게이트 타지역 40 드롭 → **95 신규 insert, errors 0**. env gate 제거 → `isQwenAvailable()` 기준 Qwen 기본·Gemini fallback (크론/감사 어디서든 자동, 사용자 env 설정 불요).
- **S2 블로커**: classification_blacklist_staging(00068) 테이블 DB 미적용 — 신규 테이블이라 코드 회피 불가. 환경상 프로그래밍 DDL 불가(psql/CLI/pg/rpc 전무, .env 차단). 코드는 완성+graceful → **00068 SQL 대시보드 적용 시 즉시 동작**.
- tsc 0 / place-gate 33 pass·2 pre-existing (회귀 0)

**검증 전략**: invalid regex(`new RegExp` throw) / JSON 파싱 실패 / 역방향 오탐(활성 데이터 매칭 카운트 초과) 3중 자동 게이트. DB write는 dry-run 기본. S3-K는 env gate + fallback로 점진 롤아웃(회귀 시 즉시 복구).

## Working Notes

> [ckpt-202605160050:btn-babyplace] 인계: [handoff-audit-qwen-20260516.md](./handoff-audit-qwen-20260516.md)
> - **마지막 결정**: 장소감사 wf 완료(00:20~00:41, 21분, 카운터3 메타v6 `audit-improvement-current.md`). Qwen 4단계 개선 커밋 — keyword-yield silent-fail fix(9e4b4b7: keywords.is_active 없음→status), S3-K 프롬프트 보강, S2-Q sanity+역방향게이트(#7 코드구현 완료, AUDIT_RULES.md #7 status open 표기만 미갱신→resolved로 바꿔야). 어린이 캐릭터 whitelist 리서치 Phase1 완료(40선, Phase2 skip).
> - **다음 의도**: `server/config/classifier-config.json` 편집 — L2 version 20→21, L3 updated_at "2026-05-16", L38 whitelist `"쿠로미"` 다음에 21개 추가: 티니핑/뽀로로/핑크퐁/타요/또봇/헬로카봇/미니특공대/브레드이발소/콩순이/엄마까투리/슈퍼윙스/두다다쿵/크리쳐스/페파피그/코코멜론/블루이/퍼피구조대/겨울왕국/토이스토리/미키마우스/뿡뿡이 (라바/폴리/호비/꼬모/토마스는 2자 일반어충돌로 제외). L41 changelog 맨앞 unshift `{version:21,date:"2026-05-16",change:"어린이 인기 캐릭터 21종 whitelist 추가 (리서치 기반)"}`. → tsc → git add classifier-config.json AUDIT_RULES.md(#7 resolved) → commit. → 사용자 ②qwen효과 ③토큰 보고. → Phase3 memory(.research/) + MEMORY.md 포인터 + `rm -f .research/tmp/search-*`.
> - **동기화 필요**: classifier-config 현재 v20(편집 전). 리서치 raw=`.research/tmp/search-phase1-kids-characters-2026-result.txt`+archive. 커밋 567df06(audit docs)/9e4b4b7(keyword fix)/S2-Q gate. AUDIT_RULES.md #6 resolved #7 open(코드 구현됨 상태표기만 미갱신).

> [ckpt-202605152115:btn-babyplace] 인계: [handoff-qwen-binding-20260515.md](./handoff-qwen-binding-20260515.md)
> - **마지막 결정**: Qwen ping 성공(exit 0, `["ping","ok"]`) — ollama qwen3-coder-fast 작동 확인. `server/lib/qwen.ts` callQwen 헬퍼 작성 완료(extractWithGemini 시그니처 동일 drop-in).
> - **다음 의도**: S1-Q 구현 — place-accuracy-audit.ts `applyQwenPlacePatterns(dryRun=true)`: place-rejected-names.json + place-pattern-gen.txt → callQwen → JSON.parse → 각 패턴 `new RegExp` 검증 + 활성 places 역방향 오탐 카운트(임계 초과 reject) → dry-run 리포트 / `--apply` 시 place_blacklist_patterns upsert. 이어 S2-Q(refine `--refine`), S3-K(candidate-generator extractWithGemini→callQwen + env gate).
> - **동기화 필요**: 커밋 afc66d7 이후 `server/lib/qwen.ts` 신규 미커밋. progress.md S3 step 추가됨. plan.md는 S3 미반영(progress.md만).

- 2026-05-15: progress.md 생성. model-switch 버그 해결 완료, S1-1 착수.
- 2026-05-15: S1+S2(7 step) 완료 커밋 afc66d7. 사용자 지시로 Qwen 실호출(S1-Q/S2-Q) + S3 키워드 정제 추가.
- 2026-05-15: qwen.ts 헬퍼 작성 + ping 성공. S1-Q 착수 직전 ckpt(252k).
