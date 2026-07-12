// server.js (최종 수정 버전)

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
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

// Google AI 설정 (신규 @google/genai SDK)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. 이미지 생성용 모델 (Nano Banana 2 Lite: 최저가 $0.034/장, 약 4초 생성)
//    합성 품질이 아쉬우면 환경변수로 IMAGE_MODEL=gemini-3.1-flash-image (Nano Banana 2, $0.067/장) 지정
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image';

// 2. 텍스트 생성용 모델 (구 gemini-1.5-flash-latest 대체, 더 저렴하고 빠름)
const TEXT_MODEL = process.env.TEXT_MODEL || 'gemini-2.5-flash-lite';

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

// Gemini 전송 전 이미지 축소 설정 (base64 전송량을 줄여 왕복 시간 단축)
const MAX_IMAGE_DIMENSION = parseInt(process.env.MAX_IMAGE_DIMENSION, 10) || 1536;
const RESIZE_JPEG_QUALITY = 82;

async function optimizeImageForGemini(file) {
  try {
    const optimized = await sharp(file.buffer)
      .rotate() // EXIF 회전 정보 반영 (리사이즈 시 회전 메타데이터가 유실되므로 픽셀에 직접 적용)
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: RESIZE_JPEG_QUALITY })
      .toBuffer();
    return {
      data: optimized.toString('base64'),
      mimeType: 'image/jpeg',
      originalBytes: file.size,
      optimizedBytes: optimized.length,
    };
  } catch (error) {
    console.warn(`이미지 최적화 실패, 원본 그대로 전송 (${file.originalname}):`, error.message);
    return {
      data: file.buffer.toString('base64'),
      mimeType: file.mimetype,
      originalBytes: file.size,
      optimizedBytes: file.size,
    };
  }
}

app.use(express.json());

// 기본 라우트 (서버 상태 확인용)
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'CodiPOP Backend Server is running!',
    timestamp: new Date().toISOString()
  });
});

// AdMob app-ads.txt 인증용 (Play Console/App Store 개발자 웹사이트 루트에서 크롤링)
app.get('/app-ads.txt', (req, res) => {
  res.type('text/plain');
  res.send('google.com, pub-6990308526694074, DIRECT, f08c47fec0942fa0\n');
});

// 파일럿 몰 제휴용 데모 (외부 공유 URL)
// https://codipop-backend.onrender.com/demo/
app.use(
  '/demo',
  express.static(path.join(__dirname, 'public/demo'), {
    index: 'index.html',
    redirect: false,
  }),
);
app.get(['/demo', '/demo/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public/demo/index.html'));
});

