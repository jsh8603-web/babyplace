# BabyPlace - 아기랑 놀러갈 곳 지도 앱

## Context
서울/경기 지역에서 아기와 함께 갈 만한 장소를 지도에 표시하는 모바일 중심 웹앱.
다양한 소스에서 장소를 주기적으로 수집·분석하여 자동 업데이트.
PC 없이도 24/7 구동되는 클라우드 배포.

### 결정 사항:
- 지도: 카카오맵 JS SDK
- 플랫폼: 모바일 최적화 PWA (Next.js, 홈화면 추가 가능)
- 배포: Vercel(웹) + GitHub Actions(크론) = 완전 무료
- DB: 클라우드 DB (Vercel 서버리스에서 SQLite 불가)
- 인증: Google OAuth + 이메일 로그인 → 관리자/사용자 구분
- 네이버 연동: 불필요 → 계정별 즐겨찾기
- 자동화: 관리자 수동 승인 없이 다중 신호 자동 검증으로 전 파이프라인 자동화

### 경쟁 환경:
- 애기야가자(180만 DL, 30K+ 장소), 맘맘(월령별 랭킹), 엄마의지도(편의시설)
- 놀이의발견(200억 투자 후 폐업 — 단일 수익 모델 경고)
- 네이버/카카오맵에 키즈 전용 필터 없음 → 전문 앱 기회

### BabyPlace 차별점:
- 소셜 멘션 기반 자동 스코어링 (경쟁 앱 미시도)
- 장소별 인기 포스팅 5개 자동 큐레이션
- 적응형 키워드 로테이션으로 수집 자동 최적화
- 날씨 연동 + 비상 모드 등 실사용 중심 기능
- 전 파이프라인 무인 자동화 (관리자 승인 불필요)

---

## 1. 기술 스택
| 레이어 | 선택 | 이유 |
| --- | --- | --- |
| 프레임워크 | Next.js (App Router) + PWA | 모바일 홈화면 추가, 오프라인 기본 지원 |
| 지도 | 카카오맵 JS SDK + MarkerClusterer | 한글 UX 최고, 일 20만 건 무료 |
| DB | Supabase (PostgreSQL) | Auth 내장, RLS, 무료 500MB |
| 인증 | Supabase Auth (Google OAuth + email) | 관리자/사용자 role 관리 |
| 배포 (웹) | Vercel Hobby | Next.js 최적, 무료 |
| 배포 (크론) | GitHub Actions | 매 6시간 수집, 무료 2000분/월 |
| 스타일 | Tailwind CSS | 모바일 반응형 |
| 아이콘 | Lucide React | 경량, Tree-shakeable, Next.js 호환 |
| 지도 통합 | react-kakao-maps-sdk | 카카오맵 React 래퍼, TypeScript 내장 |
| 하단 시트 | vaul | Radix 기반, 모바일 드래그 최적화, 경량 |
| 상태/페칭 | @tanstack/react-query | 무한 스크롤, 캐싱, 서버 상태 관리 |
| 장소 수집 | 카카오 카테고리 API (1차) + 블로그 역검색 (2차) | 정규식 의존도 최소화 |

---

## 2. 장소 카테고리 + 편의시설 태그

### 대분류 10개
| # | 대분류 | 세부 예시 | 주 데이터 소스 | 실내/실외 |
| --- | --- | --- | --- | --- |
| 1 | 놀이 | 키즈카페, 실내놀이터, 볼풀 | 카카오 로컬, LOCALDATA | 실내 |
| 2 | 공원/놀이터 | 어린이공원, 숲놀이터, 물놀이장 | 공공데이터 | 실외 |
| 3 | 전시/체험 | 어린이박물관, 과학관, 미술관 | Tour API, 공공데이터 | 실내 |
| 4 | 공연 | 어린이뮤지컬, 인형극, 마술쇼 | KOPIS API | 실내 |
| 5 | 동물/자연 | 동물원, 아쿠아리움, 농장 | Tour API | 실외 |
| 6 | 식당/카페 | 유아식, 키즈존, 이유식카페 | 카카오 로컬, 블로그 | 실내 |
| 7 | 도서관 | 어린이도서관, 그림책/장난감도서관 | 공공데이터 | 실내 |
| 8 | 수영/물놀이 | 유아수영장, 워터파크 유아존 | 카카오 로컬 | 실내 |
| 9 | 문화행사 | 축제, 체험프로그램, 교육 | 서울시 API | 혼합 |
| 10 | 편의시설 | 공공 수유실, 기저귀교환대 | 지자체 데이터 | 실내 |

**편의시설 태그 (장소에 복수 부착)**
수유실 / 기저귀교환대 / 남성화장실교환대 / 유모차접근 / 아기의자 / 주차 / 예스키즈존 / 엘리베이터

---

## 3. 인증 + 역할 관리
**로그인 방식**
- Google OAuth 2.0 (Supabase Auth)
- 이메일/비밀번호 (Supabase Auth)
- 비로그인 → 지도 조회, 검색만 가능 / 즐겨찾기·리뷰 불가

**역할 (roles)**
| 역할 | 권한 |
| --- | --- |
| user | 지도 조회, 검색, 즐겨찾기, 리뷰 작성, 장소 제보 |
| admin | 위 전부 + 관리자 페이지 접근 |

*Supabase profiles 테이블에 role 컬럼. RLS 정책으로 admin 전용 API 보호.*

---

## 4. 관리자 페이지
**4-1. 대시보드**
- 총 장소 수 / 이벤트 수 / 사용자 수
- 오늘 신규 장소 / 신규 가입 / 리뷰 수
- 수집 파이프라인 상태 (마지막 성공 시간, 에러율)

**4-2. 수집 파이프라인 모니터링**
- 크론 실행 이력 (collection_logs 테이블)
- 소스별 성공/실패/수집량 차트
- 수동 수집 트리거 버튼
- API 키 상태 확인

**4-3. 키워드 관리**
- 키워드 목록 (상태: ACTIVE/DECLINING/EXHAUSTED/SEASONAL/NEW)
- 키워드별 성과 지표 (효율 점수, 신규 발견, 중복률)
- 키워드 추가/수정/삭제/상태 강제 변경
- 자동 교체 이력

**4-4. 장소 데이터 관리**
- 장소 목록 (검색, 필터, 정렬)
- 장소 수정 (카테고리, 태그, 정보 보정)
- 중복 장소 병합
- 자동 승격 이력 (place_candidates → places 승격 로그)
- 폐업/이전 자동 비활성화 현황 (카카오 재검증 실패 + 6개월 무언급)

**4-5. 사용자 관리**
- 사용자 목록 (가입일, 활동량, 역할)
- 역할 변경 (user ↔ admin)
- 리뷰 신고 처리 큐

**4-6. 검색 키워드 분석**
- 사용자 검색어 TOP N
- 검색했으나 결과 없는 키워드 (데이터 gap 발견)

---

## 5. 장소 상세 페이지
**기본 정보**
- 장소명, 카테고리, 주소, 전화, 영업시간
- 카카오맵 미니맵 (위치 표시)
- 편의시설 태그 아이콘 (수유실, 유모차 등)
- 인기도 배지 (mention_count 기반)

**인기 포스팅 TOP 5**
- 블로그/카페 언급 중 가장 최신 + 높은 소스 신뢰도 순으로 5개
- 표시: 제목 (링크) + 출처 아이콘(N블로그/카페) + 날짜
- 정렬: post_date DESC + source_reliability 가중치
- 쿼리: blog_mentions WHERE place_id = ? ORDER BY post_date DESC LIMIT 5

**즐겨찾기 + 공유**
- 하트 버튼 → 계정별 즐겨찾기 저장
- 공유 버튼 → 카카오톡/링크 공유

---

## 6. 사용자 핵심 기능
**6-1. 거리순 목록 뷰**
- 내 위치 기준 가까운 장소 리스트 (무한 스크롤)
- 정렬 옵션: 거리순 / 인기순 / 최신순
- 카테고리 칩 필터 (지도 뷰와 동일 필터 공유)
- 지도 ↔ 목록 토글 (뷰포트/필터 상태 유지)

