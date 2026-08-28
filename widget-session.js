// widget-session.js
//
// 위젯 세션 토큰 — **부모 페이지(몰)의 origin 을 실제로 검증하기 위한 장치.**
//
// 문제였던 것:
//   피팅 UI 는 우리 서버가 서빙하는 iframe(/widget/fitting.html) 안에 있습니다.
//   그 안에서 /try-on 을 부르면 브라우저가 붙이는 Origin 은 **우리 서버 주소**입니다.
//   몰 주소가 아닙니다. 그래서 tenant.origins 허용 목록이 아무것도 막지 못했습니다.
//
// iframe 이 부모 주소를 알려주게 하는 방법은 소용없습니다. iframe URL 의
// `?origin=` 은 **그냥 주소창의 글자**라, 남의 사이트에서 진짜 몰 주소를 적어
// 열면 그만입니다. **iframe 안에서는 부모가 누구인지 증명할 수 없습니다.**
//
// 검증이 가능한 지점은 하나뿐입니다 — **몰 페이지가 우리 서버로 직접 보내는 요청.**
// 브라우저는 교차 출처 fetch 에 Origin 헤더를 강제로 붙이고, 페이지의 자바스크립트는
// 이 값을 바꿀 수 없습니다. 그래서 codipop.js(몰 페이지에서 실행)가 /widget/session 을
// 부르는 그 순간에 딱 한 번 진짜 검사를 하고, 결과를 서명해 iframe 으로 넘깁니다.
//
// **한계를 분명히 해 둡니다.** curl 같은 비브라우저 클라이언트는 Origin 을 마음대로
// 적을 수 있어 막지 못합니다. 이 장치가 막는 것은 "페이지 소스에서 pk_ 를 긁어다
// 자기 쇼핑몰에 붙이는" 경우이며, 공개 키에 대해 현실적으로 일어나는 위협은 그것입니다.

const crypto = require('crypto');

/** 30분. 피팅 한 번 하는 동안 넉넉하되, 토큰이 유출돼도 오래 쓰이지 않을 길이. */
const TTL_MS = 30 * 60 * 1000;

// 미설정이면 부팅 때마다 새로 만듭니다. 서버가 재시작하면 그전 토큰이 무효가 되어
// **그 순간 피팅 중이던 사람이 한 번 실패**합니다. Render 는 재배포·슬립으로
// 자주 재시작하므로 운영에서는 WIDGET_SECRET 을 반드시 설정하세요.
const SECRET = process.env.WIDGET_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.WIDGET_SECRET) {
  console.warn('⚠️  WIDGET_SECRET 미설정 — 부팅마다 세션 토큰이 무효가 됩니다. 운영에서는 설정하세요.');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payload) {
  return b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
}

/** origin 검사를 통과한 몰에게 발급한다. */
function issueSession(mallId) {
  const expiresAt = Date.now() + TTL_MS;
  const payload = b64url(`${mallId}\n${expiresAt}`);
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * 토큰을 검증해 mallId 를 돌려준다. 조금이라도 이상하면 null.
 *
 * 서명 비교에 timingSafeEqual 을 쓰는 이유: 일반 비교는 앞에서부터 틀린 지점까지
 * 걸린 시간이 다릅니다. 그 차이를 재면 서명을 한 글자씩 맞춰 나갈 수 있습니다.
 */
function verifySession(token) {
  if (typeof token !== 'string' || token.length > 512) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  let decoded;
  try {
    decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) {
    return null;
  }
  const nl = decoded.indexOf('\n');
  if (nl <= 0) return null;

  const mallId = decoded.slice(0, nl);
  const expiresAt = Number(decoded.slice(nl + 1));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return { mallId, expiresAt };
}

function describeSessionConfig() {
  return { ttlMinutes: TTL_MS / 60000, secretSet: Boolean(process.env.WIDGET_SECRET) };
}

module.exports = { issueSession, verifySession, describeSessionConfig };
