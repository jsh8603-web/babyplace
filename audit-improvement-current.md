# 감사 wf 메타 개선 — v6 (2026-05-16, 카운터 3 도달)

> 직전: v5 (2026-04-18). 직전 3회(4/16·4/17·4/18) + 이번(5/16) 기반.
> 이전 v5 → `audit-improvement-current-v5.md`로 아카이브 권장 (이번 미수행 — 시간).

## Step1 — 이전 사이클(v5) 검증

- v5 핵심: penalty_flags 쿼리 timeout 수정, poster pending 1051→390. → 이번 확인: penalty 정상 출력(competing_branch 74%), poster 390→265 추가 감소. **부분 달성**.
- 미달: classification FP <10% 목표(이월#1) → 이번 18.8% **미달·재발**.

## Step3-4 — 10관점 개선 항목 (P1/P2/P3)

| # | 관점 | 현황(데이터) | 문제 | 개선안 | 우선 |
|---|------|------------|------|--------|------|
| 1 | 자동화율 | classification review 55%, pending 126 | classification bulk-judge 부재 — 전수인데 수동만 | classification-audit.ts에 bulkJudge 추가 (blacklist/whitelist 명확매칭 자동 correct, target+키즈 자동) | P2 |
| 2 | 정확도 | LLM FP 18.8%(21/112), 이월#1 재발 | v20 blacklist가 신규 성인뮤지컬/팝업 못 잡음 | S2 파이프라인 실가동(이번 24건 staging→Qwen). 누적 50건+ 자동 정제 | P1 |
| 3 | 커버리지 | place 44%(8067/18537) | 순환 정상, 단 ~335라운드 소요 | 현행 유지(샘플 50) | P3 |
| 4 | 소요시간 | 이번 ~30분, --full 4분 | 신규 0건이라 빠름. 정상 | — | P3 |
| 5 | 코드품질 | keyword-yield silent fail 3회+ 누락 | 없는 컬럼 select→null→무출력(error핸들링부재) | **수정완료**(9e4b4b7): status+error로깅+else | P1✅ |
| 6 | 교차감사 | vision 16/16 reject(100%) | 전건 reject — date mismatch 과민 의심 or poster 품질 | poster-vision.ts date 비교 로직 점검(연도만 vs 전체날짜) | P2 |
| 7 | 스크립트안정성 | S1-Q/S2-Q/keyword 3건 "없는 컬럼" silent | Supabase select 없는컬럼=null, error 미확인 패턴 반복 | 신규 audit 쿼리 작성 시 error 핸들링 의무화(컨벤션) | P1 |
| 8 | 데이터추적 | S2 staging 신설 후 첫 실가동(24건) | classification setVerdict→staging 자동주입 검증 필요 | 다음 라운드 setVerdict FP 판정 시 staging 누적 확인 | P2 |
| 9 | config효과 | classifier v20→FP 18.8% 여전 | 개별 blacklist로 신규 FP 못 따라감 | S2-Q Qwen 자동 정제로 전환(이번 가동) | P1 |
| 10 | 규칙-코드동기화 | classification-rules "개인전 FN" open 미반영 | isBlacklisted(L118) Step1 즉시exclude → "어린이 개인전" FN | event-classifier.ts: blacklist 매칭이어도 title 강baby키워드(어린이/키즈) 시 whitelist로 양보 | P2 |

## Step5 — 즉시 수정(이번 완료)

- ✅ #5 keyword-yield silent fail 수정 (9e4b4b7)
- ✅ #2/#9 S2 파이프라인 실가동 — FP 24건 staging→S2-Q --refine 검증
- ✅ S3-K 프롬프트 보강 (text_mining 10→20 + 검색량) — llm_generated avgEff 0.027 개선 시도
- ✅ S2-Q 프롬프트 강화 (어린이 캐릭터 blacklist 금지 — 티니핑 오추출 차단)

## 이월(다음 3회 사이클)

- S2-Q **역방향 의미 게이트** 미구현 (P1) — sanity는 형식만, Qwen이 "티니핑" 같은 의미부적절 추출 시 못 막음. S1-Q 역방향 오탐의 S2 대칭 필요.
- #1 classification bulkJudge, #6 vision 과민, #10 개인전 FN.
