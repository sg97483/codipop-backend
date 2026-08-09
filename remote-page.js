// remote-page.js
//
// 몰 상품 페이지에서 공개 메타데이터를 읽어온다. **영업 미리보기 전용이다.**
//
// 왜 필요한가: 미팅에서 데모몰의 가짜 상품을 보여주는 것과, 사장님 몰의 실제 상품을
// 입힌 결과를 보여주는 것은 설득력이 다릅니다. 후자를 하려면 그 상품의 이름·이미지·가격이
// 필요한데, 브라우저에서 남의 사이트를 읽으면 CORS 에 막히므로 서버가 대신 읽습니다.
//
// 읽는 것은 **링크 미리보기와 같은 범위**입니다 — OG 태그와 JSON-LD 상품 정보.
// 페이지 본문을 저장하지 않고, 응답으로 돌려준 뒤 버립니다.
//
// remote-image.js 와 같은 SSRF 방어를 씁니다. 주소를 받아 서버가 요청을 보내는
// 기능은 전부 이 방어를 거쳐야 합니다.

const { assertPublicHost } = require('./remote-image.js');

const MAX_BYTES = Number(process.env.REMOTE_PAGE_MAX_BYTES) || 2 * 1024 * 1024; // 2MB
const TIMEOUT_MS = Number(process.env.REMOTE_PAGE_TIMEOUT_MS) || 8000;

function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** <meta property="og:x" content="..."> — 속성 순서가 뒤바뀐 경우도 잡는다. */
function readMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) return decodeEntities(match[1]);
  }
  return '';
}

/**
 * JSON-LD 의 Product 정보.
 * 카페24·메이크샵 계열은 대부분 이걸 넣어주므로 OG 보다 정확할 때가 많다.
 */
function readJsonLd(html) {
  const result = {};
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      continue; // 깨진 JSON-LD 는 흔하다. 조용히 넘어간다
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const type = String(node['@type'] || '');
      if (!type.toLowerCase().includes('product')) continue;
      if (node.name && !result.name) result.name = String(node.name).trim();
      if (node.image && !result.image) {
        result.image = Array.isArray(node.image) ? String(node.image[0]) : String(node.image);
      }
      const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      if (offers && offers.price && !result.price) result.price = Number(offers.price) || 0;
    }
  }
  return result;
}

/** "39,000원" → 39000 */
function parsePrice(text) {
  if (!text) return 0;
  const digits = String(text).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits.slice(0, 10), 10) : 0;
}

/**
 * 사이즈 표기 추출.
 * 국내 몰은 상품명에 `[size:F(55~66)]` 를 붙이는 경우가 많아 거기서 먼저 찾는다.
 */
function guessSizes(title, html) {
  const fromTitle = String(title || '').match(/\[?\s*size\s*[:=]\s*([^\]]+)\]/i);
  if (fromTitle) return fromTitle[1].trim();

  const free = String(title || '').match(/\b(FREE|F)\s*\(\s*\d{2,3}\s*[~\-–]\s*\d{2,3}\s*\)/i);
  if (free) return free[0].trim();

  const fromHtml = String(html || '').match(/\[?\s*size\s*[:=]\s*([^\]<]{1,30})\]/i);
  if (fromHtml) return fromHtml[1].trim();

  return '';
}

/**
 * 몰 이름.
 *
 * 미리보기 상단에 **그 몰의 이름**이 떠야 "우리 몰이네"가 됩니다.
 * 그런데 국내 몰은 `og:site_name` 을 비워두는 경우가 많아(리린이 그렇습니다)
 * 여러 단계로 추론합니다.
 *
 *   og:site_name → <title> 의 꼬리 조각("상품명 : 리린") → 호스트명
 */
function guessSiteName(html, titleTag, finalUrl) {
  const og = readMeta(html, 'og:site_name');
  if (og) return og;

  // 국내 몰 상품명에는 `[size:S,M,L]` `[LABEL]` 같은 대괄호가 흔하고 그 안에 콜론이 들어간다.
  // 먼저 걷어내지 않으면 "S,M,L][기본/숏기장]]" 같은 조각이 몰 이름으로 잡힌다.
  const title = decodeEntities(titleTag || '').replace(/\[[^\]]*\]/g, ' ');
  if (title) {
    const parts = title.split(/[|:｜>»]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const tail = parts[parts.length - 1];
      // 몰 이름은 짧고, 쉼표·괄호·숫자 나열이 없다. 아니면 상품명 조각이다.
      if (tail.length > 0 && tail.length <= 20 && !/[,\[\]\/]/.test(tail)) return tail;
    }
  }

  return finalUrl.hostname.replace(/^www\./, '');
}

/**
 * 상품 페이지 메타데이터를 읽어 위젯이 쓸 수 있는 모양으로 돌려준다.
 * 실패하면 예외를 던진다 — 영업 담당자에게 "왜 안 되는지" 를 보여줘야 한다.
 */
async function fetchProductMeta(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (error) {
    throw new Error('올바른 주소가 아닙니다.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http/https 주소만 지원합니다.');
  }

  await assertPublicHost(url.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow', // 상품 페이지는 리다이렉트가 흔하다 (모바일 전용 주소 등)
      headers: {
        'User-Agent': 'CodiPOP-Preview/1.0 (+https://codipop-backend.onrender.com)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`페이지를 열지 못했습니다 (HTTP ${response.status}).`);
    }

    // 리다이렉트를 따라간 뒤 최종 주소가 사설망일 수 있으므로 다시 확인한다.
    const finalUrl = new URL(response.url || url.href);
    await assertPublicHost(finalUrl.hostname);

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('html')) {
      throw new Error('상품 페이지 주소가 아닙니다.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('페이지가 너무 큽니다.');

    // 국내 몰은 EUC-KR 인 경우가 아직 있다. 메타에서 charset 을 보고 디코딩한다.
    const head = buffer.subarray(0, 4096).toString('latin1');
    const charsetMatch = head.match(/charset=["']?\s*([\w-]+)/i);
    const charset = (charsetMatch ? charsetMatch[1] : 'utf-8').toLowerCase();
    let html;
    try {
      html = new TextDecoder(charset === 'euc-kr' ? 'euc-kr' : charset).decode(buffer);
    } catch (error) {
      html = buffer.toString('utf8');
    }

    const jsonLd = readJsonLd(html);
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];

    const name =
      jsonLd.name || readMeta(html, 'og:title') || decodeEntities(titleTag || '') || '';
    const image = readMeta(html, 'og:image') || jsonLd.image || '';
    const price =
      jsonLd.price ||
      parsePrice(readMeta(html, 'product:price:amount')) ||
      parsePrice(readMeta(html, 'og:price:amount')) ||
      0;

    return {
      url: finalUrl.href,
      name: name.slice(0, 120),
      image: image ? new URL(image, finalUrl).href : '',
      price,
      sizes: guessSizes(name, html).slice(0, 40),
      siteName: guessSiteName(html, titleTag, finalUrl).slice(0, 40),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchProductMeta };
