// admin.js
//
// 몰 사장님용 백오피스 리포트. GET /stats/:mallId 하나만 호출한다.
//
// 사업기획서 슬라이드 21에서 사장님이 직접 요구한 5개 항목을 그대로 화면에 올린다.
//   · AI 피팅 횟수 (전체 / 1인당 평균)
//   · AI 피팅 후 판매로 연결 (횟수 / 금액)
//   · 가장 많이 입어본 옷
//   · AI 피팅 후 구매 순위
//   · 업셀링 데이터
// 이 5개는 요청이 아니라 구매 조건이다.

const API_ORIGIN =
  window.location.hostname.includes("onrender.com") ||
  window.location.hostname.includes("codipop")
    ? window.location.origin
    : "https://codipop-backend.onrender.com";

const els = {
  signin: document.getElementById("signin"),
  form: document.getElementById("filters"),
  days: document.getElementById("f-days"),
  min: document.getElementById("f-min"),
  token: document.getElementById("f-token"),
  remember: document.getElementById("f-remember"),
  btn: document.getElementById("btn-load"),
  signout: document.getElementById("btn-signout"),
  status: document.getElementById("status"),
  sub: document.getElementById("admin-sub"),
  report: document.getElementById("report"),
  raw: document.getElementById("raw"),
  footMeta: document.getElementById("foot-meta"),
};

// 조회 토큰 보관 위치는 사장님이 정한다.
//   기본     탭을 닫으면 사라짐 (sessionStorage) — 매장 공용 PC 대비
//   기억 체크 브라우저에 남음 (localStorage) — 본인 사무실 PC 용
const TOKEN_KEY = "codipop_stats_token";

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
};

const writeToken = (value, remember) => {
  try {
    // 어느 쪽에 남아 있든 먼저 지운다. 안 그러면 '기억 해제'가 동작하지 않는다.
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (!value) return;
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
  } catch (e) { /* 저장 실패해도 이번 조회는 된다 */ }
};

const num = (n) => Number(n || 0).toLocaleString("ko-KR");
const won = (n) => `₩${num(Math.round(n || 0))}`;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("error", isError);
}

/**
 * 가로 막대 렌더링.
 * 단일 계열이므로 범례가 필요 없고 (제목이 계열을 지칭한다), 값은 막대 옆에
 * 직접 라벨로 붙여 색만으로 의미가 전달되지 않게 한다.
 */
