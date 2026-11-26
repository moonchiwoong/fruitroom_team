// 서울가락 시세 요약: 등급을 합친 경매 거래의 kg당 가중 평균을 10kg 상자 기준으로 환산합니다.
import type {MarketAuctionTrade} from './market-auction-source';
import type {SettlementRow} from './market-settlement';
import {addDays} from './tracker';

export const GARAK_CODE = '110001';
export type TrendVariety = '후지' | '홍로';
export type TrendPoint = {date: string; per10kg: number; kg: number};
export type GarakTrendResponse = {status: 'ready' | 'empty' | 'unavailable'; variety: TrendVariety; today: TrendPoint | null; yesterday: TrendPoint | null; lastYear: TrendPoint | null; years: (TrendPoint & {year: number})[]; partial: boolean};

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
