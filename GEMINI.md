# babyplace — Gemini 프로젝트 보충 규칙

## 공유 규칙

이 프로젝트의 규칙은 **CLAUDE.md에 정의**. 반드시 읽고 따를 것.
CLAUDE.md의 모든 규칙(감사 워크플로우, 6종 감사, 30분 채우기, 시간 추적)을 준수.

## 읽기 경로 (.claude/rules/ 읽기 불가 → 루트 대체)

| .claude/rules/ 경로 | Gemini 읽기 경로 | 비고 |
|---------------------|-----------------|------|
| .claude/rules/audit-system-rules.md | AUDIT_RULES.md | 읽기 전용 복사본 (종합 감사) |
| .claude/rules/place-audit-rules.md | PLACE_AUDIT_RULES.md | 읽기 전용 복사본 |
| .claude/rules/classification-audit-rules.md | CLASSIFICATION_AUDIT_RULES.md | 읽기 전용 복사본 |
| .claude/rules/candidate-audit-rules.md | CANDIDATE_AUDIT_RULES.md | 읽기 전용 복사본 |
| .claude/rules/event-dedup-audit-rules.md | EVENT_DEDUP_AUDIT_RULES.md | 읽기 전용 복사본 |
| .claude/rules/poster-audit-rules.md | POSTER_AUDIT_RULES.md | 읽기 전용 복사본 |
| .claude/rules/mention-audit-rules.md | MENTION_AUDIT_RULES.md | 읽기 전용 복사본 |

**범용 지식 (전체 목록: `GEMINI_SYNC_MANIFEST.md` 참조)**

| Claude 원본 경로 | Gemini 읽기 경로 | 비고 |
|------------------|-----------------|------|
| ~/.claude/docs/domain/agent-task-api.md | AGENT_TASK_API.md | 태스크 등록/실행 API |
| ~/.claude/docs/domain/excel-powerbi.md | EXCEL_POWERBI.md | Excel/PBI 처리 |
| ~/.claude/docs/patterns/*.md | PATTERN_*.md | 설계 패턴 6종 |
| ~/.claude/docs/operations/code-quality.md | CODE_QUALITY.md | 코드 품질 기준 |
| ~/.claude/docs/operations/env-manifest.md | ENV_MANIFEST.md | 환경변수 관리 |
| ~/.claude/rules/pc-tools.md | PC_TOOLS.md | PC 도구 인벤토리 |
| ~/.claude/skills/email-smtp/skill.md | SKILL_EMAIL_SMTP.md | SMTP 발송 |
| ~/.claude/skills/gmail-fetch/skill.md | SKILL_GMAIL_FETCH.md | Gmail 조회 |
| ~/.claude/skills/gdrive-upload/skill.md | SKILL_GDRIVE_UPLOAD.md | Drive 업로드 |
| ~/.claude/skills/telegram-notify/skill.md | SKILL_TELEGRAM.md | 텔레그램 봇 |

## 감사 워크플로우

1. **반드시 먼저** AUDIT_RULES.md (프로젝트 루트) 읽기 → 규칙 전체 숙지
2. 규칙의 **"감사 실행 원칙 7개"** 확인 (특히 원칙 5: 시간 추적, 원칙 6: 30분 채우기)
3. 시작 시각 기록: `date +%H:%M`
4. 6종 감사 순차 실행 — 각 감사별 상세 규칙은 위 경로 매핑의 루트 파일 참조
5. 종료 보고서 작성 (소요시간 포함 필수)

### 감사 스크립트 실행

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/audit-all.ts --full
```

개별 감사:
```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/{script}.ts
```

## 기록 장소

| 파일 | 위치 | 시점 |
|------|------|------|
| 감사 보고서 | 채팅 출력 | 감사 완료 시 |
| 코드 수정 | PR 또는 직접 수정 | 감사 중 발견 시 |
| promotion-log | .gemini-outbox/promotion-log-entry.md | 에러/패턴 발견 시 |

## Agent 필드

감사 보고서에 `Agent: Gemini CLI` 기재.

## .claude/ 디렉토리 보호

`.claude/` 하위 파일은 **삭제/수정 금지**. `.geminiignore`로 차단됨.
- 루트 UPPER_CASE 파일은 **읽기 전용 복사본** — 원본은 `.claude/rules/`에 있음
- `.claude/rules/` 파일은 Claude가 사용하는 원본이므로 Gemini가 건드리면 Claude 파이프라인이 깨짐
- 규칙 수정이 필요하면 `.gemini-outbox/`에 제안을 기록할 것
