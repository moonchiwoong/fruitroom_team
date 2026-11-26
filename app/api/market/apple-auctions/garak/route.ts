import {unstable_cache} from 'next/cache';
import {firstTradingDay, GARAK_CODE, realtimePoint, sameDayYearsAgo, settlementPoint, type GarakTrendResponse, type TrendPoint, type TrendVariety} from '@/lib/garak-trend';
import {fetchMarketAuctionDay} from '@/lib/market-auction-source';
import {fetchSettlementDay} from '@/lib/market-settlement';
import {addDays, todayKST} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const FIRST_YEAR = 2020;
const LOOKBACK = 7;
const settlementKey = () => (process.env.AT_SETTLEMENT_SERVICE_KEY ?? process.env.AT_WHOLESALE_AUCTION_SERVICE_KEY)?.trim();

async function settled(date: string, variety: TrendVariety): Promise<TrendPoint | null> {
  const k = settlementKey();
  if (!k) throw new Error('settlement configuration');
  return settlementPoint(await fetchSettlementDay({serviceKey: k, marketCode: GARAK_CODE, date, signal: AbortSignal.timeout(9000)}), variety, date);
}
// 지난 정산일은 바뀌지 않으므로 하루, 어제 정산은 3시간, 오늘 실시간은 30분 캐시합니다(품종별 하루 값만 저장).
const pastPoint = unstable_cache(settled, ['garak-settlement-point-v1'], {revalidate: 86400});
const recentPoint = unstable_cache(settled, ['garak-settlement-recent-v1'], {revalidate: 10800});
const todayPoint = unstable_cache(async (date: string, variety: TrendVariety): Promise<TrendPoint | null> => {
  const k = process.env.AT_WHOLESALE_AUCTION_SERVICE_KEY?.trim();
  if (!k) throw new Error('auction configuration');
  const day = await fetchMarketAuctionDay({source: 'wholesale', date, serviceKey: k, marketCode: GARAK_CODE, signal: AbortSignal.timeout(15000)});
  return realtimePoint(day.trades, variety, date);
}, ['garak-realtime-point-v1'], {revalidate: 1800});

/** 서울가락 사과(후지·홍로) 시세 요약: 오늘(실시간)·어제·작년 같은 날·연도별 같은 날(정산), 등급 합산 10kg 환산. */
export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get('variety');
  if (v !== '후지' && v !== '홍로') return Response.json({error: '품종을 확인해 주세요.'}, {status: 400});
  const variety: TrendVariety = v;
  const today = todayKST(), yest = addDays(today, -1);
  let partial = false;
  const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { partial = true; return null; } };
  const year0 = +today.slice(0, 4);
  const [todayP, yesterday, ...back] = await Promise.all([
    safe(todayPoint(today, variety)),
    safe(firstTradingDay(yest, LOOKBACK, d => (d === yest ? recentPoint(d, variety) : pastPoint(d, variety)))),
    ...Array.from({length: year0 - FIRST_YEAR}, (_, i) => safe(firstTradingDay(sameDayYearsAgo(today, i + 1), LOOKBACK, d => pastPoint(d, variety)))),
  ]);
  const lastYear = back[0] ?? null;
  const years = back.flatMap((p, i) => (p ? [{...p, year: year0 - i - 1}] : [])).reverse();
  const latest = todayP ?? yesterday;
  if (latest) years.push({...latest, year: year0});
  const any = !!(todayP || yesterday || years.length);
  const body: GarakTrendResponse = {status: any ? 'ready' : partial ? 'unavailable' : 'empty', variety, today: todayP, yesterday, lastYear, years, partial};
  return Response.json(body, {status: body.status === 'unavailable' ? 503 : 200, headers: {'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store'}});
}