**6-2. 계정별 즐겨찾기**
- 로그인 사용자 → Supabase favorites 테이블
- 장소 + 이벤트 모두 저장 가능
- 즐겨찾기 목록 페이지 (거리순/추가순 정렬)

**6-3. 카테고리 필터**
- 10개 대분류 칩 (복수 선택)
- 편의시설 태그 필터 (수유실, 유모차 등)

**6-4. 키워드 검색**
- 장소명/주소/카테고리 통합 검색
- 검색어 로그 → 관리자 검색 분석에 활용

---

## 7. 추가 기능 (5개, 사용자 관점)
| # | 기능 | 설명 | 우선순위 |
| --- | --- | --- | --- |
| 1 | 비상 모드 | "수유실 급해요" 원터치 → 가장 가까운 수유실/교환대 안내 | Phase 1 |
| 2 | 날씨 연동 추천 | 현재 날씨에 따라 실내/실외 자동 필터. 비 오면 실내만 표시 | Phase 1 |
| 3 | 시설 검증 배지 | 최근 3개월 내 사용자가 시설 정보를 확인한 장소 "최근 검증됨" 표시 | Phase 2 |
| 4 | 계절 큐레이션 | 이달의 추천: 봄 벚꽃/여름 물놀이/가을 단풍/겨울 실내 | Phase 2 |
| 5 | 방문 기록 | 방문한 장소 타임라인 + 메모 + "다시 갈래요" 표시 | Phase 3 |

*제외된 기능: 월령별 추천 (데이터 부족), 아빠 모드 (데이터 소스 제한), 코스 플래너 (API 심사+복잡도), 즐겨찾기 컬렉션 공유, 접근성 체크리스트 (데이터 부재)*

---

## 8. 인기도 스코어링 + 밀도 제어
**8-1. 인기도 점수 (popularity_score, 0~1)**
```text
raw_score = (
  0.35 × normalize(log(1 + mention_count))  # 블로그/카페 언급
+ 0.25 × source_diversity                    # 복수 소스 확인
+ 0.25 × recency (exp(-days/180))            # 최신성 (반감기 180일)
+ 0.15 × data_completeness                   # 정보 완성도
)

bayesian_score = (raw × n + avg × C) / (n + C)
  C = 전체 mention_count 25번째 백분위수

변수 정의:
- normalize(x): (x - min) / (max - min), 전체 places 기준 min-max 정규화
- source_diversity: 장소를 언급한 고유 소스 유형 수 / 4 (blog, cafe, kakao, public 최대 4종)
- recency: 가장 최근 blog_mention의 post_date 기준. 언급 없으면 created_at 사용
- data_completeness: 비어있지 않은 필드 비율 (name, address, phone, tags, description 중 채워진 수 / 5)
```

**8-2. 지도 밀도 제어**
| 줌 | 범위 | 표시 |
| --- | --- | --- |
| 7-9 | 전국 | 시/도별 Top 5 + 클러스터 |
| 10-12 | 시/구 | 구별 Top 10 + 클러스터 |
| 13-14 | 동 | 동별 Top 20 |
| 15+ | 거리 | 뷰포트 내 전체 (최대 200) |

행정동별 공정 분배 (밀집 지역 편중 방지). 행정동 경계: vuski/admdongkor GeoJSON.

**8-3. 거리순 목록에서의 밀도 제어**
- 목록 뷰: 내 위치 기준 반경 순, 인기도 가중 정렬
- 기본 반경 2km → 결과 부족 시 자동 확장 (5km, 10km)
- 동일 동에서 최대 5개 표시 후 "이 지역 더보기" 버튼

---

## 9. 적응형 키워드 로테이션
**9-1. 키워드 효율 점수**
```text
efficiency = (
  0.40 × yield × (1 - 중복률)     # 신규 발견 효율
+ 0.25 × 관련성                    # 아기/육아 관련 비율
+ 0.20 × exp(-cycle_count/10)     # 피로도 감쇠
+ 0.15 × (1 - consecutive_zero×0.3)  # 무성과 페널티
)
```

**9-2. 상태 전환**
- ACTIVE (≥0.3) → DECLINING (0.1~0.3) → EXHAUSTED (<0.1 또는 3회 연속 무성과)
- EXHAUSTED 30%+ 시 → 자동 신규 후보 생성 (텍스트 마이닝 + 템플릿)
- 계절 키워드: 시즌 도래 1개월 전 자동 활성화, 비시즌 시 SEASONAL 상태

**9-3. 네이버 DataLab 트렌드 (월 1회)**
- 부모 연령대(20-30대) 기준 상승 키워드 감지
- 3개월 전 대비 20%+ 성장 → NEW 상태 자동 등록

---

## 10. 데이터 수집 파이프라인
**10-1. 데이터 소스 (Tier 1: 공식 API, 무료)**
| # | 소스 | 일 한도 | 수집 대상 |
| --- | --- | --- | --- |
| 1 | 카카오 로컬 (키워드+카테고리) | ~100,000 | 장소명, 주소, 좌표, 카테고리 |
| 2 | 네이버 블로그 검색 | 25,000 | 블로그 제목, 설명, URL |
| 3 | 네이버 카페 검색 | 25,000 | 맘카페 후기 |
| 4 | 네이버 로컬 검색 | 25,000 | 장소 메타데이터 |
| 5 | 어린이놀이시설 (data.go.kr) | 10,000 | 놀이시설, 주소 |
| 6 | 도시공원 (data.go.kr) | 10,000 | 어린이공원, 좌표 |
| 7 | 도서관 (data.go.kr) | 10,000 | 어린이도서관 |
| 8 | 박물관/미술관 (data.go.kr) | 10,000 | 시설, 입장료, 좌표 |
| 9 | KOPIS 공연 | 무제한 | 아동/가족 공연 |
| 10 | Tour API (관광공사) | 무제한 | 관광지, 축제, 가족코스 |
| 11 | 서울시 문화행사 | 무제한 | 행사, 이용대상 |
| 12 | 서울시 공공서비스예약 | 무제한 | 체험프로그램 |
| 13 | 어린이집 정보 (data.go.kr) | 인증 후 | 어린이집 위치 |
| 14 | 네이버 DataLab | 1,000 | 키워드 트렌드 |

**10-2. 수집 스케줄 (GitHub Actions)**
| 주기 | 작업 내용 |
| --- | --- |
| 매 6시간 | 파이프라인 B: 블로그/카페 역검색 (인기도) + 키워드 검색 (신규 후보) |
| 매일 02시 | 파이프라인 A: 카카오 카테고리 스캔 (장소 발견) |
| 매일 03시 | 공공데이터 (놀이시설, 공원, 도서관 등) |
| 매일 04시 | 공연/행사 (KOPIS, Tour, 서울시) |
| 매일 05시 | 키워드 평가 + 인기도 재계산 + candidates 자동 승격 + 폐업 자동 감지 |
| 매주 월요일 | LOCALDATA, 경기도 파일 갱신 |
| 매월 1일 | 네이버 DataLab 트렌드 + 계절 전환 |

*GitHub Actions cron → Next.js API Route 호출 (Vercel) 또는 직접 스크립트 실행.*

**10-3. 2-파이프라인 아키텍처**

핵심 원칙: 카카오 API가 장소 "발견", 블로그는 "인기도 측정 + 큐레이션" 전담.
정규식은 보조 수단으로만 사용. 전 과정 관리자 승인 없이 자동화.

**파이프라인 A — 장소 발견 (매일)**
```text
카카오 카테고리/키워드 검색 ──→ places 테이블 직접 upsert
공공데이터 API (구조화) ────────→ (좌표·주소·카테고리 확정 상태)
```
- 카카오 카테고리 코드: CE7(카페), AT4(관광), CT1(문화시설) 등 + 키워드 조합
- 정규식 불필요: API 응답이 이미 구조화된 데이터

