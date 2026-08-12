// size-recommend.js
//
// 규칙 기반 사이즈 추천 — AI 호출이 없어 추가 비용이 0원이다.
// CodiPop 앱의 src/services/sizeRecommendService.ts 를 그대로 옮긴 것으로,
// 앱과 데모가 같은 사이즈를 추천해야 하므로 규칙을 바꾸지 말 것.
//
// 사업기획서 슬라이드 3~5의 서사(반품 사유 1위 = 사이즈·핏 불만족)와
// 실제 기능을 잇는 유일한 고리다. 이미지 합성은 '스타일' 확인이지 '사이즈' 확인이 아니라서,
// 이 문구가 없으면 "그래서 사이즈 실패가 줄어요?"라는 질문에 답할 수 없다.

const CLOTHING_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXL+'];

const SIZE_REASONS = {
  sizeReasonBodyOnly: '키·몸무게 기준(BMI {bmi})으로 {recommendedSize}를 추천해요.',
  sizeReasonBodyMatch: '평소 사이즈와 체형 기준이 같아요. {recommendedSize}를 추천해요.',
  sizeReasonBodySmaller:
    '체형 기준으로는 {recommendedSize}예요. 평소 {usualSize}를 입으신다면 여유 있는 핏을 좋아하시는 편이에요.',
  sizeReasonBodyLarger:
    '체형 기준으로는 {recommendedSize}예요. 평소 {usualSize}를 입으신다면 붙는 핏을 좋아하시는 편이에요.',
  sizeReasonOuter: '아우터는 겹쳐 입는 경우가 많아 {recommendedSize}를 추천해요.',
  sizeReasonProductMatch: '상품 표기 {productSize}와 내 추천 {recommendedSize}가 잘 맞아요.',
  sizeReasonProductSmall: '상품 표기 {productSize}보다 여유 있는 {recommendedSize}를 권장해요.',
  sizeReasonProductLarge: '상품 표기 {productSize}보다 작은 {recommendedSize}도 고려해 보세요.',
};

function sizeIndex(size) {
  return CLOTHING_SIZE_LABELS.indexOf(size);
}

function clampSize(index) {
  const max = CLOTHING_SIZE_LABELS.length - 1;
  return CLOTHING_SIZE_LABELS[Math.max(0, Math.min(max, index))];
}

function normalizeSizeLabel(value) {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, '');
  if (raw === 'XXL이상' || raw === 'XXL+' || raw === 'XXXL') return 'XXL+';
  return CLOTHING_SIZE_LABELS.includes(raw) ? raw : null;
}

