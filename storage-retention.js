// storage-retention.js
//
// 결과 이미지 보관 정책.
//
// 문제: 합성 결과는 Storage 에 `public: true` 로 무기한 보관됩니다.
// 고객의 **얼굴과 체형이 담긴 사진**이 URL 만 알면 영원히 열립니다.
// 파일럿 몰에 실제 소비자가 들어오는 순간 이건 우리 문제가 아니라
// 그 몰의 개인정보 처리 문제가 되고, B2B 계약 실사에서 가장 먼저 지적됩니다.
//
// **다만 전부 지우면 안 됩니다.** B2C 앱은 합성 결과를 `users/{uid}/recentResults`
// 에 저장하고 '최근 코디' 화면에서 계속 보여줍니다. 같은 규칙을 걸면 앱 사용자의
// 기록이 통째로 깨진 이미지가 됩니다.
//
// 그래서 저장 경로를 나눕니다.
//
//   results/          B2C 앱 결과 — 사용자가 자기 기록으로 보관한다. 자동 삭제 대상 아님
//   results/widget/   위젯(쇼핑몰) 결과 — 계정도 기록도 없는 익명 소비자. 삭제 대상
//
// 위젯 결과는 리포트에 쓰이지도 않습니다 (리포트는 Firestore 메타데이터만 씁니다).
// 이미지가 살아 있어야 하는 기간은 "소비자가 저장·공유하는 동안"이 전부입니다.

const crypto = require('crypto');

const APP_PREFIX = 'results/';
const WIDGET_PREFIX = 'results/widget/';

// 미설정이면 **버킷을 건드리지 않습니다.** 삭제 정책이 실수로 켜지는 것보다
// 안 켜지는 편이 안전하므로 명시적 opt-in 으로 둡니다.
const RETENTION_DAYS = Number(process.env.STORAGE_LIFECYCLE_DAYS) || 0;

/**
 * 이 요청의 결과를 저장할 경로. mallId 가 있으면 위젯 경로다.
 *
 * 파일명에 난수를 붙이는 이유: 예전에는 `results/<밀리초>_result.jpeg` 였는데,
 * 이러면 타임스탬프를 훑어 **남의 피팅 결과를 열 수 있습니다.** 이미지가
 * 공개 URL 이라 주소를 모르는 것이 유일한 보호막이므로 주소를 추측 불가능하게 만듭니다.
 */
function resultPath(mallId) {
  const prefix = mallId && mallId !== 'app' ? WIDGET_PREFIX : APP_PREFIX;
  const token = crypto.randomBytes(9).toString('hex'); // 72비트
  return `${prefix}${Date.now()}_${token}_result.jpeg`;
}

/**
 * 버킷에 수명주기 규칙을 적용한다.
 *
 * 같은 규칙을 반복 적용해도 결과가 같으므로(멱등) 부팅 때마다 불러도 됩니다.
 * **접두어를 반드시 지정합니다.** 접두어 없는 규칙은 버킷 전체를 지우며,
 * 이 버킷에는 앱 사용자의 옷장 이미지도 들어 있습니다.
 */
// 마지막 적용 결과. 헬스체크가 읽어 배포 상태를 확인할 수 있게 남긴다
// (Render 로그를 열지 않고도 정책이 걸렸는지 알기 위해).
let lastResult = { applied: false, reason: 'PENDING' };

/**
 * 헬스체크용 요약.
 * 원인 메시지는 서버 경로 같은 내부 정보를 담으므로 **로그에만** 남기고
 * 공개 응답에는 코드만 내보낸다. 상세는 Render 로그에서 본다.
 */
function retentionStatus() {
  return {
    applied: lastResult.applied,
    reason: lastResult.reason || null,
    days: RETENTION_DAYS || null,
  };
}

async function applyRetentionPolicy(bucket) {
  if (!RETENTION_DAYS) {
    console.log('결과 이미지 보관 정책: 미설정 (STORAGE_LIFECYCLE_DAYS 로 일수를 지정하세요)');
    lastResult = { applied: false, reason: 'DISABLED' };
    return lastResult;
  }

  const rule = {
    action: { type: 'Delete' },
    condition: {
      age: RETENTION_DAYS,
      matchesPrefix: [WIDGET_PREFIX],
    },
  };

  try {
    const [metadata] = await bucket.getMetadata();
    const existing = (metadata.lifecycle && metadata.lifecycle.rule) || [];

    // 우리 규칙이 아닌 것은 그대로 둔다 — 콘솔에서 누가 설정해 둔 것을 지우면 안 된다.
    const others = existing.filter(
      (r) => !(r.condition && (r.condition.matchesPrefix || []).includes(WIDGET_PREFIX)),
    );

    await bucket.setMetadata({ lifecycle: { rule: [...others, rule] } });
    console.log(
      `결과 이미지 보관 정책 적용: ${WIDGET_PREFIX} ${RETENTION_DAYS}일 후 삭제 ` +
        `(기존 규칙 ${others.length}건 유지, 앱 결과 ${APP_PREFIX} 는 대상 아님)`,
    );
    lastResult = { applied: true, keptOtherRules: others.length };
    return lastResult;
  } catch (error) {
    // 정책 적용 실패가 서비스를 막으면 안 된다. 권한 문제면 로그로만 알린다.
    console.error(`⚠️  보관 정책 적용 실패: ${error.message}`);
    lastResult = { applied: false, reason: 'ERROR', message: error.message };
    return lastResult;
  }
}

module.exports = {
  resultPath,
  applyRetentionPolicy,
  retentionStatus,
  RETENTION_DAYS,
  APP_PREFIX,
  WIDGET_PREFIX,
};