**파이프라인 B — 인기도 수집 (매 6시간)**
```text
방법 1 (역검색): DB 장소명 → 네이버 블로그 검색 → blog_mentions 저장 + mention_count++
방법 2 (키워드검색): 키워드 블로그 검색 → DB 기존 장소 매칭 → mention_count++
                                        → 매칭 실패 + 유망 → place_candidates 저장
```

| 방법 | 흐름 | 정확도 | 용도 |
| --- | --- | --- | --- |
| 역검색 (장소→블로그) | DB 장소명으로 네이버 검색 | 매우 높음 | mention_count + 포스팅 TOP 5 |
| 키워드 검색 (블로그→장소) | 키워드 검색 → DB 매칭 | 중간 | 트렌드 감지 + 신규 후보 |

역검색 API 호출: 하루 4회 × 회당 100장소 = 400건 (일 25,000건 한도 대비 여유)

**10-4. 자동 검증 엔진 (관리자 승인 대체)**
```text
place_candidates 자동 승격 조건 (매일 05시 배치):
  ① 2+ 독립 블로그 출처 (같은 블로거 URL 도메인 제외)
  ② 카카오 API 매칭 성공 (문자열 유사도 > 0.8, normalized)
  ③ 서울/경기 지역 확인
  → 3개 모두 충족 → places 테이블로 자동 승격
  → 30일간 미충족 → 자동 삭제 (TTL)
```

**사용자 제보 자동 처리:**
```text
사용자 장소 제보
  → 카카오 API 검증 성공? → 즉시 places 등록
  → 카카오 미매칭? → place_candidates → 위 승격 조건 대기
```

**폐업/이전 자동 비활성화:**
```text
매일 05시 배치:
  → 카카오 API 재검증 실패 (장소 삭제됨) + 6개월간 블로그 무언급
  → is_active = false 자동 설정
```

**매칭 로직 (키워드 검색 → 기존 장소):**
- 장소명 정규화 (공백·특수문자 제거) 후 DB 장소명과 contains 비교
- 서울/경기 외 주소 패턴 감지 시 제외
- 광고 감지 ("협찬", "제공받아", "광고") → 신뢰도 가중치 하향 (삭제는 아님)

---

## 11. 프로젝트 구조
```text
babyplace/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (public)/                 # 비로그인 접근 가능
│   │   │   ├── page.tsx              # 메인 지도 + 하단시트 목록
│   │   │   ├── place/[id]/page.tsx   # 장소 상세 (인기 포스팅 5개)
│   │   │   └── event/[id]/page.tsx   # 이벤트 상세
│   │   ├── (auth)/                   # 로그인 필요
│   │   │   ├── favorites/page.tsx    # 즐겨찾기 목록
│   │   │   └── profile/page.tsx      # 프로필/설정
│   │   ├── admin/                    # admin role 전용
│   │   │   ├── page.tsx              # 대시보드
│   │   │   ├── places/page.tsx       # 장소 관리
│   │   │   ├── keywords/page.tsx     # 키워드 관리
│   │   │   ├── pipeline/page.tsx     # 수집 모니터링
│   │   │   └── users/page.tsx        # 사용자 관리
│   │   ├── api/
│   │   │   ├── places/               # 장소 CRUD + bbox/zoom 쿼리
│   │   │   ├── events/               # 공연/행사
│   │   │   ├── favorites/            # 즐겨찾기 CRUD
│   │   │   ├── report/               # 사용자 장소 제보 → 자동 검증
│   │   │   ├── collect/              # 수집 트리거 (GitHub Actions 호출용)
│   │   │   └── admin/                # 관리자 전용 API
│   │   ├── login/page.tsx            # 로그인 (Google + 이메일)
│   │   ├── manifest.json             # PWA manifest
│   │   └── layout.tsx
│   ├── components/
│   │   ├── map/
│   │   │   ├── KakaoMap.tsx          # 카카오맵 + MarkerClusterer
│   │   │   └── PlaceMarker.tsx
│   │   ├── place/
│   │   │   ├── PlaceCard.tsx         # 목록 카드
│   │   │   ├── PlaceDetail.tsx       # 상세 (포스팅 5개 포함)
│   │   │   └── TopPosts.tsx          # 인기 포스팅 목록
│   │   ├── EventCard.tsx
│   │   ├── SearchBar.tsx
│   │   ├── FilterPanel.tsx           # 카테고리 칩 + 편의시설 태그
│   │   ├── BottomSheet.tsx           # 하단 시트 (지도 위 목록)
│   │   ├── EmergencyButton.tsx       # 비상 모드 (수유실 급해요)
│   │   └── BottomNav.tsx             # 모바일 하단 4탭 네비게이션
│   ├── lib/
│   │   ├── supabase.ts               # Supabase 클라이언트
│   │   ├── auth.ts                   # 인증 헬퍼
│   │   └── weather.ts                # 날씨 API 연동
│   └── types/
├── server/                           # 수집 파이프라인 (GitHub Actions에서 실행)
│   ├── collectors/                   # 파이프라인 A: 장소 발견
│   ├── enrichers/                    # 파이프라인 B: 인기도 수집 (역검색+키워드)
│   ├── matchers/                     # 블로그↔장소 매칭 로직
│   ├── candidates/                   # 자동 승격 엔진 (place_candidates → places)
│   ├── keywords/
│   ├── scoring.ts                    # 인기도 점수
│   ├── density.ts                    # 행정동별 Top-N
│   ├── geocoder.ts
│   └── rate-limiter.ts
├── .github/workflows/
├── data/districts/                   # 행정동 GeoJSON
├── public/
│   ├── manifest.json                 # PWA
│   └── sw.js                         # Service Worker
└── supabase/
    └── migrations/                   # DB 마이그레이션
```

---

