import {unstable_cache} from 'next/cache';
import {auctionOriginRegion, groupAppleAuctions, type RegionalAuctionTrade} from '@/lib/apple-auctions';
import type {AppleAuctionsResponse} from '@/lib/apple-auction-types';
import {fetchMarketAuctionDay, type MarketAuctionSource} from '@/lib/market-auction-source';
import {isRegionKey, type RegionKey} from '@/lib/regions';
import {addDays, todayKST} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// 농넷에서 공판장 이름과 코드를 대조했고, 응답의 시장명도 확인합니다.
const ORIGIN_HALLS: Partial<Record<RegionKey, string>> = {
  geochang: '6118204840',
  yeongju: '5128204505',
};
const HALL_NAMES: Record<string, RegExp> = {
  '6118204840': /거창사과원(?:예)?(?:농협|농업협동조합|협)/,
  '5128204505': /풍기농(?:협|업협동조합)/,
};
const SETTLEMENT_DAYS = 14;

function sourceKey(source: MarketAuctionSource) {
  return (source === 'origin-hall'
    ? process.env.AT_ORIGIN_AUCTION_SERVICE_KEY
    : process.env.AT_WHOLESALE_AUCTION_SERVICE_KEY)?.trim();
}

async function loadDay(source: MarketAuctionSource, date: string, marketCode?: string): Promise<RegionalAuctionTrade[]> {
  const serviceKey = sourceKey(source);
  if (!serviceKey) throw new Error('Missing auction source configuration');
  const trades = await fetchMarketAuctionDay({source, date, serviceKey, marketCode, signal: AbortSignal.timeout(15000)});
  const hallName = marketCode ? HALL_NAMES[marketCode] : undefined;
  if (hallName && trades.some(trade => !hallName.test(trade.marketName.replace(/\s+/g, '')))) {
    throw new Error('Unexpected origin auction hall');
  }
  return trades.flatMap(trade => {
    const region = auctionOriginRegion(trade.origin);
    return region ? [{...trade, region, source}] : [];
  });
}

// 같은 도매시장 원자료를 산지를 바꿀 때마다 다시 받지 않습니다.
const recentDay = unstable_cache(loadDay, ['apple-auction-recent-day-v1'], {revalidate: 3600});
const earlierDay = unstable_cache(loadDay, ['apple-auction-earlier-day-v1'], {revalidate: 86400});

export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get('region');
  if (!isRegionKey(region)) return Response.json({error: '산지를 확인해 주세요.'}, {status: 400});

  const today = todayKST();
  const marketCode = ORIGIN_HALLS[region];
  const sources: {source: MarketAuctionSource; marketCode?: string}[] = [];
  if (sourceKey('wholesale')) sources.push({source: 'wholesale'});
  if (marketCode && sourceKey('origin-hall')) sources.push({source: 'origin-hall', marketCode});

  const neededSources = marketCode ? 2 : 1;
  const trades: RegionalAuctionTrade[] = [];
  let successful = 0;
  let partial = sources.length < neededSources;
  const deadline = Date.now() + 37000;

  for (let offset = 0; sources.length && offset < SETTLEMENT_DAYS; offset += 3) {
    if (Date.now() >= deadline) {
      partial = true;
      break;
    }
    const days = Array.from({length: Math.min(3, SETTLEMENT_DAYS - offset)}, (_, i) => offset + i);
    const results = await Promise.allSettled(days.flatMap(age => sources.map(({source, marketCode}) =>
      (age < 3 ? recentDay : earlierDay)(source, addDays(today, -age), marketCode))));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successful++;
        for (const trade of result.value) {
          if (trade.region === region && trade.date <= today) trades.push(trade);
        }
      } else {
        partial = true;
      }
    }
    if (successful === 0) break;
  }

  const groups = groupAppleAuctions(trades, region);
  const status = groups.length ? 'ready' : successful && !partial ? 'empty' : 'unavailable';
  const response: AppleAuctionsResponse = {status, region, groups, checkedThrough: today, partial};
  return Response.json(response, {
    status: status === 'unavailable' ? 503 : 200,
    headers: {'cache-control': partial || status === 'unavailable' ? 'no-store' : 'public, max-age=120, s-maxage=600'},
  });
}
