// firebase-admin.js

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ✅ 환경 변수에서 JSON 문자열을 파싱하여 사용 (Render 서버용)
let serviceAccount;
if (process.env.GOOGLE_CREDENTIALS) {
  serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS);
} else {
  // 로컬 개발용 - serviceAccountKey.json 파일 사용
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require('./serviceAccountKey.json');
  } else {
    console.warn('⚠️  serviceAccountKey.json 파일이 없습니다. Firebase 기능이 제한될 수 있습니다.');
    // 기본 Firebase 앱 초기화 (환경 변수 사용)
    try {
      admin.initializeApp({
        projectId: 'codipop-6d2c0d' // 프로젝트 ID 명시적 설정
      });
    } catch (error) {
      console.error('Firebase 초기화 실패:', error.message);
    }
    const firestore = admin.firestore();
    module.exports = { firestore };
    return;
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'codipop-6d2c0d' // Firebase 프로젝트 ID 명시적 설정
});

const firestore = admin.firestore();

module.exports = { firestore };