## 12. DB 스키마 (Supabase PostgreSQL)
```sql
-- 사용자 프로필 (Supabase Auth 확장)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  display_name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 장소
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sub_category TEXT,
  address TEXT,
  road_address TEXT,
  district_code TEXT,               -- 행정동 코드
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  phone TEXT,
  source TEXT NOT NULL,
  source_id TEXT,
  kakao_place_id TEXT UNIQUE,
  description TEXT,
  tags TEXT[],                      -- PostgreSQL 배열: {'수유실','유모차접근'}
  is_indoor BOOLEAN,               -- 날씨 연동 필터용
  mention_count INT DEFAULT 0,
  popularity_score REAL DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  source_count INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,   -- 폐업 자동 비활성화
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 장소 후보 (자동 승격 대기)
CREATE TABLE place_candidates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  kakao_place_id TEXT,
  kakao_similarity REAL,            -- 카카오 매칭 유사도
  source_urls TEXT[],               -- 독립 출처 URL 목록
  source_count INT DEFAULT 1,       -- 독립 출처 수
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);

-- 공연/행사
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  venue_name TEXT,
  venue_address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  start_date DATE NOT NULL,
  end_date DATE,
  time_info TEXT,
  price_info TEXT,
  age_range TEXT,
  source TEXT NOT NULL,
  source_id TEXT UNIQUE,
  source_url TEXT,
  poster_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 즐겨찾기 (계정별)
CREATE TABLE favorites (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  place_id INT REFERENCES places(id),
  event_id INT REFERENCES events(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (place_id IS NOT NULL OR event_id IS NOT NULL),
  UNIQUE (user_id, place_id),
  UNIQUE (user_id, event_id)
);

-- 블로그/카페 언급
CREATE TABLE blog_mentions (
  id SERIAL PRIMARY KEY,
  place_id INT REFERENCES places(id),
  source_type TEXT NOT NULL,        -- naver_blog, naver_cafe
  title TEXT,
  url TEXT UNIQUE,
  post_date DATE,
  snippet TEXT,
  collected_at TIMESTAMPTZ DEFAULT now()
);

-- 키워드
CREATE TABLE keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT UNIQUE NOT NULL,
  keyword_group TEXT,
  status TEXT DEFAULT 'NEW',
  efficiency_score REAL DEFAULT 0,
  total_results INT DEFAULT 0,
  new_places_found INT DEFAULT 0,
  duplicate_ratio REAL DEFAULT 0,
  cycle_count INT DEFAULT 0,
  consecutive_zero_new INT DEFAULT 0,
  seasonal_months INT[],            -- {3,4,5}
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

-- 키워드 사이클 로그
CREATE TABLE keyword_logs (
  id SERIAL PRIMARY KEY,
  keyword_id INT REFERENCES keywords(id),
  api_results INT,
  new_places INT,
  duplicates INT,
  ran_at TIMESTAMPTZ DEFAULT now()
);

-- 수집 로그
CREATE TABLE collection_logs (
  id SERIAL PRIMARY KEY,
  collector TEXT NOT NULL,
  keyword TEXT,
  results_count INT DEFAULT 0,
  new_places INT DEFAULT 0,
  new_events INT DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  duration_ms INT,
  ran_at TIMESTAMPTZ DEFAULT now()
);

-- 검색 로그 (사용자 검색어 분석용)
CREATE TABLE search_logs (
  id SERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  results_count INT,
  user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX idx_places_category ON places(category);
CREATE INDEX idx_places_location ON places USING gist (
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)
);  -- PostGIS 공간 인덱스
CREATE INDEX idx_places_district ON places(district_code);
CREATE INDEX idx_places_score ON places(popularity_score DESC);
CREATE INDEX idx_places_active ON places(is_active);
CREATE INDEX idx_candidates_seen ON place_candidates(last_seen_at);
CREATE INDEX idx_events_dates ON events(start_date, end_date);
CREATE INDEX idx_favorites_user ON favorites(user_id);
CREATE INDEX idx_blog_mentions_place ON blog_mentions(place_id);
CREATE INDEX idx_keywords_status ON keywords(status);

-- RLS 정책
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Places are publicly readable"
  ON places FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify places"
  ON places FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Events are publicly readable"
  ON events FOR SELECT USING (true);
CREATE POLICY "Only service_role can modify events"
  ON events FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites"
  ON favorites FOR ALL USING (auth.uid() = user_id);

ALTER TABLE blog_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Blog mentions are publicly readable"
  ON blog_mentions FOR SELECT USING (true);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only service_role can read search_logs"
  ON search_logs FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Anyone can insert search_logs"
  ON search_logs FOR INSERT WITH CHECK (true);
```

---

## 13. 구현 순서
**Phase 1: MVP (지도 + 수집 + 기본 기능)**
1. Next.js + Supabase 프로젝트 초기화, PWA 설정
2. Supabase Auth (Google + 이메일) + profiles 테이블
3. DB 마이그레이션 (places, events, blog_mentions, place_candidates 등)
4. 카카오맵 JS SDK + MarkerClusterer 지도 컴포넌트
5. 장소 API (bbox, zoom, category → 행정동별 Top-N)
6. 메인 뷰 (지도 + 하단 시트 목록, 드래그로 전환)
7. 장소 상세 페이지 (기본 정보 + 인기 포스팅 TOP 5)
8. 파이프라인 A: 카카오 카테고리 수집기 (장소 발견)
9. 파이프라인 B: 네이버 블로그/카페 역검색 (인기도) + 키워드 검색 매칭
10. 자동 검증 엔진 (place_candidates 자동 승격 + 폐업 자동 감지)
11. GitHub Actions 크론 워크플로우
12. 비상 모드 (수유실/교환대 최근접 검색)
13. 날씨 연동 (기상청 API → 실내/실외 자동 필터)
14. 모바일 하단 4탭 네비게이션 + 반응형 레이아웃
15. Vercel 배포

**Phase 2: 데이터 확장 + 사용자 기능**
16. 공공데이터 수집기 (놀이시설, 공원, 도서관, 박물관)
17. KOPIS + Tour API + 서울시 행사 수집기
18. LOCALDATA 키즈카페 수집기
19. 인기도 스코어링 배치 (scoring.ts)
20. 계정별 즐겨찾기 (Supabase favorites)
21. 카테고리 필터 + 편의시설 태그 필터
22. 시설 검증 배지 (최근 3개월 확인)
23. 계절 큐레이션 (이달의 추천)

**Phase 3: 적응형 키워드 + 관리자**
24. 키워드 상태 관리 (rotation-engine.ts)
25. 키워드 후보 생성 + 계절 캘린더
26. 네이버 DataLab 트렌드 연동
27. 관리자 대시보드 (장소/수집/키워드/사용자)
28. 장소 데이터 관리 (자동화 현황, 수동 보정)

**Phase 4: 고급 기능**
29. 방문 기록 다이어리
30. 검색 키워드 Gap 분석

---

## 14. 필요한 API 키 / 서비스
| 서비스 | 발급처 | 용도 |
| --- | --- | --- |
| Supabase | supabase.com | DB + Auth (무료 500MB, 50K 인증) |
| Vercel | vercel.com | 웹앱 호스팅 (무료 100GB BW) |
| 카카오 | developers.kakao.com | JS키 + REST키 |
| 네이버 | developers.naver.com | 블로그/카페/로컬/DataLab |
| 공공데이터포털 | data.go.kr | 놀이시설, 공원, 도서관, 박물관 |
| KOPIS | kopis.or.kr | 공연 정보 |
| Tour API | api.visitkorea.or.kr | 관광공사 |
| 서울 열린데이터 | data.seoul.go.kr | 문화행사, 공공서비스 |
| 기상청 | data.kma.go.kr | 날씨 (날씨 연동용) |

---

## 15. 검증 방법
1. npm run dev → 카카오맵 + MarkerClusterer 렌더링
2. Google 로그인 → 프로필 생성 확인
3. GitHub Actions 수동 트리거 → 파이프라인 A → Supabase places 확인
4. 파이프라인 B → 역검색 → blog_mentions + mention_count 확인
5. place_candidates → 2+ 출처 자동 승격 → places 이동 확인
6. 장소 상세 → 인기 포스팅 5개 표시 확인
7. 거리순 목록 뷰 → 내 위치 기준 정렬 확인
8. 즐겨찾기 추가/제거 → 계정별 저장 확인
9. 비상 모드 → 가장 가까운 수유실 안내 확인
10. 날씨 API → 비 올 때 실내만 표시 확인
11. 관리자 로그인 → admin 페이지 접근 확인, user 계정 접근 차단 확인
12. 줌 인/아웃 → 밀도 제어 확인
13. 모바일 브라우저에서 PWA 설치 → 홈화면 아이콘 동작 확인
14. Vercel 배포 후 PC 끈 상태에서 접속 확인

---

## 16. UI 디자인 가이드

### 16-1. 디자인 원칙
- **한 손 조작**: 아기를 안고 한 손으로 사용하는 상황 (큰 터치 영역, 하단 중심 인터랙션)
- **즉시 발견**: 지도 중심, 최소 탭으로 장소 정보 접근
- **신뢰감**: 편의시설 아이콘 즉시 확인, 인기도 수치 투명 공개

### 16-2. 색상 팔레트

**Primary — Soft Coral**
```
primary-50:  #FFF5F3   배경 (하단 시트, 카드 hover)
primary-100: #FFE8E3   연한 강조
primary-200: #FFCFC4   카테고리 칩 배경 (선택 시)
primary-300: #FFA08D   아이콘 강조
primary-400: #FF7B66   CTA 버튼 hover
primary-500: #FF5C45   CTA 버튼, 인기도 배지, 비상 모드 버튼
primary-600: #E84530   비상 모드 활성화
```

