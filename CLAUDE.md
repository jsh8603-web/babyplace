# babyplace — 아기 친화 장소 플랫폼

서울/경기 아기 친화 장소·이벤트 수집·분류·감사 시스템.
기술스택: Next.js 15 (App Router), Supabase, Gemini API, Playwright

## Auto Triggers

| 트리거 | 실행 | 주기 |
|--------|------|------|
| `장소감사 wf` / `장소감사` / `place audit wf` | audit-system-rules.md 전체 6종 감사 | 주 2~3회 |

## 감사 워크플로우

장소감사 wf 트리거 시:
1. **반드시 먼저** ReadFile `AUDIT_RULES.md` (프로젝트 루트) → 규칙 전체를 읽고 숙지
   - ⚠️ `.claude/` 경로는 .gitignore에 의해 접근 불가. **반드시 프로젝트 루트의 `AUDIT_RULES.md`를 읽을 것**
   - ReadFile 실패 시: `Get-Content -Encoding UTF8 AUDIT_RULES.md`
2. 규칙의 **"감사 실행 원칙 7개"** 를 반드시 확인 (특히 원칙 5: 시간 추적, 원칙 6: 30분 채우기)
3. 시작 시각을 Shell로 기록: `Get-Date -Format "HH:mm"`
4. 0단계에서 `place_feedback` pending 인지 (`place-accuracy-audit.ts --feedback`) → 6종 + 8종(place-feedback) 감사 순차 실행
5. 종료 보고서 작성 (소요시간 포함 필수)

감사 카운터/이력: 프로젝트 메모리 `audit-counter.md` 참조.

## Gemini 세션 지원

Gemini CLI로 감사 실행 시 `.claude/rules/` 접근 불가 → **루트 UPPER_CASE 복사본** 사용.
상세 경로 매핑은 `GEMINI.md` 참조.

| 원본 (.claude/rules/) | Gemini 읽기 경로 |
|-----------------------|-----------------|
| audit-system-rules.md | AUDIT_RULES.md |
| place-audit-rules.md | PLACE_AUDIT_RULES.md |
| classification-audit-rules.md | CLASSIFICATION_AUDIT_RULES.md |
| candidate-audit-rules.md | CANDIDATE_AUDIT_RULES.md |
| event-dedup-audit-rules.md | EVENT_DEDUP_AUDIT_RULES.md |
| poster-audit-rules.md | POSTER_AUDIT_RULES.md |
| mention-audit-rules.md | MENTION_AUDIT_RULES.md |

**동기화 의무**: `.claude/rules/` 원본 수정 시 루트 복사본도 반드시 갱신할 것.

## 전역 시스템 연동 규칙

이 프로젝트는 전역 훅/가드 시스템(`~/.claude/hooks/promotion-signal.js`)의 **하위**로 동작한다.

### 유지되는 전역 보호
- rm-rf / push main 차단 (PreToolUse Bash 가드)
- H4 코드 품질 inject
- H3/H6 세션 복원 / 압축 복원

### 프로젝트가 우선하는 영역
- **감사 기록**: 감사 결과는 프로젝트 내부(audit 스크립트 출력, DB 갱신, classifier-config.json 등)에 기록 — 전역 promotion-log.md에 기록 불필요
- **에러 처리**: 감사 스크립트 실행 중 발생하는 에러(분류 정확도 미달, 중복 감지 등)는 감사 프로세스 내에서 처리

### pending-promotion.txt 처리 기준
- **ERROR**: 감사 스크립트(audit-all.ts, audit-*.ts) 실행 중 에러 → `[SKIP: 감사 프로세스 내부 처리]`
- **ERROR**: 감사 외 에러(빌드 실패, API 키 만료 등) → 기록조건에 따라 판단
- **REQUEST**: 감사 규칙 파일 참조 → `[SKIP: 프로젝트 내부 절차]`
- **PATTERN/KNOWLEDGE**: 새 API 연동, 새 수집 소스 등 → 기록조건에 따라 판단 (범용이면 전역 기록)
