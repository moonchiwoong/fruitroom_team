// ‘지금 출하 vs 30일 더 저장’ 비교. 사용자가 넣은 물량·가격·저장비만으로 계산합니다(시세·물량 예측 없음).
export type ShipInput = {nowKg: string; nowPrice: string; laterKg: string; cost: string; laterPrice: string};
export type ShipResult =
  | {ok: false; missing: string[]; reason?: string}
  | {ok: true; nowRevenue: number; breakEven: number; diff: number | null; laterRevenue: number | null};

const num = (s: string) => { const t = s.replace(/,/g, '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };

/** 기준 가격 = (지금 물량 × 지금 가격 + 추가 저장비) ÷ 30일 뒤 판매 물량. 원 단위 올림(그 값에 팔면 손해가 없도록).
 *  수입 차이 = 30일 뒤 물량 × 30일 뒤 가격 − 추가 저장비 − 지금 수입(30일 뒤 가격을 넣은 경우만). */
export function compareShipping(i: ShipInput): ShipResult {
  const f = {nowKg: num(i.nowKg), nowPrice: num(i.nowPrice), laterKg: num(i.laterKg), cost: num(i.cost), laterPrice: num(i.laterPrice)};
  const label: Record<string, string> = {nowKg: '지금 팔 수 있는 물량', nowPrice: '지금 가격', laterKg: '30일 뒤 판매 가능 물량', cost: '추가 저장비', laterPrice: '30일 뒤 예상 가격'};
  const missing = (['nowKg', 'nowPrice', 'laterKg', 'cost'] as const).filter(k => f[k] === null).map(k => label[k]);
  if (missing.length) return {ok: false, missing};
  const bad = (Object.keys(f) as (keyof typeof f)[]).filter(k => f[k] !== null && (Number.isNaN(f[k]) || (f[k] as number) < 0)).map(k => label[k]);
  if (bad.length) return {ok: false, missing: [], reason: `0 이상의 숫자를 넣어 주세요: ${bad.join(', ')}`};
  if (f.laterKg === 0) return {ok: false, missing: [], reason: '30일 뒤 판매 가능 물량이 0이면 기준 가격을 계산할 수 없어요.'};
  const nowRevenue = f.nowKg! * f.nowPrice!;
  const breakEven = Math.ceil((nowRevenue + f.cost!) / f.laterKg! - 1e-9);
  const laterRevenue = f.laterPrice === null ? null : f.laterKg! * f.laterPrice!;
  const diff = laterRevenue === null ? null : Math.round(laterRevenue - f.cost! - nowRevenue);
  return {ok: true, nowRevenue, breakEven, diff, laterRevenue};
}
