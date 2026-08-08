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
| POST | `/try-on` | **가상 착장 합성** (multipart). 한도 초과 시 429 |
| POST | `/analyze-clothing` | 의류 카테고리·상품명 자동 분류 (비전) |
| POST | `/get-recommendation` | 코디 추천 (※ 프롬프트가 하드코딩되어 사실상 데모 수준) |
| POST | `/events` | 위젯 상호작용·구매 클릭 수집 |
| GET | `/my/stats` | **내 몰 리포트.** 토큰이 몰을 결정한다 (대시보드가 쓰는 경로) |
| GET | `/stats/:mallId` | 몰별 통계 (내부용·마스터 토큰) |
| GET | `/widget.js` | **임베드 위젯 로더.** 고객사가 붙이는 스크립트 한 줄 |
| GET | `/widget/config` | 위젯 부팅용 공개 정보 (`?key=pk_...`) |
| GET | `/widget/fitting.html` | 위젯이 띄우는 iframe 피팅 화면 |
| GET | `/widget/example.html` | **연동 예시 페이지 (고객사 전달용)** |
| GET | `/demo/` | 파일럿 몰 제휴용 웹 데모 |
| GET | `/app-ads.txt` | AdMob 퍼블리셔 인증 |

### POST /try-on

**필수:** `person` (이미지 1장) + 옷 이미지
옷은 파일(`clothing`, 1~2장) 또는 **URL**(`clothingUrl`, `clothingUrl2`) 중 하나로 보냅니다.
**선택:** `apiKey`, `clothing_count`, `heightCm`, `weightKg`, `usualSize`, `mallId`, `productId`, `productName`, `sessionId`, `userId`, `mallName`, `mallLogo`(파일)

> `apiKey`를 보내면 **body 의 `mallId`는 무시되고 키가 가리키는 몰로 기록**됩니다.
> 키 없이 `mallId`만 보내는 기존 경로(B2C 앱·구 데모)도 그대로 동작합니다.

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

### GET /my/stats

대시보드가 호출하는 경로입니다. **몰 ID 를 파라미터로 받지 않습니다.**

```
GET /my/stats?token=<몰의 dashboardToken>&days=30&minFittings=2
```

| 토큰 종류 | 볼 수 있는 몰 |
|---|---|
| 고객사 `dashboardToken` | **그 몰 하나뿐.** `mall` 파라미터를 넣어도 무시된다 |
| 마스터 `STATS_TOKEN` | `?mall=` 로 지정한 몰 (우리 내부 확인용) |
| 아무 토큰도 설정 안 됨 | 과도기 — 누구나 조회 가능. **실제 몰 데이터 투입 전 반드시 토큰을 설정할 것** |

화면에 몰 ID 입력칸을 두지 않는 이유가 이것입니다. 입력칸이 있으면 사장님이
남의 몰 ID 를 넣어볼 수 있고, 그 순간 사고가 됩니다. **볼 수 있는 몰은 토큰이 정합니다.**

### GET /stats/:mallId

내부용입니다. 몰별 `dashboardToken` 또는 마스터 `STATS_TOKEN` 으로 인증합니다.

```
GET /stats/demo-mall?days=30&minFittings=2&token=<토큰>
```

