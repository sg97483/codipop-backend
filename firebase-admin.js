// firebase-admin.js

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // ✅ CommonJS 방식으로 JSON 파일 불러오기

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// firestore 인스턴스를 초기화하고 export 합니다.
const firestore = admin.firestore();

module.exports = { firestore }; // ✅ CommonJS 방식으로 export