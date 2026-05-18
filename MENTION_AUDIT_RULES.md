# Mention Audit 규칙

## 매칭 판정 기준

### correct (올바른 매칭)
- 블로그 글이 해당 장소를 직접 방문/리뷰
- 장소명이 본문에 명시적으로 언급
- 주소/위치 정보가 일치

### wrong_match (잘못된 매칭)
- 체인명만 일치하고 지점이 다름 (예: "스타벅스" → 다른 지점에 매칭)
- 동음이의어 장소 (예: "미도인" 식당 vs 미도인 카페)
- substring 매칭으로 인한 오매칭

### wrong_place (장소 자체 오류)
- 장소가 서비스 영역(서울/경기) 밖
- 폐업/이전된 장소
- 아기 비친화 장소가 DB에 존재

### borderline (경계)
- 장소 근처 방문이지만 직접 리뷰 아님
- 광고성 글 (체험단)
- 관련은 있으나 신뢰도 낮음

## 오매칭 유형

| 유형 | 원인 | 대응 |
|------|------|------|
| 체인 귀속 | substring 매칭 높은 점수 | similarity.ts 길이비율 가드 |
| 동명이인 | 같은 이름 다른 장소 | 주소 교차 검증 강화 |
| 키워드 과매칭 | "키즈" 등 일반 키워드 | computePostRelevance 가중치 조정 |
| 지역 불일치 | 다른 지역 같은 이름 | 좌표 거리 검증 |

| generic_suffix 과매칭 | "어린이공원" 등 일반 접미사 장소가 무관 블로그와 매칭 | generic_suffix_no_addr 페널티 -0.15→-0.30 강화 (2026-03-06) |

## 피드백 절차

1. `--patterns`로 오매칭 패턴 분석
2. `mention-relevance-config.json` 가중치/임계값 조정 (version 증가)
3. `naver-blog.ts:computePostRelevance()` 반영
4. 다음 배치 실행 후 비교

## 프로세스 보완 이력

### 2026-03-06 감사 결과
- **오매칭률 87%** (26/30) — 대부분 어린이공원 관련 generic_suffix 문제
- **대응**: `relevance.ts` generic_suffix_no_addr 페널티 -0.15 → -0.30 강화
- **잔여 과제**: 어린이공원 place가 `is_common_name=false`인 경우 common_name 페널티 미적용 → `is_common_name` 설정 검토 필요 — **resolved** (2026-03-08: 20건 중 16건 true, false 4건은 긴 공식명칭으로 문제없음)
- **로깅 개선 필요**: mention_audit_log에 `source_type`과 `post_date`가 NULL인 항목 다수 — 기존 mention 생성 시 이 필드를 채우지 않았음. 신규 수집 시 필수 기록 확인

### 2026-03-06 전수 벌크 감사 (44,441건)
- **1단계**: 1,000건 계층적 샘플링 감사 → 정확률 30.9%
- **코드 수정**: `relevance.ts`에 `name_absent_cap` 규칙 추가 (장소명 미매칭 시 점수 상한 0.25)
- **config 수정**: `mention-relevance-config.json` v2 (changelog 기록)
- **2단계**: 전체 pending 44,441건 자동 판정 (keyset pagination 사용)

**최종 분포:**

| 상태 | 건수 | 비율 |
|------|------|------|
| approved (correct) | 12,119 | 27.3% |
| rejected (wrong_match) | 13,290 | 29.9% |
| flagged (borderline) | 16,510 | 37.2% |
| pending (uncertain) | 2,522 | 5.7% |

- rejected 13,290건: `blog_mentions` relevance_score=0 + mention_locked=true 처리 완료
- **자동 판정 기준**: name_title/name_snippet 존재 여부 + relevance_score 구간 + generic_park 패턴 + competing_branch 페널티
- **벌크 스크립트 버그 수정**: offset 기반 → keyset pagination (id cursor) 전환으로 무한루프 해결

**2차 처리 (2,522건 → 0건 pending):**
- 2,303건 approve: name_title 매칭 + score 0.45 (주소 매칭 약하나 제목에 장소명 명시)
  - 63건 competing_location 페널티 → 경기광주 vs 광주 오탐 (제목에 장소명 100% 포함 확인)
- 181건 reject: no name match + score 0.7+ (name_absent_cap 이전 레거시 고점수, 주소만 일치)
- 38건 flag: name_title + landmark_ref(26) 또는 irrelevant_content(12) 페널티

**최종 분포 (44,441건):**

| 상태 | 건수 | 비율 |
|------|------|------|
| approved | 14,422 | 32.5% |
| rejected | 13,471 | 30.3% |
| flagged | 16,548 | 37.2% |
| pending | 0 | 0% |

### 2026-03-10 감사 (141,796건 → pending 0)
- **신규 pending ~97K**: bulk-judge 자동 처리 완료 (이전 세션에서 batch 500→50 축소 전 처리됨)
- **최종 분포**: approved 45,275 (31.9%), rejected 24,672 (17.4%), flagged 71,849 (50.7%)
- **벌크 스크립트 버그**: Supabase statement_timeout (8s 제한)
  - 원인 1: `.in('id', 500건)` UPDATE → 해결: batch 50으로 축소
  - 원인 2: `.eq('audit_status','pending').order('id').limit(50)` SELECT → 23K pending 행 정렬 timeout
  - **최종 해결**: ORDER BY 제거 + ID-only SELECT → PK IN으로 JSONB 별도 조회 (2단계 split query)
  - 이유: pending 상태가 다수일 때 `audit_status` 인덱스 + ORDER BY id 조합이 Supabase free tier에서 timeout
- **코드 개선 (4단계)**:
  1. `mention-audit.ts` bulkJudge: 2단계 split query 패턴 (ID SELECT → PK IN으로 JSONB 조회)
  2. 교차 감사: inactive 장소 연결 38 mention → score=0 + locked
- **Flagged 분석** (71,849건):
  - 99%가 score 0.4-0.6, `name_snippet`만 있고 `name_title` 없음
  - 패턴: addr_dong(0.3) + addr_district(0.1) + name_snippet(0.05~0.15) = 0.45~0.55
  - 자동 판정 어려움: snippet 매칭이 우연일 수 있어 approve/reject 불가
  - **향후 개선 옵션**: snippet 매칭 강도(토큰 일치율)를 기록하면 더 정밀한 bulk-judge 가능
- **penalty 분포** (전체 141K):
  - competing_branch: 23,141 (58%) — 체인 지점 오매칭 최다
  - stale_post_3y: 7,073 (18%) — 3년+ 오래된 포스트
  - name_absent_cap: 6,154 (15%) — 장소명 미언급
  - competing_location: 3,906 (10%) — 다른 지역 동명 장소
  - 나머지: landmark_ref, chain_region_mismatch, irrelevant_content, common_name 등
