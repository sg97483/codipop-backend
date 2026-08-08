# codipop-backend

CodiPOP AI 가상 피팅 백엔드. Express + Gemini + Firebase.

- 운영 URL: https://codipop-backend.onrender.com
- Firebase 프로젝트: `codipop-63c0d`
- 배포: GitHub `main` 푸시 → **Render 대시보드에서 수동 배포 버튼을 눌러야 반영됨** (자동 배포 아님)

---

## 실행

```bash
yarn install          # 또는 npm install
node server.js        # 기본 포트 3000
```

로컬에서 Firebase 기능(로깅·통계)을 쓰려면 프로젝트 루트에 `serviceAccountKey.json`이 필요합니다.
없으면 서버는 뜨지만 Firestore 호출이 전부 실패합니다 (`Could not load the default credentials`).
합성 자체를 테스트하려면 `GEMINI_API_KEY`도 필요합니다.

---

## 엔드포인트

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/` | 헬스체크 |
| POST | `/try-on` | **가상 착장 합성** (multipart) |
| POST | `/analyze-clothing` | 의류 카테고리·상품명 자동 분류 (비전) |
| POST | `/get-recommendation` | 코디 추천 (※ 프롬프트가 하드코딩되어 사실상 데모 수준) |
| POST | `/events` | 위젯 상호작용·구매 클릭 수집 |
| GET | `/stats/:mallId` | 몰별 통계 (대시보드·파일럿 리포트·청구 근거) |
| GET | `/demo/` | 파일럿 몰 제휴용 웹 데모 |
| GET | `/app-ads.txt` | AdMob 퍼블리셔 인증 |

### POST /try-on

**필수:** `person` (이미지 1장), `clothing` (이미지 1~2장)
**선택:** `clothing_count`, `heightCm`, `weightKg`, `usualSize`, `mallId`, `productId`, `sessionId`, `userId`, `mallName`, `mallLogo`(파일)

의류가 3장 이상이면 앞의 2장만 처리하고 `warning`을 함께 반환합니다.

```json
{
  "success": true,
  "imageUrl": "https://storage.googleapis.com/...",
  "processedItems": { "person": 1, "clothing": 1, "total": 2 },
  "fittingEventId": "h7iTMoDIp4i11gVzTiR0"
}
```

`fittingEventId`는 이후 구매 클릭을 이 피팅에 귀속시킬 때 `/events`로 되돌려 보냅니다.

### POST /events

```json
{ "type": "buy_click", "mallId": "demo-mall", "productId": "top-01",
  "sessionId": "s_abc", "fittingEventId": "h7iT...", "productPrice": 89000 }