**Neutral — Warm Gray**
```
neutral-50:  #FAFAF8   페이지 배경
neutral-100: #F5F4F2   카드 배경
neutral-200: #E8E6E3   구분선, 비활성 칩
neutral-300: #D1CEC9   placeholder 텍스트
neutral-400: #A8A49E   보조 텍스트
neutral-500: #78746D   본문 텍스트
neutral-600: #524E49   제목 텍스트
neutral-700: #3A3733   장소명, 강조 텍스트
neutral-800: #252320   헤더, 최상위 텍스트
```

**Semantic**
```
success:  #34C759   시설 검증 배지
warning:  #FF9500   수집 경고
error:    #FF3B30   에러 상태
info:     #007AFF   링크, 블로그 출처
indoor:   #5B7FFF   실내 장소 태그
outdoor:  #34C759   실외 장소 태그
```

**Tailwind 설정 (`tailwind.config.ts`):**
```ts
colors: {
  coral: {
    50: '#FFF5F3', 100: '#FFE8E3', 200: '#FFCFC4',
    300: '#FFA08D', 400: '#FF7B66', 500: '#FF5C45', 600: '#E84530',
  },
  warm: {
    50: '#FAFAF8', 100: '#F5F4F2', 200: '#E8E6E3', 300: '#D1CEC9',
    400: '#A8A49E', 500: '#78746D', 600: '#524E49', 700: '#3A3733', 800: '#252320',
  },
}
```

### 16-3. 타이포그래피

| 용도 | 폰트 | 크기 | 굵기 | 행간 |
| --- | --- | --- | --- | --- |
| 앱 헤더 | Pretendard | 20px | 700 (Bold) | 1.3 |
| 장소명 | Pretendard | 17px | 600 (SemiBold) | 1.4 |
| 카테고리/태그 | Pretendard | 13px | 500 (Medium) | 1.3 |
| 본문/설명 | Pretendard | 15px | 400 (Regular) | 1.6 |
| 보조 텍스트 | Pretendard | 13px | 400 (Regular) | 1.4 |
| 거리/수치 | Pretendard | 13px | 600 (SemiBold) | 1.0 |

설치: `@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');`

### 16-4. 간격 + 터치 영역

| 요소 | 최소 크기 | 간격 |
| --- | --- | --- |
| 터치 타겟 | 48×48dp (모바일 필수) | 8dp 간격 |
| 하단 탭 아이콘 | 24×24px 아이콘 + 10px 라벨 | 탭 영역 전체 48px 높이 |
| 카테고리 칩 | 32px 높이, 12px 좌우 패딩 | 칩 간 8px |
| 편의시설 아이콘 | 20×20px | 아이콘 간 6px |
| 카드 | 풀폭, 16px 내부 패딩 | 카드 간 8px |
| 하단 시트 핸들 | 40×4px 둥근 바 | 상단 12px 마진 |

둥근 모서리: 카드 12px, 버튼 12px, 칩 16px (pill), 바텀시트 상단 20px

### 16-5. 아이콘 시스템

**일반 UI 아이콘 — Lucide React**
- 설치: `npm install lucide-react`
- 문서: https://lucide.dev/icons
- 사용 아이콘: `MapPin`, `Search`, `Heart`, `User`, `Filter`, `ChevronUp`, `Share2`, `Phone`, `Clock`, `Navigation`, `CloudRain`, `Sun`, `Star`
- 크기: 네비게이션 24px, 카드 내 16px, 상세페이지 20px
- 색상: `stroke="currentColor"` (Tailwind text color 상속)

**편의시설 커스텀 아이콘 세트 (8종)**
Lucide 기반 매핑 + 필요시 SVG 커스텀:

| 편의시설 | Lucide 아이콘 | 대체 방안 |
| --- | --- | --- |
| 수유실 | `Baby` | 커스텀 SVG (젖병) |
| 기저귀교환대 | `BabyIcon` 변형 | 커스텀 SVG |
| 남성화장실교환대 | `User` + `Baby` 조합 | 커스텀 SVG |
| 유모차접근 | `Accessibility` 변형 | 커스텀 SVG (유모차) |
| 아기의자 | `Armchair` | 그대로 사용 가능 |
| 주차 | `ParkingCircle` | Lucide 내장 |
| 예스키즈존 | `SmilePlus` | Lucide 내장 |
| 엘리베이터 | `ArrowUpDown` | 커스텀 SVG (EV) |

커스텀 아이콘 제작 규격: 24×24 viewBox, stroke-width 2, stroke-linecap round, 컬러 currentColor

### 16-6. 레이아웃 패턴

**메인 화면 (지도 + 하단 시트)**
```
┌─────────────────────────────────┐
│ 📍 강남구              🔍 [필터] │  ← 상단 바 (현위치 + 검색)
├─────────────────────────────────┤
│                                 │
│         [카카오맵 전면]          │
│      📌  📌    📌              │
│           📌      📌           │
│    📌         📌               │
│                                 │
│  ┌──────────┐                   │
│  │🍼급해요! │                   │  ← 비상 FAB (우하단)
│  └──────────┘                   │
├─────── ═══ ─────────────────────┤  ← 하단 시트 (드래그)
│ 코코몽 에코파크         1.2km   │
│ 키즈카페 · 🍼 🚼 🅿           │
├─────────────────────────────────┤
│ 서울상상나라             2.3km  │
│ 전시체험 · 🍼 ♿               │
├────────┬────────┬───────┬──────┤
│ 🗺 홈  │ 🔍 검색 │ ❤ 찜  │ 👤  │  ← 하단 4탭
└────────┴────────┴───────┴──────┘
```

**장소 상세 페이지**
```
┌─────────────────────────────────┐
│ ←                         ↗ 공유│  ← 상단 바
├─────────────────────────────────┤
│ [    사진 갤러리 스와이프     ]  │  ← 풀폭 240px 높이
├─────────────────────────────────┤
│ 코코몽 에코파크            ❤    │  ← 장소명 + 찜
│ 키즈카페 · 강남구 · 1.2km      │  ← 카테고리 + 위치 + 거리
│ 🍼 🚼 🅿 🪑 ♿               │  ← 편의시설 아이콘 행
├─────────────────────────────────┤
│ ████████░░ 인기도 0.82         │  ← 소셜 인기도 바
├─────────────────────────────────┤
│ 📍 서울 강남구 삼성로 123       │
│ 📞 02-1234-5678                │
│ 🕐 10:00~18:00 (월 휴무)       │
│ ┌─────────────────────────────┐│
│ │      카카오맵에서 길찾기     ││  ← CTA 버튼 (coral-500)
│ └─────────────────────────────┘│
├─────────────────────────────────┤
│ 📝 인기 포스팅 TOP 5           │
│ ┌───────────────────────────┐  │
│ │ N 24개월 아기랑 코코몽 후기│  │  ← N = 네이버 아이콘
│ │   2026.02.20              │  │
│ ├───────────────────────────┤  │
│ │ N 코코몽 에코파크 솔직리뷰 │  │
│ │   2026.02.15              │  │
│ └───────────────────────────┘  │
└─────────────────────────────────┘
```

**필터 패널 (하단에서 올라오는 시트)**
```
┌─────────────────────────────────┐
│ 카테고리                    닫기│
│ [놀이] [공원] [전시] [공연] →  │  ← 가로 스크롤 칩
│ [동물] [식당] [도서관] [수영] →│
├─────────────────────────────────┤
│ 편의시설                        │
│ [🍼수유실] [🚼교환대] [🅿주차] │  ← 토글 칩 (복수 선택)
│ [♿유모차] [🪑의자] [🛗EV]     │
├─────────────────────────────────┤
│ 정렬                            │
│ (●) 거리순  ( ) 인기순          │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐│
│ │        필터 적용 (N개)       ││  ← CTA
│ └─────────────────────────────┘│
└─────────────────────────────────┘
```