function renderBars(node, rows, opts) {
  if (!rows.length) {
    node.innerHTML = `<p class="empty">${opts.emptyText}</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  node.innerHTML = rows
    .map((r) => {
      const pct = Math.max(2, (r.value / max) * 100);
      return `
      <div class="bar-row">
        <span class="bar-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <div class="bar-track" role="img"
             aria-label="${escapeHtml(r.name)}: ${escapeHtml(r.valueLabel)}">
          <div class="bar-fill ${opts.fillClass}" style="width:${pct}%"></div>
        </div>
        <span class="bar-value">${escapeHtml(r.valueLabel)}${
          r.subLabel ? `<small>${escapeHtml(r.subLabel)}</small>` : ""
        }</span>
      </div>`;
    })
    .join("");
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderTable(id, rows, emptyText) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!rows.length) {
    const cols = document.querySelectorAll(`#${id} thead th`).length;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">${emptyText}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.join("");
}

/**
 * 이번 달 사용량.
 *
 * 기본 제공량을 넘겨도 **막히지 않는다**는 점을 화면에서 분명히 한다 —
 * 사장님이 "한도 초과=서비스 중단"으로 오해하면 이벤트 기간에 위젯을 내려버린다.
 * 초과분은 차단이 아니라 후청구다.
 */
function renderUsage(usage) {
  const card = document.getElementById("usage-card");
  if (!usage) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  document.getElementById("usage-plan").textContent =
    `${usage.plan} 요금제 · ${usage.month}`;
  document.getElementById("usage-used").textContent = `${num(usage.used)}회`;
  document.getElementById("usage-of").textContent = usage.included
    ? `기본 제공 ${num(usage.included)}회 중`
    : "제공량 협의";

  const pct = usage.usedPercent === null ? 0 : Math.min(100, usage.usedPercent);
  const fill = document.getElementById("usage-fill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("over", usage.overage > 0);
  document
    .getElementById("usage-bar-wrap")
    .setAttribute(
      "aria-label",
      usage.included
        ? `기본 제공 ${usage.included}회 중 ${usage.used}회 사용 (${pct}%)`
        : `${usage.used}회 사용`,
    );

  let note;
  if (usage.overage > 0) {
    note =
      `기본 제공량을 ${num(usage.overage)}회 초과했습니다. ` +
      `서비스는 계속 이용하실 수 있으며, 초과분 ${won(usage.overageKrw)}이 다음 청구서에 반영됩니다.`;
  } else if (usage.included) {
    note = `남은 기본 제공량 ${num(usage.remaining)}회. 초과해도 중단되지 않으며 초과분만 후청구됩니다.`;
  } else {
    note = "제공량이 계약으로 정해진 요금제입니다.";
  }
  if (!usage.seeded) note += " (집계 준비 중이라 실제보다 적게 보일 수 있습니다)";
  document.getElementById("usage-note").textContent = note;
}

function render(stats) {
  // ① AI 피팅 횟수
  document.getElementById("k-fittings").textContent = num(stats.fitting.success);
  document.getElementById("k-fittings-meta").textContent =
    `전체 ${num(stats.fitting.total)}회 · 실패 ${num(stats.fitting.failed)}회 · 평균 ${
      (stats.fitting.avgElapsedMs / 1000).toFixed(1)
    }초`;

  document.getElementById("k-avg").textContent = `${stats.fitting.avgPerSession}회`;
  document.getElementById("k-avg-meta").textContent =
    `방문자 ${num(stats.fitting.uniqueSessions)}명 기준`;

  // ② 피팅 후 판매 연결
  document.getElementById("k-buy").textContent = num(stats.conversion.buyClicks);
  document.getElementById("k-buy-meta").textContent =
    stats.conversion.estimatedRevenue
      ? `추정 매출 ${won(stats.conversion.estimatedRevenue)}`
      : "상품가가 전달된 클릭만 매출로 집계";

  document.getElementById("k-rate").textContent = `${stats.conversion.rate}%`;
  document.getElementById("k-rate-meta").textContent =
    `성공 피팅 ${num(stats.fitting.success)}회 중 ${num(stats.conversion.buyClicks)}회`;

  // ③ 가장 많이 입어본 옷
  renderBars(
    document.getElementById("chart-fitted"),
    stats.topFittedProducts.map((p) => ({
      name: productLabel(p),
      value: p.count,
      valueLabel: `${num(p.count)}회`,
    })),
    { fillClass: "bar-fitted", emptyText: "아직 피팅 데이터가 없습니다." },
  );

  // ⑤ 피팅했지만 사지 않은 상품 — 미구매율 순
  renderBars(
    document.getElementById("chart-missed"),
    stats.fittedButNotBought.map((p) => ({
      name: productLabel(p),
      value: p.missRate,
      valueLabel: `${p.missRate}%`,
      subLabel: `${num(p.fitted)}회 중 ${num(p.missed)}회 미구매`,
    })),
    {
      fillClass: "bar-missed",
      emptyText: `${stats.fittedButNotBoughtMinFittings}회 이상 피팅된 미구매 상품이 없습니다.`,
    },
  );

  // ④ 피팅 후 구매 순위
  renderTable(
    "t-bought",
    stats.topBoughtProducts.map(
      (p, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(productLabel(p))}</td><td class="num">${num(p.count)}</td></tr>`,
    ),
    "아직 구매 클릭이 없습니다.",
  );

  // ⑥ 업셀링
  document.getElementById("u-total").textContent = num(stats.upsell.multiItemFittings);
  renderTable(
    "t-upsell",
    stats.upsell.topCombos.map(
      (p) => `<tr><td>${escapeHtml(productLabel(p))}</td><td class="num">${num(p.count)}</td></tr>`,
    ),
    "아직 세트 피팅이 없습니다.",
  );

  // 청구 근거
  const tiers = stats.billing.byTier || [];
  renderTable(
    "t-billing",
    tiers.map(
      (t) =>
        `<tr><td>${escapeHtml(tierLabel(t.tier))}</td><td class="num">${num(t.count)}</td><td class="num">${won(t.costKrw)}</td></tr>`,
    ),
    "과금 대상 피팅이 없습니다.",
  );
  document.querySelector("#t-billing tfoot").innerHTML = tiers.length
    ? `<tr><td>합계</td><td class="num">${num(stats.billing.billableFittings)}</td><td class="num">${won(
        stats.billing.estimatedCostKrw,
      )}</td></tr>`
    : "";
  document.getElementById("billing-note").textContent =
    `추정 원가는 실제 토큰 사용량 × 모델 단가로 산출하며, 환율 ${num(
      stats.billing.usdToKrw,
    )}원/USD 를 적용했습니다. 청구 금액이 아니라 원가 참고치입니다.`;

  els.raw.textContent = JSON.stringify(stats, null, 2);
  els.footMeta.textContent =
    `${stats.mallId} · 최근 ${stats.periodDays}일 · ${new Date(stats.since).toLocaleDateString("ko-KR")} 이후`;
}

/**
 * 표시용 상품 이름.
 * 위젯이 상품명을 보내주면 그것을 쓰고, 없으면 상품 코드로 떨어진다.
 * 사장님에게 `top-01` 만 보여주면 리포트를 읽을 수 없다.
 */
function productLabel(row) {
  return row.productName || row.productId;
}

function tierLabel(tier) {
  return { standard: "스탠다드 1K", premium: "프리미엄 1K", premium2k: "프리미엄 2K" }[tier] || tier || "미분류";
}

function showSignedIn(signedIn) {
  els.signin.classList.toggle("hidden", signedIn);
  els.form.classList.toggle("hidden", !signedIn);
  if (!signedIn) els.report.classList.add("hidden");
}

async function load(event) {
  if (event) event.preventDefault();

  els.btn.disabled = true;
  setStatus("조회 중…");

  const params = new URLSearchParams({
    days: els.days.value,
    minFittings: els.min.value,
  });
  const token = readToken();
  if (token) params.set("token", token);
  // mall 파라미터는 마스터 토큰으로 들어온 경우에만 서버가 인정한다.
  // 고객사 토큰으로는 무시되므로 남의 몰이 열리지 않는다.
  if (MASTER_MALL) params.set("mall", MASTER_MALL);

  try {
    const res = await fetch(`${API_ORIGIN}/my/stats?${params}`);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      // 토큰을 넣은 적이 없는데 401 이면 "틀렸다"가 아니라 "필요하다"이다.
      // 첫 방문자에게 빨간 오류를 보여줄 이유가 없다.
      const hadToken = Boolean(token);
      writeToken("", false);
      showSignedIn(false);
      throw new Error(
        hadToken
          ? "조회 토큰이 올바르지 않습니다. 다시 입력해 주세요."
          : "조회 토큰을 입력해 주세요.",
      );
    }
    if (!res.ok || !data.success) {
      throw new Error(data.message || `조회 실패 (${res.status})`);
    }

    showSignedIn(true);
    renderUsage(data.usage);
    render(data.stats);
    els.report.classList.remove("hidden");
    if (data.mallName) {
      els.sub.innerHTML = `<strong>${escapeHtml(data.mallName)}</strong> 리포트`;
    }
    setStatus(
      data.stats.fitting.total === 0
        ? "해당 기간에 데이터가 없습니다. 기간을 늘려 보세요."
        : `최근 ${els.days.value}일 기준으로 불러왔습니다.`,
    );
  } catch (error) {
    setStatus(error.message || "조회 중 오류가 발생했습니다.", true);
  } finally {
    els.btn.disabled = false;
  }
}

els.form.addEventListener("submit", load);

els.signin.addEventListener("submit", (event) => {
  event.preventDefault();
  writeToken(els.token.value.trim(), els.remember.checked);
  els.token.value = "";
  load();
});

els.signout.addEventListener("click", () => {
  writeToken("", false);
  showSignedIn(false);
  setStatus("로그아웃되었습니다. 조회 토큰을 입력해 주세요.");
});

// ?mall= 은 우리 내부 확인용이다. 마스터 토큰이 아니면 서버가 무시한다.
const q = new URLSearchParams(location.search);
const MASTER_MALL = q.get("mall") || "";
if (q.get("days")) els.days.value = q.get("days");

// 일단 열어 본다.
//
// 서버가 인증을 요구하지 않는 상태(파일럿 전 데모 기간)면 그대로 리포트가 뜨고,
// 요구하는 상태면 401 이 오면서 토큰 입력 화면으로 넘어간다.
// **인증이 필요 없는데도 로그인 화면을 먼저 보여주는 것은 불필요한 마찰이다.**
showSignedIn(Boolean(readToken()));
load();
