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
  sizeReasonUsual: '평소 {usualSize} 기준으로 {recommendedSize}를 추천해요.',
  sizeReasonSlim: '체형이 슬림한 편이라 평소보다 한 단계 작은 {recommendedSize}를 추천해요.',
  sizeReasonBorder: '평소 {usualSize}를 유지하되, 브랜드 핏에 따라 한 사이즈 여유를 고려해 보세요.',
  sizeReasonBroad: '체형 기준으로 평소보다 여유 있는 {recommendedSize}를 추천해요.',
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

/** 평소 사이즈를 기준으로 BMI 에 따라 ±1 보정한다. */
function recommendClothingSize(input) {
  const bmi = calcBmi(input.heightCm, input.weightKg);
  const base = sizeIndex(input.usualSize);
  let offset = 0;
  let fitHint = 'similar';
  let reasonKey = 'sizeReasonUsual';
  let confidence = 'medium';

  if (bmi > 0 && bmi < 18.5) {
    offset = -1; fitHint = 'smaller'; reasonKey = 'sizeReasonSlim'; confidence = 'medium';
  } else if (bmi >= 18.5 && bmi < 23) {
    offset = 0; fitHint = 'similar'; reasonKey = 'sizeReasonUsual'; confidence = 'high';
  } else if (bmi >= 23 && bmi < 25) {
    offset = 0; fitHint = 'similar'; reasonKey = 'sizeReasonBorder'; confidence = 'medium';
  } else if (bmi >= 25) {
    offset = 1; fitHint = 'larger'; reasonKey = 'sizeReasonBroad'; confidence = 'medium';
  } else {
    confidence = 'low'; reasonKey = 'sizeReasonUsual';
  }

  // 카테고리 약한 보정: OUTER 는 여유 핏 선호
  const category = (input.category || '').toUpperCase();
  if (category === 'OUTER' && offset < 1 && bmi >= 23) {
    offset = 1; fitHint = 'larger'; reasonKey = 'sizeReasonOuter';
  }

  const recommendedSize = clampSize(base + offset);
  const productSize = normalizeSizeLabel(input.productSize);
  const roundedBmi = Math.round(bmi * 10) / 10;

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
    reasonParams: { usualSize: input.usualSize, recommendedSize },
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
