// firebase-admin.js

const admin = require('firebase-admin');

// ✅ Secret File의 경로에서 직접 파일을 읽어옵니다.
const serviceAccount = require('/etc/secrets/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

module.exports = { firestore };