// --- API 엔드포인트 ---
app.post('/try-on', upload.any(), async (req, res) => {
  const requestId = Date.now();
  console.log(`[${requestId}] 이미지 처리 요청 받음 (다중 옷 이미지)...`);
  console.log(`[${requestId}] 요청 헤더:`, JSON.stringify(req.headers, null, 2));

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: '이미지 파일이 필요합니다.' });
    }

    // 디버깅: 받은 모든 파일 정보 출력
    console.log(`[${requestId}] 받은 모든 파일들:`);
    req.files.forEach((file, index) => {
      console.log(`[${requestId}]   ${index + 1}. fieldname: "${file.fieldname}", originalname: "${file.originalname}", size: ${file.size} bytes`);
    });

    // 전송된 파일들 중에서 'person'과 'clothing'들을 구분합니다.
    const personFile = req.files.find(file => file.fieldname === 'person');
    const clothingFiles = req.files.filter(file => file.fieldname.startsWith('clothing'));

    // 만약 clothing으로 시작하는 파일이 없다면, person이 아닌 모든 파일을 옷으로 간주
    const allClothingFiles = clothingFiles.length > 0 ? clothingFiles : req.files.filter(file => file.fieldname !== 'person');

    if (!personFile || allClothingFiles.length === 0) {
      return res.status(400).json({ success: false, message: '사람과 옷 이미지가 모두 필요합니다.' });
    }

    // 옷 아이템 개수 제한 (원본 이미지 보존을 위해 최대 2개로 제한)
    if (allClothingFiles.length > 2) {
      console.log(`[${requestId}] 경고: 옷 아이템이 ${allClothingFiles.length}개입니다. 원본 이미지 보존을 위해 처음 2개만 처리합니다.`);
      allClothingFiles.splice(2); // 처음 2개만 유지
    }

    console.log(`[${requestId}] 처리할 이미지: 사람 1개, 옷 ${allClothingFiles.length}개`);

    const heightCm = Number(req.body?.heightCm);
    const weightKg = Number(req.body?.weightKg);
    const usualSize = typeof req.body?.usualSize === 'string' ? req.body.usualSize.trim() : '';
    const hasBodySize =
      Number.isFinite(heightCm) &&
      heightCm >= 120 &&
      heightCm <= 230 &&
      Number.isFinite(weightKg) &&
      weightKg >= 30 &&
      weightKg <= 200;

    if (hasBodySize) {
      console.log(`[${requestId}] 체형 정보 반영: ${heightCm}cm / ${weightKg}kg / usual=${usualSize || 'n/a'}`);
    }

    // 이미지 리사이즈 (Gemini 전송량 절감)
    const resizeStart = Date.now();
    const optimizedImages = await Promise.all(
      [personFile, ...allClothingFiles].map(file => optimizeImageForGemini(file))
    );
    const totalOriginalKB = Math.round(optimizedImages.reduce((sum, img) => sum + img.originalBytes, 0) / 1024);
    const totalOptimizedKB = Math.round(optimizedImages.reduce((sum, img) => sum + img.optimizedBytes, 0) / 1024);
    console.log(`[${requestId}] 이미지 리사이즈 완료: ${totalOriginalKB}KB -> ${totalOptimizedKB}KB (${Date.now() - resizeStart}ms)`);

    const imageParts = optimizedImages.map(img => ({
      inlineData: { data: img.data, mimeType: img.mimeType }
    }));

    const bodySizeGuidance = hasBodySize
      ? `
      **BODY SIZE GUIDANCE (soft fit only):**
      - The wearer profile is approximately ${heightCm} cm and ${weightKg} kg${usualSize ? `, usual clothing size ${usualSize}` : ''}.
      - Use this only to adjust how the clothing drapes and how fitted/loose it looks on the person already in Image 1.
      - Do NOT redraw or morph the person's body into a different physique. Keep the person's body silhouette from Image 1.
      - Prefer realistic sleeve length, hem length, and fabric tension consistent with that profile.
      `
      : '';

    // 가상 착장 프롬프트 (교체/겹치기 구분, 옷 디테일 보존, 조명 일치 지시 포함)
    const prompt = `
      You are an expert virtual try-on image editing AI. Edit the original photo so the person is wearing the provided clothing items. Change NOTHING else.

      **INPUTS:**
      - Image 1: The original photo of the person. THIS IS THE BASE.
      - Images 2 to ${allClothingFiles.length + 1}: Clothing items to put on the person.
      ${bodySizeGuidance}
      **HOW TO APPLY CLOTHING:**
      - If an item is a top/shirt/knit/dress: REPLACE the corresponding garment the person is currently wearing.
      - If an item is outerwear (jacket, cardigan, coat): layer it naturally OVER the current outfit.
      - If an item is an accessory (hat, cap, earmuffs): add it without altering the hair more than necessary.
      - Reproduce each clothing item EXACTLY: same color, pattern, logo, texture, and details as its reference image.
      - Fit the clothing naturally to the person's body with realistic wrinkles, draping, and proportions.
      - Match the lighting, shadows, and color tone of the original photo so the result looks like one real photograph.

      **STRICT RULES (DO NOT DEVIATE):**
      1. DO NOT change the person: face, hair, skin tone, pose, and expression must be IDENTICAL to Image 1.
      2. DO NOT invent a different body type; keep the person's overall silhouette from Image 1, using body-size guidance only for clothing drape/fit.
      3. DO NOT change the background: it must be IDENTICAL to Image 1.
      4. MAINTAIN the exact same aspect ratio and framing as Image 1. Do NOT crop, zoom, or resize.
      5. Apply ALL provided clothing items.

      **Output ONLY the edited image.** Do not generate a new person or a new scene.
    `;

    console.log(`[${requestId}] Gemini API 호출 시작 (모델: ${IMAGE_MODEL})...`);
    const geminiStart = Date.now();

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
      config: {
        // 낮은 temperature로 원본(인물/배경) 보존 일관성 강화
        temperature: 0.2,
      },
    });
    console.log(`[${requestId}] Gemini API 호출 완료 (${Date.now() - geminiStart}ms)`);

    // 토큰 사용량 로그 추가
    if (response && response.usageMetadata) {
      const usage = response.usageMetadata;
      console.log(`[${requestId}] 이미지 합성 토큰 사용량:`, {
        personImage: '1개',
        clothingImages: `${allClothingFiles.length}개`,
        totalImages: `${allClothingFiles.length + 1}개`,
        promptTokenCount: usage.promptTokenCount,
        candidatesTokenCount: usage.candidatesTokenCount,
        totalTokenCount: usage.totalTokenCount
      });
    }

    // 응답 전체(base64 포함)를 로그로 남기면 수 MB가 찍히므로 구조 요약만 출력
    const partSummary = response?.candidates?.[0]?.content?.parts?.map(p =>
      p.inlineData ? `image(${p.inlineData.mimeType})` : Object.keys(p).join(',')
    );
    console.log(`[${requestId}] Gemini 응답 파트:`, JSON.stringify(partSummary));

    // Gemini 응답에서 이미지 데이터 추출
    const candidates = response?.candidates;
    if (!candidates || candidates.length === 0) {
      console.error(`[${requestId}] Gemini 응답에 candidates가 없습니다.`);
      return res.status(500).json({ success: false, message: 'Gemini API가 응답을 생성하지 못했습니다.' });
    }

    const content = candidates[0]?.content;
    if (!content || !content.parts || content.parts.length === 0) {
      console.error(`[${requestId}] Gemini 응답에 content.parts가 없습니다.`);
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
      console.error(`[${requestId}] Gemini 응답에서 이미지 데이터를 찾을 수 없습니다.`);
      console.error(`[${requestId}] 응답 구조:`, JSON.stringify(content.parts, null, 2));
      return res.status(500).json({ success: false, message: '생성된 이미지를 찾을 수 없습니다.' });
    }
    const generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');

    const fileName = `results/${Date.now()}_result.jpeg`;
    const file = bucket.file(fileName);

    console.log(`[${requestId}] Firebase Storage에 이미지 업로드 시작...`);
    const uploadStart = Date.now();
    await file.save(generatedImageBuffer, {
      metadata: { contentType: 'image/jpeg' },
      public: true,
      resumable: false, // 작은 파일은 단일 요청 업로드가 훨씬 빠름 (resumable은 요청 왕복이 3회 이상)
    });
    console.log(`[${requestId}] Storage 업로드 완료 (${Date.now() - uploadStart}ms)`);

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log(`[${requestId}] 이미지 처리 완료 (총 ${Date.now() - requestId}ms), URL:`, publicUrl);

    // 클라이언트에 처리된 아이템 개수 정보 포함
    const responseData = {
      success: true,
      imageUrl: publicUrl,
      processedItems: {
        person: 1,
        clothing: allClothingFiles.length,
        total: allClothingFiles.length + 1
      }
    };

    // 만약 옷 아이템이 2개로 제한되었다면 경고 메시지 추가
    if (req.files.filter(file => file.fieldname.startsWith('clothing')).length > 2) {
      responseData.warning = "원본 이미지 보존을 위해 옷 아이템을 최대 2개까지만 처리했습니다.";
    }

    res.json(responseData);

  } catch (error) {
    console.error(`[${requestId}] 서버 에러:`, error);
    res.status(500).json({ success: false, message: '이미지 처리 중 서버 내부 오류가 발생했습니다.' });
  }
});

