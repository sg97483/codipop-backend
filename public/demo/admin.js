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
  form: document.getElementById("filters"),
  mall: document.getElementById("f-mall"),
  days: document.getElementById("f-days"),
  min: document.getElementById("f-min"),
  token: document.getElementById("f-token"),
  btn: document.getElementById("btn-load"),
  status: document.getElementById("status"),
  report: document.getElementById("report"),
  raw: document.getElementById("raw"),
  footMeta: document.getElementById("foot-meta"),
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
      name: p.productId,
      value: p.count,
      valueLabel: `${num(p.count)}회`,
    })),
    { fillClass: "bar-fitted", emptyText: "아직 피팅 데이터가 없습니다." },
  );

  // ⑤ 피팅했지만 사지 않은 상품 — 미구매율 순
  renderBars(
    document.getElementById("chart-missed"),
    stats.fittedButNotBought.map((p) => ({
      name: p.productId,
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
        `<tr><td>${i + 1}</td><td>${escapeHtml(p.productId)}</td><td class="num">${num(p.count)}</td></tr>`,
    ),
    "아직 구매 클릭이 없습니다.",
  );

  // ⑥ 업셀링
  document.getElementById("u-total").textContent = num(stats.upsell.multiItemFittings);
  renderTable(
    "t-upsell",
    stats.upsell.topCombos.map(
      (p) => `<tr><td>${escapeHtml(p.productId)}</td><td class="num">${num(p.count)}</td></tr>`,
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

function tierLabel(tier) {
  return { standard: "스탠다드 1K", premium: "프리미엄 1K", premium2k: "프리미엄 2K" }[tier] || tier || "미분류";
}

async function load(event) {
  if (event) event.preventDefault();
  const mallId = els.mall.value.trim();
  if (!mallId) {
    setStatus("쇼핑몰 ID를 입력해 주세요.", true);
    return;
  }

  els.btn.disabled = true;
  setStatus("조회 중…");

  const params = new URLSearchParams({
    days: els.days.value,
    minFittings: els.min.value,
  });
  if (els.token.value.trim()) params.set("token", els.token.value.trim());

  try {
    const res = await fetch(`${API_ORIGIN}/stats/${encodeURIComponent(mallId)}?${params}`);
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      throw new Error("조회 토큰이 필요하거나 올바르지 않습니다.");
    }
    if (!res.ok || !data.success) {
      throw new Error(data.message || `조회 실패 (${res.status})`);
    }

    render(data.stats);
    els.report.classList.remove("hidden");
    setStatus(
      data.stats.fitting.total === 0
        ? "해당 기간에 데이터가 없습니다. 기간을 늘리거나 쇼핑몰 ID를 확인해 주세요."
        : `${mallId} · 최근 ${els.days.value}일 기준으로 불러왔습니다.`,
    );
  } catch (error) {
    setStatus(error.message || "조회 중 오류가 발생했습니다.", true);
  } finally {
    els.btn.disabled = false;
  }
}

els.form.addEventListener("submit", load);

// URL 로 몰을 지정할 수 있게 한다 (?mall=lirin&days=7)
const q = new URLSearchParams(location.search);
if (q.get("mall")) els.mall.value = q.get("mall");
if (q.get("days")) els.days.value = q.get("days");
if (q.get("mall")) load();
