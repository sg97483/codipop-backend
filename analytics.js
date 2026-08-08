// analytics.js
//
// 피팅 이벤트 로깅 및 집계.
//
// 목적 3가지:
//   1. 파일럿 리포트 근거 (피팅 횟수 / 구매 전환율)
//   2. MD 대시보드 원천 데이터 (인기 상품 / 피팅했지만 안 산 상품 / 업셀링 조합)
//   3. 건수 기반 요금제의 청구 근거 (몰별 월 사용량)
//
// 로깅은 절대 본 요청을 실패시키지 않는다. 모든 함수가 내부에서 에러를 삼킨다.

const { firestore } = require('./firebase-admin.js');

const FITTING_COLLECTION = 'fittingEvents';
const CONVERSION_COLLECTION = 'conversionEvents';

// 모델별 토큰 단가 (USD / 1M tokens)
// 출처: https://ai.google.dev/gemini-api/docs/pricing (2026-08 확인)
const MODEL_PRICING = {
  'gemini-3.1-flash-lite-image': { inputPerM: 0.25, outputPerM: 30.0 },
  'gemini-3.1-flash-image': { inputPerM: 0.5, outputPerM: 60.0 },
  'gemini-2.5-flash-image': { inputPerM: 0.3, outputPerM: 30.0 },
  'gemini-2.5-flash-lite': { inputPerM: 0.1, outputPerM: 0.4 },
};

const USD_TO_KRW = Number(process.env.USD_TO_KRW) || 1400;

// Firestore 가 응답하지 않을 때 /try-on 응답이 함께 지연되는 것을 막는다.
// 초과하면 null 을 반환하고, 실제 쓰기는 백그라운드에서 계속 진행된다.
const WRITE_TIMEOUT_MS = Number(process.env.LOG_WRITE_TIMEOUT_MS) || 3000;

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(null);
    }, ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

// 허용하는 전환 이벤트 타입 (임의 문자열이 쌓이는 것을 방지)
const CONVERSION_TYPES = new Set([
  'widget_open', // 상세페이지에서 '착용해 보기' 클릭
  'fitting_start', // 피팅 시작 버튼
  'result_view', // 결과 화면 도달
  'buy_click', // '이 상품 구매하기' 클릭  ← 전환율의 분자
  'retry', // 다른 사진으로 다시 피팅
  'save_image', // 결과 이미지 저장
  'share', // SNS 공유
  'mixmatch_click', // 어울리는 상품 '함께 피팅' 클릭 ← 업셀링 지표
]);

/**
 * 외부에서 들어온 문자열을 Firestore 에 넣기 안전한 형태로 정리.
 * mallId / productId 는 클라이언트가 보내는 값이라 길이를 제한한다.
 */
function safeStr(value, maxLen = 120) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.slice(0, maxLen);
}

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * 토큰 사용량 기반 원가 추정.
 * 이미지 출력은 candidatesTokenCount 에 이미지 토큰(1K 기준 약 1,120)이 잡힌다.
 */
function estimateCost(model, promptTokens, outputTokens) {
  const price = MODEL_PRICING[model];
  if (!price || promptTokens === null || outputTokens === null) {
    return { usd: null, krw: null };
  }
  const usd =
    (promptTokens / 1e6) * price.inputPerM + (outputTokens / 1e6) * price.outputPerM;
  return {
    usd: Number(usd.toFixed(6)),
    krw: Number((usd * USD_TO_KRW).toFixed(2)),
  };
}

/**
 * 요청 본문에서 호출 주체를 식별한다.
 * - 쇼핑몰 위젯: mallId 를 보냄 (demo-mall/app.js 가 이미 전송 중)
 * - B2C 앱: mallId 없음 → 'app'
 */
function resolveSource(body) {
  const mallId = safeStr(body?.mallId, 60);
  if (mallId) {
    return { mallId, source: mallId === 'demo-mall' ? 'demo' : 'widget' };
  }
  return { mallId: 'app', source: 'app' };
}

/**
 * 피팅 1건을 기록한다. 성공/실패 모두 남긴다.
 * await 하지 말 것 — 호출부 응답 지연을 만들지 않는다.
 */
