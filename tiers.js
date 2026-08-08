// tiers.js
//
// 요금제별 합성 엔진 등급.
//
// 사업기획서 슬라이드 15의 "제공 화질 (AI 엔진)" 열을 코드가 실제로 지키게 한다.
// 등급을 나누지 않으면 고객사가 품질 향상을 요구할 때 프리미엄 엔진을
// 스탠다드 단가에 제공하게 되고, BUSINESS 추가 단가(100원) 기준으로
// 건당 12.4원 역마진이 발생한다. (실측 원가: 스탠다드 56.2원 / 프리미엄 112.4원)

// 해상도를 명시하지 않으면 모델 기본값에 의존하게 되고, 상위 해상도로 올라가면
// 원가가 3배 이상 뛴다. 모든 등급에서 imageSize 를 반드시 지정한다.
const TIERS = {
  standard: {
    name: 'standard',
    // 기존 IMAGE_MODEL 환경변수를 그대로 존중해 배포 시 동작이 바뀌지 않게 한다.
    model: process.env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image',
    imageSize: '1K',
    label: '스탠다드 1K',
  },
  premium: {
    name: 'premium',
    model: process.env.PREMIUM_IMAGE_MODEL || 'gemini-3.1-flash-image',
    imageSize: '1K',
    label: '프리미엄 1K',
  },
  // ENTERPRISE 협의 전용. 원가가 크게 뛰므로 기본 요금제에 노출하지 않는다.
  premium2k: {
    name: 'premium2k',
    model: process.env.PREMIUM_IMAGE_MODEL || 'gemini-3.1-flash-image',
    imageSize: '2K',
    label: '프리미엄 2K',
  },
};

const DEFAULT_TIER = TIERS[process.env.DEFAULT_TIER] ? process.env.DEFAULT_TIER : 'standard';

/**
 * 고객사(mallId) → 등급 매핑.
 * 환경변수 TENANT_TIERS 에 JSON 으로 지정한다.
 *   TENANT_TIERS={"lirin":"premium","justone":"standard"}
 * 정식 테넌트 관리 화면이 생기면 Firestore 조회로 옮길 것.
 */
function loadTenantTiers() {
  const raw = process.env.TENANT_TIERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const map = {};
    for (const [mallId, tierName] of Object.entries(parsed)) {
      if (!TIERS[tierName]) {
        console.warn(`⚠️  TENANT_TIERS: '${mallId}' 의 등급 '${tierName}' 을 알 수 없어 무시합니다.`);
        continue;
      }
      map[mallId] = tierName;
    }
    return map;
  } catch (error) {
    console.error('⚠️  TENANT_TIERS 파싱 실패, 전체 기본 등급으로 동작합니다:', error.message);
    return {};
  }
}

const TENANT_TIERS = loadTenantTiers();

/**
 * 요청의 mallId 로 등급을 결정한다.
 * 알 수 없는 몰은 항상 기본 등급(스탠다드) — 미등록 고객사에 프리미엄이
 * 새어나가지 않게 하는 것이 이 함수의 핵심 역할이다.
 */
function resolveTier(mallId) {
  const key = typeof mallId === 'string' ? mallId.trim().slice(0, 60) : '';
  const tierName = (key && TENANT_TIERS[key]) || DEFAULT_TIER;
  return TIERS[tierName] || TIERS.standard;
}

function describeTierConfig() {
  const entries = Object.entries(TENANT_TIERS);
  return {
    defaultTier: DEFAULT_TIER,
    standardModel: TIERS.standard.model,
    premiumModel: TIERS.premium.model,
    mappedTenants: entries.length,
  };
}

module.exports = { TIERS, resolveTier, describeTierConfig, DEFAULT_TIER };
