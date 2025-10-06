 // server.js (최종 수정 버전)

const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { firestore } = require('./firebase-admin.js');

// --- 설정 ---
const app = express();
const port = process.env.PORT || 3000;

// CORS 설정 (클라이언트 접근 허용)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
 
 // Google AI 설정
 const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 // ✅ [수정] 모델 이름을 스크린샷에 나온 정확한 ID로 변경
 const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });
 
 // Firebase Storage 설정
 const storage = new Storage({
   keyFilename: path.join(process.cwd(), 'serviceAccountKey.json'),
   projectId: 'codipop-63c0d',
 });
 const bucket = storage.bucket('codipop-63c0d.firebasestorage.app');
 
 const upload = multer({ storage: multer.memoryStorage() });
 
app.use(express.json());

// 기본 라우트 (서버 상태 확인용)
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'CodiPOP Backend Server is running!',
    timestamp: new Date().toISOString()
  });
});

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
 
    // Gemini 응답에서 이미지 데이터 추출
    const candidates = response?.candidates;
    if (!candidates || candidates.length === 0) {
      console.error('Gemini 응답에 candidates가 없습니다.');
      return res.status(500).json({ success: false, message: 'Gemini API가 응답을 생성하지 못했습니다.' });
    }

    const content = candidates[0]?.content;
    if (!content || !content.parts || content.parts.length === 0) {
      console.error('Gemini 응답에 content.parts가 없습니다.');
      return res.status(500).json({ success: false, message: 'Gemini API가 이미지를 생성하지 못했습니다.' });
    }

    // 이미지 데이터 찾기
    let generatedImageBase64 = null;
    for (const part of content.parts) {
      if (part.inlineData && part.inlineData.data) {
        generatedImageBase64 = part.inlineData.data;
        break;
      }
    }

    if (!generatedImageBase64) {
      console.error('Gemini 응답에서 이미지 데이터를 찾을 수 없습니다.');
      console.error('응답 구조:', JSON.stringify(content.parts, null, 2));
      return res.status(500).json({ success: false, message: '생성된 이미지를 찾을 수 없습니다.' });
    }
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

// 코디 추천 엔드포인트
app.post('/get-recommendation', async (req, res) => {
  console.log('코디 추천 요청 받음...');
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, message: '사용자 ID가 필요합니다.' });
  }

  try {
    // Firestore에서 사용자 옷장 데이터 조회
    const closetSnapshot = await firestore
      .collection('users')
      .doc(userId)
      .collection('closet')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    if (closetSnapshot.empty) {
      return res.json({ success: true, recommendation: "옷장에 아이템을 먼저 추가해주세요!" });
    }
    
    const prompt = `
      한 패션 전문 AI 스타일리스트로서, 사용자의 옷장 아이템을 기반으로 오늘 날씨(서울, 맑음, 22도, 가을)에 어울리는 코디를 제안해줘.
      사용자의 옷장에는 주로 '베이지색 니트', '청바지', '블라우스' 같은 아이템이 있어.
      캐주얼하면서도 세련된 스타일로 추천해줘.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const recommendationText = response.text();

    console.log('Gemini 코디 추천:', recommendationText);
    res.json({ success: true, recommendation: recommendationText });

  } catch (error) {
    console.error('추천 생성 중 에러:', error);
    res.status(500).json({ success: false, message: '추천을 생성하는 중 오류가 발생했습니다.' });
  }
});

app.listen(port, () => {
 console.log(`CodiPOP 백엔드 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});