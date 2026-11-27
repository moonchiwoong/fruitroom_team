// 품종 평균(일반적인 품종 특성) 당도·산도: 그래프에 점선으로만 보여 주는 참고선입니다.
// 계산식·예측값에는 쓰지 않습니다. 소비자 선호값이나 출하·품질 판정 기준이 아닙니다.
// 값은 공공기관이 공개한 품종 특성 그대로 옮겼고, 범위로 공개된 값은 범위 그대로(띠) 그립니다.
import type {MetricId} from './tracker';

export type RefValue = {lo: number; hi: number; source: string; url: string};
type VarietyRef = {label: string; brix: RefValue; acidity: RefValue};

const FUJI: VarietyRef = {
  label: '후지',
  brix: {lo: 14, hi: 15, source: '농촌진흥청 농사로(과실의 기준 당도)', url: 'https://nongsaro.go.kr/portal/ps/psz/psza/contentSub.ps?cntntsNo=219539&menuId=PS00078&pageIndex=1&pageSize=10&sText=&sType=sCntntsSj'},
  acidity: {lo: 0.4, hi: 0.4, source: '무주군 사과분양 홈페이지(후지 품종 특성, 0.4% 내외)', url: 'https://tour.muju.go.kr/apple/contents.do?key=694'},
};
const HONGRO: VarietyRef = {
  label: '홍로',
  brix: {lo: 14.5, hi: 14.5, source: '농촌진흥청 국립원예특작과학원 보도자료', url: 'https://www.nihhs.go.kr/usr/nihhs/news_Press_view.do?dataNo=100000758196'},
  acidity: {lo: 0.25, hi: 0.31, source: '농촌진흥청 국립원예특작과학원 보도자료', url: 'https://www.nihhs.go.kr/usr/nihhs/news_Press_view.do?dataNo=100000758196'},
};

/** 정확한 품종 이름만 받습니다(후지·부사·후지(부사)·홍로). 다른 이름은 null. */
export function varietyRef(variety: string | null | undefined): VarietyRef | null {
  const v = (variety ?? '').trim();
  if (v === '홍로') return HONGRO;
  if (v === '후지' || v === '부사' || v === '후지(부사)') return FUJI;
  return null;
}

export function refFor(variety: string | null | undefined, m: MetricId): (RefValue & {label: string}) | null {
  const r = varietyRef(variety); if (!r || (m !== 'brix' && m !== 'acidity')) return null;
  return {...r[m], label: r.label};
}
