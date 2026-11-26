import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auctionOriginRegion, groupAppleAuctions, type RegionalAuctionTrade} from '../lib/apple-auctions';

const sale: RegionalAuctionTrade = {
  date: '2026-11-26', source: 'origin-hall', region: 'geochang',
  marketName: '거창사과원예농협', origin: '경남 거창군', variety: '후지(부사)', grade: '특',
  packageName: '상자', size: '3', unit: 'kg', unitWeightKg: 20, quantity: 2, unitPrice: 12000,
};

test('matches all eight municipalities from the origin field, including old and new Gunwi names', () => {
  const origins = [
    ['경남 거창군', 'geochang'], ['경상북도 청송군 진보면', 'cheongsong'], ['전북특별자치도 장수군', 'jangsu'],
    ['경북 영주시', 'yeongju'], ['충청북도 충주시', 'chungju'], ['대구광역시 군위군', 'gunwi'],
    ['경상북도 군위군', 'gunwi'], ['경기도 포천시', 'pocheon'], ['경기 화성시', 'hwaseong'],
  ];
  for (const [label, expected] of origins) assert.equal(auctionOriginRegion(label), expected, label);
  for (const label of ['', '경남', '경기 광주시', '거창사과원예농협', '국내산']) {
    assert.equal(auctionOriginRegion(label), undefined, label);
  }
});

test('weights prices by lots and never merges sizes, grades, varieties, or markets', () => {
  const groups = groupAppleAuctions([
    sale, {...sale, quantity: 6, unitPrice: 20000}, {...sale, unitWeightKg: 10}, {...sale, grade: '상'},
    {...sale, variety: '미시마'}, {...sale, size: '4'}, {...sale, packageName: '컨테이너'},
    {...sale, source: 'wholesale', marketName: '안동'}, {...sale, region: 'yeongju'},
  ], 'geochang');
  assert.equal(groups.length, 7);
  assert.deepEqual(groups.find(group => group.days[0].quantity === 8)?.days, [
    {date: '2026-11-26', averagePrice: 18000, quantity: 8, totalWeightKg: 160},
  ]);
});

test('takes five distinct actual trading dates without inserting missing days', () => {
  const dates = ['2026-11-26', '2026-11-25', '2026-11-24', '2026-11-23', '2026-11-20', '2026-11-19'];
  const [group] = groupAppleAuctions(dates.map(date => ({...sale, date})).reverse(), 'geochang');
  assert.deepEqual(group.days.map(day => day.date), dates.slice(0, 5));
});
