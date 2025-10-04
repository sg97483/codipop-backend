 // server.js (최종 수정 버전)

 import express from 'express';
 import multer from 'multer';
 import { GoogleGenerativeAI } from '@google/generative-ai';
 import { Storage } from '@google-cloud/storage';
 import path from 'path';
 import { firestore } from './firebase-admin.js';
 
 // --- 설정 ---
 const app = express();
 const port = 3000;
 
 // Google AI 설정
 const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 // ✅ [수정] 모델 이름을 스크린샷에 나온 정확한 ID로 변경
 const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });
 
 // Firebase Storage 설정
 const storage = new Storage({
   keyFilename: path.join(process.cwd(), 'serviceAccountKey.json'),
   projectId: 'codipop-6d2c0d',
 });
 const bucket = storage.bucket('codipop-63c0d.firebasestorage.app');
 
 const upload = multer({ storage: multer.memoryStorage() });
 
 // --- API 엔드포인트 ---
 app.post('/try-on', upload.fields([{ name: 'person' }, { name: 'clothing' }]), async (req, res) => {
   console.log('이미지 처리 요청 받음 (gemini-2.5-flash-image-preview 사용)...');
 
   try {
     if (!req.files.person || !req.files.clothing) {
       return res.status(400).json({ success: false, message: '이미지 파일이 모두 필요합니다.' });
     }
 
     const personFile = req.files.person[0];
     const clothingFile = req.files.clothing[0];
 
     const imageParts = [
       { inlineData: { data: personFile.buffer.toString('base64'), mimeType: personFile.mimetype } },
       { inlineData: { data: clothingFile.buffer.toString('base64'), mimeType: clothingFile.mimetype } },
     ];
 
     const prompt = `
       You are an expert virtual try-on AI.
       Using the first image of the person and the second image of the clothing, generate a new image where the person is wearing the clothing.
       Maintain the person's original face, hair, and body shape. The clothing should fit naturally.
       Preserve the background of the first image.
       The output must be only the resulting image.
     `;
 
     const result = await model.generateContent([prompt, ...imageParts]);
     const response = result.response;
     
     console.log('Gemini 응답:', JSON.stringify(response, null, 2));
 
     const firstPart = response?.candidates?.[0]?.content?.parts?.[0];
 
     if (!firstPart || !firstPart.inlineData) {
       const errorMessage = firstPart?.text || 'Gemini API did not return an image. Please check the prompt or input images.';
       console.error('Gemini 응답 에러:', errorMessage);
       return res.status(500).json({ success: false, message: errorMessage });
     }
     
     const generatedImageBase64 = firstPart.inlineData.data;
     const generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');
     
     const fileName = `results/${Date.now()}_result.jpeg`;
     const file = bucket.file(fileName);
 
     await file.save(generatedImageBuffer, {
       metadata: { contentType: 'image/jpeg' },
       public: true,
     });
 
     const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
     console.log('이미지 처리 완료, URL:', publicUrl);
     
     res.json({ success: true, imageUrl: publicUrl });
 
   } catch (error) {
     console.error('서버 에러:', error);
     res.status(500).json({ success: false, message: '이미지 처리 중 서버 내부 오류가 발생했습니다.' });
   }
 });
 
 
 app.listen(port, () => {
   console.log(`CodiPOP 백엔드 서버가 http://localhost:${port} 에서 실행 중입니다.`);
 });