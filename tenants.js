// tenants.js
//
// 고객사(테넌트) 레지스트리 — 임베드 위젯과 사장님 리포트의 인증 기반.
//
// 기획서 슬라이드 14의 "연동이 복잡할 것 같다" 74.5% 에 대한 답이 "스크립트 한 줄"이려면,
// 그 한 줄이 스스로 어느 몰인지 밝혀야 한다. 그 식별자가 API 키다.
//
// 키는 두 종류이며 성격이 정반대이므로 절대 섞어 쓰지 않는다.
//
//   apiKey        (pk_...) 몰 페이지의 <script> 태그에 그대로 박힌다. **비밀이 아니다.**
//                          누구나 본다는 전제로 설계한다 — 보호 수단은 origin 허용 목록이고,
//                          이 키로는 통계를 볼 수 없다. 할 수 있는 일은 "피팅 요청"뿐이다.
//   dashboardToken (sk_...) 사장님 리포트 조회용 **비밀 키.** 프론트엔드에 넣지 않는다.
//
// 지금까지는 클라이언트가 보낸 mallId 를 그대로 믿었다. 그러면 아무나 남의 몰 이름으로
// 이벤트를 쌓아 리포트를 오염시킬 수 있다. apiKey 로 들어온 요청은 **키가 가리키는 mallId**
// 를 쓰고 body 의 mallId 는 버린다.

const { TIERS, DEFAULT_TIER, resolveTier } = require('./tiers.js');

/**
 * 데모용 기본 테넌트.
 *
 * 환경변수가 비어 있어도 공개 데모(/demo/)와 위젯 데모가 계속 동작해야 하므로 코드에 둔다.
 * 데모 키는 공개되어도 무방하다 — 스탠다드 등급이고 데모 몰 통계에만 영향을 준다.
 * **실제 제휴 몰은 반드시 TENANTS 환경변수로 등록할 것.**
 */
const DEMO_TENANT = {
  mallId: 'demo-mall',
  name: 'DEMO MALL',
  tier: 'standard',
  apiKey: 'pk_demo_mall',
  dashboardToken: '',
  origins: [], // 비어 있으면 모든 origin 허용 (데모라서 어디서든 붙여볼 수 있어야 한다)
  logo: 'demo-mall.png',
};

function safeStr(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 환경변수 TENANTS 파싱.
 *
 *   TENANTS={"lirin":{"name":"리린","tier":"standard","apiKey":"pk_live_a1b2",
 *                     "dashboardToken":"sk_live_x9y8",
 *                     "origins":["https://lirin.co.kr","https://*.cafe24.com"],
 *                     "logo":"lirin.png"}}
 *
 * 파싱에 실패해도 서버는 떠야 한다. 위젯이 죽는 것보다 데모 테넌트만 남는 편이 낫다.
 */
function loadTenants() {
  const registry = new Map();
  const byKey = new Map();

  const register = (mallId, raw) => {
    const id = safeStr(mallId, 60);
    if (!id) return;

    const tier = TIERS[raw?.tier] ? raw.tier : DEFAULT_TIER;
    if (raw?.tier && !TIERS[raw.tier]) {
      console.warn(`⚠️  TENANTS: '${id}' 의 등급 '${raw.tier}' 을 알 수 없어 ${DEFAULT_TIER} 로 처리합니다.`);
    }

    const tenant = {
      mallId: id,
      name: safeStr(raw?.name, 40) || id,
      tier,
      apiKey: safeStr(raw?.apiKey, 80),
      dashboardToken: safeStr(raw?.dashboardToken, 80),
      origins: Array.isArray(raw?.origins) ? raw.origins.map((o) => safeStr(o, 200)).filter(Boolean) : [],
      logo: safeStr(raw?.logo, 120),
    };

    registry.set(id, tenant);
    if (tenant.apiKey) {
      if (byKey.has(tenant.apiKey)) {
        console.warn(`⚠️  TENANTS: apiKey 가 '${byKey.get(tenant.apiKey).mallId}' 와 중복되어 '${id}' 를 무시합니다.`);
        return;
      }
      byKey.set(tenant.apiKey, tenant);
    } else {
      console.warn(`⚠️  TENANTS: '${id}' 에 apiKey 가 없어 위젯을 붙일 수 없습니다.`);
    }
  };

  const raw = process.env.TENANTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const [mallId, config] of Object.entries(parsed)) register(mallId, config);
    } catch (error) {
      console.error('⚠️  TENANTS 파싱 실패, 데모 테넌트만 활성화합니다:', error.message);
    }
  }

  // 데모 테넌트는 환경변수가 같은 mallId 를 정의하지 않은 경우에만 넣는다.
  if (!registry.has(DEMO_TENANT.mallId)) register(DEMO_TENANT.mallId, DEMO_TENANT);

  return { registry, byKey };
}

