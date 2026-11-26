import test from 'node:test';
import assert from 'node:assert/strict';
import {changePct, firstTradingDay, matchesVariety, realtimePoint, sameDayYearsAgo, settlementPoint} from '../lib/garak-trend';

const row = (o: object) => ({date: '2026-11-25', marketCode: '110001', marketName: '서울가락', origin: '경북 안동시', variety: '후지', grade: '특', size: '', packageName: '상자', unitWeightKg: 10, boxes: 10, amount: 300000, low: 1, high: 1, ...o});

test('후지(부사)·홍로 이름만, 등급 합산 kg 가중 평균을 10kg으로 환산', () => {
  assert.ok(matchesVariety('부사', '후지')); assert.ok(!matchesVariety('미얀마', '후지')); assert.ok(matchesVariety('홍로', '홍로'));
  // 10kg×10상자 300,000원 + 20kg×5상자 250,000원 → 550,000원 / 200kg = 2,750원/kg → 27,500원/10kg
  const p = settlementPoint([row({}), row({unitWeightKg: 20, boxes: 5, amount: 250000, grade: '상'}), row({variety: '미얀마', amount: 999999})], '후지', '2026-11-25');
  assert.deepEqual(p, {date: '2026-11-25', per10kg: 27500, kg: 200});
  assert.equal(settlementPoint([row({})], '홍로', '2026-11-25'), null);
  const rt = realtimePoint([{date: '2026-11-26', marketName: '서울가락', origin: '', variety: '후지', grade: '', packageName: '상자', size: '', unit: 'kg', unitWeightKg: 10, quantity: 4, unitPrice: 30000}], '후지', '2026-11-26');
  assert.equal(rt?.per10kg, 30000);
});

test('변화율·같은 날짜·휴장일 건너뛰기', async () => {
  assert.equal(changePct({date: 'a', per10kg: 34200, kg: 1}, {date: 'b', per10kg: 38000, kg: 1}), -10);
  assert.equal(changePct(null, {date: 'b', per10kg: 1, kg: 1}), null);
  assert.equal(sameDayYearsAgo('2026-11-26', 1), '2025-11-26'); assert.equal(sameDayYearsAgo('2028-02-29', 1), '2027-02-28');
  const seen: string[] = [];
  const p = await firstTradingDay('2025-11-30', 7, async d => { seen.push(d); return d === '2025-11-28' ? {date: d, per10kg: 1, kg: 1} : null; });
  assert.equal(p?.date, '2025-11-28'); assert.deepEqual(seen, ['2025-11-30', '2025-11-29', '2025-11-28']);
});
