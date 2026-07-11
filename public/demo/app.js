const TRY_ON_API =
  window.location.hostname.includes("onrender.com") ||
  window.location.hostname.includes("codipop")
    ? `${window.location.origin}/try-on`
    : "https://codipop-backend.onrender.com/try-on";

const PRODUCTS = [
  {
    id: "top-01",
    badge: "NEW · TOPS",
    title: "언밸런스 코튼 티셔츠",
    price: 89000,
    priceLabel: "₩89,000",
    desc: "비대칭 헴라인의 데일리 티셔츠. 상세의 착용해 보기로 내 핏을 바로 확인하세요.",
    category: "TOPS",
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
    image: "./assets/outer.jpg",
    buyUrl: null,
  },
];

const SAMPLE_PERSON = "./assets/sample-person.jpg";

const state = {
  view: "home",
  productId: PRODUCTS[0].id,
  personFile: null,
  personPreviewUrl: null,
  resultUrl: null,
  elapsedTimer: null,
};

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

function renderTryOn() {
  const product = getProduct();
  els.tryonClothing.src = product.image;
  els.tryonClothing.alt = product.title;
  els.apiEndpoint.textContent = TRY_ON_API;
  els.btnStartFit.disabled = !state.personFile;
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
}

function goBuy() {
  const product = getProduct();
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
    const clothingFile = await urlToFile(product.image, `${product.id}.jpg`);
    const formData = new FormData();
    formData.append("person", state.personFile, state.personFile.name || "person.jpg");
    formData.append("clothing", clothingFile, clothingFile.name);
    formData.append("clothing_count", "1");
    formData.append("mallId", "demo-mall");
    formData.append("productId", product.id);

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
    els.resultBefore.src = state.personPreviewUrl;
    els.resultAfter.src = data.imageUrl;
    els.loadingPanel.classList.add("hidden");
    els.resultPanel.classList.remove("hidden");
    history.replaceState(null, "", `#result/${product.id}`);
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
  document.getElementById("btn-retry").addEventListener("click", openTryOn);
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
