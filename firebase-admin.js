// firebase-admin.js

const admin = require('firebase-admin');

// ✅ serviceAccountKey.json 파일을 직접 읽는 대신, 환경 변수에서 읽어옵니다.
const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

module.exports = { firestore };