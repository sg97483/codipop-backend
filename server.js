// server.js (CommonJS 방식으로 통일)

const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { firestore } = require('./firebase-admin.js'); // ✅ CommonJS 방식으로 import

// --- 설정 ---
const app = express();
const port = 3000;

// Google AI 설정
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });

// Firebase Storage 설정
const storage = new Storage({
  keyFilename: path.join(process.cwd(), 'serviceAccountKey.json'),
  projectId: 'codipop-63c0d', // ✅ 오타 수정 (6d -> 63)
});
const bucket = storage.bucket('codipop-63c0d.firebasestorage.app');

const upload = multer({ storage: multer.memoryStorage() });

// --- API 엔드포인트 ---
app.use(express.json()); // ✅ express.json() 미들웨어 추가

app.post('/try-on', upload.fields([{ name: 'person' }, { name: 'clothing' }]), async (req, res) => {
    // ... (기존 try-on 로직은 동일)
});

app.post('/get-recommendation', async (req, res) => {
    // ... (기존 get-recommendation 로직은 동일)
});

app.listen(port, () => {
  console.log(`CodiPOP 백엔드 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});