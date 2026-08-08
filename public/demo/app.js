const API_ORIGIN =
  window.location.hostname.includes("onrender.com") ||
  window.location.hostname.includes("codipop")
    ? window.location.origin
    : "https://codipop-backend.onrender.com";

const TRY_ON_API = `${API_ORIGIN}/try-on`;
const EVENTS_API = `${API_ORIGIN}/events`;

const MALL_ID = "demo-mall";
const MALL_NAME = "DEMO MALL";
// 결과 이미지에 새길 로고. 운영 서버에는 한글 폰트가 없어 텍스트 워터마크로는
// 한글 몰명이 깨지므로, 로고 이미지를 보내는 것이 정식 경로다.
// 로고는 제작 시점에 글자가 이미지로 고정되어 서버 폰트와 무관하다.
const MALL_LOGO = "./assets/mall-logo.png";

// 방문자 1명을 식별하는 값. 피팅 → 구매 클릭을 이어 붙여 전환율을 계산한다.
function getSessionId() {
  let id = sessionStorage.getItem("codipop_session");
  if (!id) {
    id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("codipop_session", id);
  }
  return id;
}

const SESSION_ID = getSessionId();

// 수집 실패가 사용자 동작을 막으면 안 되므로 전부 fire-and-forget.
function sendEvent(type, extra = {}) {
  const payload = JSON.stringify({
    type,
    mallId: MALL_ID,
    sessionId: SESSION_ID,
    ...extra,
  });
  try {
    // 페이지를 떠나는 순간(구매 클릭)에도 유실되지 않도록 sendBeacon 우선
    if (navigator.sendBeacon) {
      navigator.sendBeacon(EVENTS_API, new Blob([payload], { type: "application/json" }));
      return;
    }
  } catch (_) {
    /* sendBeacon 미지원 → fetch 로 폴백 */
  }
  fetch(EVENTS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

const PRODUCTS = [
  {
    id: "top-01",
    badge: "NEW · TOPS",
    title: "언밸런스 코튼 티셔츠",
    price: 89000,
    priceLabel: "₩89,000",
    desc: "비대칭 헴라인의 데일리 티셔츠. 상세의 착용해 보기로 내 핏을 바로 확인하세요.",
    category: "TOPS",
    productSize: "M", // 상품 표기 사이즈 — 내 추천과 비교해 보여준다
    image: "./assets/top.jpg",
    buyUrl: null,
  },
  {
    id: "bottom-01",
    badge: "BEST · BOTTOMS",
    title: "와이드 데님 팬츠",
    price: 128000,
    priceLabel: "₩128,000",
    desc: "여유 있는 실루엣의 데님. 피팅 후 바로 구매 페이지로 돌아올 수 있습니다.",
    category: "BOTTOMS",
    productSize: "L",
    image: "./assets/bottom.jpg",
    buyUrl: null,
  },
  {
    id: "outer-01",
    badge: "OUTER",
    title: "울 블렌드 코트",
    price: 249000,
    priceLabel: "₩249,000",
    desc: "시즌 아우터. 영세몰 상세에 붙는 위젯 데모용 샘플 상품입니다.",
    category: "OUTER",
    productSize: "M",
    image: "./assets/outer.jpg",
    buyUrl: null,
  },
];

// 믹스매치 규칙 — AI 호출 없이 카테고리만으로 조합을 제안한다 (추가 비용 0원).
// 기획서 슬라이드 13의 "하의를 보러 온 고객에게 상의까지 세트 판매" 시연용.
const MIX_MATCH_RULES = {
  TOPS: ["BOTTOMS", "OUTER"],
  BOTTOMS: ["TOPS", "OUTER"],
  OUTER: ["TOPS", "BOTTOMS"],
};

function getMixMatches(product) {
  const wanted = MIX_MATCH_RULES[product.category] || [];
  return wanted
    .map((cat) => PRODUCTS.find((p) => p.category === cat && p.id !== product.id))
    .filter(Boolean);
}

const SAMPLE_PERSON = "./assets/sample-person.jpg";

const state = {
  view: "home",
  productId: PRODUCTS[0].id,
  personFile: null,
  personPreviewUrl: null,
  resultUrl: null,
  elapsedTimer: null,
  fittingEventId: null,
  partnerId: null,     // 함께 피팅할 두 번째 상품
  showBefore: false,
};

// ── MY 사이즈 (브라우저에 1회 저장) ──────────────────────────
const BODY_KEY = "codipop_body_size";

function loadBodySize() {
  try {
    const raw = localStorage.getItem(BODY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return window.CodiPopSize.isValidBodySize(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveBodySize(profile) {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(profile));
  } catch (_) {
    /* 저장 실패해도 이번 세션에서는 동작한다 */
  }
}

/** 입력창에서 현재 값을 읽어 유효하면 반환한다. */
function readBodySizeInput() {
  const heightCm = Number(els.inputHeight.value);
  const weightKg = Number(els.inputWeight.value);
  const usualSize = els.inputUsualSize.value;
  const profile = { heightCm, weightKg, usualSize };
  return window.CodiPopSize.isValidBodySize(profile) ? profile : null;
}

const els = {
  views: {
    home: document.getElementById("view-home"),
    product: document.getElementById("view-product"),
    tryon: document.getElementById("view-tryon"),
    result: document.getElementById("view-result"),
  },
  grid: document.getElementById("product-grid"),
  productHero: document.getElementById("product-hero"),
  productBadge: document.getElementById("product-badge"),
  productTitle: document.getElementById("product-title"),
  productPrice: document.getElementById("product-price"),
  productDesc: document.getElementById("product-desc"),
  tryonClothing: document.getElementById("tryon-clothing"),
  tryonClothing2: document.getElementById("tryon-clothing2"),
  tryonExtra: document.getElementById("tryon-extra"),
  personPreview: document.getElementById("person-preview"),
  personInput: document.getElementById("person-input"),
  btnStartFit: document.getElementById("btn-start-fit"),
  apiEndpoint: document.getElementById("api-endpoint"),
  loadingPanel: document.getElementById("loading-panel"),
  resultPanel: document.getElementById("result-panel"),
  errorPanel: document.getElementById("error-panel"),
  errorMessage: document.getElementById("error-message"),
  resultBefore: document.getElementById("result-before"),
  resultAfter: document.getElementById("result-after"),
  elapsed: document.getElementById("elapsed"),
  inputHeight: document.getElementById("input-height"),
  inputWeight: document.getElementById("input-weight"),
  inputUsualSize: document.getElementById("input-usual-size"),
  sizeBox: document.getElementById("size-box"),
  sizeResult: document.getElementById("size-result"),
  sizeValue: document.getElementById("size-value"),
  sizeReason: document.getElementById("size-reason"),
  sizeMeta: document.getElementById("size-meta"),
  mixmatch: document.getElementById("mixmatch"),
  mixmatchList: document.getElementById("mixmatch-list"),
  btnBeforeToggle: document.getElementById("btn-before-toggle"),
};

function getProduct() {
  return PRODUCTS.find((p) => p.id === state.productId) || PRODUCTS[0];
}

function productBuyUrl(product) {
  return product.buyUrl || `#product/${product.id}`;
}

function showView(name) {
  state.view = name;
  Object.entries(els.views).forEach(([key, node]) => {
    node.classList.toggle("is-active", key === name);
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function renderHome() {
  els.grid.innerHTML = PRODUCTS.map(
    (p) => `
    <button type="button" class="product-card" data-product-id="${p.id}">
      <img src="${p.image}" alt="${p.title}" />
      <div>
        <p class="meta">${p.badge}</p>
        <h3>${p.title}</h3>
        <p class="price">${p.priceLabel}</p>
      </div>
    </button>
  `,
  ).join("");
}

function renderProduct() {
  const product = getProduct();
  els.productHero.src = product.image;
  els.productHero.alt = product.title;
  els.productBadge.textContent = product.badge;
  els.productTitle.textContent = product.title;
  els.productPrice.textContent = product.priceLabel;
  els.productDesc.textContent = product.desc;
}

function getPartner() {
  return state.partnerId ? PRODUCTS.find((p) => p.id === state.partnerId) : null;
}

function renderTryOn() {
  const product = getProduct();
  els.tryonClothing.src = product.image;
  els.tryonClothing.alt = product.title;
  els.apiEndpoint.textContent = TRY_ON_API;
  els.btnStartFit.disabled = !state.personFile;

  const partner = getPartner();
  els.tryonExtra.classList.toggle("hidden", !partner);
  if (partner) {
    els.tryonClothing2.src = partner.image;
    els.tryonClothing2.alt = partner.title;
  }

  const saved = loadBodySize();
  if (saved) {
    els.inputHeight.value = saved.heightCm;
    els.inputWeight.value = saved.weightKg;
    els.inputUsualSize.value = saved.usualSize;
  }
}

function setPersonFromFile(file, previewUrl) {
  if (state.personPreviewUrl && state.personPreviewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.personPreviewUrl);
  }
  state.personFile = file;
  state.personPreviewUrl = previewUrl;
  els.personPreview.classList.remove("empty");
  els.personPreview.innerHTML = `<img src="${previewUrl}" alt="내 사진" />`;
  els.btnStartFit.disabled = false;
}

async function urlToFile(url, filename) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("이미지를 불러오지 못했습니다.");
  }
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  return new File([blob], filename, { type });
}

function openProduct(productId) {
  state.productId = productId;
  renderProduct();
  showView("product");
  history.replaceState(null, "", `#product/${productId}`);
}

function openTryOn() {
  renderTryOn();
  showView("tryon");
  history.replaceState(null, "", `#tryon/${state.productId}`);
  sendEvent("widget_open", { productId: state.productId });
}

function goBuy() {
  const product = getProduct();
  sendEvent("buy_click", {
    productId: product.id,
    productPrice: product.price,
    fittingEventId: state.fittingEventId,
  });
  const url = productBuyUrl(product);
  if (url.startsWith("http")) {
    window.location.href = url;
    return;
  }
  openProduct(product.id);
  alert("데모: 실제 제휴 시 이 버튼이 몰 상품/장바구니 URL로 이동합니다.");
}

async function startFitting() {
  const product = getProduct();
  if (!state.personFile) {
    return;
  }

  showView("result");
  els.loadingPanel.classList.remove("hidden");
  els.resultPanel.classList.add("hidden");
  els.errorPanel.classList.add("hidden");

  const startedAt = Date.now();
  els.elapsed.textContent = "0.0초";
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
    els.elapsed.textContent = `${sec}초`;
  }, 100);

  try {
    const partner = getPartner();
    const formData = new FormData();
    formData.append("person", state.personFile, state.personFile.name || "person.jpg");

    const clothingFile = await urlToFile(product.image, `${product.id}.jpg`);
    formData.append("clothing", clothingFile, clothingFile.name);
    if (partner) {
      const partnerFile = await urlToFile(partner.image, `${partner.id}.jpg`);
      formData.append("clothing", partnerFile, partnerFile.name);
    }
    formData.append("clothing_count", partner ? "2" : "1");

    formData.append("mallId", MALL_ID);
    formData.append("mallName", MALL_NAME);
    formData.append("productId", product.id);

    // 브랜드 로고를 함께 보내면 서버가 결과 이미지에 구워 준다.
    // 로고를 불러오지 못해도 피팅은 그대로 진행한다.
    try {
      const logoFile = await urlToFile(MALL_LOGO, "mall-logo.png");
      formData.append("mallLogo", logoFile, logoFile.name);
    } catch (_) {
      /* 로고 없이 진행 — mallName 이 라틴 문자면 텍스트 배지로 대체된다 */
    }
    formData.append("sessionId", SESSION_ID);

    // MY 사이즈를 입력했으면 핏 표현에 반영시킨다
    const body = readBodySizeInput() || loadBodySize();
    if (body) {
      saveBodySize(body);
      formData.append("heightCm", String(body.heightCm));
      formData.append("weightKg", String(body.weightKg));
      formData.append("usualSize", body.usualSize);
    }

    sendEvent("fitting_start", {
      productId: product.id,
      partnerProductId: partner ? partner.id : null,
    });

    const response = await fetch(TRY_ON_API, {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => ({}));
    clearInterval(state.elapsedTimer);

    if (!response.ok || !data.success || !data.imageUrl) {
      throw new Error(data.message || `피팅 요청 실패 (${response.status})`);
    }

    state.resultUrl = data.imageUrl;
    state.fittingEventId = data.fittingEventId || null;
    els.resultBefore.src = state.personPreviewUrl;
    els.resultAfter.src = data.imageUrl;

    // 결과는 After 만 크게 보여준다 (Before 는 토글)
    state.showBefore = false;
    applyBeforeToggle();

    renderSizeRecommendation(product);
    renderMixMatch(product);

    els.loadingPanel.classList.add("hidden");
    els.resultPanel.classList.remove("hidden");
    history.replaceState(null, "", `#result/${product.id}`);
    sendEvent("result_view", {
      productId: product.id,
      fittingEventId: state.fittingEventId,
    });
  } catch (error) {
    clearInterval(state.elapsedTimer);
    els.loadingPanel.classList.add("hidden");
    els.resultPanel.classList.add("hidden");
    els.errorPanel.classList.remove("hidden");
    els.errorMessage.textContent =
      error?.message ||
      "네트워크 또는 서버 오류입니다. Render 백엔드가 깨어 있는지 확인해 주세요.";
  }
}

// ── 결과 화면 구성 ───────────────────────────────────────────

function applyBeforeToggle() {
  els.resultBefore.classList.toggle("hidden", !state.showBefore);
  els.resultAfter.classList.toggle("hidden", state.showBefore);
  els.btnBeforeToggle.textContent = state.showBefore ? "피팅 결과 보기" : "원본 보기";
}

/** 사이즈 추천 — 입력이 없으면 안내 문구로 입력을 유도한다. */
function renderSizeRecommendation(product) {
  const body = readBodySizeInput() || loadBodySize();
  if (!body) {
    els.sizeResult.classList.add("hidden");
    return;
  }

  const result = window.CodiPopSize.recommendClothingSize({
    heightCm: body.heightCm,
    weightKg: body.weightKg,
    usualSize: body.usualSize,
    category: product.category,
    productSize: product.productSize,
  });

  els.sizeValue.textContent = result.recommendedSize;
  els.sizeReason.textContent = window.CodiPopSize.formatSizeReason(result);
  els.sizeMeta.textContent =
    `${body.heightCm}cm · ${body.weightKg}kg · BMI ${result.bmi}` +
    (product.productSize ? ` · 상품 표기 ${product.productSize}` : "");
  els.sizeResult.classList.remove("hidden");
}

/** 믹스매치 업셀링 — 어울리는 상품을 제안하고 '함께 피팅'으로 연결한다. */
function renderMixMatch(product) {
  const matches = getMixMatches(product);
  if (!matches.length) {
    els.mixmatch.classList.add("hidden");
    return;
  }
  els.mixmatchList.innerHTML = matches
    .map(
      (p) => `
    <div class="mix-card">
      <img src="${p.image}" alt="${p.title}" />
      <p class="mix-title">${p.title}</p>
      <p class="mix-price">${p.priceLabel}</p>
      <button type="button" class="btn-secondary mix-btn" data-mix-id="${p.id}">
        함께 피팅
      </button>
    </div>`,
    )
    .join("");
  els.mixmatch.classList.remove("hidden");
}

/** 어울리는 상품과 함께 다시 피팅 — 백엔드가 옷 2벌 동시 착장을 지원한다. */
function startCoFitting(partnerId) {
  state.partnerId = partnerId;
  sendEvent("mixmatch_click", {
    productId: state.productId,
    partnerProductId: partnerId,
  });
  openTryOn();
}

async function saveResultImage() {
  if (!state.resultUrl) return;
  sendEvent("save_image", {
    productId: state.productId,
    fittingEventId: state.fittingEventId,
  });
  try {
    // 워터마크는 서버에서 이미지에 구워져 있으므로 그대로 내려받으면 된다
    const res = await fetch(state.resultUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codipop-${state.productId}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_) {
    // CORS 등으로 blob 다운로드가 막히면 새 탭으로 열어 저장하게 한다
    window.open(state.resultUrl, "_blank", "noopener");
  }
}

async function shareResult() {
  if (!state.resultUrl) return;
  const product = getProduct();
  sendEvent("share", {
    productId: product.id,
    fittingEventId: state.fittingEventId,
  });
  const shareData = {
    title: `${MALL_NAME} · ${product.title}`,
    text: `${product.title} 입어봤어요. 나한테 어울릴까?`,
    url: state.resultUrl,
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(state.resultUrl);
    alert("결과 이미지 주소를 복사했습니다. 카카오톡·인스타그램에 붙여넣어 보세요.");
  } catch (_) {
    /* 사용자가 공유를 취소한 경우 — 아무것도 하지 않는다 */
  }
}

function bindEvents() {
  els.grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-product-id]");
    if (!card) return;
    openProduct(card.dataset.productId);
  });

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-nav");
      if (target === "home") {
        showView("home");
        history.replaceState(null, "", "#");
      } else if (target === "product") {
        openProduct(state.productId);
      } else if (target === "tryon") {
        openTryOn();
      }
    });
  });

  document.getElementById("btn-try-on").addEventListener("click", openTryOn);
  document.getElementById("btn-buy-detail").addEventListener("click", goBuy);
  document.getElementById("btn-cart").addEventListener("click", () => {
    alert("데모: 장바구니 동작은 몰 쪽 기능입니다.");
  });
  document.getElementById("btn-buy-result").addEventListener("click", goBuy);
  document.getElementById("btn-retry").addEventListener("click", () => {
    sendEvent("retry", { productId: state.productId });
    state.partnerId = null; // 단품 피팅으로 되돌린다
    openTryOn();
  });

  els.btnBeforeToggle.addEventListener("click", () => {
    state.showBefore = !state.showBefore;
    applyBeforeToggle();
  });

  els.mixmatchList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-mix-id]");
    if (!btn) return;
    startCoFitting(btn.dataset.mixId);
  });

  document.getElementById("btn-save").addEventListener("click", saveResultImage);
  document.getElementById("btn-share").addEventListener("click", shareResult);

  // 사이즈 입력이 있으면 패널을 펼친 채로 시작한다
  if (loadBodySize()) {
    els.sizeBox.open = false;
  }
  document.getElementById("btn-start-fit").addEventListener("click", startFitting);

  els.personInput.addEventListener("change", () => {
    const file = els.personInput.files?.[0];
    if (!file) return;
    setPersonFromFile(file, URL.createObjectURL(file));
  });

  document.getElementById("btn-sample-person").addEventListener("click", async () => {
    try {
      const file = await urlToFile(SAMPLE_PERSON, "sample-person.jpg");
      setPersonFromFile(file, SAMPLE_PERSON);
    } catch (error) {
      alert(error.message || "체험용 사진을 불러오지 못했습니다.");
    }
  });
}

function bootFromHash() {
  const hash = location.hash.replace(/^#/, "");
  const [route, id] = hash.split("/");
  if ((route === "product" || route === "tryon" || route === "result") && id) {
    state.productId = id;
    renderProduct();
    if (route === "tryon") {
      openTryOn();
      return;
    }
    if (route === "result" && state.resultUrl) {
      showView("result");
      els.loadingPanel.classList.add("hidden");
      els.errorPanel.classList.add("hidden");
      els.resultPanel.classList.remove("hidden");
      return;
    }
    openProduct(id);
    return;
  }
  showView("home");
}

renderHome();
bindEvents();
bootFromHash();