// 쇼핑몰 캡쳐/스캔 이미지 카테고리 분석
app.post('/analyze-clothing', upload.any(), async (req, res) => {
  const requestId = Date.now();
  console.log(`[${requestId}] 의류 분석 요청 (/analyze-clothing)`);

  try {
    const imageFile =
      (req.files || []).find(file => file.fieldname === 'image') ||
      (req.files || [])[0];

    if (!imageFile) {
      return res.status(400).json({ success: false, message: '이미지 파일이 필요합니다.' });
    }

    const optimized = await optimizeImageForGemini(imageFile);
    const prompt = `
You analyze a clothing product photo for a virtual try-on closet app.
Return ONLY valid JSON with this shape:
{"category":"TOPS|BOTTOMS|SHOES|OUTER","productName":"short Korean product name","confidence":0.0}

Rules:
- category must be exactly one of: TOPS, BOTTOMS, SHOES, OUTER
- If unsure between categories, pick the most likely and lower confidence
- productName should be brief (e.g. "레드 티셔츠")
- Do not wrap JSON in markdown
`;

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: optimized.data,
                mimeType: optimized.mimeType,
              },
            },
          ],
        },
      ],
      config: { temperature: 0.1 },
    });

    const rawText = (response.text || '').trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[${requestId}] JSON 파싱 실패:`, rawText);
      return res.status(500).json({ success: false, message: '분석 결과를 해석하지 못했습니다.' });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const allowed = new Set(['TOPS', 'BOTTOMS', 'SHOES', 'OUTER']);
    const category = allowed.has(parsed.category) ? parsed.category : 'TOPS';

    console.log(`[${requestId}] 분석 결과:`, parsed);
    return res.json({
      success: true,
      category,
      productName: parsed.productName || '',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    });
  } catch (error) {
    console.error(`[${requestId}] 의류 분석 에러:`, error);
    return res.status(500).json({ success: false, message: '의류 분석 중 오류가 발생했습니다.' });
  }
});

// 코디 추천 엔드포인트
app.post('/get-recommendation', async (req, res) => {
  console.log(`코디 추천 요청 받음 (${TEXT_MODEL} 사용)...`);
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

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
    });
    const recommendationText = response.text;

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