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
 
 // 1. 이미지 생성용 모델 (이미지 합성에 최적화)
 const imageModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image' });
 
 // 2. 텍스트 생성용 모델 (더 저렴하고 빠름)
 const textModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
 
// Firebase Storage 설정 (환경 변수 사용)
let storage;
if (process.env.GOOGLE_CREDENTIALS) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  storage = new Storage({
    credentials: serviceAccount,
    projectId: 'codipop-63c0d',
  });
} else {
  // 로컬 개발용
  storage = new Storage({
    keyFilename: path.join(process.cwd(), 'serviceAccountKey.json'),
    projectId: 'codipop-63c0d',
  });
}
const bucket = storage.bucket('codipop-63c0d.firebasestorage.app');
 
 const upload = multer({ 
   storage: multer.memoryStorage(),
   fileFilter: (req, file, cb) => {
     // 모든 파일 허용
     cb(null, true);
   }
 });
 
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
app.post('/try-on', upload.any(), async (req, res) => {
  console.log('이미지 처리 요청 받음 (다중 옷 이미지)...');
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: '이미지 파일이 필요합니다.' });
    }
    
    // 디버깅: 받은 모든 파일 정보 출력
    console.log('받은 모든 파일들:');
    req.files.forEach((file, index) => {
      console.log(`  ${index + 1}. fieldname: "${file.fieldname}", originalname: "${file.originalname}", size: ${file.size} bytes`);
    });
    
    // 전송된 파일들 중에서 'person'과 'clothing'들을 구분합니다.
    const personFile = req.files.find(file => file.fieldname === 'person');
    const clothingFiles = req.files.filter(file => file.fieldname.startsWith('clothing'));
    
    // 만약 clothing으로 시작하는 파일이 없다면, person이 아닌 모든 파일을 옷으로 간주
    const allClothingFiles = clothingFiles.length > 0 ? clothingFiles : req.files.filter(file => file.fieldname !== 'person');

    if (!personFile || allClothingFiles.length === 0) {
      return res.status(400).json({ success: false, message: '사람과 옷 이미지가 모두 필요합니다.' });
    }

    console.log(`처리할 이미지: 사람 1개, 옷 ${allClothingFiles.length}개`);

    // 이미지 파트 구성 (사람 이미지 + 여러 옷 이미지)
    const imageParts = [
      { inlineData: { data: personFile.buffer.toString('base64'), mimeType: personFile.mimetype } }
    ];
    allClothingFiles.forEach(file => {
      imageParts.push({
        inlineData: { data: file.buffer.toString('base64'), mimeType: file.mimetype }
      });
    });

    // 프롬프트도 여러 개의 옷을 처리하도록 수정
    const prompt = `
      You are an expert virtual try-on AI.
      Using the first image of the person and the following ${allClothingFiles.length} clothing images, generate a new image where the person is wearing all the clothing items together.
      Combine all clothing items naturally. For example, if there is a top and pants, wear them together. If there is a hat, top, and pants, wear all three.
      Maintain the person's original face, hair, and body shape.
      The output must be only the resulting image.
    `;
 
    const result = await imageModel.generateContent([prompt, ...imageParts]);
    const response = result.response;
    
    // 토큰 사용량 로그 추가
    if (result.response && result.response.usageMetadata) {
      const usage = result.response.usageMetadata;
      console.log('이미지 합성 토큰 사용량:', {
        personImage: '1개',
        clothingImages: `${allClothingFiles.length}개`,
        totalImages: `${allClothingFiles.length + 1}개`,
        promptTokenCount: usage.promptTokenCount,
        candidatesTokenCount: usage.candidatesTokenCount,
        totalTokenCount: usage.totalTokenCount
      });
    }
    
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
  console.log('코디 추천 요청 받음 (gemini-1.5-flash-latest 사용)...');
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
    
    const result = await textModel.generateContent(prompt);
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