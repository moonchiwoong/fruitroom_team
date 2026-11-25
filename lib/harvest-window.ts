/**
 * 품종별로 수확일로 고를 수 있는 달.
 * - 홍로 8~10월: 팀 홍로 식 담당(박세린)이 알려 준 수확 시기 '8월 말~10월'을 달 단위로 넉넉히 연 범위.
 * - 후지 10~11월: 경북 사과원 '후지' 수확 '10월 말~11월 중순'(한국원예학회지 계열 논문, koreascience JAKO201329063577244)을 달 단위로 연 범위.
 * 그 밖의 품종(자유 입력 이름)은 근거가 없어 제한하지 않습니다.
 */
import {isHongroVariety} from './cultivar';

export type HarvestCultivar = 'hongro' | 'fuji';
export const HARVEST_MONTHS: Record<HarvestCultivar, readonly [number, number]> = {hongro: [8, 10], fuji: [10, 11]};
const LABEL: Record<HarvestCultivar, string> = {hongro: '홍로', fuji: '후지'};

export function harvestCultivar(variety: unknown): HarvestCultivar | null {
  if (isHongroVariety(variety)) return 'hongro';
  if (typeof variety !== 'string') return null;
  const v = variety.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  return v.includes('후지') || v.includes('부사') || v.includes('fuji') ? 'fuji' : null;
}

/** 수확일이 품종의 수확 달 밖이면 안내 문구, 아니면 null(날짜가 비었거나 형식이 아니면 여기서 판단하지 않음). */
export function harvestMonthError(variety: unknown, date: unknown): string | null {
  const c = harvestCultivar(variety);
  if (!c || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const m = Number(date.slice(5, 7)), [from, to] = HARVEST_MONTHS[c];
  return m >= from && m <= to ? null : `${LABEL[c]}는 ${from}~${to}월에 수확한 사과만 등록할 수 있어요. 수확일을 다시 확인해 주세요.`;
}
