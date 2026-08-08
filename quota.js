// quota.js
//
// 호출 한도. 요금표(기획서 슬라이드 15)를 코드가 실제로 지키게 한다.
//
// **핵심 설계: 기본 제공량을 넘겨도 막지 않는다.**
// 추가 단가(200/150/100원)가 실측 원가 56.2원보다 훨씬 높아서, 초과 사용은
// 손해가 아니라 이익입니다. 여기서 칼같이 끊으면 매출을 스스로 걷어차는 셈입니다.
// 그래서 한도는 두 단계로 둡니다.
//
//   기본 제공량 (included)  넘으면 → 계속 허용, 초과분으로 집계해 후청구
//   안전 상한   (hardCap)   넘으면 → 차단. 폭주·오남용으로부터 원가를 지키는 선
//
// 두 번째 방어선은 IP 시간당 제한입니다. 키 없이 호출하는 레거시 경로
// (B2C 앱)와, 남의 pk_ 키를 긁어가 두드리는 경우를 막습니다.
//
// 카운터는 메모리에 둡니다. 재시작하면 사라지지만 매달 첫 요청에서
// Firestore 실적으로 다시 채워 넣으므로 실질적인 구멍은 없습니다.
// **청구의 근거는 언제나 Firestore 의 fittingEvents 이며, 이 카운터가 아닙니다.**

const { firestore } = require('./firebase-admin.js');

const FITTING_COLLECTION = 'fittingEvents';

/**
 * 요금제. 슬라이드 15 기준.
 * `tier`(화질)와 `plan`(수량)은 다른 축이다 — 섞지 말 것.
 */
const PLANS = {
  starter: { label: 'STARTER', included: 500, overageKrw: 200 },
  pro: { label: 'PRO', included: 2000, overageKrw: 150 },
  business: { label: 'BUSINESS', included: 5000, overageKrw: 100 },
  // 협의 요금제. 제공량이 계약마다 다르므로 tenant 설정의 included 를 그대로 쓴다.
  enterprise: { label: 'ENTERPRISE', included: Infinity, overageKrw: 0 },
};

const DEFAULT_PLAN = 'starter';

// 기본 제공량의 몇 배까지 허용할지. 3배면 STARTER 가 1,500건까지 열린다
// (초과 1,000건 × 200원 = 20만원 추가 매출, 원가는 5.6만원).
const HARD_CAP_MULTIPLIER = Number(process.env.QUOTA_HARD_CAP_MULTIPLIER) || 3;

// IP 시간당 제한. 이동통신 NAT 뒤에서는 여러 사람이 같은 IP 를 쓰므로
// 정상 사용자를 끊지 않도록 넉넉하게 잡는다. 이건 정밀한 과금 장치가 아니라
// "한 곳에서 수천 건이 쏟아지는" 상황만 잡는 안전장치다.
const IP_HOURLY_LIMIT = Number(process.env.QUOTA_IP_HOURLY_LIMIT) || 60;

// --- 카운터 ---

/** mallId → { month: 'YYYY-MM', count: n, seeded: bool } */
const monthly = new Map();
/** ip → { windowStart: ms, count: n } */
const hourly = new Map();

/** 청구 기준은 한국 시간이다. UTC 로 세면 월말 하루가 밀린다. */
function currentMonthKey(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStartDate(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // KST 기준 1일 00:00 을 UTC 로 되돌린다.
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 60 * 60 * 1000);
}

function planOf(tenant) {
  const name = tenant && PLANS[tenant.plan] ? tenant.plan : DEFAULT_PLAN;
  const plan = PLANS[name];
  // 계약별 제공량이 있으면 그것이 우선 (ENTERPRISE 는 이 값이 없으면 무제한이 된다).
  const included = Number.isFinite(tenant?.includedFittings)
    ? tenant.includedFittings
    : plan.included;
  const hardCap = Number.isFinite(tenant?.hardCap)
    ? tenant.hardCap
    : Number.isFinite(included)
      ? included * HARD_CAP_MULTIPLIER
      : Infinity;
  return { name, label: plan.label, included, hardCap, overageKrw: plan.overageKrw };
}

/**
 * 이번 달 실적을 Firestore 에서 한 번 읽어 카운터를 채운다.
 *
 * 실패하면 0 에서 시작한다 (fail-open). 색인이 없다는 이유로 정상 고객의
 * 피팅을 막는 것이 한도를 조금 느슨하게 세는 것보다 나쁩니다.
 */
async function seedFromFirestore(mallId, entry) {
  try {
    const snapshot = await firestore
      .collection(FITTING_COLLECTION)
      .where('mallId', '==', mallId)
      .where('status', '==', 'success')
      .where('createdAt', '>=', monthStartDate())
      .count()
      .get();
    entry.count = snapshot.data().count || 0;
    console.log(`쿼터 시드: ${mallId} 이번 달 ${entry.count}건`);
  } catch (error) {
    console.warn(`⚠️  쿼터 시드 실패(0에서 시작): ${mallId} — ${error.message}`);
    entry.count = 0;
  }
  entry.seeded = true;
}