| 파라미터 | 기본 | 설명 |
|---|---|---|
| `days` | 30 | 조회 기간 (1~365) |
| `minFittings` | 2 | "피팅했지만 안 산 상품" 최소 표본. 파일럿 초기엔 1로 낮춰 볼 것 |
| `token` | — | 해당 몰의 `dashboardToken` 또는 `STATS_TOKEN` |

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
| `TENANTS` | 데모 1곳 | **고객사 레지스트리.** API 키·조회 토큰·등급·허용 도메인. 아래 참조 |
| `TENANT_TIERS` | `{}` | (구) 고객사별 등급 매핑. `TENANTS` 로 대체됨 — 키 없는 레거시 요청에만 적용 |
| `DEFAULT_TIER` | `standard` | 매핑에 없는 몰의 기본 등급 |
| `IMAGE_MODEL` | `gemini-3.1-flash-lite-image` | 스탠다드 등급 모델 |
| `PREMIUM_IMAGE_MODEL` | `gemini-3.1-flash-image` | 프리미엄 등급 모델 |
| `TEXT_MODEL` | `gemini-2.5-flash-lite` | 분류·추천용 텍스트 모델 |
| `STATS_TOKEN` | — | 마스터 조회 토큰. **미설정이고 몰별 토큰도 없으면 무인증 공개** |
| `USD_TO_KRW` | 1400 | 원가 환산 환율 |
| `MAX_IMAGE_DIMENSION` | 1536 | Gemini 전송 전 축소 상한(px) |
| `LOG_WRITE_TIMEOUT_MS` | 3000 | 로깅 쓰기 타임아웃 |
| `REMOTE_IMAGE_MAX_BYTES` | 12MB | 상품 이미지 URL 수신 크기 상한 |
| `REMOTE_IMAGE_TIMEOUT_MS` | 8000 | 상품 이미지 수신 타임아웃 |
| `REMOTE_IMAGE_ALLOW_PRIVATE` | `false` | **로컬 개발 전용.** 켜면 SSRF 방어가 꺼진다. 운영에 절대 설정 금지 |
| `QUOTA_HARD_CAP_MULTIPLIER` | 3 | 기본 제공량의 몇 배까지 허용할지 (안전 상한) |
| `QUOTA_IP_HOURLY_LIMIT` | 60 | IP 하나당 시간당 피팅 요청 수 |

---

## 임베드 위젯 (widget)

기획서 슬라이드 14의 **"연동이 복잡할 것 같다" 74.5%** 에 대한 답입니다.
고객사가 상품 상세 템플릿에 추가하는 코드는 이것이 전부입니다.

```html
<!-- ① 페이지 어딘가에 한 번 -->
<script src="https://codipop-backend.onrender.com/widget.js"
        data-codipop-key="pk_..." defer></script>

<!-- ② 버튼을 넣고 싶은 자리에 -->
<div data-codipop-button
     data-codipop-product="상품코드"
     data-codipop-name="상품명"
     data-codipop-price="39000"
     data-codipop-image="상품 이미지 주소"
     data-codipop-buy="구매/장바구니 주소"></div>
```

**동작하는 예시 페이지: `/widget/example.html`** — 고객사에 이 링크를 보내면 됩니다.

| 파일 | 역할 |
|---|---|
| `public/widget/codipop.js` | 로더. 버튼 주입 + iframe 오버레이 + postMessage |
| `public/widget/fitting.html` `.css` `.js` | iframe 안의 피팅 화면 |
| `public/widget/example.html` | 연동 예시 + 속성 설명 (고객사 전달용) |
| `public/widget/size-recommend.js` | 사이즈 추천 (데모와 동일 로직) |

### 설계 결정 세 가지

**1. 피팅 UI 는 iframe 안에 있다.**
임대몰(카페24·고도몰) 스킨이 어떤 CSS 를 쓰는지 우리가 알 수 없습니다. 몰 페이지에
직접 DOM 을 그리면 스킨마다 깨지고, 그 대응 비용이 곧 "연동이 복잡하다"는 인식이 됩니다.
iframe 은 CSS 가 양방향으로 격리되므로 **어느 몰에 붙여도 같은 화면**이 나옵니다.

**2. 상품 이미지는 URL 로 받아 서버가 내려받는다** (`remote-image.js`).
위젯은 몰 페이지의 이미지 *주소*만 알고 파일은 갖고 있지 않습니다. 브라우저에서 그
이미지를 읽으면 몰 CDN 의 CORS 에 막힙니다. 서버에는 CORS 가 없으므로 여기서 받습니다.
부수 효과로 **슬라이드 14의 82.1% "누끼·재촬영 부담"이 같이 풀립니다** — 몰이 이미지를
따로 준비할 필요 없이 이미 올려둔 상품 사진 주소만 있으면 됩니다.

> ⚠️ 주소를 받아 서버가 요청을 보내는 기능이므로 **SSRF 방어가 들어 있습니다.**
> 사설 대역(10.x, 192.168.x, 127.x, 169.254.169.254 메타데이터 등)과 리다이렉트,
> 이미지가 아닌 Content-Type 을 모두 차단합니다. `remote-image.js` 를 수정할 때
> 이 방어를 무력화하지 마세요 — 뚫리면 클라우드 자격증명이 노출됩니다.

