// firebase-admin.js

import admin from 'firebase-admin';

// ES Module 환경에서 JSON 파일을 불러오는 방법입니다.
// firebase-admin.js (수정 후)
import serviceAccount from './serviceAccountKey.json' with { type: 'json' };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// firestore 인스턴스를 초기화하고 export 합니다.
const firestore = admin.firestore();

export { firestore };