**비상 모드 (전면 오버레이)**
```
┌─────────────────────────────────┐
│                            ✕ 닫기│
│                                 │
│        🍼 가장 가까운 수유실     │  ← coral-600 배경
│                                 │
│ ┌─────────────────────────────┐ │
│ │ 1. 강남역 지하 수유실  350m │ │  ← 흰색 카드
│ │    [길찾기 →]               │ │
│ ├─────────────────────────────┤ │
│ │ 2. OO백화점 수유실    500m  │ │
│ │    [길찾기 →]               │ │
│ ├─────────────────────────────┤ │
│ │ 3. △△병원 수유실     720m  │ │
│ │    [길찾기 →]               │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 16-7. 경쟁앱 디자인 레퍼런스 (코더 참고용)

코더는 아래 앱 스토어 링크에서 실제 스크린샷을 확인하고 패턴을 참고할 것.

| 앱 | 참고 포인트 | App Store 스크린샷 |
| --- | --- | --- |
| **엄마의지도** | 편의시설 아이콘 필터, 장르별 컬러 라벨, 꿀팁 상세 | https://apps.apple.com/kr/app/id1625804077 |
| **애기야가자** | 카드 리스트 레이아웃, 하단 5탭, 따뜻한 베이지 톤 | https://apps.apple.com/kr/app/id1479205228 |
| **Winnie** | 지도 중심 UI, 세분화 필터, 깔끔한 블루 톤 | https://apps.apple.com/us/app/id1066620030 |
| **GoWhee** | Kid-Friendliness Score 바, 접근성 필터, 활기찬 배색 | https://apps.apple.com/us/app/id1491678639 |
| **PlayScout** | 방문/미방문 핀 색상 구분, 지도 전면 레이아웃 | https://apps.apple.com/us/app/id6471904451 |

**핵심 벤치마크:**
- 지도+하단시트 패턴 → Winnie, PlayScout
- 편의시설 아이콘 행 → 엄마의지도
- 카드 리스트 (사진+이름+태그+거리) → 애기야가자
- 소셜 인기도 바 → GoWhee (Kid-Friendliness Score)
- 따뜻한 색감 + 둥근 모서리 → 전체 공통 트렌드

### 16-8. 컴포넌트 스타일 요약

| 컴포넌트 | 배경 | 테두리 | 그림자 | 라운드 |
| --- | --- | --- | --- | --- |
| PlaceCard | white | none | `shadow-sm` | 12px |
| BottomSheet | white | `warm-200` top | `shadow-lg` | 상단 20px |
| CategoryChip (off) | `warm-100` | `warm-200` | none | 16px (pill) |
| CategoryChip (on) | `coral-200` | `coral-400` | none | 16px (pill) |
| FacilityTag | `warm-50` | none | none | 8px |
| CTAButton | `coral-500` | none | `shadow-md` | 12px |
| EmergencyFAB | `coral-600` | none | `shadow-lg` | 16px |
| SearchBar | `warm-50` | `warm-200` | none | 12px |
| BottomNav | white | `warm-200` top | none | 0 |
| TopPostItem | `warm-50` | `warm-200` bottom | none | 8px |

---

## 17. 오케스트레이션: 디자인 에이전트 규칙

M/L 스케일에서 Coder 에이전트 중 **1명을 Design Coder로 지정**하여 모든 UI 컴포넌트를 전담.

**이유:** 색상·간격·아이콘 스타일의 통일성. 여러 Coder가 UI를 나눠 만들면 일관성 깨짐.

**Design Coder 담당 범위:**
- `src/components/` 전체 (map/, place/, 공통 컴포넌트)
- `src/app/**/page.tsx` 레이아웃
- `tailwind.config.ts` 커스텀 색상/폰트 설정
- `public/icons/` 커스텀 SVG 아이콘

**Design Coder 프롬프트에 필수 포함:**
- "섹션 16 UI 디자인 가이드를 엄격히 따를 것"
- "색상은 coral/warm 팔레트만 사용, 임의 색상 금지"
- "Lucide React 아이콘만 사용, 다른 아이콘 라이브러리 설치 금지"
- "터치 타겟 최소 48×48dp 준수"

**다른 Coder (로직 담당):**
- `server/`, `src/lib/`, `src/app/api/` — 비즈니스 로직 전담
- 컴포넌트 생성/수정 금지 (Design Coder 영역)

---

## 18. 구현 상세 가이드

### 18-1. 환경변수 (.env.local)
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # 서버 전용 (수집 파이프라인, admin API)

# 카카오
NEXT_PUBLIC_KAKAO_JS_KEY=abc123           # 지도 SDK (브라우저 노출 OK)
KAKAO_REST_KEY=def456                     # 로컬 검색 API (서버 전용)

# 네이버
NAVER_CLIENT_ID=xxx
NAVER_CLIENT_SECRET=yyy

# 공공데이터
DATA_GO_KR_API_KEY=zzz                   # 인코딩된 키

# 기상청
KMA_API_KEY=www

# GitHub Actions 크론 → Vercel API Route 호출용
CRON_SECRET=random-secret-string         # API Route에서 Authorization 헤더 검증

# KOPIS
KOPIS_API_KEY=kkk

# Tour API (관광공사)
TOUR_API_KEY=ttt
```

### 18-2. Supabase 클라이언트 설정

**브라우저 클라이언트 (`src/lib/supabase.ts`):**
```ts
import { createBrowserClient } from '@supabase/ssr'
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

**서버 클라이언트 (API Route, Server Component):**
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
// 사용자 인증 컨텍스트가 필요한 곳 (즐겨찾기, 프로필)
```

**서비스 클라이언트 (수집 파이프라인, admin):**
```ts
import { createClient } from '@supabase/supabase-js'
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // RLS 우회
)
```

**미들웨어 (`src/middleware.ts`):**
- 인증 세션 갱신 (Supabase SSR 패턴)
- `/admin/*` 경로 → profiles.role = 'admin' 검증, 아니면 `/` 리다이렉트
- `/(auth)/*` 경로 → 미로그인 시 `/login` 리다이렉트

### 18-3. 카카오맵 Next.js 통합

**패키지:** `react-kakao-maps-sdk` (TypeScript 내장)
```bash
npm install react-kakao-maps-sdk
```

**SDK 로딩 (`src/app/layout.tsx`):**
```tsx
import Script from 'next/script'
<Script
  src={`//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_JS_KEY}&libraries=clusterer,services&autoload=false`}
  strategy="beforeInteractive"