function logFittingEvent(payload) {
  const { mallId, source } = resolveSource(payload.body);
  const promptTokens = safeInt(payload.usage?.promptTokenCount);
  const outputTokens = safeInt(payload.usage?.candidatesTokenCount);
  const cost = estimateCost(payload.model, promptTokens, outputTokens);

  const doc = {
    // 누가 / 어디서
    mallId,
    source,
    productId: safeStr(payload.body?.productId, 120),
    // 상품명. 리포트에 `top-01` 대신 사람이 읽는 이름이 나오게 하려면 이 값이 필요하다.
    // 위젯이 몰 페이지에서 직접 읽어 보내주므로 상품 API 연동이 없어도 채워진다.
    productName: safeStr(payload.body?.productName, 120),
    sessionId: safeStr(payload.body?.sessionId, 80),
    userId: safeStr(payload.body?.userId, 80),

    // 무엇을
    clothingCount: safeInt(payload.clothingCount) ?? 0,
    hasBodySize: Boolean(payload.hasBodySize),

    // 결과
    status: payload.status, // 'success' | 'failed'
    errorMessage: payload.status === 'failed' ? safeStr(payload.errorMessage, 300) : null,
    resultImageUrl: safeStr(payload.resultImageUrl, 500),

    // 비용 / 성능
    model: safeStr(payload.model, 80),
    tier: safeStr(payload.tier, 40),           // standard | premium | premium2k
    imageSize: safeStr(payload.imageSize, 10), // 1K | 2K | 4K
    promptTokens,
    outputTokens,
    totalTokens: safeInt(payload.usage?.totalTokenCount),
    estimatedCostUsd: cost.usd,
    estimatedCostKrw: cost.krw,
    geminiMs: safeInt(payload.geminiMs),
    elapsedMs: safeInt(payload.elapsedMs),

    createdAt: new Date(),
  };

  const write = firestore
    .collection(FITTING_COLLECTION)
    .add(doc)
    .then((ref) => {
      console.log(
        `[${payload.requestId}] 피팅 이벤트 기록 (${ref.id}) mall=${mallId} product=${doc.productId || '-'} ` +
          `status=${doc.status} cost=${doc.estimatedCostKrw ?? '?'}원`,
      );
      return ref.id;
    })
    .catch((error) => {
      // 로깅 실패가 서비스에 영향을 주면 안 된다.
      console.error(`[${payload.requestId}] 피팅 이벤트 기록 실패:`, error.message);
      return null;
    });

  return withTimeout(write, WRITE_TIMEOUT_MS, () => {
    console.warn(
      `[${payload.requestId}] 피팅 이벤트 기록이 ${WRITE_TIMEOUT_MS}ms 를 초과해 응답을 먼저 반환합니다 (쓰기는 계속 진행).`,
    );
  });
}

/**
 * 위젯 상호작용 / 구매 클릭 기록.
 * 피팅 이벤트와 sessionId + productId 로 이어 붙여 전환율을 계산한다.
 */
function logConversionEvent(body) {
  const type = safeStr(body?.type, 40);
  if (!type || !CONVERSION_TYPES.has(type)) {
    return Promise.resolve({ ok: false, reason: 'INVALID_TYPE' });
  }

  const { mallId, source } = resolveSource(body);
  const doc = {
    type,
    mallId,
    source,
    productId: safeStr(body?.productId, 120),
    productName: safeStr(body?.productName, 120),
    sessionId: safeStr(body?.sessionId, 80),
    fittingEventId: safeStr(body?.fittingEventId, 80),
    // 구매 클릭일 때만 의미가 있는 값 (몰이 알려주면 매출 추정에 사용)
    productPrice: safeInt(body?.productPrice),
    createdAt: new Date(),
  };

  return firestore
    .collection(CONVERSION_COLLECTION)
    .add(doc)
    .then(() => ({ ok: true }))
    .catch((error) => {
      console.error('전환 이벤트 기록 실패:', error.message);
      return { ok: false, reason: 'WRITE_FAILED' };
    });
}

/**
 * 몰별 집계. 슬라이드 21에서 사장님이 요구한 5개 항목을 그대로 반환한다.
 *   · AI 피팅 횟수 (전체 / 1인당 평균)
 *   · AI 피팅 후 판매로 연결 (횟수 / 금액)
 *   · 가장 많이 입어본 옷
 *   · AI 피팅 후 구매 순위
 *   · 업셀링 데이터 (함께 피팅된 조합)
 *
 * 파일럿 규모(월 수천 건)에서는 전량 조회 후 메모리 집계로 충분하다.
 * 건수가 커지면 일 단위 롤업 컬렉션으로 옮길 것.
 */
