// product-size.js
//
// 상품이 실제로 파는 사이즈를 해석한다.
//
// **왜 필요한가.** 우리는 XS~XXL 로만 답하는데, 국내 여성 쇼핑몰은 대부분 다르다.
// 실제 파일럿 후보 몰의 표기를 그대로 옮기면 이렇다.
//
//   리린      [size:F(55~66)]        ← 프리 사이즈. 55~66 이 입을 수 있다는 뜻
//   저스트원  FREE / FREE,L / S,M,L  ← 프리 단독, 프리+L 혼합, 알파벳 옵션
//
// 이 상태에서 "L 사이즈를 추천합니다"라고 말하면, **애초에 L 이 없는 상품**이다.
// 사장님 앞에서 바로 들통나고, 우리가 차별점이라고 내세운 기능이 오작동으로 보인다.
//
// 그래서 규칙은 하나다.
//
//   **상품이 팔지 않는 사이즈는 절대 추천하지 않는다.**
//
// BMI 보정 규칙(size-recommend.js)은 앱과 공유하므로 건드리지 않는다.
// 이 파일은 그 결과를 **상품이 파는 사이즈에 맞춰 번역하는 층**이다.

(function (global) {
  'use strict';

  // 국내 여성복 호수 ↔ 알파벳. 44=XS 부터 한 칸씩 올라간다.
  const KR_TO_ALPHA = { 44: 'XS', 55: 'S', 66: 'M', 77: 'L', 88: 'XL', 99: 'XXL' };
  const ALPHA_TO_KR = { XS: 44, S: 55, M: 66, L: 77, XL: 88, XXL: 99 };
  const ALPHA_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXL+'];

  const FREE_TOKENS = ['F', 'FREE', 'ONE', 'ONESIZE', 'ONE SIZE', '프리', '프리사이즈'];

  function alphaIndex(size) {
    return ALPHA_ORDER.indexOf(size);
  }

  /** 55 → 'S', 'S' → 'S'. 모르면 null. */
  function toAlpha(token) {
    if (!token) return null;
    const raw = String(token).trim().toUpperCase().replace(/\s+/g, '');
    if (ALPHA_ORDER.includes(raw)) return raw;
    if (raw === 'XXXL' || raw === 'XXL+') return 'XXL+';
    const num = parseInt(raw, 10);
    return KR_TO_ALPHA[num] || null;
  }

  /** 'M' → '66'. 국내 몰 표기로 되돌려 준다 (없으면 알파벳 그대로). */
  function toKorean(alpha) {
    return ALPHA_TO_KR[alpha] ? String(ALPHA_TO_KR[alpha]) : alpha;
  }

  function isFreeToken(token) {
    const raw = String(token).trim().toUpperCase().replace(/\s+/g, '');
    return FREE_TOKENS.some((f) => f.replace(/\s+/g, '') === raw);
  }

  /**
   * 상품 사이즈 표기를 구조로 바꾼다.
   *
   *   'F(55~66)'   → { free: true,  range: ['S','M'], raw: 'F(55~66)' }
   *   'FREE'       → { free: true,  range: null }
   *   'S,M,L'      → { free: false, options: ['S','M','L'] }
   *   'FREE,L'     → { free: true,  options: ['L'] }        (프리 + 별도 옵션)
   *   '66'         → { free: false, options: ['M'] }
   *   ''           → null
   */
  function parseProductSize(text) {
    if (!text) return null;
    const raw = String(text).trim();
    if (!raw) return null;

    // `[size:F(55~66)]` 같은 껍데기에서 알맹이만 꺼낸다.
    const inner = raw.replace(/^\[?\s*size\s*[:=]?\s*/i, '').replace(/\]$/, '').trim();

    // 괄호 안의 범위를 먼저 회수한다 — 토큰 분리 전에 빼야 '55~66'이 쪼개지지 않는다.
    let range = null;
    const rangeMatch = inner.match(/(\d{2,3})\s*[~\-–]\s*(\d{2,3})/);
    if (rangeMatch) {
      const from = toAlpha(rangeMatch[1]);
      const to = toAlpha(rangeMatch[2]);
      if (from && to) range = [from, to];
    }

    const body = inner.replace(/\([^)]*\)/g, ' ');
    const tokens = body.split(/[,/|·]/).map((t) => t.trim()).filter(Boolean);

    let free = false;
    const options = [];
    for (const token of tokens) {
      if (isFreeToken(token)) {
        free = true;
        continue;
      }
      const alpha = toAlpha(token);
      if (alpha && !options.includes(alpha)) options.push(alpha);
    }

    // 괄호 밖에 아무 토큰도 없고 범위만 있으면 프리로 본다 ('(55~66)' 단독 표기)
    if (!free && !options.length && range) free = true;
    if (!free && !options.length) return null;

    options.sort((a, b) => alphaIndex(a) - alphaIndex(b));
    return { free, range, options, raw };
  }

  /**
   * 추천 사이즈를 **상품이 실제로 파는 사이즈**에 맞춰 번역한다.
   *
   * @param recommendedSize size-recommend.js 가 낸 알파벳 사이즈
   * @param productSizeText 상품 표기 원문
   * @returns null 이면 상품 표기를 해석하지 못한 것 — 기존 문구를 그대로 쓰면 된다
   */
  function describeForProduct(recommendedSize, productSizeText) {
    const offering = parseProductSize(productSizeText);
    if (!offering || !recommendedSize) return null;

    const myIndex = alphaIndex(recommendedSize);
    const kr = toKorean(recommendedSize);

    // 숫자 뒤 조사는 읽는 법에 따라 달라진다 ('55라' / '66이라').
    // 문장에서 조사를 아예 빼고 괄호와 '입니다'로만 쓴다 — 어떤 숫자에도 안전하다.

    // ── 프리 사이즈 단독 ─────────────────────────────
    if (offering.free && !offering.options.length) {
      if (!offering.range) {
        return {
          badge: 'FREE',
          headline: '프리 사이즈 상품입니다',
          detail: `고객님 추천 사이즈는 ${recommendedSize}(${kr}) 기준입니다. 상품 실측을 함께 확인해 보세요.`,
          fit: 'unknown',
          offered: 'FREE',
        };
      }

      const [from, to] = offering.range;
      const span = `${toKorean(from)}~${toKorean(to)}`;

      if (myIndex > alphaIndex(to)) {
        return {
          badge: 'FREE',
          headline: '타이트할 수 있습니다',
          detail: `프리 사이즈 기준이 ${span}인데 고객님 추천은 ${kr} 입니다. 여유 있는 핏을 원하시면 상품 실측을 확인해 주세요.`,
          fit: 'tight',
          offered: `FREE (${span})`,
        };
      }
      if (myIndex < alphaIndex(from)) {
        return {
          badge: 'FREE',
          headline: '여유 있게 맞습니다',
          detail: `프리 사이즈 기준이 ${span}이라 고객님 추천 ${kr} 기준으로는 넉넉하게 떨어집니다.`,
          fit: 'loose',
          offered: `FREE (${span})`,
        };
      }
      return {
        badge: 'FREE',
        headline: '잘 맞는 사이즈입니다',
        detail: `프리 사이즈 기준이 ${span}이고 고객님 추천은 ${kr} 입니다. 범위 안에 들어옵니다.`,
        fit: 'fits',
        offered: `FREE (${span})`,
      };
    }

    // ── 옵션이 있는 상품 (S,M,L / FREE,L / 66 등) ────
    const options = offering.options;
    if (options.length) {
      // 파는 것 중 추천에 가장 가까운 것을 고른다. **없는 사이즈는 절대 말하지 않는다.**
      let best = options[0];
      let bestGap = Math.abs(alphaIndex(best) - myIndex);
      for (const option of options) {
        const gap = Math.abs(alphaIndex(option) - myIndex);
        if (gap < bestGap) {
          best = option;
          bestGap = gap;
        }
      }
      const bestKr = toKorean(best);
      // 프리도 함께 파는 상품이면 목록에 넣는다. 빼면 "L만 나와요" 같은 거짓말이 된다.
      const labels = options.map((o) => `${o}(${toKorean(o)})`);
      const list = (offering.free ? ['FREE'].concat(labels) : labels).join(' · ');

      if (bestGap === 0) {
        return {
          badge: best,
          headline: `${bestKr} 사이즈를 추천합니다`,
          detail: `판매 사이즈는 ${list} 입니다. 이 중 고객님 체형에 맞습니다.`,
          fit: 'fits',
          offered: list,
        };
      }

      const goesUp = alphaIndex(best) > myIndex;
      const freeNote = offering.free
        ? ' 프리 사이즈도 함께 판매하니 실측을 비교해 보세요.'
        : '';
      return {
        badge: best,
        headline: `${bestKr} 사이즈를 추천합니다`,
        detail:
          `고객님 추천은 ${kr} 기준인데 이 상품의 판매 사이즈는 ${list} 입니다. ` +
          `그중 가장 가까운 ${goesUp ? '큰' : '작은'} 사이즈를 골랐습니다.${freeNote}`,
        fit: goesUp ? 'loose' : 'tight',
        offered: list,
      };
    }

    return null;
  }

  global.CodiPopProductSize = {
    parseProductSize,
    describeForProduct,
    toAlpha,
    toKorean,
    KR_TO_ALPHA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
