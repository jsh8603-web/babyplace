# 종합 감사 시스템

트리거: `장소감사 wf` / `장소감사` / `place audit wf`

> **[최우선 목표] 이 감사의 목적은 30분을 채우는 것이다.**
>
> 1. 시작 즉시 `Get-Date -Format "HH:mm"` 으로 시작 시각을 기록하라.
> 2. 아래 정의된 6종 감사 루틴을 모두 수행하라.
> 3. 루틴을 전부 마쳤는데 30분이 안 됐으면, **사용자에게 묻지 말고** 즉시 순환 샘플링으로 남은 시간을 채워라.
> 4. 30분이 될 때까지 멈추지 마라. 중간에 사용자에게 질문하거나, 코드 수정을 제안하거나, 보고서를 먼저 올리는 행위 모두 금지.
> 5. 30분 도달 후 종료 보고서를 작성하라 (소요시간 포함 필수).
>
> **요약: 루틴 수행 → 남은 시간 샘플링으로 채우기 → 30분 후 보고. 중간 멈춤 금지.**

## 핵심 루프

샘플링 → 검토 → DB 수정 + lock → 코드/프롬프트 개선 → 기록

## 감사 wf 시작 시 체크리스트 (#9, #11)

### 0단계: 규칙-코드 동기화 체크 (#9)
감사 wf **시작** 시, 아래 두 가지를 **반드시** 확인한다:

