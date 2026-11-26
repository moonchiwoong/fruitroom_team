// 서울가락 시세 요약: 등급을 합친 경매 거래의 kg당 가중 평균을 10kg 상자 기준으로 환산합니다.
import type {MarketAuctionTrade} from './market-auction-source';
import type {SettlementRow} from './market-settlement';
import {addDays} from './tracker';

export const GARAK_CODE = '110001';
export type TrendVariety = '후지' | '홍로';
export type TrendPoint = {date: string; per10kg: number; kg: number};
export type WeekPoint = {year: number; from: string; to: string; per10kg: number; kg: number; days: number};
export type GarakTrendResponse = {status: 'ready' | 'empty' | 'unavailable'; variety: TrendVariety; today: TrendPoint | null; yesterday: TrendPoint | null; years: WeekPoint[]; partial: boolean};

/** 하루 값들을 물량(kg)으로 가중 평균해 한 주(기간) 값으로 합칩니다. 거래가 없는 날은 빼고, 하루도 없으면 null. */
export function weekPoint(year: number, from: string, to: string, days: (TrendPoint | null)[]): WeekPoint | null {
  const ok = days.filter((d): d is TrendPoint => !!d && d.kg > 0);
  const kg = ok.reduce((n, d) => n + d.kg, 0);
  if (!kg) return null;
  return {year, from, to, per10kg: Math.round(ok.reduce((n, d) => n + d.per10kg * d.kg, 0) / kg), kg, days: ok.length};
}

/** 값이 크게 바뀐 해의 짧은 사유(공식 자료로 확인한 것만, 출처 포함). 품종·연도별로 사람이 정리합니다. */
export const YEAR_NOTES: Record<TrendVariety, Record<number, {text: string; source: string; url: string}>> = {
  후지: {
    2023: {text: '생육이 나빠 사과 도매가격이 크게 올랐어요. 11월 후지 도매가격이 1년 전의 두 배 수준(79.9~94.2% 상승)으로 전망됐어요.', source: '한국농촌경제연구원 설명자료(2023-11-07)', url: 'https://www.krei.re.kr/krei/page/24?cmd=view&pst=162993'},
    2025: {text: '가을 비가 잦아 후지 수확이 7일 넘게 늦어졌고, 농가 저장이 늘어 11월 도매시장 반입량이 줄었어요.', source: '농식품부 12월 수급 자료(2025-12-02) · 농업관측 11월호', url: 'https://www.newsis.com/view/NISX20251202_0003424583'},
    2026: {text: '사과 생산량이 지난해보다 늘면서 도매가격이 떨어질 것으로 전망됐어요.', source: 'SBS Biz(2026-11-05, 농업관측 인용)', url: 'https://biz.sbs.co.kr/amp/article/20000344361'},
  },
  홍로: {},
};
/** 사유 표시 기준: 전년보다 15% 이상 변한 해 중 사유가 정리된 해. */
export const NOTE_MIN_CHANGE = 15;

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
export function matchesVariety(name: string, v: TrendVariety) {
  const n = norm(name);
  return v === '홍로' ? n === '홍로' : n === '후지' || n === '부사' || n === '후지(부사)';
}

/** 정산 행(어제 이전) → 하루 값. 물량 kg = 상자 수 × 포장 무게. */
export function settlementPoint(rows: readonly SettlementRow[], v: TrendVariety, date: string): TrendPoint | null {
  let amount = 0, kg = 0;
  for (const r of rows) if (r.date === date && matchesVariety(r.variety, v)) { amount += r.amount; kg += r.boxes * r.unitWeightKg; }
  return kg > 0 ? {date, per10kg: Math.round(amount / kg * 10), kg: Math.round(kg)} : null;
}

/** 실시간 경매(오늘) → 하루 값. */
export function realtimePoint(trades: readonly MarketAuctionTrade[], v: TrendVariety, date: string): TrendPoint | null {
  let amount = 0, kg = 0;
  for (const t of trades) if (t.date === date && matchesVariety(t.variety, v)) { amount += t.quantity * t.unitPrice; kg += t.quantity * t.unitWeightKg; }
  return kg > 0 ? {date, per10kg: Math.round(amount / kg * 10), kg: Math.round(kg)} : null;
}

/** 변화율(%) 소수 첫째 자리. 기준값이 없으면 null. */
export const changePct = (now: TrendPoint | null, before: TrendPoint | null) =>
  now && before && before.per10kg > 0 ? Math.round((now.per10kg - before.per10kg) / before.per10kg * 1000) / 10 : null;

/** 기준일부터 하루씩 거슬러 올라가며(최대 n일) 값이 있는 첫 날을 찾습니다(주말·휴장일 대비). */
export async function firstTradingDay(from: string, n: number, load: (date: string) => Promise<TrendPoint | null>): Promise<TrendPoint | null> {
  for (let i = 0; i < n; i++) { const p = await load(addDays(from, -i)); if (p) return p; }
  return null;
}

/** 같은 월·일의 지난해 날짜(2월 29일은 28일). */
export function sameDayYearsAgo(date: string, years: number) {
  const y = +date.slice(0, 4) - years, md = date.slice(5);
  return md === '02-29' ? `${y}-02-28` : `${y}-${md}`;
}
