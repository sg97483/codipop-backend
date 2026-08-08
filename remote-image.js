// remote-image.js
//
// 상품 이미지 URL 을 서버가 직접 받아온다.
//
// 왜 브라우저가 아니라 서버인가:
// 임베드 위젯은 몰 페이지의 상품 이미지 주소만 알 뿐 파일을 갖고 있지 않다.
// 브라우저에서 그 이미지를 fetch 하면 대부분의 몰 CDN 이 CORS 로 막는다
// (카페24·고도몰 이미지 서버는 Access-Control-Allow-Origin 을 주지 않는다).
// 서버에는 CORS 가 없으므로 여기서 받아오는 것이 유일하게 동작하는 경로다.
//
// 부수 효과로 기획서 슬라이드 14의 82.1% "누끼·재촬영 부담"도 같이 풀린다.
// 몰이 이미지를 따로 준비할 필요 없이 이미 올려둔 상품 사진 주소만 있으면 된다.
//
// **주소를 받아 서버가 요청을 보내는 기능이므로 SSRF 방어가 필수다.**
// 사내망 주소(169.254.169.254 메타데이터, 10.x, 192.168.x 등)를 그대로 열면
// 클라우드 자격증명이 노출된다.

const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = Number(process.env.REMOTE_IMAGE_MAX_BYTES) || 12 * 1024 * 1024; // 12MB
const TIMEOUT_MS = Number(process.env.REMOTE_IMAGE_TIMEOUT_MS) || 8000;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** 사설·예약 대역인지 판정한다. */
function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // 클라우드 메타데이터
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // 멀티캐스트 / 예약
    return false;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // 판정 불가면 막는다
}

// 로컬 개발에서만 사설 주소를 허용한다 (localhost 로 띄운 예제 페이지 테스트용).
// 운영 환경에 이 값을 켜면 SSRF 방어가 통째로 사라지므로 절대 설정하지 말 것.
const ALLOW_PRIVATE = process.env.REMOTE_IMAGE_ALLOW_PRIVATE === 'true';
if (ALLOW_PRIVATE) {
  console.warn('⚠️  REMOTE_IMAGE_ALLOW_PRIVATE=true — 사설 주소 차단이 꺼져 있습니다. 로컬 개발에서만 사용하세요.');
}

async function assertPublicHost(hostname) {
  if (ALLOW_PRIVATE) return;

  // 호스트명이 이미 IP 인 경우
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('사설 주소는 허용되지 않습니다.');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error('주소를 확인할 수 없습니다.');
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error('사설 주소는 허용되지 않습니다.');
  }
}

/**
 * 이미지 URL 을 받아 multer 파일과 같은 모양의 객체로 돌려준다.
 * 실패하면 예외를 던진다 — 호출부가 "이미지를 못 가져왔다"를 사용자에게 알려야 한다.
 */
async function fetchRemoteImage(rawUrl, fieldname = 'clothing') {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (error) {
    throw new Error('올바른 이미지 주소가 아닙니다.');
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
      // 리다이렉트를 따라가면 사설망으로 우회될 수 있으므로 직접 막는다.
      redirect: 'manual',
      headers: {
        // 일부 몰 CDN 은 UA 없는 요청을 차단한다.
        'User-Agent': 'CodiPOP-Widget/1.0 (+https://codipop-backend.onrender.com)',
        Accept: 'image/*',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error('리다이렉트되는 주소는 지원하지 않습니다. 최종 이미지 주소를 넣어 주세요.');
    }
    if (!response.ok) {
      throw new Error(`이미지를 가져오지 못했습니다 (HTTP ${response.status}).`);
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !ALLOWED_TYPES.includes(contentType)) {
      throw new Error(`이미지 파일이 아닙니다 (${contentType}).`);
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new Error('이미지가 너무 큽니다.');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    // Content-Length 를 안 주는 서버가 있으므로 실제 크기도 확인한다.
    if (buffer.length > MAX_BYTES) throw new Error('이미지가 너무 큽니다.');
    if (!buffer.length) throw new Error('빈 이미지입니다.');

    return {
      fieldname,
      originalname: url.pathname.split('/').pop() || 'clothing.jpg',
      mimetype: contentType || 'image/jpeg',
      buffer,
      size: buffer.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchRemoteImage, isPrivateAddress };
