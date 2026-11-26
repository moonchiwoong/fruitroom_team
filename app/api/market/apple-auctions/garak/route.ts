import {unstable_cache} from 'next/cache';
import {firstTradingDay, GARAK_CODE, realtimePoint, sameDayYearsAgo, settlementPoint, weekPoint, type GarakTrendResponse, type TrendPoint, type TrendVariety, type WeekPoint} from '@/lib/garak-trend';
import {fetchMarketAuctionDay} from '@/lib/market-auction-source';
import {fetchSettlementDay} from '@/lib/market-settlement';
import {addDays, todayKST} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const FIRST_YEAR = 2020;
const WEEK = 7;
const POOL = 6;

/** 동시에 POOL개까지만 원자료를 요청합니다(공공데이터 호출이 한꺼번에 몰리지 않게). */
function limiter() {
  let active = 0; const queue: (() => void)[] = [];
  return async <T,>(job: () => Promise<T>): Promise<T> => {
    if (active >= POOL) await new Promise<void>(r => queue.push(r));
    active++;
    try { return await job(); } finally { active--; queue.shift()?.(); }
  };
}
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

/**
 * 서울가락 사과(후지·홍로) 시세 요약.
 * 오늘(실시간)·어제(정산) 하루 값, 그리고 해마다 ‘같은 날짜까지 7일’ 물량 가중 평균(정산). 하루 값은 주말·휴장 영향으로 크게 흔들려 연도 비교는 7일 평균을 씁니다.
 */
export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get('variety');
  if (v !== '후지' && v !== '홍로') return Response.json({error: '품종을 확인해 주세요.'}, {status: 400});
  const variety: TrendVariety = v;
  const today = todayKST(), yest = addDays(today, -1);
  let partial = false;
  const run = limiter();
  const safe = async <T,>(job: () => Promise<T>): Promise<T | null> => { try { return await run(job); } catch { partial = true; return null; } };
  const year0 = +today.slice(0, 4);
  const week = async (year: number): Promise<WeekPoint | null> => {
    const to = year === year0 ? yest : sameDayYearsAgo(today, year0 - year);
    const dates = Array.from({length: WEEK}, (_, i) => addDays(to, -i));
    const days = await Promise.all(dates.map(d => safe(() => (d === yest ? recentPoint(d, variety) : pastPoint(d, variety)))));
    return weekPoint(year, dates.at(-1)!, to, days);
  };
  const [todayP, yesterday, ...weeks] = await Promise.all([
    safe(() => todayPoint(today, variety)),
    firstTradingDay(yest, WEEK, d => safe(() => (d === yest ? recentPoint(d, variety) : pastPoint(d, variety)))),
    ...Array.from({length: year0 - FIRST_YEAR + 1}, (_, i) => week(FIRST_YEAR + i)),
  ]);
  const years = weeks.filter((w): w is WeekPoint => !!w);
  const any = !!(todayP || yesterday || years.length);
  const body: GarakTrendResponse = {status: any ? 'ready' : partial ? 'unavailable' : 'empty', variety, today: todayP, yesterday, years, partial};
  return Response.json(body, {status: body.status === 'unavailable' ? 503 : 200, headers: {'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store'}});
}