async function getMallStats(mallId, days = 30, minFittings = 2) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [fittingSnap, conversionSnap] = await Promise.all([
    firestore
      .collection(FITTING_COLLECTION)
      .where('mallId', '==', mallId)
      .where('createdAt', '>=', since)
      .get(),
    firestore
      .collection(CONVERSION_COLLECTION)
      .where('mallId', '==', mallId)
      .where('createdAt', '>=', since)
      .get(),
  ]);

  const fittings = fittingSnap.docs.map((d) => d.data());
  const conversions = conversionSnap.docs.map((d) => d.data());

  const success = fittings.filter((f) => f.status === 'success');
  const buyClicks = conversions.filter((c) => c.type === 'buy_click');

  // 1인당 평균 — sessionId 를 방문자 대용으로 사용
  const sessions = new Set(success.map((f) => f.sessionId).filter(Boolean));
  const sessionCount = sessions.size;

  // 상품 ID → 이름. 리포트에 `top-01` 이 아니라 실제 상품명이 나오게 한다.
  // 이름은 나중에 바뀔 수 있으므로 가장 최근에 기록된 값을 쓴다.
  const nameByProduct = new Map();
  for (const row of [...fittings, ...conversions]) {
    if (row.productId && row.productName) nameByProduct.set(row.productId, row.productName);
  }
  const labelOf = (productId) => nameByProduct.get(productId) || '';

  // 상품별 피팅 횟수
  const fittedByProduct = new Map();
  for (const f of success) {
    if (!f.productId) continue;
    fittedByProduct.set(f.productId, (fittedByProduct.get(f.productId) || 0) + 1);
  }

  // 상품별 구매 클릭 횟수
  const boughtByProduct = new Map();
  let estimatedRevenue = 0;
  for (const c of buyClicks) {
    if (c.productId) {
      boughtByProduct.set(c.productId, (boughtByProduct.get(c.productId) || 0) + 1);
    }
    if (Number.isFinite(c.productPrice)) estimatedRevenue += c.productPrice;
  }

  const topN = (map, n = 10) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  // ★ 피팅했지만 사지 않은 상품 — 경쟁사가 줄 수 없는 데이터
  //
  // 절대 건수(missed)로 정렬하면 인기 상품이 상위를 차지한다.
  // 5회 피팅 중 2회 구매(전환 40%)인 상품보다 3회 피팅 중 0회 구매(전환 0%)인 상품이
  // MD 입장에서 훨씬 중요한 신호이므로, 미구매율을 1순위 정렬 기준으로 삼는다.
  // 1~2회짜리 표본은 미구매율이 쉽게 100%가 되므로 minFittings 로 걸러낸다.
  const fittedNotBought = [...fittedByProduct.entries()]
    .map(([productId, fitted]) => {
      const bought = boughtByProduct.get(productId) || 0;
      const missed = fitted - bought;
      return {
        productId,
        productName: labelOf(productId),
        fitted,
        bought,
        missed,
        missRate: Number(((missed / fitted) * 100).toFixed(1)),
      };
    })
    .filter((row) => row.missed > 0 && row.fitted >= minFittings)
    .sort((a, b) => b.missRate - a.missRate || b.missed - a.missed)
    .slice(0, 10);

  // 업셀링 — 한 번에 2개 이상 착장한 경우를 조합으로 집계
  const comboCount = new Map();
  for (const f of success) {
    if ((f.clothingCount || 0) >= 2 && f.productId) {
      comboCount.set(f.productId, (comboCount.get(f.productId) || 0) + 1);
    }
  }

  const totalCostKrw = success.reduce((sum, f) => sum + (f.estimatedCostKrw || 0), 0);
  const avgElapsed = success.length
    ? Math.round(success.reduce((s, f) => s + (f.elapsedMs || 0), 0) / success.length)
    : 0;

  return {
    mallId,
    periodDays: days,
    since: since.toISOString(),

    // ① AI 피팅 횟수
    fitting: {
      total: fittings.length,
      success: success.length,
      failed: fittings.length - success.length,
      uniqueSessions: sessionCount,
      avgPerSession: sessionCount ? Number((success.length / sessionCount).toFixed(1)) : 0,
      avgElapsedMs: avgElapsed,
    },

    // ② 피팅 후 판매로 연결
    conversion: {
      buyClicks: buyClicks.length,
      rate: success.length
        ? Number(((buyClicks.length / success.length) * 100).toFixed(1))
        : 0,
      estimatedRevenue,
    },

    // ③ 가장 많이 입어본 옷 / ④ 피팅 후 구매 순위
    topFittedProducts: topN(fittedByProduct).map(([productId, count]) => ({
      productId,
      productName: labelOf(productId),
      count,
    })),
    topBoughtProducts: topN(boughtByProduct).map(([productId, count]) => ({
      productId,
      productName: labelOf(productId),
      count,
    })),
    fittedButNotBought: fittedNotBought,
    fittedButNotBoughtMinFittings: minFittings,

    // ⑤ 업셀링 (2개 이상 동시 착장)
    upsell: {
      multiItemFittings: [...comboCount.values()].reduce((a, b) => a + b, 0),
      topCombos: topN(comboCount).map(([productId, count]) => ({
        productId,
        productName: labelOf(productId),
        count,
      })),
    },

    // 과금 / 원가 근거
    billing: {
      billableFittings: success.length,
      estimatedCostKrw: Number(totalCostKrw.toFixed(0)),
      usdToKrw: USD_TO_KRW,
      // 등급별 분리 — 청구서에 스탠다드/프리미엄을 나눠 적기 위한 근거
      byTier: [...success.reduce((m, f) => {
        const key = f.tier || 'unknown';
        const cur = m.get(key) || { tier: key, count: 0, costKrw: 0 };
        cur.count += 1;
        cur.costKrw += f.estimatedCostKrw || 0;
        return m.set(key, cur);
      }, new Map()).values()].map((r) => ({
        ...r,
        costKrw: Number(r.costKrw.toFixed(0)),
      })),
    },
  };
}

module.exports = {
  logFittingEvent,
  logConversionEvent,
  getMallStats,
  estimateCost,
  MODEL_PRICING,
  CONVERSION_TYPES,
  FITTING_COLLECTION,
  CONVERSION_COLLECTION,
};