/>
```

**MarkerClusterer 설정:**
```ts
gridSize: 60,        // 클러스터 그리드 (px)
minClusterSize: 3,   // 최소 3개부터 클러스터
averageCenter: true,  // 클러스터 중심 = 마커 평균
styles: [{            // 커스텀 클러스터 스타일
  width: '40px', height: '40px',
  background: 'rgba(255, 92, 69, 0.8)',  // coral-500
  borderRadius: '20px',
  color: 'white', textAlign: 'center', lineHeight: '40px',
  fontSize: '14px', fontWeight: '600',
}]
```

**지도 이벤트:**
- `onBoundsChanged` → 현재 bbox + zoom 레벨로 API 호출 (debounce 300ms)
- `onZoomChanged` → 줌 레벨에 따른 밀도 제어 파라미터 변경

### 18-4. API Route 스펙

**GET /api/places**
```ts
// 파라미터
params: {
  swLat: number, swLng: number, neLat: number, neLng: number,  // bbox
  zoom: number,          // 줌 레벨 → 밀도 제어
  category?: string,     // 쉼표 구분: "놀이,전시/체험"
  tags?: string,         // 쉼표 구분: "수유실,주차"
  sort?: 'distance' | 'popularity' | 'recent',
  lat?: number, lng?: number,  // 거리순 정렬 시 내 위치
  cursor?: number,       // 무한 스크롤 커서 (place.id)
  limit?: number,        // 기본 20
  indoor?: boolean,      // 날씨 연동: true면 실내만
}
// 응답
{ places: Place[], nextCursor: number | null }
```

**GET /api/places/[id]**
```ts
// 응답: Place + blog_mentions (최신 5개) + isFavorited (로그인 시)
{ place: Place, topPosts: BlogMention[], isFavorited: boolean }
```

**GET /api/places/emergency**
```ts
// 파라미터
params: { lat: number, lng: number, type: 'nursing_room' | 'diaper_station' }
// 응답: 최근접 5개
{ places: (Place & { distance_m: number })[] }
```

**POST /api/favorites**
```ts
body: { placeId?: number, eventId?: number }  // 토글 (있으면 삭제, 없으면 추가)
// 응답
{ favorited: boolean }
```

**POST /api/report** (사용자 장소 제보)
```ts
body: { name: string, address?: string, category: string, description?: string }
// 서버: 카카오 검증 → places 즉시 등록 or place_candidates
// 응답
{ status: 'registered' | 'candidate', placeId?: number }
```

**POST /api/collect/trigger** (GitHub Actions 전용)
```ts
headers: { Authorization: `Bearer ${CRON_SECRET}` }
body: { pipeline: 'A' | 'B' | 'scoring' | 'promote' | 'deactivate' }
```

**GET /api/weather**
```ts
// 파라미터
params: { lat: number, lng: number }
// 응답
{ isRaining: boolean, temperature: number, description: string }
```

### 18-5. 카카오 카테고리 코드 → BabyPlace 카테고리 매핑

| 카카오 category_group_code | 카카오 카테고리명 | BabyPlace 대분류 | 검색 키워드 보강 |
| --- | --- | --- | --- |
| CE7 | 카페 | 식당/카페 | "키즈카페", "이유식카페" |
| FD6 | 음식점 | 식당/카페 | "키즈존 식당", "유아식" |
| CT1 | 문화시설 | 전시/체험 | "어린이박물관", "과학관" |
| AT4 | 관광명소 | 동물/자연 | "동물원", "아쿠아리움" |
| SW8 | 지하철역 | (제외) | - |
| PK6 | 주차장 | (제외) | - |

**카카오 카테고리 검색으로 커버 안 되는 BabyPlace 카테고리 → 키워드 검색:**
| BabyPlace 대분류 | 카카오 키워드 검색어 |
| --- | --- |
| 놀이 | "키즈카페", "실내놀이터", "볼풀" |
| 공원/놀이터 | "어린이공원", "놀이터" |
| 공연 | (KOPIS API 전담) |
| 도서관 | "어린이도서관" |
| 수영/물놀이 | "유아수영장", "키즈풀" |
| 문화행사 | (서울시 API 전담) |
| 편의시설 | (공공데이터 전담) |

**카카오 로컬 API 응답 → places 컬럼 매핑:**
```ts
kakaoResult.id           → kakao_place_id
kakaoResult.place_name   → name
kakaoResult.category_name → category (위 매핑 테이블로 변환)
kakaoResult.address_name → address
kakaoResult.road_address_name → road_address
kakaoResult.x            → lng (parseFloat)
kakaoResult.y            → lat (parseFloat)
kakaoResult.phone        → phone
```

### 18-6. 외부 API 엔드포인트 + 호출 상세

**카카오 로컬 — 키워드 검색**
```
GET https://dapi.kakao.com/v2/local/search/keyword
Headers: Authorization: KakaoAK {KAKAO_REST_KEY}
Params: query, x(lng), y(lat), rect(swLng,swLat,neLng,neLat), page(1-45), size(1-15)
```

**카카오 로컬 — 카테고리 검색**
```
GET https://dapi.kakao.com/v2/local/search/category
Headers: Authorization: KakaoAK {KAKAO_REST_KEY}
Params: category_group_code(CE7 등), rect, page(1-45), size(1-15)
```
카카오 페이지네이션: `is_end: false`면 다음 페이지. 최대 45페이지 × 15개 = 675건/쿼리

**네이버 블로그 검색**
```
GET https://openapi.naver.com/v1/search/blog.json
Headers: X-Naver-Client-Id, X-Naver-Client-Secret
Params: query, display(1-100), start(1-1000), sort(sim|date)
Response: { items: [{ title, link, description, bloggername, bloggerlink, postdate }] }
```

**네이버 카페 검색**
```
GET https://openapi.naver.com/v1/search/cafearticle.json
(동일 헤더/파라미터 구조)
Response: { items: [{ title, link, description, cafename, cafeurl }] }
```

**기상청 단기예보 (초단기실황)**
```
GET http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst
Params: serviceKey, numOfRows, pageNo, dataType(JSON), base_date(YYYYMMDD), base_time(HHmm), nx, ny
```
nx/ny = 기상청 격자 좌표 (위경도 → 격자 변환 함수 필요)

**기상청 PTY (강수형태) 코드 → 날씨 필터 매핑:**
| PTY 값 | 의미 | isRaining |
| --- | --- | --- |
| 0 | 없음 | false |
| 1 | 비 | true |
| 2 | 비/눈 | true |
| 3 | 눈 | true |
| 5 | 빗방울 | true |
| 6 | 빗방울날림 | true |
| 7 | 눈날림 | true |

isRaining = true → 프론트에서 `indoor=true` 파라미터 자동 추가

**위경도 → 기상청 격자 변환:**
기상청에서 제공하는 격자 변환 공식 사용. `src/lib/weather.ts`에 `toGridCoord(lat, lng) → {nx, ny}` 함수 구현.
참조: 기상청 오픈API 기술문서 부록 (격자 변환 C 코드 → TypeScript 포팅)

### 18-7. PostGIS 공간 쿼리

**Supabase PostGIS 활성화:**
Supabase Dashboard → Database → Extensions → `postgis` 활성화

**bbox 쿼리 (지도 뷰포트 내 장소 조회):**
```sql
SELECT *, ST_Distance(
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
) AS distance_m
FROM places
WHERE is_active = true
  AND lat BETWEEN $swLat AND $neLat
  AND lng BETWEEN $swLng AND $neLng
  AND ($category IS NULL OR category = ANY($categories))
  AND ($tags IS NULL OR tags && $tags::text[])
  AND ($indoor IS NULL OR is_indoor = $indoor)
ORDER BY popularity_score DESC
LIMIT $limit;
```
참고: 간단한 bbox는 lat/lng BETWEEN이 PostGIS GiST 인덱스보다 빠름. GiST는 거리 계산에 사용.

**비상 모드 최근접 검색 (수유실):**
```sql
SELECT *, ST_Distance(
  ST_SetSRID(ST_MakePoint($userLng, $userLat), 4326)::geography,
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
) AS distance_m
FROM places
WHERE is_active = true
  AND '수유실' = ANY(tags)   -- 또는 '기저귀교환대'
ORDER BY ST_SetSRID(ST_MakePoint(lng, lat), 4326) <-> ST_SetSRID(ST_MakePoint($userLng, $userLat), 4326)
LIMIT 5;
```
`<->` 연산자: KNN (K-Nearest Neighbor) GiST 인덱스 활용, 매우 빠름

**행정동 코드 할당 (장소 INSERT 시):**
행정동 GeoJSON은 `data/districts/` 에 저장. 수집 파이프라인 서버에서 point-in-polygon 수행:
```ts
import districts from '@/data/districts/seoul_gyeonggi.json'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

function getDistrictCode(lat: number, lng: number): string | null {
  const pt = point([lng, lat])
  for (const feature of districts.features) {
    if (booleanPointInPolygon(pt, feature)) return feature.properties.adm_cd
  }
  return null
}
```
패키지: `@turf/boolean-point-in-polygon`, `@turf/helpers`

### 18-8. 역검색 로테이션 전략

매 6시간 실행 시 100장소 선정 기준:
```sql
SELECT id, name FROM places
WHERE is_active = true
ORDER BY
  -- 우선순위 1: 최근 언급 업데이트가 오래된 순
  COALESCE(last_mentioned_at, '2000-01-01') ASC,
  -- 우선순위 2: 인기도 높은 순 (인기 장소일수록 새 블로그 나올 확률 높음)
  popularity_score DESC
