import type {AppleAuctionDay, AppleAuctionGroup} from './apple-auction-types';
import type {MarketAuctionSource, MarketAuctionTrade} from './market-auction-source';
import {REGION_KEYS, REGIONS, type RegionKey} from './regions';

const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, '');
const provincialNames: Record<RegionKey, readonly string[]> = {
  geochang: ['경남', '경상남도'],
  cheongsong: ['경북', '경상북도'],
  jangsu: ['전북', '전라북도', '전북특별자치도'],
  yeongju: ['경북', '경상북도'],
  chungju: ['충북', '충청북도'],
  gunwi: ['대구', '대구광역시', '경북', '경상북도'],
  pocheon: ['경기', '경기도'],
  hwaseong: ['경기', '경기도'],
};

export function auctionOriginRegion(origin: string): RegionKey | undefined {
  const name = normalize(origin);
  return REGION_KEYS.find(key => {
    const {area, label} = REGIONS[key];
    const city = area.split(' ').at(-1)!;
    return name === city || provincialNames[key].some(province =>
      name === province + label || name.startsWith(province + city));
  });
}

export type RegionalAuctionTrade = MarketAuctionTrade & {source: MarketAuctionSource; region: RegionKey};

type GroupTotal = Omit<AppleAuctionGroup, 'days'> & {
  dailyTotals: Map<string, {quantity: number; amount: number}>;
};

const compareGroups = (a: AppleAuctionGroup, b: AppleAuctionGroup) =>
  Number(b.source === 'origin-hall') - Number(a.source === 'origin-hall') ||
  b.days[0].date.localeCompare(a.days[0].date) || b.days[0].totalWeightKg - a.days[0].totalWeightKg ||
  a.marketName.localeCompare(b.marketName, 'ko') || a.variety.localeCompare(b.variety, 'ko');

function auctionDay(date: string, quantity: number, totalAmount: number, unitWeightKg: number): AppleAuctionDay {
  return {date, quantity, totalAmount, averagePrice: Math.round(totalAmount / quantity),
    totalWeightKg: Math.round(quantity * unitWeightKg * 1000) / 1000};
}

export function groupAppleAuctions(trades: readonly RegionalAuctionTrade[], region: RegionKey): AppleAuctionGroup[] {
  const groups = new Map<string, GroupTotal>();

  for (const trade of trades) {
    if (trade.region !== region) continue;
    const {date, source, marketName, variety, grade, packageName, size, unit, unitWeightKg, quantity, unitPrice} = trade;
    const id = JSON.stringify([source, marketName, variety, grade, packageName, size, unit, unitWeightKg]);
    let group = groups.get(id);
    if (!group) {
      group = {id, source, marketName, variety, grade, packageName, size, unit, unitWeightKg, dailyTotals: new Map()};
      groups.set(id, group);
    }
    const totals = group.dailyTotals.get(date) ?? {quantity: 0, amount: 0};
    totals.quantity += quantity;
    totals.amount += quantity * unitPrice;
    group.dailyTotals.set(date, totals);
  }

  return [...groups.values()].map(({dailyTotals, ...group}) => {
    const days = [...dailyTotals.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 5)
      .map(([date, totals]) => auctionDay(date, totals.quantity, totals.amount, group.unitWeightKg));
    return {...group, days};
  }).sort(compareGroups);
}

export function mergeAppleAuctionGroups(currentGroups: readonly AppleAuctionGroup[], partGroups: readonly AppleAuctionGroup[]): AppleAuctionGroup[] {
  const groups = new Map(currentGroups.map(group => [group.id, group]));
  for (const group of partGroups) {
    const current = groups.get(group.id);
    if (!current) {
      groups.set(group.id, group);
      continue;
    }
    const byDate = new Map(current.days.map(day => [day.date, day]));
    for (const day of group.days) {
      const previous = byDate.get(day.date);
      byDate.set(day.date, previous
        ? auctionDay(day.date, previous.quantity + day.quantity, previous.totalAmount + day.totalAmount, group.unitWeightKg)
        : day);
    }
    const days = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    groups.set(group.id, {...group, days});
  }
  return [...groups.values()].sort(compareGroups);
}
