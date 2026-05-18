# 포스터 감사 시스템

## 감사 워크플로우

```
1. manual-poster 실행 → poster-enrichment 실행 + poster_audit_log 기록
   - poster_locked=true 이벤트는 search_only 모드 (검색+기록, DB 미수정)
2. poster-audit.ts --bulk-approve --action kept (kept은 대부분 안전)
3. Opus 이미지 리뷰 (아래 "Opus 이미지 리뷰 프로세스" 참조)
   a. --review 로 UPDATED 건 후보 목록 출력
   b. Opus가 각 이미지 URL을 WebFetch/Read로 확인
   c. LLM 선택이 적절하면 --approve, 부적절하면 더 나은 후보로 --lock
4. poster-audit.ts --search-only 로 locked 이벤트의 LLM 재검색 결과 검토
5. poster-audit.ts --summary 로 통계 확인 + rejected 패턴 분석
6. 시스템 개선:
   a. rejected 패턴 → 차단 도메인 추가 (poster-enrichment.ts POSTER_BLOCKED_DOMAINS)
   b. 반복 오류 → 프롬프트 수정 (poster-prompt.json, version 증가 + changelog)
```

## 복구 워크플로우 (poster_hidden 이벤트)

```
1. 부적절 포스터 발견 → poster_hidden=true 처리
2. 일일 파이프라인 (또는 manual-poster-recovery):
   runHiddenPosterRecovery()
     → hidden 이벤트 대상 collectImages() + selectPosterWithLLM(null)
     → poster_audit_log 기록 (action='recovery' 또는 'recovery_failed')
     → DB 미수정 (승인 대기)
3. Opus 감사 (감사 wf 또는 수동):
   poster-audit.ts --review-recovery
     → recovery 후보 상세 검토 (기존 hidden URL vs 새 후보 비교)
     → --approve <id>: 새 포스터 적용 + 숨김해제
     → --reject <id>: hidden 유지, 다음 파이프라인에서 재시도
     → --replace <id> --poster <url>: Opus가 직접 URL 지정 + 숨김해제
4. 반복: 다음 파이프라인에서 미복구(rejected/failed) 이벤트 재시도
```

Recovery 항목은 일반 enrichment보다 **엄격하게** 감사:
- 새 후보가 **확실히 공식 포스터**인 경우에만 approve
- 뉴스 사진, 현장 스냅, 스톡 이미지 → 즉시 reject
- 불확실하면 reject (다음 파이프라인에서 재시도)
- 후보 중 더 나은 이미지가 있으면 `--replace`로 직접 지정

## Opus 이미지 리뷰 프로세스

이터레이션(R1~R24)과 동일한 방식으로 Opus가 직접 이미지를 확인하고 판단한다.

### 실행 절차

1. `--review` 실행 → UPDATED 건 10개씩 출력 (이벤트명, 후보 URL 전체, LLM 선택/이유)
2. Opus가 각 건에 대해:
   a. LLM이 선택한 이미지 URL → WebFetch로 페이지 확인 또는 URL 패턴 분석
   b. 후보 중 더 적절한 이미지가 있으면 해당 URL 선택
   c. 후보에 적절한 이미지가 없으면 Naver 직접 검색 (WebFetch)
3. 판정:
   - LLM 선택이 적절 → `--approve <audit_id>`
   - 더 나은 후보 존재 → `--lock <event_id> --poster <better_url>` (DB 교체 + lock)
   - 모든 후보 부적절 → `--reject <audit_id> --note "사유"` (이전 포스터 복원은 수동)
4. 다음 페이지: `--review --offset 10`

### 판단 기준 (이터레이션 기준 동일)

- 이벤트명과 이미지 내용이 일치하는가
- 공식 포스터 > 뉴스 기사 이미지 > 유사 이벤트 이미지
- 현장 사진/후기 사진/블로그 스냅은 부적절
- 다른 지역의 유사 행사 이미지는 부적절 (같은 작품 순회공연은 허용)
- 빈 포스터 > 무관한 이미지 (엄격 적용)

### 개선 피드백 루프