LIMIT 100;
```

**역검색 프로세스 (장소당):**
1. `"코코몽 에코파크" site:blog.naver.com` 네이버 블로그 검색 (display=10, sort=date)
2. 기존 blog_mentions.url과 비교 → 신규 URL만 INSERT
3. 신규 있으면 mention_count++, last_mentioned_at = now()
4. 없으면 skip (API 호출 1회로 끝)

### 18-9. 문자열 유사도 + 중복 감지

**문자열 유사도 (블로그 매칭, candidates 검증):**
정규화 → 포함 비교 → 유사도 점수 순서:
```ts
function normalizePlace(name: string): string {
  return name
    .replace(/\s+/g, '')           // 공백 제거
    .replace(/[^가-힣a-zA-Z0-9]/g, '') // 특수문자 제거
    .toLowerCase()
}

function similarity(a: string, b: string): number {
  const na = normalizePlace(a), nb = normalizePlace(b)
  if (na === nb) return 1.0
  if (na.includes(nb) || nb.includes(na)) return 0.9
  // Dice coefficient (bigram)
  const bigramsA = new Set(bigrams(na)), bigramsB = new Set(bigrams(nb))
  const intersection = [...bigramsA].filter(x => bigramsB.has(x)).length
  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}
```
라이브러리 설치 불필요. 직접 구현 (30줄 이내).

**중복 감지 (새 장소 INSERT 전):**
```sql
-- 1차: kakao_place_id 동일 → 확실한 중복
SELECT id FROM places WHERE kakao_place_id = $kakaoPlaceId;

-- 2차: 이름 유사 + 반경 100m 이내 → 의심 중복
SELECT id, name FROM places
WHERE ST_DWithin(
  ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
  ST_SetSRID(ST_MakePoint($newLng, $newLat), 4326)::geography,
  100  -- 100미터
)
AND is_active = true;
```
2차 결과에서 similarity(기존name, 신규name) > 0.7 → 중복으로 처리 (mention_count만 증가)

### 18-10. 서울/경기 지역 판별

**좌표 바운딩 박스:**
```ts
const SEOUL_GYEONGGI_BOUNDS = {
  swLat: 36.9, swLng: 126.5,  // 남서
  neLat: 38.0, neLng: 127.9,  // 북동
}
function isInServiceArea(lat: number, lng: number): boolean {
  return lat >= 36.9 && lat <= 38.0 && lng >= 126.5 && lng <= 127.9
}
```

**주소 정규식 (보조 검증):**
```ts
const SEOUL_GYEONGGI_REGEX = /^(서울|경기|인천)/
function isValidAddress(address: string): boolean {
  return SEOUL_GYEONGGI_REGEX.test(address)
}
```
두 검증 모두 통과해야 등록 (좌표 + 주소)

### 18-11. GitHub Actions 워크플로우 구조

```yaml
# .github/workflows/collect.yml
name: Data Collection
on:
  schedule:
    - cron: '0 */6 * * *'    # 매 6시간 (파이프라인 B)
    - cron: '0 17 * * *'     # 매일 02시 KST=17UTC (파이프라인 A)
    - cron: '0 18 * * *'     # 매일 03시 KST (공공데이터)
    - cron: '0 19 * * *'     # 매일 04시 KST (공연/행사)
    - cron: '0 20 * * *'     # 매일 05시 KST (스코어링+승격+비활성화)
  workflow_dispatch:          # 수동 트리거

jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx server/run.ts ${{ github.event.schedule || 'manual' }}
        env:
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          KAKAO_REST_KEY: ${{ secrets.KAKAO_REST_KEY }}
          NAVER_CLIENT_ID: ${{ secrets.NAVER_CLIENT_ID }}
          NAVER_CLIENT_SECRET: ${{ secrets.NAVER_CLIENT_SECRET }}
          DATA_GO_KR_API_KEY: ${{ secrets.DATA_GO_KR_API_KEY }}
          # ... 나머지 키
```

`server/run.ts`: cron 표현식 파라미터로 어떤 파이프라인 실행할지 분기.
GitHub Actions에서 직접 `npx tsx` 실행 (Vercel API Route 호출 대신 → 10분 제한 회피).

### 18-12. PWA 설정

**manifest.json:**
```json
{
  "name": "BabyPlace",
  "short_name": "BabyPlace",
  "description": "아기랑 놀러갈 곳 지도",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAFAF8",
  "theme_color": "#FF5C45",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Service Worker 전략 (sw.js):**
- 지도 타일: NetworkFirst (항상 최신, 오프라인 시 캐시)
- API 응답 (/api/places): StaleWhileRevalidate (빠른 로딩 + 백그라운드 갱신)
- 정적 자산 (JS/CSS/이미지): CacheFirst
- 라이브러리: `next-pwa` 또는 `serwist` (Next.js App Router 호환)

### 18-13. 무한 스크롤 + 상태 관리

**@tanstack/react-query 기반 무한 스크롤:**
```ts
const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
  queryKey: ['places', filters],
  queryFn: ({ pageParam }) => fetchPlaces({ ...filters, cursor: pageParam }),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  initialPageParam: undefined,
})
```

**커서 기반 페이지네이션 (API 서버):**
```sql
SELECT * FROM places
WHERE is_active = true
  AND ($cursor IS NULL OR id < $cursor)  -- 커서: place.id DESC
  -- ... 기타 필터
ORDER BY popularity_score DESC, id DESC
LIMIT 21;  -- 20 + 1 (다음 페이지 존재 여부 확인용)
```
21개 조회 → 20개 반환, 21번째 있으면 nextCursor = 20번째.id

**필터 상태 공유 (지도 ↔ 목록):**
URL searchParams로 관리 (nuqs 라이브러리 또는 Next.js useSearchParams):
```
/?category=놀이,전시/체험&tags=수유실&sort=distance&lat=37.5&lng=127.0
```
지도/목록 전환 시 URL 유지 → 필터 상태 보존

### 18-14. Rate Limiter (수집 파이프라인)

```ts
// server/rate-limiter.ts
class RateLimiter {
  private queue: Array<() => Promise<any>> = []
  constructor(
    private maxPerSecond: number,  // 카카오: 10/초, 네이버: 10/초
    private maxPerDay: number,     // 카카오: 100,000, 네이버: 25,000
  ) {}
  async throttle<T>(fn: () => Promise<T>): Promise<T> { /* 큐 기반 쓰로틀 */ }
}

// 사용
const kakaoLimiter = new RateLimiter(10, 100_000)
const naverLimiter = new RateLimiter(10, 25_000)
```
일일 호출 횟수: collection_logs에 기록하여 한도 초과 방지.

### 18-15. 공공데이터 API 상세

**공통 패턴:**
```
GET https://apis.data.go.kr/{서비스}/{오퍼레이션}
Params: serviceKey(인코딩된 키), numOfRows, pageNo, type(json)
```

| API | 서비스 경로 | 키 파라미터 | 아동 필터 |
| --- | --- | --- | --- |
| 어린이놀이시설 | /B553077/api/open/sdsc2/storeListInDong | divId=I(어린이) | 자동 (어린이 전용) |
| 도시공원 | /B553881/CityParkInfoService | 없음 | park_nm LIKE '%어린이%' |
| 도서관 | /B553881/LibraryInfoService | 없음 | lbrry_ty_nm = '어린이도서관' |
| 박물관/미술관 | /B553881/MuseumInfoService | 없음 | 전체 수집 후 태깅 |

**KOPIS 공연 API:**
```
GET http://www.kopis.or.kr/openApi/restful/pblprfr
Params: service(API키), stdate, eddate, shcate(AAAB=뮤지컬), kidstate(Y=아동)
Response: XML → xml2js로 파싱
```

**Tour API (관광공사):**
```
GET http://apis.data.go.kr/B551011/KorService1/areaBasedList1
Params: serviceKey, contentTypeId(12=관광지,14=문화시설,15=축제), areaCode(1=서울,31=경기), cat1(A02=인문,A03=레포츠)
Response: JSON
```
