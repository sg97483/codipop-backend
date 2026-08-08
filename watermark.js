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

const sharp = require('sharp');

/** SVG 텍스트에 넣기 전 XML 특수문자를 이스케이프한다. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 결과 이미지 우하단에 브랜드 워터마크를 합성한다.
 * 실패하면 원본 버퍼를 그대로 돌려준다 — 워터마크 때문에 피팅이 실패해선 안 된다.
 *
 * @param {Buffer} imageBuffer 합성 결과 이미지
 * @param {string} brandText   쇼핑몰 이름
 * @param {object} [opts]
 * @param {string} [opts.subText] 보조 문구 (기본 'AI 피팅')
 */
async function applyBrandWatermark(imageBuffer, brandText, opts = {}) {
  const brand = (brandText || '').trim();
  if (!brand) {
    return imageBuffer;
  }

  try {
    const meta = await sharp(imageBuffer).metadata();
    const width = meta.width || 1024;
    const height = meta.height || 1024;

    // 이미지 크기에 비례시켜 어떤 해상도에서도 같은 비중으로 보이게 한다.
    const base = Math.min(width, height);
    const fontSize = Math.max(14, Math.round(base * 0.032));
    const subSize = Math.max(10, Math.round(fontSize * 0.62));
    const padX = Math.round(fontSize * 0.85);
    const padY = Math.round(fontSize * 0.55);
    const margin = Math.round(base * 0.035);

    const sub = opts.subText === undefined ? 'AI 피팅' : opts.subText;
    // 한글 폭을 넉넉히 잡는다 (정확한 텍스트 측정은 불가)
    const textW = Math.round(brand.length * fontSize * 0.98);
    const subW = sub ? Math.round(sub.length * subSize * 0.98) : 0;
    const boxW = Math.max(textW, subW) + padX * 2;
    const boxH = (sub ? fontSize + subSize + padY * 2.4 : fontSize + padY * 2);
    const radius = Math.round(fontSize * 0.45);

    const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(${width - boxW - margin}, ${height - boxH - margin})">
    <rect x="0" y="0" width="${boxW}" height="${boxH}" rx="${radius}" ry="${radius}"
          fill="rgba(0,0,0,0.42)"/>
    <text x="${padX}" y="${padY + fontSize * 0.82}"
          font-family="sans-serif" font-size="${fontSize}" font-weight="700"
          fill="#FFFFFF">${escapeXml(brand)}</text>
    ${sub ? `<text x="${padX}" y="${padY + fontSize + subSize * 0.95}"
          font-family="sans-serif" font-size="${subSize}" font-weight="400"
          fill="rgba(255,255,255,0.82)">${escapeXml(sub)}</text>` : ''}
  </g>
</svg>`;

    return await sharp(imageBuffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch (error) {
    // 서버에 한글 폰트가 없거나 SVG 렌더링에 실패할 수 있다. 원본으로 진행한다.
    console.warn('워터마크 합성 실패, 원본 이미지로 진행합니다:', error.message);
    return imageBuffer;
  }
}

module.exports = { applyBrandWatermark };