리뷰 완료 후 rejected 패턴 분석:
- 특정 도메인 반복 reject → POSTER_BLOCKED_DOMAINS 추가
- LLM이 반복적으로 잘못된 유형 선택 → poster-prompt.json 수정
- 검색 결과에 공식 포스터 미포함 → 검색 쿼리/소스 전략 개선

## 감사 CLI

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --list
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --review [--limit 10] [--offset 0]
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --summary
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --approve <id>
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --reject <id> --note "이유"
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --bulk-approve --action kept
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --prompt
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --search-only
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --lock <event_id> --poster <url>
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/poster-audit.ts --locked
```

## 이터레이션 스크립트 (수동 라운드 테스트)

```bash
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config server/scripts/_poster_llm_iterate.ts --round N --source blog_discovery
```

매 라운드: 한 변수만 변경 → 전체 결과 직접 검토 (URL 확인) → 레슨 기록

---

## 선별 원칙

- 빈 포스터 > 무관한 이미지 (엄격 적용)
- 관련 행사 장면/후기 사진은 포스터가 아님
- 확신 없으면 제거 (false positive 방지)
- **2025년 이상 이미지만 수집** (URL 경로에 /2024/ 이하 연도 → 차단)

## 도메인 분류

### 신뢰 (검증 생략)

```
culture.seoul.go.kr, kopis.or.kr, sac.or.kr, sejongpac.or.kr,
og-data.s3.amazonaws.com, gwanak.go.kr, incheon.go.kr,
ticket.melon.com, ticketlink.co.kr, interpark.com, yes24.com,
museum.go.kr, mmca.go.kr, sema.seoul.go.kr,
museum.seoul.go.kr, visitkorea.or.kr, mediahub.seoul.go.kr
```

### 차단 도메인 (130+개, `poster-enrichment.ts` POSTER_BLOCKED_DOMAINS 참조)

카테고리별:
- **스톡/템플릿**: freepik, pngtree, canva, gettyimagesbank, istockphoto, lovepik, clipartkorea, mangoboard, miricanvas
- **쇼핑/상거래**: ssgcdn, esmplus, msscdn(무신사), coupangcdn, 10x10, dealbada, idus, partybungbung, shop-phinf, shopping.phinf
- **커뮤니티**: ruliweb, dcinside, pann, theqoo, extmovie, dmitory, clien, instiz, mania, inven, plaync
- **음악/영상**: ytimg, youtube, mzstatic(Apple), sndcdn(SoundCloud), genie, kinolights, kakaotv, tumblbug
- **틀린 지역**: jinju, taean, changwon, yeonggwang, bonghwa, naju, jje(제주), gjartcenter(광주), cng(창녕), uiryeong(의령), jj.ac(전주), gokseong
- **오래된 뉴스**: gukjenews, kns.tv, ctnews, woorinews, bodonews, thesegye, asiae, asiatoday, socialfocus, autoherald
- **뉴스 이미지**: imgnews.naver.net (네이버뉴스 첨부 사진 — 기자 촬영 현장 스냅, 워터마크 포함)
- **예매/상품**: res.klook.com (Klook 상품 썸네일), item.kakaocdn.net (카카오 캐릭터 스티커/이모티콘)
- **백화점/에디터**: imgprism.ehyundai.com (현대백화점 에디터 이미지)
- **기타**: pinimg, behance, Artsy, traveli, imweb, mofa, ibric, reportworld, bonghwa, namu.wiki, wevity, archives.go.kr

## 소스별 포스터 정책

| 소스 | 포스터 | enrichment | 비고 |
|------|--------|-----------|------|
| tour_api | 공식 API 제공 | **스킵** | OFFICIAL_POSTER_SOURCES — 검증/교체 불필요 |
| interpark | CDN 포스터 | **스킵** | OFFICIAL_POSTER_SOURCES — 검증/교체 불필요 |
| babygo | API 썸네일 | **스킵** | OFFICIAL_POSTER_SOURCES — 검증/교체 불필요 |
| seoul_events | 공식 API 제공 | **스킵** | OFFICIAL_POSTER_SOURCES — 검증/교체 불필요 |
| blog_discovery | 멀티소스 + LLM | 대상 | collectImages + selectPosterWithLLM |
| exhibition_extraction | 멀티소스 + LLM | 대상 | 동일 파이프라인 |

## 멀티소스 수집 파이프라인

위치: `server/enrichers/poster-enrichment.ts`

```
1. source_url → og:image 추출 (블로그 URL은 skip)
2. Naver Image Search (5단계 fallback, 2쿼리 수집)
   → "{이벤트} 포스터" → "{이벤트} {장소}" → "{이벤트}"
   → 핵심키워드 → "{장소} {핵심키워드}"
   → filtered.length > 0 체크 (pre-filter 통과 결과만 카운트)