**3. 구매 이동은 부모 창이 한다.**
iframe 안에서 `location` 을 바꾸면 몰 페이지는 그대로인 채 프레임만 이동해 장바구니
흐름이 깨집니다. iframe → 부모로 `postMessage({type:'buy', url})` 를 보내고,
부모가 `location.href` 를 바꿉니다. 부모는 메시지의 `origin` 을 검사합니다.

---

## 고객사 등록 (tenants.js)

키는 두 종류이며 성격이 정반대입니다. **절대 섞어 쓰지 마세요.**

| 키 | 어디에 두는가 | 비밀인가 | 할 수 있는 일 |
|---|---|---|---|
| `apiKey` (`pk_...`) | 몰 페이지 `<script>` 태그 | **아니오 — 누구나 본다** | 피팅 요청만 |
| `dashboardToken` (`sk_...`) | 사장님에게만 전달 | **예** | 그 몰의 리포트 조회 |

```bash
TENANTS={"lirin":{"name":"리린","tier":"standard","apiKey":"pk_live_a1b2","dashboardToken":"sk_live_x9y8","origins":["https://lirin.co.kr","https://*.cafe24.com"],"logo":"lirin.png"}}
```

| 필드 | 설명 |
|---|---|
| `name` | 몰 이름. 위젯 상단과 리포트 제목에 표시된다 |
| `tier` | `standard` / `premium` / `premium2k`. 생략 시 `standard` |
| `apiKey` | 공개 키. **없으면 위젯을 붙일 수 없다** |
| `dashboardToken` | 리포트 조회 토큰. 없으면 마스터 토큰으로만 조회 가능 |
| `origins` | 허용 도메인. `https://*.cafe24.com` 처럼 선두 와일드카드 지원 |
| `logo` | `public/tenant-logos/` 안의 파일명. 워터마크에 쓰인다 |

**`apiKey` 는 페이지 소스에 노출되므로 보호 수단은 `origins` 뿐입니다.** 정식 계약 몰은
반드시 채우세요. 비워 두면 통과시키는데, 파일럿 중 몰이 도메인을 바꿨다는 이유로
위젯이 통째로 죽는 것이 더 큰 사고이기 때문입니다.

JSON 이 깨지거나 등급명이 오타여도 서버는 뜹니다 — 데모 테넌트만 남고 경고를 찍습니다.
부팅 로그의 `고객사(테넌트) 설정:` 줄에서 등록 결과를 확인하세요.

> `TENANTS` 를 설정하지 않으면 데모 테넌트(`demo-mall` / `pk_demo_mall`) 하나만 활성화됩니다.
> 공개 데모가 계속 동작해야 하므로 코드에 두었으며, 스탠다드 등급이고 데모 몰 통계에만 영향을 줍니다.

---

## 호출 한도 (quota.js)

요금표(슬라이드 15)를 코드가 실제로 지키게 하는 장치입니다.

### 기본 제공량을 넘겨도 막지 않습니다

**이게 이 모듈의 가장 중요한 규칙입니다.** 추가 단가(200/150/100원)가 실측 원가
56.2원보다 훨씬 높아서 **초과 사용은 손해가 아니라 이익**입니다. 여기서 칼같이 끊으면
매출을 스스로 걷어차는 셈입니다. 그래서 한도를 두 단계로 둡니다.

| 단계 | 넘으면 |
|---|---|
| **기본 제공량** (`included`) | 계속 허용. 초과분으로 집계해 **후청구** |
| **안전 상한** (`hardCap`) | **차단** (429). 폭주·오남용으로부터 원가를 지키는 선 |

| 요금제 | 기본 제공 | 안전 상한(3배) | 추가 단가 |
|---|---|---|---|
| STARTER | 500건 | 1,500건 | 200원 |
| PRO | 2,000건 | 6,000건 | 150원 |
| BUSINESS | 5,000건 | 15,000건 | 100원 |
| ENTERPRISE | 계약값 | 계약값 | 협의 |

`TENANTS` 에서 몰별로 덮어쓸 수 있습니다 — `plan`, `includedFittings`, `hardCap`.

### IP 시간당 제한

