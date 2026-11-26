import {unstable_cache} from 'next/cache';
import {auctionOriginRegion, groupAppleAuctions, type RegionalAuctionTrade} from '@/lib/apple-auctions';
import {APPLE_AUCTION_PARTS, type AppleAuctionsResponse} from '@/lib/apple-auction-types';
import {fetchMarketAuctionDay, type MarketAuctionSource} from '@/lib/market-auction-source';
import {isRegionKey, type RegionKey} from '@/lib/regions';
import {addDays, todayKST} from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

// 공판장 조회와 사업자 정보에서 확인한 번호를 사용하고, 응답의 시장명도 확인합니다.
const ORIGIN_HALLS: Partial<Record<RegionKey, string>> = {
  geochang: '6118200280',
  yeongju: '5128204505',
};
const HALL_NAMES: Record<string, RegExp> = {
  '6118200280': /거창사과원(?:예)?(?:농협|농업협동조합|협)/,
  '5128204505': /풍기농(?:협|업협동조합)/,
};
const SETTLEMENT_WINDOWS = [[0, 1, 2], [3, 4, 5, 6], [7, 8, 9, 10], [11, 12, 13]] as const;

function sourceKey(source: MarketAuctionSource) {
  return (source === 'origin-hall'
    ? process.env.AT_ORIGIN_AUCTION_SERVICE_KEY
    : process.env.AT_WHOLESALE_AUCTION_SERVICE_KEY)?.trim();
}

async function loadDay(source: MarketAuctionSource, date: string, marketCode?: string) {
  const serviceKey = sourceKey(source);
  if (!serviceKey) throw new Error('Missing auction source configuration');
  const geochangHall = source === 'origin-hall' && marketCode === ORIGIN_HALLS.geochang;
  const signal = AbortSignal.timeout(source === 'origin-hall' ? 8500 : 18000);
  const query = {source, date, serviceKey, marketCode, signal, unfilteredHall: geochangHall};
  let day = await fetchMarketAuctionDay(query);
  // 거창사과원예농협 본점과 청과물종합처리장 사업자 번호를 순서대로 확인합니다.
  // 동일 공판장 자료가 두 번호에 연결되어도 한 번만 집계합니다.
  if (geochangHall && !day.trades.length && !day.incompleteOrigins.length) {
    day = await fetchMarketAuctionDay({...query, marketCode: '6118204840'});
  }
  const {trades, incompleteOrigins} = day;
  const hallName = marketCode ? HALL_NAMES[marketCode] : undefined;
  if (hallName && trades.some(trade => !hallName.test(trade.marketName.replace(/\s+/g, '')))) {
    throw new Error('Unexpected origin auction hall');
  }
  const mapped: RegionalAuctionTrade[] = trades.flatMap(trade => {
    const region = auctionOriginRegion(trade.origin);
    return region ? [{...trade, region, source}] : [];
  });
  return {trades: mapped, incompleteRegions: [...new Set(incompleteOrigins.map(auctionOriginRegion))].filter(isRegionKey)};
}

// 같은 도매시장 원자료를 산지를 바꿀 때마다 다시 받지 않습니다.
const recentDay = unstable_cache(loadDay, ['apple-auction-recent-day-v3'], {revalidate: 3600});
const earlierDay = unstable_cache(loadDay, ['apple-auction-earlier-day-v3'], {revalidate: 86400});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = params.get('region');
  if (!isRegionKey(region)) return Response.json({error: '산지를 확인해 주세요.'}, {status: 400});

  const today = todayKST();
  const baseDate = params.get('asOf') ?? today;
  const part = Number(params.get('part') ?? '0');
  const selectedSource = params.get('source');
  if (!Number.isInteger(part) || part < 0 || part >= APPLE_AUCTION_PARTS || (baseDate !== today && baseDate !== addDays(today, -1))) {
    return Response.json({error: '조회 범위를 확인해 주세요.'}, {status: 400});
  }
  const marketCode = ORIGIN_HALLS[region];
  if (selectedSource !== null && selectedSource !== 'wholesale' && !(selectedSource === 'origin-hall' && marketCode)) {
    return Response.json({error: '이 산지에서 조회할 수 있는 거래처를 확인해 주세요.'}, {status: 400});
  }
  const availableSources: {source: MarketAuctionSource; marketCode?: string}[] = [{source: 'wholesale'}];
  if (marketCode) availableSources.push({source: 'origin-hall', marketCode});
  const neededSources = selectedSource ? availableSources.filter(({source}) => source === selectedSource) : availableSources;
  const sources = neededSources.filter(({source}) => sourceKey(source));

  const trades: RegionalAuctionTrade[] = [];
  let successful = 0;
  let partial = sources.length < neededSources.length;
  const results = await Promise.allSettled(SETTLEMENT_WINDOWS[part].flatMap(age => sources.map(({source, marketCode}) =>
    (age < 3 ? recentDay : earlierDay)(source, addDays(baseDate, -age), marketCode))));
  for (const result of results) {
    if (result.status === 'rejected' || result.value.incompleteRegions.includes(region)) {
      partial = true;
      continue;
    }
    successful++;
    for (const trade of result.value.trades) {
      if (trade.region === region && trade.date <= baseDate) trades.push(trade);
    }
  }

  const groups = groupAppleAuctions(trades, region);
  const status = groups.length ? 'ready' : successful && !partial ? 'empty' : 'unavailable';
  const response: AppleAuctionsResponse = {status, region, groups, checkedThrough: baseDate, partial};
  return Response.json(response, {
    status: status === 'unavailable' ? 503 : 200,
    headers: {'cache-control': partial || status === 'unavailable' ? 'no-store' : 'public, max-age=120, s-maxage=600'},
  });
}
