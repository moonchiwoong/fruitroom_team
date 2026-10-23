/** Existing free-text lot labels remain unchanged; model routing only normalizes for detection. */
export function isHongroVariety(value:unknown):boolean {
  if(typeof value!=='string')return false;
  const normalized=value.normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
  return normalized.includes('홍로')||normalized.includes('hongro');
}

export const HONGRO_DEDICATED_NOTICE='홍로는 기존 후지·연결 확인용 모델로 계산하지 않습니다. 품질 예측의 ‘홍로 · 거창’ 전용 계산기를 이용해 주세요.';
export const HONGRO_DEDICATED_REASON=HONGRO_DEDICATED_NOTICE+' 홍로 계산 결과의 AI 설명은 아직 지원하지 않습니다.';