두 번째 방어선입니다. 키 없이 호출하는 레거시 경로(B2C 앱)와, 남의 `pk_` 키를 긁어가
두드리는 경우를 막습니다. 기본 60회/시간이며, 넘으면 429 + `Retry-After` 를 반환합니다.

> 이동통신 NAT 뒤에서는 여러 사람이 같은 IP 를 씁니다. 이건 정밀한 과금 장치가 아니라
> "한 곳에서 수천 건이 쏟아지는" 상황만 잡는 안전장치이므로 넉넉하게 잡혀 있습니다.

### 카운터의 성격

메모리에 둡니다. 재시작하면 사라지지만 **매달 첫 요청에서 Firestore 실적으로 다시
채워 넣으므로** 실질적인 구멍은 없습니다. 시드 쿼리가 실패하면 0에서 시작합니다
(fail-open) — 색인이 없다는 이유로 정상 고객의 피팅을 막는 쪽이 더 나쁩니다.

**청구의 근거는 언제나 Firestore 의 `fittingEvents` 이며 이 카운터가 아닙니다.**
카운터는 한도 판정에만 씁니다.

> 시드에 `mallId + status + createdAt` 복합 색인이 필요합니다.
> `firestore.indexes.json` 에 정의되어 있으니 `firebase deploy --only firestore:indexes` 를 실행하세요.
> 색인이 없으면 매달 첫 요청에서 경고를 찍고 0부터 셉니다.

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
3. `public/tenant-logos/<파일명>.png` 로 저장하고 `TENANTS` 의 `logo` 필드에 파일명을 적는다

**임베드 위젯은 몰 페이지에 스크립트만 붙이므로 로고를 업로드할 경로가 없습니다.**
그래서 서버가 등록된 파일을 직접 읽어 씁니다. 요청에 `mallLogo` 가 함께 오면 그쪽이 우선입니다
(구 데모가 이 경로를 씁니다).

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

1. **레거시 경로가 열려 있음** — 키 없이 `mallId`만 보내는 경로를 B2C 앱이 쓰고 있어
   막지 못했습니다. 이 경로에는 몰 단위 한도가 없고 **IP 시간당 제한만** 걸립니다.
   앱을 API 키 방식으로 전환한 뒤 차단할 것
2. **토큰 미설정** — `STATS_TOKEN` 도 몰별 `dashboardToken` 도 없으면 리포트가 무인증 공개입니다.
   **실제 몰 데이터가 들어가기 전에 반드시 설정하세요**
3. **결과 이미지 보관 정책 없음** — Storage에 `public: true` + 무기한 보관. 고객 얼굴이 포함된 이미지가 URL만 알면 접근 가능하며, B2B 계약 실사에서 지적될 항목. 90일 자동 삭제 + 서명 URL 전환 필요
4. **CORS 전체 허용** — `Access-Control-Allow-Origin: *`
5. **`/get-recommendation` 프롬프트 하드코딩** — 옷장 아이템과 날씨가 프롬프트에 박혀 있어 실제 사용자 데이터를 반영하지 않음
6. **`node_modules`가 git에 추적됨** — `.gitignore`에 있지만 이전에 커밋되어 5,695개 파일이 추적 중. 정리하려면 `git rm -r --cached node_modules` 필요
7. **`demo-mall` 수동 복사** — `CodiPop/demo-mall/` → `public/demo/`가 수동 동기화. 배포 스크립트화 또는 별도 정적 호스팅으로 분리 권장
   - `size-recommend.js` 는 이제 **사본이 3개**입니다 (앱 `src/services/sizeRecommendService.ts`, `public/demo/`, `public/widget/`). 앱과 웹이 다른 사이즈를 추천하면 안 되므로 한쪽만 고치지 마세요
8. **`TENANTS` 가 환경변수** — 고객사가 늘어나면 JSON 한 줄이 감당하지 못합니다. Firestore 컬렉션 + 관리 화면으로 옮길 것. 키 회전(rotate) 수단도 아직 없습니다
9. **Render 콜드 스타트** — 무료 플랜이면 첫 요청이 수십 초. 영업 미팅 전 반드시 워밍업하거나 Starter 플랜($7/월)으로 전환할 것