function getMonthlyEntry(mallId) {
  const month = currentMonthKey();
  let entry = monthly.get(mallId);
  if (!entry || entry.month !== month) {
    entry = { month, count: 0, seeded: false };
    monthly.set(mallId, entry);
  }
  return entry;
}

/** IP 시간당 제한. 창을 넘기면 리셋한다. */
function checkIpBurst(ip) {
  if (!ip) return { ok: true, count: 0 };
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let entry = hourly.get(ip);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0 };
    hourly.set(ip, entry);
  }
  if (entry.count >= IP_HOURLY_LIMIT) {
    return { ok: false, count: entry.count, retryAfterSec: Math.ceil((entry.windowStart + windowMs - now) / 1000) };
  }
  entry.count += 1;

  // 오래된 항목 정리. 요청량이 많지 않으므로 이 정도면 충분하다.
  if (hourly.size > 5000) {
    for (const [key, value] of hourly) {
      if (now - value.windowStart >= windowMs) hourly.delete(key);
    }
  }
  return { ok: true, count: entry.count };
}

/**
 * 피팅을 진행해도 되는지 판정한다. **Gemini 를 호출하기 전에** 부른다.
 * 이미 돈이 나간 뒤에 막으면 의미가 없다.
 */
async function checkQuota({ tenant, mallId, ip }) {
  const burst = checkIpBurst(ip);
  if (!burst.ok) {
    return {
      ok: false,
      code: 'IP_RATE_LIMIT',
      retryAfterSec: burst.retryAfterSec,
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    };
  }

  // 키 없는 레거시 요청(B2C 앱)은 몰 단위 한도가 없다. IP 제한만 적용된다.
  if (!mallId || mallId === 'app') return { ok: true, code: 'NO_MALL' };

  const plan = planOf(tenant);
  const entry = getMonthlyEntry(mallId);
  if (!entry.seeded) await seedFromFirestore(mallId, entry);

  if (entry.count >= plan.hardCap) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: '이번 달 이용 한도를 초과했습니다. 담당자에게 문의해 주세요.',
      usage: describeUsage(mallId, tenant),
    };
  }

  return { ok: true, code: 'OK', usage: describeUsage(mallId, tenant) };
}

/** 성공한 피팅만 센다 — 실패 건은 청구하지 않으므로 한도에서도 빼 준다. */
function recordFitting(mallId, success) {
  if (!success || !mallId || mallId === 'app') return;
  const entry = getMonthlyEntry(mallId);
  entry.count += 1;
}

/**
 * 리포트용 사용량. 카운터가 비어 있으면 Firestore 에서 채운 뒤 돌려준다.
 *
 * `describeUsage` 를 그대로 쓰면 안 되는 이유:
 * 카운터는 메모리에 있으므로 재배포 직후에는 0 이고, 시드는 `/try-on` 이
 * 들어와야 일어난다. 그 사이 사장님이 리포트를 열면 **실제로 300건을 썼는데
 * 0건으로 보입니다.** 청구 근거로 쓰는 숫자가 틀리게 보이면 신뢰를 잃는다.
 */
async function loadUsage(mallId, tenant) {
  if (!mallId || mallId === 'app') return describeUsage(mallId, tenant);
  const entry = getMonthlyEntry(mallId);
  if (!entry.seeded) await seedFromFirestore(mallId, entry);
  return describeUsage(mallId, tenant);
}

/** 리포트 화면에 그대로 올릴 수 있는 모양으로 사용량을 요약한다. */
function describeUsage(mallId, tenant) {
  const plan = planOf(tenant);
  const entry = getMonthlyEntry(mallId);
  const used = entry.count;
  const included = plan.included;
  const overage = Number.isFinite(included) ? Math.max(0, used - included) : 0;

  return {
    month: entry.month,
    plan: plan.label,
    used,
    included: Number.isFinite(included) ? included : null,
    remaining: Number.isFinite(included) ? Math.max(0, included - used) : null,
    usedPercent: Number.isFinite(included) && included > 0
      ? Number(((used / included) * 100).toFixed(1))
      : null,
    overage,
    overageKrw: overage * plan.overageKrw,
    hardCap: Number.isFinite(plan.hardCap) ? plan.hardCap : null,
    // 아직 시드 전이면 화면에서 "집계 중"으로 표시할 수 있게 알려 준다.
    seeded: entry.seeded,
  };
}

function describeQuotaConfig() {
  return {
    hardCapMultiplier: HARD_CAP_MULTIPLIER,
    ipHourlyLimit: IP_HOURLY_LIMIT,
    plans: Object.keys(PLANS),
  };
}

module.exports = {
  PLANS,
  checkQuota,
  recordFitting,
  loadUsage,
  describeUsage,
  describeQuotaConfig,
  planOf,
};
