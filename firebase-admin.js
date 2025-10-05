// firebase-admin.js

const admin = require('firebase-admin');

// ✅ 환경 변수에서 JSON 문자열을 파싱하여 사용
const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

module.exports = { firestore };