3. Naver Web Search → 신뢰 도메인 페이지 → og:image 추출
   → 2쿼리 (포스터 → 일반), display 10, 최대 3페이지 크롤
4. 중복 제거 → Gemini Flash LLM 선택
```

### Pre-filter (LLM 전 1차 필터)

- 차단 도메인 (130+) → 즉시 제외
- `hasStaleYear`: URL 경로에 `/20XX/` (XX < currentYear-1) → 제외
- 이미지 최소 크기: 200×200
- OG_IMAGE_BLOCKLIST: `og_image`, `og_img`, `ogimage`, `meta_img`, `sns_sImg` 등 사이트 로고 패턴

### LLM 프롬프트

프롬프트 버전 관리: `server/config/poster-prompt.json`
- version 증가 + changelog 추가로 변경 추적
- audit_log에 prompt_version 기록 → 버전별 성과 비교 가능

핵심 규칙 (v2):
- `[현재]` → 공식출처(culture.seoul.go.kr/kopis.or.kr)이면 교체 금지
- `[공식]` / `[신뢰]` 태그로 소스 신뢰도 전달
- 순회공연 허용 (같은 작품 다른 공연장 OK)
- 도서/음반 표지 금지 (yes24/interpark 공연 포스터만)
- 엄격 금지: 다른 지역 행사, 블로그 스냅, 장소 사진, 회차 불일치, 스톡

### rule-based fallback (`selectBestPoster`)

| 항목 | 점수 | 조건 |
|------|------|------|
| 타이틀 관련성 | 0~50 | 이벤트명 토큰 매칭 비율 × 50 |
| 장소명 매칭 | +10 | venue 토큰 매칭 |
| 신뢰 도메인 | +20 | POSTER_TRUSTED_DOMAINS |
| 포스터 비율 | +10/+5 | 0.8~2.5 / 1.2~1.8 |
| 공식 키워드 | +10 | 공식/포스터/메인/키비주얼/대표 |
| 현장/후기 키워드 | -15 | 현장/후기/방문/리뷰/체험기/블로그/스냅 |

---

## 이터레이션 이력 (R1~R24)

### 수치 추이

| 지표 | R2 (시작) | R10 (P2 끝) | R20 (P3 끝) | R24 (P4 끝) |
|------|-----------|-------------|------------|-------------|
| LLM선택률 | 43.2% | 57.9% | 72.6% | 82.8% |
| both_empty | 15 | 15 | 10 | 26* |
| new_poster | 0 | 1 | 6 | 1 |
| llm_removed | 39 | 25 | 16 | 5 |

*R22~: 전체 소스 포함으로 both_empty 증가 (니치 seoul_events 포함)

### Phase별 요약

**Phase 1 (R1~R6): LLM 프롬프트 최적화**
- [신뢰] 태그 시스템 도입, 같은 IP/브랜드 허용, 검색 쿼리 전처리
- blocked domains 확장은 양날의 검 (R4 과도한 차단으로 회귀)

**Phase 2 (R7~R10): 멀티소스 이미지 수집**
- source_url og:image + Naver Web Search og:image 추가
- og:image 기본 이미지 차단 리스트 필수
- visitkorea.or.kr에서 양질의 축제 포스터 확보

**Phase 3 (R11~R20): 검색 전략 + 품질 최적화**
- R11 핵심: `filtered.length > 0` 체크 → pre-filter 후 0건이면 다음 쿼리로 fallback (+9pp)
- R14: 선택률 83.2% 최고치이나 false positive 다수 → R15에서 품질 우선으로 전환
- R16: 순회공연 허용 + 도서표지 금지
- R18: kakaotv/tumblbug 차단, isBlocked() 대소문자 수정

**Phase 4 (R22~R24): 전체 소스 + 현재 포스터 비교**
- R23: og:image 사이트 로고 8패턴 차단 (og_image, meta_img 등)
- R24: `[현재]` 태그 도입 → match +28, removed -11 (과대교체 방지)

### 핵심 레슨

1. **직접 검토 필수** — 수치(match/different)만으로 품질 판단 불가, 매 라운드 전체 결과 URL 검증
2. **`filtered.length > 0` 패턴** — API 원본 결과가 아닌 실제 사용 가능 결과 기준으로 fallback 판단
3. **선택률 < 정합성** — coverage와 precision 트레이드오프에서 precision 우선
4. **현재 포스터를 후보에 포함** — LLM이 기존 vs 새 후보를 비교해야 과대교체 방지
5. **og:image 제네릭 패턴** — 공통 패턴으로 사이트 로고 일괄 차단
6. **한 라운드에 한 변수만 변경** — 태그로 신뢰도 전달, 허용/금지 경계에 구체적 예시 포함

### 한계 (개선 불가)

- **both_empty ~24건**: 니치 로컬 이벤트 (Naver + 공식 포털 모두 검색 결과 없음)
  - 로코유 팝업, 서울물재생체험관, 이레베이킹, 베이비페어/유아교육전 등
  - 대안: blog-event-discovery에서 원본 블로그 이미지 직접 추출

상세 라운드별 기록: `memory/llm-iteration-lessons.md`

## 프로세스 보완 이력

### 2026-03-06 감사 결과
- **124건 UPDATED 분석**: imgnews.naver.net 49건(40%) — 신뢰도메인 후보 0건 상태에서의 선택 (LLM 판단 오류 아닌 검색 부족)
- **trusted_ignored 0건**: LLM이 신뢰 후보를 무시한 사례 없음
- **차단 도메인 6개 추가**: bbscdn.df.nexon.com, kream-phinf.pstatic.net, d3kxs6kpbh59hp.cloudfront.net, down.humoruniv.com, images.unsplash.com, page-images.kakaoentcdn.com
- **search_only 모드 도입**: poster_locked=true 이벤트도 검색 수행하되 DB 미수정, audit_log에 기록 → 다음 감사 시 `--search-only`로 검토
- **잔여 과제**: imgnews 49건 중 현장 사진/보도 사진 vs 실제 포스터 구분 — **resolved** (2026-03-08: imgnews.naver.net 차단 도메인 추가 + poster-vision.ts Vision 검증 도입으로 자동 판별)

### 2026-03-06 Opus 전수 검토 (217건 완료, pending 0)

**결과**: 33 approve + 27 reject (3건 공식 포스터 복원, 24건 poster_url=null+locked)

**거부 패턴 분석 (27건)**:

| 패턴 | 건수 | 비율 | 원인 |
|------|------|------|------|
| 다른 지역 유사 행사 | 13 | 48% | 키워드 매칭으로 통영/부산/제주 등 동일 이벤트명의 다른 지역 포스터 선택 |
| 블로그 스냅/썸네일 | 5 | 19% | dthumb-phinf.pstatic.net, blog.kakaocdn.net 등 블로그 인플루언서 사진 |
| 공식 포스터 과대교체 | 3 | 11% | culture.seoul.go.kr [현재] 포스터를 뉴스 이미지로 불필요하게 교체 |
| 장소 외관/내부 사진 | 3 | 11% | 건물 사진, 공원 사진 등 이벤트 포스터가 아닌 장소 이미지 |
| 초 제네릭 이벤트명 | 2 | 7% | "물놀이", "딸기농장체험" 등 너무 일반적인 이름 → 무관한 검색 결과 |
| 회차 혼동 | 1 | 4% | 제11회 vs 제13회 서울국제어린이영화제 |

**개선 적용 (v2)**:

1. **LLM 프롬프트 v2** (`poster-prompt.json`):
   - [현재] 공식출처(culture.seoul.go.kr/kopis.or.kr) 보호 강화 → 교체 금지
   - 6가지 엄격 금지 조항 명시 (지역 불일치, 블로그 스냅, 장소 사진, 회차 불일치 등)
   - 구체적 지역명 예시 포함 (통영, 남양주, 부산, 제주, 강진 등)

2. **차단 도메인 추가** (`poster-enrichment.ts`):
   - `dthumb-phinf.pstatic.net` — 블로그 포스팅 대표 썸네일 (5건 거부 원인)
   - `blog.kakaocdn.net` — 카카오 블로그 이미지 CDN

3. **hasStaleYear 패턴 확장** (`poster-enrichment.ts`):
   - `/YYYYMM/`, `/YYYYMMDD/` 패턴도 감지 (기존 `/YYYY/`만 감지 → 뉴스 URL `202402` 누락)

4. **감사 프로세스 레슨**:
   - 전수 검토 시 `--review --limit N`으로 일괄 출력 → 패턴별 분류 → 배치 스크립트 실행이 효율적
   - 공식 소스(culture.seoul.go.kr) 이벤트는 poster_locked=true가 기본이어야 함
   - 초 제네릭 이벤트명은 검색 자체를 스킵하는 것이 precision에 유리

## 포스터 연도 대조 규칙

**감사 시 필수 확인**: 포스터 이미지에 표시된 날짜/연도와 이벤트의 start_date 연도가 일치하는지 대조.

- 포스터에 "2024.3.15" 등 날짜가 표시되어 있고, 이벤트가 2026년이면 → **reject** (이전 회차 포스터)
- URL 경로에 `/2024/`, `/202402/` 등 과거 연도 → pre-filter(`hasStaleYear`)에서 자동 차단
- 같은 작품이 매년 재공연되는 경우 해당 연도 포스터만 허용
- LLM 프롬프트에 이벤트 날짜 정보를 전달하여 연도 불일치 판단 근거 제공

### 발견 사례: 삼양동화 (#7376)
- 이벤트: 2026.2.26~3.15 (seoul_events 공식)
- LLM 선택: jeonmae.co.kr/202402/ → **2024년** 뉴스 기사 포스터 (2024.3.15~3.16 표시)
- 원인: URL `/202402/` 패턴이 hasStaleYear `/YYYY/` 4자리 정규식 통과
- 조치: culture.seoul.go.kr 복원 + locked, hasStaleYear YYYYMM 패턴 추가
- 추가: 중복 2건 (#8582, #8892 blog_discovery) 삭제

### 2026-03-06 사용자 수동 검토 (14건 poster_hidden)

**부적절 포스터 패턴 분류**:

| 패턴 | 건수 | 이벤트 예시 | 차단 도메인 |
|------|------|-----------|-----------|
| 뉴스 보도 사진 | 5 | 정월대보름, 버틴스키, 미니사과, 명탐정코난 팝업, 인상주의 전시 | `imgnews.naver.net` 추가 |
| 예매/상품 이미지 | 2 | 롯데월드 아쿠아리움 ×2 | `res.klook.com` 추가 |
| DVD/다른 작품 표지 | 2 | 애니멀킹덤(DVD), 루루섬(2019 공연) | yes24 상품 표지, interpark 과거 공연 |
| 수업 현장 사진 | 1 | 3D펜 1회차 수업 | 도메인 차단 불가 (sciencecenter.or.kr 정상 도메인) |
| 캐릭터 스티커 | 1 | 뚱랑이네 집들이 팝업 | `item.kakaocdn.net` 추가 |
| 스톡/에디터 이미지 | 1 | 알폰스 무하 전시 | `imgprism.ehyundai.com` 추가 |
| 알 수 없는 긴 이미지 | 1 | 키크클럽 | naruart.or.kr 에디터 업로드 |
| 관객 현장 스냅 | 1 | 명탐정코난 더현대 팝업 | 뉴스 도메인 차단으로 해결 |

**개선 적용 (v3)**:
1. 차단 도메인 4개 추가: `imgnews.naver.net`, `res.klook.com`, `item.kakaocdn.net`, `imgprism.ehyundai.com`
2. LLM 프롬프트 v3: DVD/블루레이 커버, 뉴스 워터마크, 상품/티켓/프로모션, 과거 연도 공연, 수업 현장, 캐릭터 스티커 금지 추가
3. 14건 모두 `poster_hidden=true` 처리

**잔여 과제**:
- `sciencecenter.or.kr` 같은 정상 도메인의 수업 사진은 URL 패턴으로 차단 불가 → LLM 프롬프트 의존 — **wontfix** (LLM 프롬프트 v4에서 수업 현장 사진 금지 추가, URL 차단 불가한 구조적 한계)
- `naruart.or.kr` 에디터 업로드 이미지는 가로/세로 비율 극단적(세로 매우 긴) → 비율 필터 강화 검토 — **wontfix** (1건 발생으로 비율 필터 추가 시 정상 세로 포스터 오차단 위험, 비용 대비 효과 낮음)

### 2026-03-07 Recovery 리뷰 (12건 완료, 전수 reject)

**결과**: 0 approve, 12 reject — 모두 hidden 유지

**거부 패턴 분석 (12건)**:

| 패턴 | 건수 | 이벤트 예시 | 원인 |
|------|------|-----------|------|
| 적절한 후보 없음 (NO CANDIDATE) | 6 | 명탐정코난 팝업, 요술지갑, 9개의시선, 망원경체험, 정월대보름, 아쿠아리움 | 니치 이벤트 검색 결과 없음 또는 전부 금지 대상 |
| 크라우드펀딩/굿즈 이미지 | 1 | 명탐정코난 팝업 | wadiz 팝업북·굿즈 이미지 (팝업스토어와 무관) |
| DVD/도서 표지 재선택 | 1 | 애니멀킹덤 | yes24 DVD 표지 (숨긴 포스터와 동일 URL) |
| 쇼핑몰 상품 이미지 | 1 | 롯데아쿠아리움 | yanolja·lotteon 상품 썸네일 (가격 포함) |
| 프로모션/비공식 이미지 | 1 | 미니사과 체험 | 한화리조트 프로모션 (확실한 공식 포스터 아님) |
| 과거 공연 포스터 | 1 | 루루섬 | 인터파크 2019년 공연 포스터 재선택 |
| 뉴스레터 이미지 | 1 | 도파민하이프 | maily.so 뉴스레터 대표 이미지 |

**개선 적용 (v4)**:

1. **LLM 프롬프트 v4** (`poster-prompt.json`):
   - 크라우드펀딩 굿즈(wadiz/텀블벅) 금지 추가
   - 뉴스레터/콘텐츠 플랫폼(브런치/1boon/maily) 금지 추가
   - 쇼핑몰(야놀자/롯데온) 명시 추가
   - 지역명 예시 확장 (곡성, 영천, 강화)

2. **차단 도메인 9개 추가** (`poster-enrichment.ts`):
   - `cdn3.wadiz.kr`, `cdn.wadiz.kr` — 크라우드펀딩 상품 이미지
   - `cdn.maily.so` — 뉴스레터 이미지
   - `1004gundam.com`, `image2.1004gundam.com` — 피규어/프라모델 쇼핑몰
   - `img.gigglehd.com` — 커뮤니티 게시판 사진
   - `bookmouse.co.kr` — 도서 판매 사이트
   - `image6.yanolja.com`, `image.yanolja.com` — 야놀자 상품 썸네일
   - `contents.lotteon.com` — 롯데온 상품 이미지

**레슨**:
- hidden 포스터의 recovery 성공률은 매우 낮음 (0/12) — 대부분 니치 이벤트라 검색 결과 자체가 빈약
- DVD/과거 공연 포스터가 숨긴 포스터와 동일 URL로 재선택되는 문제 → recovery 시 숨긴 URL을 후보에서 제외하는 로직 필요
