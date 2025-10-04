// firebase-admin.js

import admin from 'firebase-admin';
import serviceAccount from './serviceAccountKey.json' with { type: 'json' };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

// ✅ module.exports 대신 export를 사용합니다.
export { firestore };