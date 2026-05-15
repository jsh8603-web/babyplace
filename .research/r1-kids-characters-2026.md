---
name: 2026 한국 영유아 인기 캐릭터·IP 화이트리스트
description: 키즈카페·전시·뮤지컬·팝업 행사명에 쓰이는 0~7세 인기 캐릭터/IP 한글 표기 40선 + classifier whitelist 채택 21종
type: reference
tags:
  - type/memory
  - domain/research
  - topic/kids-characters
  - project/babyplace
date: 2026-05-16
source-url: internal (search-engine Gemini 2-Phase, Phase1 Pro)
why: classifier-config.json whitelist_title_patterns 가 캐릭터 IP 부족으로 FN 발생(리락쿠마 팝업 미분류 사례 등). 2026 최신 인기 IP 를 조사해 whitelist 보강하기 위함.
read-when: classifier-config.json whitelist/blacklist 캐릭터 패턴 추가·검토 시 / classification 감사에서 캐릭터 IP FN·FP 발견 시 / 어린이 행사 분류 정확도 개선 작업 시
related:
  - server/config/classifier-config.json
  - AUDIT_RULES.md
---

# 2026 한국 영유아 인기 캐릭터·IP (행사 화이트리스트용)

> raw archive: `~/.claude/docs/archive/research-raw/kids-characters-2026-phase1-20260516.txt`
> 출처: search-engine Gemini 2-Phase Phase1(Pro). Phase2 skip (결론 자명 — 캐릭터 한글표기 목록은 추가 심층조사 불요, 환각검증 영향 없음, 보고함).

## classifier-config.json v21 채택 (21종, 2026-05-16 커밋 7ca07aa)

티니핑 · 뽀로로 · 핑크퐁 · 타요 · 또봇 · 헬로카봇 · 미니특공대 · 브레드이발소 · 콩순이 · 엄마까투리 · 슈퍼윙스 · 두다다쿵 · 크리쳐스 · 페파피그 · 코코멜론 · 블루이 · 퍼피구조대 · 겨울왕국 · 토이스토리 · 미키마우스 · 뿡뿡이

(기존 whitelist 보유분: 아기상어/고고다이노/다이노/옥토넛/리락쿠마/산리오/헬로키티/마이멜로디/시나모롤/포차코/쿠로미 — 중복 제외)

## 제외 (substring 충돌 위험 — AUDIT_RULES 4-2b)

| 캐릭터 | 제외 사유 |
|--------|----------|
| 라바 | 2자, "라바" 가 일반 단어/지명 substring 오매칭 위험 |
| 폴리 | 2자, "폴리에스터/폴리곤/모노폴리" 등 substring 충돌 |
| 호비 | 2자, "호비/호빵" 등 충돌 |
| 꼬모 | 2자, 일반어 충돌 |
| 토마스 | "토마스" 가 인명/지명 substring 충돌 (토마스 만/성토마스) |

→ 향후 추가하려면 단독어 경계(`\b`, lookahead) 정규식으로 정밀화 필요.

## Phase1 종합 40선 (가나다순, 미채택분 포함)

### 국산 IP
고고다이노 · 꼬마버스 타요 · 내 친구 호비 · 두다다쿵 · 라바 · 로보카 폴리 · 미니특공대 · 브레드이발소 · 뽀롱뽀롱 뽀로로(뽀로로) · 상상꾸러기 꾸다 · 슈퍼윙스 · 씰룩 · 아기상어 · 엄마까투리 · 엉뚱발랄 콩순이(콩순이) · 캐치! 티니핑 · 크리쳐스 · 토닥토닥 꼬모 · 또봇 · 핑크퐁 · 하프와 친구들 · 헬로카봇 · 메탈카드봇 · 타오르지마 버스터

### 해외 IP
겨울왕국 · 디즈니 프린세스 · 먼작귀(치이카와) · 미니언즈 · 미키 마우스 · 블루이 · 슈퍼마리오 · 옥토넛 · 인사이드 아웃 · 카(Cars) · 코코멜론 · 토마스와 친구들 · 토이스토리 · 페파피그 · 퍼피 구조대

### 2025~2026 신규/급부상
크리쳐스(티니핑 제작사 신작) · 씰룩(숏폼) · 하프와 친구들(헤이지니) · 먼작귀(치이카와 — 영유아 타겟 아니나 어린이 확산)

## 운영 메모

- **티니핑 사건**: 5/16 감사에서 S2-Q(Qwen 패턴 정제)가 성인 FP 24건 staging 정제 중 "티니핑"을 blacklist 로 오추출 → config v21 오염 → git restore. 대응: ① S2-Q 역방향 의미 게이트(커밋 0226874) ② v21 캐릭터 whitelist 등록 ③ classification-pattern-refine.txt 캐릭터 blacklist 금지 조항 — 3중 방어.
- 캐릭터 추가 시 항상 2자 이하 substring 충돌(4-2b) 점검 필수.