const { registry: TENANTS, byKey: TENANTS_BY_KEY } = loadTenants();

function getTenant(mallId) {
  return TENANTS.get(safeStr(mallId, 60)) || null;
}

function getTenantByApiKey(apiKey) {
  const key = safeStr(apiKey, 80);
  return key ? TENANTS_BY_KEY.get(key) || null : null;
}

/**
 * 조회 토큰으로 고객사를 역추적한다.
 *
 * 리포트 화면에서 "어느 몰을 볼지" 를 입력받지 않기 위한 함수다.
 * 몰 ID 입력칸이 있으면 사장님이 남의 몰 ID 를 넣어볼 수 있으므로,
 * **볼 수 있는 몰은 토큰이 정한다.**
 */
function getTenantByDashboardToken(token) {
  const value = safeStr(token, 80);
  if (!value) return null;
  for (const tenant of TENANTS.values()) {
    if (tenant.dashboardToken && tenant.dashboardToken === value) return tenant;
  }
  return null;
}

/**
 * origin 허용 여부.
 *
 * apiKey 는 페이지 소스에 노출되므로 "누가 이 키를 쓰는가"를 막을 유일한 수단이 origin 이다.
 * 다만 허용 목록이 비어 있으면 통과시킨다 — 파일럿 도중 몰이 도메인을 바꿨다는 이유로
 * 위젯이 통째로 죽는 것이 더 큰 사고이기 때문이다. 정식 계약 몰은 반드시 채울 것.
 *
 * `https://*.cafe24.com` 처럼 선두 와일드카드 서브도메인을 지원한다
 * (카페24·고도몰 등 임대몰은 고객사마다 서브도메인이 다르다).
 */
function isOriginAllowed(tenant, origin) {
  if (!tenant || !tenant.origins.length) return true;
  const value = safeStr(origin, 200);
  // 앱·서버 간 호출처럼 Origin 헤더가 없는 요청은 브라우저가 아니므로 origin 검사 대상이 아니다.
  if (!value) return true;

  return tenant.origins.some((allowed) => {
    if (allowed === '*') return true;
    if (allowed === value) return true;
    const wildcard = allowed.match(/^(https?:\/\/)\*\.(.+)$/);
    if (!wildcard) return false;
    const [, scheme, domain] = wildcard;
    return value.startsWith(scheme) && (value.endsWith(`.${domain}`) || value === `${scheme}${domain}`);
  });
}

/**
 * 요청 하나의 테넌트를 확정한다.
 *
 * 세 갈래다.
 *   1) apiKey 있음 + 유효  → 신뢰된 테넌트. body 의 mallId 는 무시한다.
 *   2) apiKey 있음 + 무효  → 거부. 오타 난 키가 조용히 'app' 통계로 섞이면 디버깅이 불가능해진다.
 *   3) apiKey 없음         → 레거시 경로. B2C 앱과 기존 데모가 여기로 온다.
 *                            등급은 tiers.js 의 TENANT_TIERS 매핑을 그대로 따른다.
 */
