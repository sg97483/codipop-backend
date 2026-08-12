// app-auth.js
//
// B2C 앱 요청의 신원 확인과 티켓 차감.
//
// **왜 API 키로는 안 되는가.**
// 앱에 심어둔 키는 바이너리에서 그대로 추출됩니다(APK 디컴파일). 위젯의 `pk_` 는
// 허용 도메인으로 보호하는데, 앱 요청에는 Origin 헤더가 없어 그 보호가 걸리지 않습니다.
// 즉 키만으로는 아무것도 막지 못합니다.
//
// 그래서 앱 요청의 보안 경계는 **Firebase ID 토큰**입니다. 남의 계정 토큰은 만들 수 없습니다.
//
// **왜 서버가 차감해야 하는가.**
// 지금 티켓은 앱의 AsyncStorage 가 사실상 원본이고, 서버는 쳐다보지도 않습니다.
// `/try-on` 을 직접 호출하면 티켓 없이 무제한이며, **건당 56.2원이 우리 카드에서 나갑니다.**

const { firestore, auth } = require('./firebase-admin.js');

// 앱의 TICKET_COST_FITTING 과 같아야 합니다. 앱만 바꾸면 서버가 더 깎거나 덜 깎습니다.
// **티켓 1장 = 피팅 1회** (2026-08-12 기획 요청으로 10장 → 1장).
const TICKET_COST_FITTING = Number(process.env.TICKET_COST_FITTING) || 1;

/** 개발용 무제한 계정. 앱의 isDevBypassUser() 와 짝입니다. */
const DEV_BYPASS_EMAILS = String(process.env.DEV_BYPASS_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * ID 토큰을 검증해 사용자를 확인합니다.
 * 토큰이 없으면 `null` — 호출부가 레거시 경로로 처리합니다(구버전 앱 호환).
 */
async function verifyAppUser(idToken) {
  const token = typeof idToken === 'string' ? idToken.trim() : '';
  if (!token) return null;

  try {
    const decoded = await auth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: (decoded.email || '').toLowerCase(),
      devBypass: DEV_BYPASS_EMAILS.includes((decoded.email || '').toLowerCase()),
    };
  } catch (error) {
    // 만료·위조 모두 여기로 옵니다. 구분해서 알려줄 이유가 없습니다.
    console.warn(`앱 토큰 검증 실패: ${error.code || error.message}`);
    return { invalid: true };
  }
}

function ticketDocRef(uid) {
  return firestore.collection('users').doc(uid);
}

/** 차감 없이 잔액만 확인합니다. **Gemini 를 부르기 전에** 씁니다. */
async function checkTickets(user) {
  if (user.devBypass) return { ok: true, balance: 9999, bypass: true };

  // 구 단위(1회=10장) 잔액이 아직 환산되지 않은 사용자가 있을 수 있습니다.
  // 앱이 처음 실행될 때 환산하므로, 서버는 잔액을 그대로 믿되 부족 판정만 합니다.
  // 환산 전 잔액은 실제보다 크므로 사용자에게 불리하지 않습니다.

  try {
    const snap = await ticketDocRef(user.uid).get();
    const balance = Number(snap.data()?.styleTickets?.balance);
    const current = Number.isFinite(balance) ? balance : 0;
    if (current < TICKET_COST_FITTING) {
      return { ok: false, code: 'INSUFFICIENT_TICKETS', balance: current, cost: TICKET_COST_FITTING };
    }
    return { ok: true, balance: current };
  } catch (error) {
    // 잔액 조회 실패로 정상 사용자를 막지는 않습니다. 대신 차감도 못 하므로 로그를 남깁니다.
    console.error(`티켓 조회 실패(통과 처리) uid=${user.uid}: ${error.message}`);
    return { ok: true, balance: null, degraded: true };
  }
}

/**
 * 합성에 성공한 뒤 차감합니다.
 *
 * 트랜잭션으로 읽고 쓰는 이유: 같은 계정이 여러 기기에서 동시에 누르면
 * 읽기-쓰기 사이에 끼어들어 한 번만 차감될 수 있습니다.
 *
 * **실패해도 이미 합성은 끝났으므로 결과는 그대로 돌려줍니다.** 여기서 에러를 던지면
 * 돈은 나갔는데 사용자는 결과를 못 받습니다.
 */
async function consumeTickets(user) {
  if (user.devBypass) return { balance: 9999, charged: 0 };

  try {
    return await firestore.runTransaction(async (tx) => {
      const ref = ticketDocRef(user.uid);
      const snap = await tx.get(ref);
      const raw = Number(snap.data()?.styleTickets?.balance);
      const current = Number.isFinite(raw) ? raw : 0;
      const next = Math.max(0, current - TICKET_COST_FITTING);

      tx.set(
        ref,
        { styleTickets: { balance: next, updatedAt: new Date() } },
        { merge: true },
      );
      return { balance: next, charged: current - next };
    });
  } catch (error) {
    console.error(`티켓 차감 실패 uid=${user.uid}: ${error.message}`);
    return { balance: null, charged: 0, failed: true };
  }
}

function describeAppAuthConfig() {
  return {
    ticketCost: TICKET_COST_FITTING,
    devBypassAccounts: DEV_BYPASS_EMAILS.length,
  };
}

module.exports = {
  verifyAppUser,
  checkTickets,
  consumeTickets,
  describeAppAuthConfig,
  TICKET_COST_FITTING,
};
