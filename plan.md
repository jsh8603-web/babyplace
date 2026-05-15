# Plan: 감사 패턴 Qwen 자동화 파이프라인

> 인계: [handoff-model-switch-fix-20260515.md](./handoff-model-switch-fix-20260515.md)

## 목표
장소감사 wf에서 수동으로 처리하던 두 가지 패턴 추가 작업을 자동화.
- S1: place rejected 장소명 → Qwen 정규식 생성 → place_blacklist_patterns DB
- S2: classification FP/FN 패턴 → Qwen 정제 → classifier-config.json 자동 갱신

## 배경
- S1 누적: 613건 not-baby-friendly flagged/rejected (place_blacklist_patterns 현재 5건만 등록)
- S2: 매 감사 wf마다 수동으로 blacklist 54건 유지, 이후에도 계속 증가
- place-gate.ts에 동적 로드(5분 캐시) + place_blacklist_patterns 테이블 이미 존재 → S1 인프라 준비됨
- S2는 DB 테이블 신설 필요

## Steps

### S1: place 패턴 Qwen 위임

- [ ] S1-1: `collectRejectedPatterns()` 함수 추가 (place-accuracy-audit.ts)
  - place_accuracy_audit_log에서 not-baby-friendly flagged/rejected 장소명 수집
  - 기존 place_blacklist_patterns와 중복 제거
  - model: opus

- [ ] S1-2: Qwen 프롬프트 파일 작성 (scripts/qwen-prompts/place-pattern-gen.txt)
  - 장소명 목록 → name/brand 정규식 생성 스펙
  - 기계 검증: place-gate.test.ts로 오탐 확인
  - model: opus

- [ ] S1-3: audit-all.ts Phase 4에 통합 (--collect-rejected-patterns 플래그)
  - model: opus

### S2: classification 패턴 자동화

- [ ] S2-1: DB migration — classification_blacklist_staging 테이블 신설
  - 필드: id, pattern, verdict(fp/fn), event_name, classifier_step, created_at, processed_at
  - model: opus

- [ ] S2-2: classification-audit.ts — FP/FN staging 로직 추가
  - 수동 판정 시 staging 테이블에 패턴 저장
  - model: opus

- [ ] S2-3: classifier-config.json 갱신 스크립트
  - staging 50건+ 시 Qwen 호출 → 기존 blacklist에 병합
  - version 증가 + changelog 자동 기록
  - model: opus

- [ ] S2-4: audit-all.ts 통합
  - model: opus

## 검증
- S1: place-gate.test.ts 기존 테스트 전부 통과 + 새 패턴 캠핑장 차단 확인
- S2: tsc 통과 + classifier-config.json schema 유효성 확인
