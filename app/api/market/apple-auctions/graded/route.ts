import {unstable_cache} from 'next/cache';
import type {GradedAuctionsResponse} from '@/lib/apple-auction-types';
import {fetchSettlementDay, groupGraded, SETTLEMENT_MARKETS, type SettlementRow} from '@/lib/market-settlement';
import {isRegionKey} from '@/lib/regions';
import {addDays, todayKST} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const MAX_MARKETS = 8;
const LOOKBACK_DAYS = 7; // 어제부터 7일(주말·휴장 포함)

function serviceKey() {
  return (process.env.AT_SETTLEMENT_SERVICE_KEY ?? process.env.AT_WHOLESALE_AUCTION_SERVICE_KEY)?.trim();
}

// 시장·정산일 단위로 원자료를 6시간 캐시합니다. 산지를 바꿔도 같은 시장·날짜는 다시 받지 않습니다.
const settlementDay = unstable_cache(async (marketCode: string, date: string): Promise<SettlementRow[]> => {
  const key = serviceKey();
  if (!key) throw new Error('settlement configuration');
  return fetchSettlementDay({serviceKey: key, marketCode, date, signal: AbortSignal.timeout(9000)});
}, ['apple-settlement-day-v1'], {revalidate: 21600});

/** 어제 이전 정산정보에서 산지별·등급별 정산가를 돌려줍니다. markets: 실시간 자료에서 이 산지 사과가 거래된 시장 코드(쉼표 구분). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = params.get('region');
  if (!isRegionKey(region)) return Response.json({error: '산지를 확인해 주세요.'}, {status: 400});
  const today = todayKST();
  const asOf = params.get('asOf') ?? today;
  const markets = [...new Set((params.get('markets') ?? '').split(',').map(s => s.trim()).filter(Boolean))];
  if ((asOf !== today && asOf !== addDays(today, -1)) || !markets.length || markets.length > MAX_MARKETS || markets.some(code => !(code in SETTLEMENT_MARKETS))) {
    return Response.json({error: '조회 범위를 확인해 주세요.'}, {status: 400});
  }
  const dates = Array.from({length: LOOKBACK_DAYS}, (_, i) => addDays(asOf, -(i + 1)));
  // 어제부터 하루씩 거슬러 올라가며, 이 산지 사과의 정산 자료가 있는 가장 최근 날 하루치만 씁니다(호출 수를 줄이기 위해).
  const rows: SettlementRow[] = [];
  let failed = 0, calls = 0;
  for (const date of dates) {
    const results = await Promise.allSettled(markets.map(code => settlementDay(code, date)));
    calls += markets.length;
    const dayRows = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    failed += results.filter(r => r.status === 'rejected').length;
    if (groupGraded(dayRows, region).length) { rows.push(...dayRows); break; }
  }
  if (failed) console.warn('aT settlement days unavailable', {region, failed, calls});
  const groups = groupGraded(rows, region);
  const status = groups.length ? 'ready' : failed === calls ? 'unavailable' : 'empty';
  const body: GradedAuctionsResponse = {status, region, groups, checkedFrom: dates.at(-1)!, checkedThrough: dates[0], partial: failed > 0};
  return Response.json(body, {status: status === 'unavailable' ? 503 : 200, headers: {'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store'}});
}