```

허용 타입만 기록됩니다 (그 외 400):
`widget_open` `fitting_start` `result_view` `buy_click` `retry` `save_image` `share`

### GET /stats/:mallId

```
GET /stats/demo-mall?days=30&minFittings=2&token=<STATS_TOKEN>
```

| 파라미터 | 기본 | 설명 |
|---|---|---|
| `days` | 30 | 조회 기간 (1~365) |
| `minFittings` | 2 | "피팅했지만 안 산 상품" 최소 표본. 파일럿 초기엔 1로 낮춰 볼 것 |
| `token` | — | `STATS_TOKEN` 설정 시 필수 |

응답은 사업기획서 슬라이드 21에서 요구된 5개 항목을 담습니다 —
피팅 횟수(전체/1인당), 피팅 후 구매 전환, 최다 피팅 상품, **피팅했지만 안 산 상품**, 업셀링.
`billing.byTier`로 등급별 건수·원가가 분리되어 청구서 근거가 됩니다.

> **`fittedButNotBought`는 절대 건수가 아니라 미구매율로 정렬됩니다.**
> 절대 건수로 정렬하면 인기 상품이 상위를 차지해, 잘 팔리는 상품이 "안 팔리는 상품"으로 보입니다.
> 5회 피팅 중 2회 구매(전환 40%)보다 3회 피팅 중 0회 구매(전환 0%)가 MD에게 중요한 신호입니다.

---

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | — | **필수.** Gemini API 키 |
| `GOOGLE_CREDENTIALS` | — | **필수(운영).** 서비스 계정 JSON 문자열. 없으면 로컬 `serviceAccountKey.json` 사용 |
| `PORT` | 3000 | 서버 포트 |
| `TENANT_TIERS` | `{}` | **고객사별 엔진 등급 매핑.** 아래 참조 |
| `DEFAULT_TIER` | `standard` | 매핑에 없는 몰의 기본 등급 |
| `IMAGE_MODEL` | `gemini-3.1-flash-lite-image` | 스탠다드 등급 모델 |
| `PREMIUM_IMAGE_MODEL` | `gemini-3.1-flash-image` | 프리미엄 등급 모델 |
| `TEXT_MODEL` | `gemini-2.5-flash-lite` | 분류·추천용 텍스트 모델 |
| `STATS_TOKEN` | — | `/stats` 접근 토큰. **미설정 시 무인증 공개** |
| `USD_TO_KRW` | 1400 | 원가 환산 환율 |
| `MAX_IMAGE_DIMENSION` | 1536 | Gemini 전송 전 축소 상한(px) |
| `LOG_WRITE_TIMEOUT_MS` | 3000 | 로깅 쓰기 타임아웃 |

---

## 요금제 등급 (tiers.js)

사업기획서 슬라이드 15의 "제공 화질(AI 엔진)" 열을 코드가 실제로 지키게 하는 장치입니다.

| 등급 | 모델 | 해상도 | 실측 원가 |
|---|---|---|---|
| `standard` | gemini-3.1-flash-lite-image | 1K | **56.2원** |
| `premium` | gemini-3.1-flash-image | 1K | **112.4원** |
| `premium2k` | gemini-3.1-flash-image | 2K | 약 168원 |

```bash
TENANT_TIERS={"lirin":"premium","justone":"standard"}
```

**매핑에 없는 몰은 항상 `standard`로 떨어집니다.** 등급명이 오타거나 JSON이 깨져 있어도
크래시 없이 `standard`로 동작합니다 — 프리미엄이 실수로 새어나가지 않게 하는 것이 이 모듈의 핵심입니다.

> ⚠️ **왜 등급을 나눴는가**
> 프리미엄 엔진 실측 원가는 112.4원인데 BUSINESS 추가 단가는 100원입니다.
> 등급 구분 없이 프리미엄을 제공하면 **건당 12.4원 역마진**이 발생합니다.
> 프리미엄·2K는 ENTERPRISE 협의 항목으로만 판매해야 합니다.

해상도는 `imageConfig.imageSize`로 **항상 명시**합니다. 지정하지 않으면 모델 기본값에 의존하게 되고,
모델 업데이트로 기본값이 2K가 되면 원가가 소리 없이 3배가 됩니다.
`aspectRatio`는 지정하지 않습니다 — 프롬프트가 원본 비율 유지를 지시하므로 값을 강제하면 충돌합니다.

---

## 브랜드 워터마크 (watermark.js)

`mallName` 또는 `mallLogo` 를 함께 보내면 결과 이미지 우하단에 브랜드를 **굽습니다**.
CSS 오버레이는 다운로드하면 사라지므로, 저장·공유 이미지에 남기려면 서버 합성이어야 합니다.

| 입력 | 동작 |
|---|---|
| `mallLogo` (이미지 파일) | **로고 합성 — 정식 경로. 폰트와 무관하므로 항상 안전** |
| `mallName` (라틴 문자) | 텍스트 배지 합성 (로고가 없을 때의 대체 수단) |
| `mallName` (한글 등) | **워터마크 생략** + 경고 로그 |

### 고객사 로고 등록 방법

1. 몰에서 로고 이미지를 받는다 (PNG 권장, 배경 투명, 가로 500~1000px)
2. 흰색 계열 로고를 권장한다 — 합성 시 반투명 검정 플레이트 위에 얹힌다
3. `/try-on` 요청에 `mallLogo` 필드로 첨부한다

**한글 상호는 로고에 이미 글자가 이미지로 고정되어 있으므로 서버 폰트가 필요 없습니다.**
로고 뒤에는 반투명 플레이트가 깔려, 흰 티셔츠·밝은 배경 사진에서도 로고가 묻히지 않습니다.
데모용 샘플은 `public/demo/assets/mall-logo.png` 를 참고하세요.

> ⚠️ **운영 서버에 한글 폰트가 없습니다.**
> SVG 텍스트로 한글을 렌더링하면 예외 없이 두부(tofu) 박스가 찍힙니다.
> 렌더러 입장에서는 "성공"이라 try/catch 로 잡히지 않아, 실제로 "리린"이
> 네모로 출력되는 것을 확인했습니다. 그래서 라틴 문자가 아니면 아예 생략합니다.
>
> **한글 몰명은 `mallLogo` 로 로고 이미지를 보내세요.** 실제 제휴 시에도 이 경로가 맞습니다.
> 굳이 한글 텍스트를 쓰려면 배포에 폰트 파일을 포함하고 `WATERMARK_FONT_FAMILY` 를 지정해야 합니다.

워터마크는 합성 결과에 얹는 후처리라 **상품 수와 무관하며 AI 비용이 0원**입니다.

## Firestore

| 컬렉션 | 내용 |
|---|---|
| `fittingEvents` | 피팅 1건 = 1 문서. 성공·실패 모두. 토큰 사용량과 **건당 원가**를 함께 저장 |
| `conversionEvents` | 위젯 상호작용·구매 클릭 |

두 컬렉션은 `firestore.rules`(CodiPop 앱 저장소)에 없어 클라이언트 접근이 기본 차단되며,
Admin SDK만 읽고 씁니다. 룰 수정은 필요 없습니다.

### 복합 색인

```bash
firebase deploy --only firestore:indexes --project codipop-63c0d
```

`firestore.indexes.json`에 `mallId + createdAt` 색인 2개가 정의되어 있습니다.
**배포 전 반드시 `firebase firestore:indexes`로 기존 색인을 확인하세요** —
로컬 파일에 없는 색인은 삭제 대상이 됩니다.

색인 생성 후 **빌드에 몇 분 걸립니다.** 그동안 `/stats`는 실패하지만 로깅 쓰기는 정상입니다.

---

## 원가 구조

피팅 1회 실측 (2026-08-08, 인물 1 + 의류 1, 환율 1,400원/USD):

```
입력 2,638 토큰 × $0.25/1M  =  $0.0007
출력 1,316 토큰 × $30.0/1M  =  $0.0395
─────────────────────────────────────
합계                          $0.0401  ≈  56.2원
```

- **비용의 98%가 출력 이미지**입니다. 절감 레버는 해상도와 모델 등급 둘뿐이며, 입력 축소 효과는 미미합니다
- 공식 가격표만으로 계산하면 48원이 나오지만 **17% 과소평가**입니다. 문서상 1K 출력은 1,120토큰인데 실측은 1,316토큰 — 세로형 인물 사진은 출력도 세로 비율이 되어 정사각형 기준보다 토큰을 더 씁니다
- 처리 시간 약 6.7초 = 축소 0.04초 + Gemini 4.99초 + Storage 업로드 1.67초

상세 분석: `CodiPop/docs/코디팝_AI합성_원가구조_및_요금제검증.pptx`

---

## 알려진 미해결 사항

우선순위 순입니다.

1. **`/try-on`이 무인증 공개** — URL만 알면 누구나 무제한 호출 가능. 건당 56원이므로 1만 회면 56만 원. 고객사별 API 키와 서버측 쿼터 필요
2. **`STATS_TOKEN` 미설정** — `/stats`가 무인증 공개 상태. 파일럿 몰 투입 전 설정할 것
3. **결과 이미지 보관 정책 없음** — Storage에 `public: true` + 무기한 보관. 고객 얼굴이 포함된 이미지가 URL만 알면 접근 가능하며, B2B 계약 실사에서 지적될 항목. 90일 자동 삭제 + 서명 URL 전환 필요
4. **CORS 전체 허용** — `Access-Control-Allow-Origin: *`
5. **`/get-recommendation` 프롬프트 하드코딩** — 옷장 아이템과 날씨가 프롬프트에 박혀 있어 실제 사용자 데이터를 반영하지 않음
6. **`node_modules`가 git에 추적됨** — `.gitignore`에 있지만 이전에 커밋되어 5,695개 파일이 추적 중. 정리하려면 `git rm -r --cached node_modules` 필요
7. **`demo-mall` 수동 복사** — `CodiPop/demo-mall/` → `public/demo/`가 수동 동기화. 배포 스크립트화 또는 별도 정적 호스팅으로 분리 권장
8. **Render 콜드 스타트** — 무료 플랜이면 첫 요청이 수십 초. 영업 미팅 전 반드시 워밍업하거나 Starter 플랜($7/월)으로 전환할 것