function calcBmi(heightCm, weightKg) {
  if (!heightCm || !weightKg) return 0;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function isValidBodySize(profile) {
  if (!profile) return false;
  return (
    typeof profile.heightCm === 'number' &&
    profile.heightCm >= 120 && profile.heightCm <= 230 &&
    typeof profile.weightKg === 'number' &&
    profile.weightKg >= 30 && profile.weightKg <= 200 &&
    CLOTHING_SIZE_LABELS.includes(profile.usualSize)
  );
}

/** BMI 구간 → 사이즈. 국내 여성복 호수(44·55·66·77·88)에 대응한다. */
const BMI_SIZE_BANDS = [
  { max: 17.5, size: 'XS' },   // 44
  { max: 19.5, size: 'S' },    // 55
  { max: 22.0, size: 'M' },    // 66
  { max: 24.5, size: 'L' },    // 77
  { max: 27.0, size: 'XL' },   // 88
  { max: 30.0, size: 'XXL' },  // 99
  { max: Infinity, size: 'XXL+' },
];

function sizeFromBmi(bmi) {
  for (const band of BMI_SIZE_BANDS) {
    if (bmi < band.max) return band.size;
  }
  return 'XXL+';
}

/** 구간 경계에 가까우면 확신을 낮춘다 — 경계에서는 브랜드 핏에 따라 갈린다. */
function confidenceFromBmi(bmi) {
  if (bmi <= 0) return 'low';
  for (const band of BMI_SIZE_BANDS) {
    if (bmi < band.max) return band.max - bmi < 0.6 ? 'medium' : 'high';
  }
  return 'medium';
}

/**
 * 체형(키·몸무게)으로 사이즈를 정한다. **같은 체형이면 항상 같은 사이즈가 나온다.**
 *
 * 예전에는 "평소 사이즈 ± BMI 보정" 이라, 165cm·50kg 인 같은 사람이 평소 M 을 고르면 S,
 * 평소 S 를 고르면 XS 가 나왔다. 화면은 "체형에 맞는 사이즈를 찾아 드릴게요"라고
 * 약속하는데 실제로는 평소 사이즈가 기준점이었던 것이다.
 *
 * 평소 사이즈는 이제 **핏 취향**을 읽는 데만 쓰고 추천 사이즈를 바꾸지 않는다.
 *
 * 앱(`src/services/sizeRecommendService.ts`)과 **같은 답을 내야 한다. 한쪽만 고치지 말 것.**
 */
function recommendClothingSize(input) {
  const bmi = calcBmi(input.heightCm, input.weightKg);
  const roundedBmi = Math.round(bmi * 10) / 10;

  let recommendedSize = sizeFromBmi(bmi);
  const confidence = confidenceFromBmi(bmi);

  // 카테고리 보정 — 옷의 성질이지 사람의 성질이 아니므로 체형 일관성을 깨지 않는다.
  const category = (input.category || '').toUpperCase();
  const isOuter = category === 'OUTER';
  if (isOuter) recommendedSize = clampSize(sizeIndex(recommendedSize) + 1);

  const usualSize = input.usualSize;
  const diffFromUsual = usualSize ? sizeIndex(recommendedSize) - sizeIndex(usualSize) : 0;

  let reasonKey;
  let fitHint = 'similar';
  if (isOuter) {
    reasonKey = 'sizeReasonOuter';
  } else if (!usualSize) {
    reasonKey = 'sizeReasonBodyOnly';
  } else if (diffFromUsual === 0) {
    reasonKey = 'sizeReasonBodyMatch';
  } else if (diffFromUsual < 0) {
    reasonKey = 'sizeReasonBodySmaller';
    fitHint = 'smaller';
  } else {
    reasonKey = 'sizeReasonBodyLarger';
    fitHint = 'larger';
  }

  const productSize = normalizeSizeLabel(input.productSize);

  if (productSize) {
    const diff = sizeIndex(recommendedSize) - sizeIndex(productSize);
    if (diff > 0) {
      return { recommendedSize, confidence, reasonKey: 'sizeReasonProductSmall',
        reasonParams: { productSize, recommendedSize }, bmi: roundedBmi, fitHint: 'larger' };
    }
    if (diff < 0) {
      return { recommendedSize, confidence, reasonKey: 'sizeReasonProductLarge',
        reasonParams: { productSize, recommendedSize }, bmi: roundedBmi, fitHint: 'smaller' };
    }
    return { recommendedSize, confidence: 'high', reasonKey: 'sizeReasonProductMatch',
      reasonParams: { productSize, recommendedSize }, bmi: roundedBmi, fitHint: 'similar' };
  }

  return {
    recommendedSize, confidence, reasonKey,
    reasonParams: { usualSize: usualSize || '', recommendedSize, bmi: roundedBmi },
    bmi: roundedBmi, fitHint,
  };
}

/** reasonKey + params 를 사람이 읽는 문장으로 바꾼다. */
function formatSizeReason(result) {
  const template = SIZE_REASONS[result.reasonKey] || SIZE_REASONS.sizeReasonUsual;
  return template.replace(/\{(\w+)\}/g, (_, key) => (result.reasonParams || {})[key] ?? '');
}

window.CodiPopSize = {
  CLOTHING_SIZE_LABELS,
  recommendClothingSize,
  formatSizeReason,
  isValidBodySize,
  calcBmi,
};
