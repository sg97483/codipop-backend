// watermark.js
//
// 결과 이미지에 쇼핑몰 브랜드를 새긴다.
//
// 사업기획서 슬라이드 11의 "고객의 갤러리가 곧 자사몰 전단지" 주장은
// 워터마크가 저장된 파일에 남아야 성립한다. CSS 오버레이는 화면에서만 보이고
// 다운로드하면 사라지므로, 합성 직후 서버에서 이미지에 직접 굽는다.
//
// 슬라이드 21의 "수백 장의 옷에 전부 적용이 가능한것인지?" 질문에 대한 답:
// 워터마크는 합성 결과에 얹는 후처리라 상품 수와 무관하며 AI 비용이 발생하지 않는다.
//
// ⚠️ 폰트 제약
// 운영 서버(Render/Linux)에는 한글 폰트가 설치되어 있지 않다. SVG 텍스트로
// 한글을 렌더링하면 예외 없이 '두부(tofu)' 박스가 찍힌다 — 렌더러 입장에서는
// 성공이라 try/catch 로 걸러지지 않는다. 실제로 "리린"이 네모로 출력되는 것을
// 확인했다. 그래서 렌더링 가능 여부를 사전에 판정한다.
//
//   1순위: 로고 이미지 합성 (폰트와 무관 · 실제 제휴 시 권장 경로)
//   2순위: 라틴 문자 텍스트
//   그 외: 워터마크 생략 (깨진 글자를 내보내는 것보다 없는 편이 낫다)
//
// 한글 텍스트 워터마크가 필요하면 폰트 파일을 배포에 포함하고
// WATERMARK_FONT_FAMILY 로 패밀리명을 지정할 것.

const sharp = require('sharp');

const FONT_FAMILY = process.env.WATERMARK_FONT_FAMILY || '';

/** 폰트 지정 없이 안전하게 렌더링되는 문자만 있는가 (라틴/숫자/기본 기호). */
function isLatinSafe(text) {
  return /^[\x20-\x7E]*$/.test(text);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function layout(width, height) {
  const base = Math.min(width, height);
  return {
    base,
    fontSize: Math.max(14, Math.round(base * 0.032)),
    margin: Math.round(base * 0.035),
  };
}

/**
 * 로고 이미지를 우하단에 합성한다. 폰트와 무관하므로 항상 안전하다.
 *
 * 로고 뒤에 반투명 플레이트를 깐다. 흰 로고는 밝은 배경(흰 티셔츠·하늘)에서,
 * 검은 로고는 어두운 배경에서 사라지기 때문에, 어떤 사진·어떤 로고에서도
 * 읽히게 하려면 배경이 필요하다. 플레이트는 도형만 있어 폰트를 타지 않는다.
 */
async function compositeLogo(imageBuffer, logoBuffer, width, height) {
  const { base, margin } = layout(width, height);
  const logoW = Math.round(base * 0.2);

  const logo = await sharp(logoBuffer)
    .resize(logoW, Math.round(logoW * 0.6), { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const lw = logoMeta.width || logoW;
  const lh = logoMeta.height || Math.round(logoW * 0.4);

  const pad = Math.round(base * 0.018);
  const plateW = lw + pad * 2;
  const plateH = lh + pad * 2;
  const radius = Math.round(pad * 1.2);

  const plate = Buffer.from(
    `<svg width="${plateW}" height="${plateH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="0" y="0" width="${plateW}" height="${plateH}" rx="${radius}" ry="${radius}" ` +
      `fill="rgba(0,0,0,0.42)"/></svg>`,
  );

  const plateLeft = width - plateW - margin;
  const plateTop = height - plateH - margin;

  return sharp(imageBuffer)
    .composite([
      { input: plate, top: plateTop, left: plateLeft },
      { input: logo, top: plateTop + pad, left: plateLeft + pad },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** 라틴 텍스트 배지를 우하단에 합성한다. */
async function compositeText(imageBuffer, brand, subText, width, height) {
  const { fontSize, margin } = layout(width, height);
  const subSize = Math.max(10, Math.round(fontSize * 0.62));
  const padX = Math.round(fontSize * 0.85);
  const padY = Math.round(fontSize * 0.55);

  const family = FONT_FAMILY ? `${FONT_FAMILY}, sans-serif` : 'sans-serif';
  const textW = Math.round(brand.length * fontSize * 0.62);
  const subW = subText ? Math.round(subText.length * subSize * 0.62) : 0;
  const boxW = Math.max(textW, subW) + padX * 2;
  const boxH = subText ? fontSize + subSize + padY * 2.4 : fontSize + padY * 2;
  const radius = Math.round(fontSize * 0.45);

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${width - boxW - margin}, ${height - boxH - margin})">
    <rect x="0" y="0" width="${boxW}" height="${boxH}" rx="${radius}" ry="${radius}"
          fill="rgba(0,0,0,0.42)"/>
    <text x="${padX}" y="${padY + fontSize * 0.82}"
          font-family="${family}" font-size="${fontSize}" font-weight="700"
          fill="#FFFFFF">${escapeXml(brand)}</text>
    ${subText ? `<text x="${padX}" y="${padY + fontSize + subSize * 0.95}"
          font-family="${family}" font-size="${subSize}" font-weight="400"
          fill="rgba(255,255,255,0.82)">${escapeXml(subText)}</text>` : ''}
  </g>
</svg>`;

  return sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * 결과 이미지에 브랜드 워터마크를 합성한다.
 * 어떤 이유로든 실패하면 원본 버퍼를 그대로 돌려준다 — 워터마크 때문에
 * 피팅이 실패해선 안 된다.
 *
 * @param {Buffer} imageBuffer 합성 결과 이미지
 * @param {string} brandText   쇼핑몰 이름
 * @param {object} [opts]
 * @param {Buffer} [opts.logoBuffer] 로고 이미지 (있으면 최우선)
 * @param {string} [opts.subText]    보조 문구 (기본 'AI FITTING')
 */
async function applyBrandWatermark(imageBuffer, brandText, opts = {}) {
  const brand = (brandText || '').trim();
  const logoBuffer = opts.logoBuffer || null;
  if (!brand && !logoBuffer) {
    return imageBuffer;
  }

  try {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 1024;
    const height = meta.height || 1024;

    if (logoBuffer) {
      return await compositeLogo(imageBuffer, logoBuffer, width, height);
    }

    // 폰트가 보장되지 않는 문자는 두부 박스로 찍히므로 아예 건너뛴다.
    if (!FONT_FAMILY && !isLatinSafe(brand)) {
      console.warn(
        `워터마크 생략: "${brand}" 은 서버에 폰트가 없어 글자가 깨집니다. ` +
          '로고 이미지를 등록하거나 WATERMARK_FONT_FAMILY 를 설정하세요.',
      );
      return imageBuffer;
    }

    const rawSub = opts.subText === undefined ? 'AI FITTING' : opts.subText;
    // 보조 문구도 같은 제약을 받는다 (기존 'AI 피팅' 이 깨졌던 원인)
    const subText = !FONT_FAMILY && !isLatinSafe(rawSub) ? '' : rawSub;

    return await compositeText(imageBuffer, brand, subText, width, height);
  } catch (error) {
    console.warn('워터마크 합성 실패, 원본 이미지로 진행합니다:', error.message);
    return imageBuffer;
  }
}

module.exports = { applyBrandWatermark, isLatinSafe };