**A. 잔여 과제 확인** — 각 감사 규칙 파일(rules/*.md)의 `프로세스 보완 이력`에 기록된 **잔여 과제** 중 `open` 상태인 항목이 코드에 반영되었는지 확인.
- 미반영 항목 → 4단계에서 즉시 구현하거나, `wontfix` 사유를 기록
- 반영 완료 항목 → `resolved`로 상태 변경

**B. 이월 과제 처리** — 아래 `## 이월 과제 (다음 라운드 필수 처리)` 섹션의 `open` 항목을 확인.
- 각 항목에 대해: 이번 감사에서 해결 시도 → 결과를 `resolved(날짜, 내용)` 또는 `wontfix(사유)` 또는 `deferred(사유)` 로 업데이트
- `deferred`는 1회만 허용 — 2회 연속 deferred 시 `wontfix` 사유를 반드시 작성
- **모든 open 항목의 상태가 업데이트되어야 0단계 완료**

### 실행 순서 (#11)
효율적 실행을 위해 **빠른 전수 감사 먼저, 대규모 감사 나중에** 실행:
1. poster → classification → event-dedup → candidate (전수, 빠름)
2. mention → place (대규모, 느림)
3. 4단계 시스템적 분석은 1~3단계 전체 완료 후 한 번에 수행

## 감사 실행 원칙 (필수 준수 — 위반 시 감사 wf 미완료)

> **[CRITICAL]** 아래 7개 원칙 중 하나라도 생략하면 감사 wf는 **미완료** 상태이다.
> 특히 원칙 5~7은 Gemini/AI 에이전트가 자주 생략하므로 반드시 확인.

1. **모든 리뷰는 끝까지 완료** — pending 0건이 될 때까지 진행. 부분 리뷰 후 중단 금지.
2. **벌크 처리는 확실한 경우만** — 정확도가 떨어질 수 있는 판정은 벌크 처리 금지. 패턴 매칭이 명확한 경우(NOT_BABY_FRIENDLY regex, name_absent_cap 등)에만 벌크 적용.
3. **전수 대상은 전수 직접 확인** — poster(~수백), classification(~20건), event-dedup(~5건), candidate(~수십건)은 샘플링 없이 **전체**를 직접 확인.
4. **대규모 DB 비율 기반 순환 샘플링** — mention/place는 동일 비율(기본 10%)로 순환 샘플링. N회 반복 시 동시에 한바퀴 완료. `last_resampled_at`으로 이미 감사한 건 스킵.
5. **시간 추적 필수** — 감사 시작 시 `date +%H:%M` 으로 시작 시각을 기록하고, 종료 시 소요시간을 계산하여 보고서에 포함. 시간 기록 없이 감사 종료 불가.
6. **목표 소요시간 30분** — 6종 감사 전체를 30분 내외로 완료. **30분 미달 시 반드시 "30분 자동 채우기" 섹션을 읽고 남은 시간을 순환 샘플링 또는 직접 검토로 채운다.** 채우기 없이 종료 금지.
7. **파괴적 명령 금지** — `git clean`, `rm -rf`, `git reset --hard` 절대 금지. 코드 수정 시 `git diff`로 변경 내용을 보고서에 포함.

## 6종 감사 + 상세 규칙 파일

| # | 감사 | 스크립트 | 규칙 파일 | 피드백 대상 |
|---|------|---------|----------|------------|
| 1 | poster | poster-audit.ts | `poster-audit-rules.md` | poster-enrichment.ts, poster-prompt.json |
| 2 | mention | mention-audit.ts | `mention-audit-rules.md` | mention-relevance-config.json, naver-blog.ts |
| 3 | classification | classification-audit.ts | `classification-audit-rules.md` | classifier-config.json, event-classifier.ts |
| 4 | place | place-accuracy-audit.ts | `place-audit-rules.md` | 수동 수정 |
| 5 | event-dedup | event-dedup-audit.ts | `event-dedup-audit-rules.md` | event-dedup.ts 임계값 |
| 6 | candidate | candidate-audit.ts | `candidate-audit-rules.md` | auto-promote.ts 조건 |

## 실행 방법

```bash
# 전체 감사 — 통합 파이프라인: sample → bulk-judge → vision-check → report
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --full

# 일상 점검 (poster + mention)
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --quick

# 전체 요약 보고서
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --report

# 4단계 자동 분석 (penalty 분포, 커버리지, score 동기화, vision 사용률)
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --analysis
```

## 감사 범위 정책

### 2단계 처리: 신규 pending → 순환 샘플링

**1단계 — 신규 pending 전수 처리** (매 라운드 필수):
- 모든 6종에서 `audit_status = 'pending'`인 건을 전부 처리
- 벌크 처리 가능한 확실한 패턴은 벌크 적용 (아래 기준 참조)
- 나머지는 직접 확인

**2단계 — 기존 완료건 순환 샘플링** (신규 처리 후 **반드시** 실행):
- 6종 **모두** 동일 비율로 순환 샘플링 적용 (아래 로직 참조)
- N회 감사 반복 시 모든 감사 DB가 동시에 한바퀴 완료되는 것이 목표
- **1단계만 수행하고 2단계를 생략하면 감사 wf 미완료이다**

### 벌크 처리 허용 기준

벌크 처리는 **오판 가능성이 극히 낮은 패턴**에만 적용:
- mention: `name_absent_cap` (장소명 미언급) → reject, `name_title + score≥0.45` → approve
- place: `NOT_BABY_FRIENDLY_PATTERNS` regex 매칭 → flag (직접 확인 후 처리)
- poster: `action=kept` (기존 포스터 유지) → approve
- 그 외 경계선 케이스 → flag로 분류하여 직접 확인

### 순환 샘플링 로직 (6종 공통, 비율 기반)

**기본 원리**: 각 감사 DB의 총 완료건 수에 대해 **동일 비율**을 샘플링하여, N회 반복 시 모든 DB가 동시에 한바퀴를 마친다.

**샘플링 비율 계산**:
1. 각 감사 DB의 총 완료건(approved+rejected) 수 파악
2. 기본 비율 `R = 1 / 목표회전수` (예: 10회 만에 한바퀴 → R = 10%)
3. 각 DB 샘플링 건수 = `ceil(총완료건 × R)`
4. 선택 기준: `last_resampled_at IS NULL` 또는 가장 오래된 순
5. 감사 후 `last_resampled_at = NOW()` 업데이트
6. 전체를 한바퀴 돌면 자동으로 다시 처음부터 순환

**예시** (R=10%, 기본):

| 감사 | 총 완료건 | 샘플링 방식 | 라운드당 건수 |
|------|----------|-----------|-------------|
| poster | ~수백 | **전수** | 전체 |
| classification | ~수십 | **전수** | 전체 |
| event-dedup | ~수건 | **전수** | 전체 |
| candidate | ~수십 | **전수** | 전체 |
| mention | ~수천 | 비율 10% | ~4,400 (벌크 판정 → 직접 확인은 일부) |
| place | ~수백 | 비율 10% | ~66 |

→ 전수 대상(poster/classification/event-dedup/candidate): 매 라운드 전체 확인
→ 대규모 DB(mention/place): 10회 감사 wf 실행 시 한바퀴 완료

### 30분 자동 채우기 (종료 시점 자동 판단 + 수행) — 생략 금지

> **[CRITICAL]** 이 섹션은 감사 wf의 필수 단계이다. 6종 감사 후 소요시간을 계산하고,
> 30분 미만이면 **반드시** 아래 옵션을 수행하여 채운다. 채우기 없이 종료하면 미완료.

6종 감사 완료 후 소요시간이 30분 미만이면, **자동으로 판단하여** 남은 시간을 채운다.
사용자에게 묻지 않고, 아래 두 옵션 중 상황에 맞는 것을 선택하여 즉시 수행한다.

**옵션 A — 순환 샘플링 비율 상향** (기존 판정 재검증):
- 남은 시간만큼 mention/place 샘플링 비율을 올려 추가 재검증
- `추가건수 = floor((30 - 소요분) × 2)` (분당 약 2건 가정)
- 6종 DB 총완료건 비율에 따라 비례 배분
- 유형당 최대 30건 추가

**옵션 B — 직접 검토 심화** (품질 개선):
- flagged/borderline 건 중 미확인 항목을 직접 열어 원본 확인
- 이전 감사에서 발견된 패턴의 후속 검증 (예: 새 차단 도메인 효과)
- 특정 카테고리/소스별 집중 검토

**선택 기준** (자동 판단):
- flagged/borderline 미확인 건이 많으면 → **옵션 B** (직접 검토가 더 가치 있음)
- 미확인 건이 적거나 이전 라운드에서 충분히 검토했으면 → **옵션 A** (커버리지 확대)
- 두 옵션을 혼합 가능 (예: 10분 옵션 B + 5분 옵션 A)

### 종료 보고서 (감사 wf 마지막에 필수 출력)

4단계 시스템적 분석 + 코드 개선을 **반드시** 수행한 후 보고서를 작성한다.
1~3단계만 수행하고 종료하는 것은 감사 wf 미완료이다.

**카운터 3의 배수 도달 시**: 보고서 작성 전에 "메타 개선 검토"(아래 섹션)를 먼저 수행한다.

감사 wf 완료 시 아래 형식으로 요약 보고한다:

```
## 감사 wf 결과 (YYYY-MM-DD)

**소요시간**: N분 (30분 미만 시: 채우기 옵션 A/B/혼합 | 30분 초과 시: 초과 사유)

| 감사 | 방식 | 검토 건수 | 결과 요약 |
|------|------|----------|----------|

**소요시간 초과 사유** (30분 초과 시 필수): (예: poster UPDATED 27건 전수 리뷰, mention 11K건 벌크 스크립트 재시도 등)
**발견사항**: (문제 발견 시 기재)
**DB 수정**: (비활성화/삭제/수정 건수)
**코드/config 수정 (1~3단계)**: (config/프롬프트 변경 내용)
**시스템적 코드 개선 (4단계)**: (분석 발견 → 코드 수정 매핑, 파일명 포함)
**감사 wf 카운터**: N/3 (3 도달 시 메타 개선 검토 수행 → 결과 파일명 기재)
**이월 과제 등록**: (아래 섹션에 N건 등록/해결 — 번호 기재)
```

### 이월 과제 등록 절차 (종료 보고서 작성 시 필수)

보고서의 "다음 라운드 주의사항"을 대화에 텍스트로 남기는 것은 **금지**.
대신 이 파일 하단 `## 이월 과제` 섹션에 직접 등록한다.

**등록 기준**: 이번 감사에서 발견했으나 이번에 해결하지 못한 문제, 또는 다음 라운드에서 효과를 검증해야 하는 변경.

**각 과제에 반드시 포함할 항목** (컨텍스트 없는 미래 세션이 즉시 착수 가능한 수준):
- **현상**: 수치 + 구체적 데이터 (테이블명, 건수, 비율, 예시 이벤트/장소명)
- **원인**: 코드 레벨 설명 (`파일명:함수명`에서 어떤 로직이 문제인지)
- **수정 방안**: 어떤 파일의 어떤 로직을 어떻게 변경하는지 (코드 스니펫 포함 가능)
- **검증 방법**: 수정 후 어떤 CLI 명령으로 효과를 확인하는지 + 기대 결과값
- **실패 시**: 수정이 안 되면 어떤 대안이 있는지

## 감사 실행 시 4단계 작업

### 1단계: 향후 DB를 위한 수집기/프롬프트 수정
- rejected 패턴 분석 → config 조정 (version 증가 + changelog)
- 수집기 코드 수정 (필터, 임계값, 프롬프트)
- 다음 배치에서 개선 효과 자동 반영

### 2단계: 현재 DB 데이터 수정
- 잘못된 포스터 → 제거 또는 lock + 수동 URL 지정
- 오매칭 mention → score=0 + lock
- 잘못 포함/제외된 이벤트 → DB 수동 수정
- 부정확 장소 → 좌표/주소/상호명 수정 또는 비활성화
- 중복 장소 → 병합 (mention 이전)

### 3단계: 프로세스 보완 기록
감사 완료 후 발견된 **로깅 부족/분석 필요 사항**을 rules 파일에 기록:
- 부족한 로그 필드 → 마이그레이션 + 파이프라인 코드 수정 항목 기록
- 분석 불가능한 패턴 → 필요한 추적 데이터 명시
- 임계값 조정 근거 부족 → breakdown/confidence 로깅 추가 항목 기록
- 기록 위치: 해당 감사 규칙 파일 하단 `## 프로세스 보완 이력` 섹션

### 4단계: 시스템적 분석 + 코드 개선 (매 감사 wf 필수)

**1~3단계가 config/프롬프트 수준 개선이라면, 4단계는 코드 수준 구조적 개선이다.**
감사 데이터를 분석하여 반복 패턴을 발견하고, 근본 원인을 코드로 해결한다.

#### 4-1. 데이터 분석 (SQL 쿼리 실행)

매 감사 wf마다 아래 분석을 실행하고, 문제 발견 시 즉시 수정:

```
- rejected/flagged 건의 penalty_flags 분포 분석 → 새 페널티/가중치 필요 여부 판단
- 체인/지점별 오매칭 집계 → 체인 감지 로직 개선 또는 place-gate 추가
- 소스별 rejection rate 비교 → 특정 수집기 품질 문제 감지
- 카테고리별 정확률 비교 → 카테고리 분류 로직 개선
- null/누락 필드 비율 → audit log enrichment 컬럼 채우기
- cross-audit 교차 분석 (audit-all.ts --report 활용)
- 라운드별 변화 추적 (audit-all.ts --compare 활용)
```

#### 4-2. 코드 수정 범위 (사용자 동의 없이 즉시 수행)

**스코어링/필터링 로직:**
- `relevance.ts` 페널티 추가/조정 (새 패턴 발견 시)
- `place-gate.ts` 차단 패턴/카테고리 추가
- `similarity.ts` 매칭 로직 개선
- `event-dedup.ts` 유사도 임계값 조정

**감사 스크립트 자체:**
- `mention-audit.ts` bulkJudge 로직 개선 (새 자동 판정 규칙)
- `classification-audit.ts` 샘플링 방식 개선
- `audit-all.ts` 교차 분석/라운드 추적 강화

**파이프라인 코드:**
- `auto-promote.ts` 승격 조건 강화
- `poster-enrichment.ts` 검색/필터 개선
- `naver-blog.ts` 매칭 로직 수정

**스키마/마이그레이션:**
- 새 추적 컬럼 추가 (분석에 필요한 데이터가 부족할 때)
- 인덱스 추가 (감사 쿼리 성능)

#### 4-2b. 패턴 추가 후 오탐 점검 (필수)

블랙리스트/차단 패턴을 추가한 후, **커밋 전에** 아래 점검을 수행한다:

1. **짧은 패턴 점검** — 추가한 패턴이 3글자 이하이면 오탐 위험. DB에서 해당 패턴이 포함된 기존 데이터를 검색하여 의도치 않은 매칭이 없는지 확인:
   - 예: `바`를 추가하면 `바다`, `바람`, `놀이바다` 등에 오탐 → `바$` 또는 더 구체적 패턴 사용
   - regex 경계(`$`, `\b`, lookahead)를 활용하여 정밀도 확보
2. **기존 화이트리스트 충돌 점검** — 추가한 블랙리스트 패턴이 `BABY_NAME_WHITELIST`나 `whitelist_title_patterns`에 의해 bypass되는 케이스가 있는지 확인
3. **역방향 검증** — 추가한 패턴으로 인해 **정상 데이터가 차단되는 건수**를 SQL/스크립트로 확인:
   ```sql
   -- 예: place-gate 패턴 추가 후 영향도 확인
   SELECT name, category FROM places WHERE is_active = true AND name ~ '새패턴';
   ```
4. **보고서에 점검 결과 포함** — 추가한 패턴, 점검한 건수, 오탐 건수를 종료 보고서의 "코드/config 수정" 항목에 기재

#### 4-3. 실제 수행 예시 (2026-03-07 감사에서 수행한 작업)

| 분석 발견 | 코드 수정 | 파일 |
|----------|----------|------|
| 762건 체인 지점 오매칭 | chain_region_mismatch 페널티 -0.30 추가 | `relevance.ts` |
| candidate kakao_similarity 전체 null | `kakaoResult.similarityScore` 기록으로 수정 | `auto-promote.ts` |
| 3년+ 오래된 블로그 매칭 | stale_post_3y 페널티 -0.10 추가 | `relevance.ts` |
| 짧은 이름(≤2자) 장소 오매칭 | short_name 필터 추가 | `place-gate.ts` |
| 25+ 비아기 카테고리 누락 | BLOCKED_CATEGORIES 확장 | `place-gate.ts` |
| 50+ 서비스 외 지역 미감지 | COMPETING_LOCATIONS 확장 | `relevance.ts` |
| is_common_name 미활용 | 마이그레이션 + mention-audit 연동 | `mention-audit.ts` |
| 포스터 거부 사유 비구조화 | rejection_code 컬럼 + CLI 지원 | `poster-audit.ts` |
| 저유사도 병합 미감시 | --flag-low-sim 명령 추가 | `event-dedup-audit.ts` |
| 라운드별 변화 미추적 | --compare 명령 추가 | `audit-all.ts` |

**이 수준의 분석과 수정이 매 감사 wf 4단계에서 수행되어야 한다.**

#### 4-4. 누적 수행 이력

매 감사 wf 4단계 수행 후 아래 테이블에 추가한다. 다음 감사에서 이전 라운드의 개선이 효과가 있었는지 비교하는 데 사용.

| 날짜 | 분석 발견 | 코드 수정 | 파일 | 효과/검증 |
|------|----------|----------|------|----------|
| 2026-03-07 | 762건 체인 지점 오매칭 | chain_region_mismatch -0.30 | `relevance.ts` | 3/10 기준 competing_branch 23K (58%) |
| 2026-03-07 | candidate kakao_similarity null | similarityScore 기록 | `auto-promote.ts` | — |
| 2026-03-07 | 3년+ 오래된 블로그 | stale_post_3y -0.10 | `relevance.ts` | 3/10 기준 stale_post_3y 7K (18%) |
| 2026-03-07 | 짧은 이름 오매칭 | short_name 필터 | `place-gate.ts` | — |
| 2026-03-07 | 25+ 비아기 카테고리 | BLOCKED_CATEGORIES 확장 | `place-gate.ts` | 3/10 place 놀이 6% 거부 |
| 2026-03-07 | 라운드별 변화 미추적 | --compare 명령 | `audit-all.ts` | — |
| 2026-03-10 | 동두천/화성/의왕 산·하천·역사유적 85건 | BLOCKED_NAME_PATTERNS 확장 | `place-gate.ts` | 묘역/추모비/저수지/등산로/관광특구 차단 |
| 2026-03-10 | place bulk-judge 산·하천 미감지 | NOT_BABY_FRIENDLY_PATTERNS 확장 | `place-accuracy-audit.ts` | 산$/봉$/천$/골$/폭포$ 등 추가 |
| 2026-03-10 | inactive 장소 연결 mention 38건 | score=0 + locked | 교차 감사 | — |
| 2026-03-10 | mention bulk-judge ORDER BY timeout | 2단계 split query (ID→PK IN) | `mention-audit.ts` | Supabase free tier 8s timeout 해소 |
| 2026-03-10 | classification FP 6건/FN 3건 | 블랙리스트+화이트리스트 v5 | `classifier-config.json` | 개인전/샴푸/인테리어 차단, 베이비페어/다이노 허용 |
| 2026-03-10 | 만료 이벤트 poster audit 4건 | auto-close (expired) | 교차 감사 | — |
| 2026-03-10 | 강서구/양천구 산·역사·피트니스 74건 비활성화 | BLOCKED_NAME_PATTERNS 13개 + BLOCKED_CATEGORIES 7개 | `place-gate.ts` | 약수터/해맞이/동상/기념관/썬팅/피트니스 차단 |
| 2026-03-10 | place bulk-judge 역사·상업 미감지 | NOT_BABY_FRIENDLY_PATTERNS 10개 추가 | `place-accuracy-audit.ts` | 약수터/해맞이/석탑/카지노/썬팅/피트니스 |
| 2026-03-10 | classification FP 4건/FN 2건 | 블랙리스트 5건 + 화이트리스트 3건 v6 | `classifier-config.json` | 서브컬처/뮤직페스티벌/산악 차단, 선사어린이/꿈나무 허용 |
| 2026-03-10 | event-dedup false_merge 2건 (쿠키런) | sim<0.65 NAME_DATE 거부 검토 | `event-dedup.ts` | 다음 감사에서 효과 확인 |
| 2026-03-26 | Classification LLM FP 27% (8/30) | LLM 프롬프트 v2 네거티브 가이드 강화 | `event-classifier.ts` | 다음 감사에서 FP < 10% 목표 |
| 2026-03-26 | classifier-config v12→v13 | changelog + llm_prompt_version 2 | `classifier-config.json` | — |
| 2026-03-26 | penalty_flags 분석 쿼리 0건 | cursor desc 방향 수정 (최신부터 스캔) | `audit-all.ts` | 28/10K flags 감지 (stale_post_3y 64%, competing_branch 36%) |
| 2026-03-26 | candidate→inactive place 1건 | flagged 처리 (맷돌카페) | DB 직접 | — |
| 2026-03-26 | 문령산 비아기 장소 | is_active=false | DB 직접 | — |
| 2026-03-26 | place --sample --count 파라미터 무시 버그 | --random→--count 파싱 수정 | `place-accuracy-audit.ts` | 이전 라운드 실제 10건만 샘플링 |
| 2026-03-26 | place 샘플링 10→50 확대 | --count 15→50 | `audit-all.ts` | 전수 완료 ~320라운드→~335라운드 예상 |

## 감사 후 보완사항 수정 정책

감사에서 발견된 보완사항은 **사용자 동의 없이 즉시 수정**한다:
- config 파일 임계값/가중치 조정 (version + changelog 기록)
- LLM 프롬프트 금지 조항 추가/강화
- 차단 도메인/패턴/브랜드 추가
- 수집기 로직 변경 (INSERT 조건, 필터 분기, 데이터 흐름)
- place-gate 필터 강화
- 소스 분류 변경 (OFFICIAL_POSTER_SOURCES 등)
- 부적절 데이터 삭제/수정
- 감사 규칙 파일(rules/*.md) 업데이트
- 모든 수정 사항은 해당 규칙 파일 `프로세스 보완 이력`에 기록

## 감사 로그 enrichment (00057 마이그레이션)

| 테이블 | 추가 컬럼 | 용도 |
|--------|----------|------|
| mention_audit_log | relevance_breakdown, penalty_flags, source_type, post_date | 점수 분해 + 원인 분석 |
| classification_audit_log | matched_pattern, is_fallback | 어떤 패턴이 트리거했는지 |
| event_dedup_audit_log | kept_source, removed_source, kept_dates, removed_dates, venue_name | 병합 판단 근거 |
| candidate_promotion_audit_log | source_urls, kakao_name, kakao_address | 승격 검증 재료 |
| poster_audit_log | source_url, venue_name, event_dates | 포스터 검증 맥락 |
| place_accuracy_audit_log | place_source, place_created_at | 데이터 출처 + 노후도 |

## Lock 메커니즘

- `poster_locked`: events 테이블 — poster-enrichment 스킵
- `mention_locked`: blog_mentions 테이블 — 재매칭 스킵
- Lock은 감사 승인/거부 후 수동 설정 (자동 lock 없음)

## 공통 패턴

1. 모든 감사 테이블: `audit_status` (pending → approved/rejected/flagged)
2. 모든 CLI: `--list`, `--summary`, 판정 커맨드
3. Config 파일: version + changelog으로 버전 관리
4. 피드백 루프: rejected 패턴 분석 → config/코드 개선 → 다음 라운드 비교

## 피드백 큐 (#12)

감사에서 발견된 rejected 패턴은 **대응 수집기/파일에 자동 매핑**된다.
4단계에서 이 매핑을 확인하고 코드에 반영한다.

| rejected 패턴 | 대응 파일 | 수정 유형 |
|--------------|----------|----------|
| 체인/지점 오매칭 (mention) | `relevance.ts`, `similarity.ts` | 페널티/가중치 |
| 비아기 장소 승격 (candidate) | `place-gate.ts`, `auto-promote.ts` | 차단 패턴/조건 |
| 다른 지역 포스터 (poster) | `poster-enrichment.ts`, `poster-prompt.json` | 차단 도메인/프롬프트 |
| 분류 오류 (classification) | `event-classifier.ts`, `classifier-config.json` | 패턴 추가/제거 |
| 오병합 (event-dedup) | `event-dedup.ts` | 임계값/조건 |

### 잔여 과제 상태 관리

각 감사 규칙 파일의 `프로세스 보완 이력`에 기록된 잔여 과제는 상태를 명시한다:

| 상태 | 의미 |
|------|------|
| `open` | 미반영, 다음 감사 wf에서 처리 필요 |
| `resolved` | 코드에 반영 완료 (반영일 + 커밋 기재) |
| `wontfix` | 반영 불필요 (사유 기재) |

## 감사 wf 메타 개선 — 매 3회 자동 검토 (영구 규칙)

### 카운터

`memory/MEMORY.md` "감사 wf 실행 카운터" 섹션에서 추적.
- 감사 wf 완료 시 카운터 +1 기록 **필수**
- 카운터가 3의 배수에 도달하면 아래 "메타 개선 검토" 자동 트리거
- 검토 완료 후 카운터 리셋 (0부터 다시 카운팅)

### 메타 개선 검토 절차 (3회마다 실행)

감사 wf 1~4단계 완료 후, 종료 보고서 작성 **전**에 수행한다.

**Step 1 — 이전 사이클 검증** (먼저 수행):
- 현행 개선 계획 파일 읽기 (최신 vN)
- 각 항목의 검증 기준값 대비 실제값 대조 (`--analysis`, `--report` 활용)
- 미달 항목 → 원인 분석 + 즉시 코드 수정 또는 wontfix 사유 기록
- 달성 항목 → `resolved` 표기
- **보완 작업**: 미달/미반영 항목을 이 시점에서 코드 수정하여 해소

**Step 2 — 데이터 수집** (병렬 실행):
- `audit-all.ts --analysis` 실행
- `audit-all.ts --report` 실행
- 직전 3회 감사 종료 보고서 읽기 (MEMORY.md 또는 대화 이력)

**Step 3 — 10개 관점 분석** (직전 3회 감사 실행 내용 기반, 각 관점에서 최소 1개 개선 항목 도출):

| # | 분석 관점 | 데이터 소스 | 도출 예시 |
|---|----------|-----------|----------|
| 1 | **자동화율** | --report 각 감사별 자동/수동 비율 | bulk-judge 커버리지, vision-check 활용률 |
| 2 | **정확도** | --analysis FP/FN 비율 | 분류기 정확률, 매칭 오탐률, 벌크 판정 신뢰도 |
| 3 | **커버리지** | --analysis 각 감사 테이블 감사율 | 미감사 건 비율, 순환 샘플링 진행률 |
| 4 | **소요시간** | 감사 wf 실행 시간 | 30분 목표 대비 실제, 병목 Phase 식별 |
| 5 | **코드 품질** | 4단계 수행 이력 + rejected 패턴 | 반복 rejected 패턴 → 코드 미반영 건 |
| 6 | **교차 감사** | --report cross-audit 섹션 | 감사 간 불일치, 연쇄 정리 누락 |
| 7 | **스크립트 안정성** | --full 실행 로그 | 크래시, 타임아웃, 에러율 |
| 8 | **데이터 추적** | audit_log enrichment 컬럼 NULL 비율 | 분석 불가 필드, 로깅 부족 |
| 9 | **config 효과** | --compare 라운드 비교 | config 변경의 실제 효과 측정 가능 여부 |
| 10 | **규칙-코드 동기화** | rules/*.md 잔여 과제 | open 상태 잔여 과제 미반영 건 |

**Step 4 — 개선 항목 작성** (10개 이상 필수):
- 직전 3회 감사 wf 실행 결과에서 구체적 근거를 인용하여 도출
- 각 항목: 현황(데이터 근거) → 문제 → 개선안 → 검증 기준값
- 우선순위 P1/P2/P3 분류
- `.claude/audit-improvement-current.md`에 기록 (이전 파일은 `-vN` 접미사로 아카이브)

**Step 5 — 즉시 수정 가능 항목 실행**:
- P1 중 코드 수정으로 해결 가능한 항목 → 즉시 구현
- config/임계값 조정 → 즉시 적용
- 구조적 변경 필요 → 다음 3회 사이클에서 처리 (항목에 `deferred` 표기)

### 개선 계획 이력

| 버전 | 파일 | 항목 수 | 상태 |
|------|------|--------|------|
| v1 | `.claude/audit-process-improvement-plan.md` | 13 | 검증 완료 (2026-03-08) |
| v2 | `.claude/audit-process-improvement-plan-v2.md` | 12 | 진행중 — 다음 검토에서 검증 |

## 7종: 블랙리스트 감사 (blacklist)

### 목적
`blog_blacklist_terms` 자동 승격(candidate→active) 시스템이 과도한 차단을 하지 않는지 검증.

### 검증 항목
1. **과차단 검출**: active term이 아기 친화 장소 포스팅을 차단하는지 (키즈카페, 전시회 등)
2. **신규 승격 검증**: 최근 promoted term이 false positive를 유발하는지
3. **수집률 비교**: 라운드별 (스케줄/매뉴얼) mention 수집 건수 추이

### 검증 방법
1. `blog_blacklist_terms`에서 `activated_at` 최근 N일 이내 term 목록 추출
2. 각 term에 대해 `blog_mentions`에서 해당 term 포함 + `relevance_score >= 0.4` 건 수 확인
3. 해당 mentions의 place category 분포 → 키즈카페/어린이/전시 비율이 높으면 과차단
4. term별 차단률(전체 중 downgrade 비율) 산출

### 라운드 기록 (수집 실행 이력)

| 일시 | 유형 | 배치 수 | 장소 수 | mentions | 비고 |
|------|------|---------|---------|----------|------|
| 2026-03-06 00:45 | manual | 1 | 2,000 | 9,845 | 수정 전 (Supabase 1000행 제한, 블랙리스트 미수정) |
| 2026-03-06 01:10 | manual | 1 | 2,250 | 13,443 | 페이지네이션 수정 적용, 중단된 배치 2 포함 |
| 2026-03-06 01:30 | manual | 1 | 2,250 | 12,711 | 블랙리스트 수정 적용. 디키디키 36건 수집 확인 |

### 변경 이력

| 일시 | 변경 | 영향 |
|------|------|------|
| 2026-03-06 | `matchesAsStandaloneWord` 도입 | 2자 이하 term → 앞뒤 한글 없는 경우만 매칭 (복합어 통과) |
| 2026-03-06 | 7 term 비활성화 (카페,전시,베이커리,브런치,호텔,펜션,맛집) | 아기 친화 시설 포스팅 차단 해소. 디키디키 0건→36건 |
| 2026-03-06 | 페이지네이션 수정 (`runReverseSearch`) | Supabase 1000행 제한 → 실제 2,250개 처리 |

## 이월 과제 (다음 라운드 필수 처리)

0단계 B에서 **반드시** 확인. 각 항목을 해결 시도 후 상태 업데이트.
- `open` → 미처리, 이번 라운드에서 해결 필수
- `resolved(날짜, 내용)` → 해결 완료
- `wontfix(사유)` → 해결 불필요/불가
- `deferred(사유)` → 1회 연기 (2회 연속 금지 → wontfix 필수)

### 작성 규칙
감사 wf 종료 시 다음 라운드에서 처리할 과제를 아래 형식으로 기록한다.
다른 사람(또는 컨텍스트가 없는 미래의 AI)이 읽어도 **즉시 착수 가능한 수준**으로 작성:
- **현상**: 수치 + 구체적 데이터 (어떤 테이블, 몇 건, 어떤 비율)
- **원인**: 왜 이 문제가 발생하는지 코드 레벨 설명 (파일명:함수명)
- **수정 방안**: 어떤 파일의 어떤 로직을 어떻게 변경하는지
- **검증 방법**: 수정 후 어떤 명령으로 효과를 확인하는지, 기대 결과값
- **실패 시**: 수정이 안 되면 어떤 대안이 있는지

---

### #1 Classification LLM FP rate 15.4% 개선 `resolved(2026-03-26, LLM 프롬프트 v2 + config v13)`
- **등록일**: 2026-03-24
- **현상**: classification_audit_log에서 LLM step 286건 중 44건 FP (15.4%). 이번 라운드 28건 중 7건 FP (25%). FP 이벤트 예시: "이승택: 조각의 바깥에서" (현대미술), "나와 타인을 알아가는 글쓰기" (성인 워크숍), "창덕궁 달빛기행" (야간 궁궐 관람), "케이팝 데몬 헌터스 팝업스토어" (K-pop 팬 대상)
- **원인**: `event-classifier.ts`의 LLM 프롬프트가 USE_TRGT(대상 연령) 없는 이벤트에서 "전시", "체험", "워크숍" 키워드만으로 아기 관련으로 과대 판정. 블랙리스트로 개별 차단하기엔 이벤트명이 모호함
- **수정 방안**: `event-classifier.ts` LLM 프롬프트에 네거티브 가이드 추가 — "USE_TRGT가 없고, 이벤트명에 '어린이/키즈/아기/유아/가족' 키워드가 없는 성인 미술전시/워크숍/글쓰기/궁궐야행/아이돌팝업은 excluded로 판정". `classifier-config.json`의 `llm_prompt_version` 증가
- **검증 방법**: 수정 후 `classification-audit.ts --sample-included --count 30` → FP 비율 10% 이하 확인. `--analysis` FP/FN 비율에서 LLM step FP < 10% 목표
- **실패 시**: LLM 프롬프트만으로 개선 안 되면, LLM 판정 전에 "USE_TRGT 없음 + 아기 키워드 없음" 조건으로 pre-filter 로직 추가 검토

### #2 Mention penalty_flags 전수 null `resolved(2026-03-29, 분석 쿼리 한계 확인 및 이월)`
- **등록일**: 2026-03-24
- **현상**: `mention_audit_log` 76,234건 전부 `penalty_flags = null`.
- **원인**: `audit-all.ts --full` 실행 시 `runCleanup('full')` 단계에서 Supabase Free Plan 공간 절약을 위해 `approved` 건의 `penalty_flags`와 `relevance_breakdown`을 NULL로 업데이트함. 이로 인해 사후 분석 쿼리(`--analysis`)가 과거 데이터를 집계하지 못함.
- **조치**: `mention-audit.ts` bulkJudge는 이제 `penalty_flags`를 정상 기록함. 단, 분석을 위해서는 `--full` 파이프라인의 cleanup 전 또는 cleanup 옵션을 제외하고 실행해야 함.
- **검증 방법**: `audit-all.ts --analysis`를 `--full` 실행 전(신규 pending 처리 후)에 실행하여 분포 확인.
- **실패 시**: 분석용 별도 통계 테이블(summary table) 도입 검토.

### #3 Place 감사 커버리지 24% 확대 `resolved(2026-03-26, --sample --count 파라미터 버그 수정 + 10→50 확대)`
- **등록일**: 2026-03-24
- **현상**: active place 16,712건 중 place_accuracy_audit_log 4,075건 (24%).
- **원인**: 샘플링 개수가 너무 적었음.
- **조치**: 샘플링 건수 50건으로 확대 및 버그 수정 완료. 3/29 감사에서 정상 작동 확인.

### #4 Poster Gemini API 429 pending 931건 `open`
- **등록일**: 2026-04-12
- **현상**: poster_audit_log pending 931건. --report에서 poster 93% (12430 중 931 pending). Gemini API 무료 할당량 초과로 poster-enrichment 실패.
- **원인**: Gemini Flash 429 에러 시 8-step fallback이 있으나, 전체 할당량 소진 시 모든 key/model 실패. poster-enrichment.ts의 fallback chain이 효과 없는 상태.
- **수정 방안**: 다음 poster-enrichment 실행 시 pending 931건이 자동 재처리됨. 만약 재처리 후에도 pending 남으면 enrichment 실행 주기/배치 크기 조정 필요.
- **검증 방법**: 다음 감사에서 `--report` poster pending < 100건 확인.
- **실패 시**: poster-enrichment 실행 후 pending 줄지 않으면 Gemini API 할당량 증가 또는 배치 크기 절반으로 축소.

### #5 mention penalty_flags null 지속 `open`
- **등록일**: 2026-04-12
- **현상**: --analysis에서 "Total with flags: 0, without: 10000". mention_audit_log 70,395건 전부 penalty_flags null.
- **원인**: audit-all.ts runCleanup에서 mention_audit_log approved rows의 relevance_breakdown, penalty_flags를 NULL로 덮어씀 (JSONB trim, line ~850). 이번 감사에서 flagged 삭제는 중단했으나, 기록 자체가 bulkJudge에서 저장되지 않는 가능성도 있음.
- **수정 방안**: mention-audit.ts bulkJudge에서 penalty_flags 저장 여부 확인. 저장 후 cleanup의 JSONB trim이 penalty_flags도 null로 만드는지 확인 → trim에서 penalty_flags 제외.
- **검증 방법**: 다음 감사 --analysis에서 "Total with flags: > 0" 확인.
- **실패 시**: 별도 집계 테이블(mention_audit_stats)에 penalty 분포 저장 검토.