function resolveRequestTenant({ apiKey, mallId, origin } = {}) {
  const key = safeStr(apiKey, 80);

  if (key) {
    const tenant = getTenantByApiKey(key);
    if (!tenant) {
      return { ok: false, code: 'UNKNOWN_KEY', message: '등록되지 않은 API 키입니다.' };
    }
    if (!isOriginAllowed(tenant, origin)) {
      console.warn(`⚠️  origin 차단: ${tenant.mallId} <- ${origin}`);
      return { ok: false, code: 'ORIGIN_NOT_ALLOWED', message: '허용되지 않은 도메인입니다.' };
    }
    return {
      ok: true,
      trusted: true,
      tenant,
      mallId: tenant.mallId,
      mallName: tenant.name,
      tier: TIERS[tenant.tier] || TIERS.standard,
    };
  }

  // 레거시: 키 없이 mallId 만 오는 경로. 여기서 온 mallId 는 신뢰할 수 없다.
  const legacyMallId = safeStr(mallId, 60);
  const tenant = legacyMallId ? getTenant(legacyMallId) : null;
  return {
    ok: true,
    trusted: false,
    tenant,
    mallId: legacyMallId,
    mallName: tenant ? tenant.name : '',
    tier: tenant ? TIERS[tenant.tier] || TIERS.standard : resolveTier(legacyMallId),
  };
}

/**
 * 리포트 조회 권한.
 *
 * 우선순위가 중요하다.
 *   1) 해당 몰에 dashboardToken 이 있으면 → 그 토큰만 통과. 다른 몰 토큰으로는 열리지 않는다.
 *   2) 없으면 STATS_TOKEN(전체 마스터) 으로 판정.
 *   3) 둘 다 없으면 통과시키되 경고를 남긴다 — 현재 배포 동작을 깨지 않기 위한 임시 상태다.
 *
 * 3번이 남아 있는 한 URL 만 알면 조회가 되므로, 실제 몰 데이터가 들어가기 전에
 * 반드시 1번 또는 2번을 채워야 한다.
 */
function verifyStatsAccess(mallId, token) {
  const provided = safeStr(token, 80);
  const master = safeStr(process.env.STATS_TOKEN, 80);
  const tenant = getTenant(mallId);

  // 마스터 토큰은 어느 몰이든 열 수 있다 (우리 내부 확인용).
  if (master && provided && provided === master) return { ok: true, via: 'master' };

  if (tenant && tenant.dashboardToken) {
    return provided === tenant.dashboardToken
      ? { ok: true, via: 'tenant' }
      : { ok: false, message: '이 쇼핑몰의 조회 토큰이 아닙니다.' };
  }

  if (master) {
    return provided === master ? { ok: true, via: 'master' } : { ok: false, message: '인증이 필요합니다.' };
  }

  console.warn(`⚠️  /stats/${mallId} 가 인증 없이 조회되었습니다. STATS_TOKEN 또는 몰별 dashboardToken 을 설정하세요.`);
  return { ok: true, via: 'none' };
}

/**
 * 위젯이 부팅할 때 필요한 공개 정보만 추린다.
 * dashboardToken 은 절대 포함하지 않는다.
 */
function publicTenantInfo(tenant) {
  if (!tenant) return null;
  return {
    mallId: tenant.mallId,
    mallName: tenant.name,
    tier: tenant.tier,
    hasLogo: Boolean(tenant.logo),
  };
}

function describeTenantConfig() {
  const list = [...TENANTS.values()];
  return {
    tenants: list.length,
    withApiKey: list.filter((t) => t.apiKey).length,
    withDashboardToken: list.filter((t) => t.dashboardToken).length,
    withOriginAllowlist: list.filter((t) => t.origins.length).length,
    mallIds: list.map((t) => t.mallId),
  };
}

module.exports = {
  getTenant,
  getTenantByApiKey,
  getTenantByDashboardToken,
  isOriginAllowed,
  resolveRequestTenant,
  verifyStatsAccess,
  publicTenantInfo,
  describeTenantConfig,
};
