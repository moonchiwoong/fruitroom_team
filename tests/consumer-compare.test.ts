import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRow, lossKg, sugarNotes, sugarRef, summaryLine} from '../lib/consumer-compare';
import {addDays, daysBetween} from '../lib/tracker';
import {lotPredictor} from '../lib/lot-predict';

const ok = (value: number) => ({ok: true as const, value});
const no = {ok: false as const, reason: '값 없음'};

test('품종 기준은 이름이 정확히 후지·홍로일 때만(로얄후지·미얀마 제외)', () => {
  assert.equal(sugarRef('후지')?.value, 14);
  assert.equal(sugarRef('부사')?.value, 14);
  assert.equal(sugarRef('홍로')?.value, 13.6);
  assert.equal(sugarRef('로얄후지'), null);
  assert.equal(sugarRef('미얀마'), null);
});

test('당도 대조: 표시값(소수 첫째 자리) 기준 차이·같음, 선호 범위 13~16', () => {
  assert.match(sugarNotes(13.7, '후지').ref!, /14\.0 °Brix보다 0\.3 °Brix 낮아요/);
  assert.match(sugarNotes(14.04, '후지').ref!, /표시값 기준으로 .*같아요/);
  assert.match(sugarNotes(14.0, '홍로').ref!, /13\.6 °Brix보다 0\.4 °Brix 높아요/);
  assert.match(sugarNotes(12.9, '후지').range, /보다 낮아요/);
  assert.match(sugarNotes(13.0, '후지').range, /안이에요/);
  assert.match(sugarNotes(16.1, '후지').range, /보다 높아요/);
  assert.equal(sugarNotes(14, '감홍').ref, null);
});

test('기간 비교: 표시 정밀도로 방향, 산도는 %p, 같은 표시값은 같음', () => {
  assert.equal(compareRow('brix', ok(14.04), ok(14.01)).dir, 'same');
  const acid = compareRow('acidity', ok(0.25), ok(0.22));
  assert.equal(acid.dir, 'down'); assert.equal(acid.diffText, '0.030%p 감소');
  assert.equal(compareRow('brix', ok(14), no).dir, null);
});

test('한 줄 요약: 방향이 다르면 따로, 같으면 묶고, 없는 지표는 뺌', () => {
  const loss = compareRow('loss', ok(1.2), ok(2.1));
  assert.equal(summaryLine([compareRow('brix', ok(14.0), ok(13.9)), compareRow('acidity', ok(0.25), ok(0.22)), loss]),
    '당도와 산도는 낮아지고, 무게는 처음 100kg당 약 0.90kg 더 줄어들 것으로 예상돼요.');
  assert.equal(summaryLine([compareRow('brix', ok(14.0), ok(14.0)), compareRow('acidity', ok(0.25), ok(0.22))]),
    '당도는 표시값이 같고, 산도는 낮아질 것으로 예상돼요.');
  assert.equal(summaryLine([compareRow('brix', ok(14.0), no), compareRow('acidity', ok(0.25), ok(0.22))]), '산도는 낮아질 것으로 예상돼요.');
  assert.equal(summaryLine([compareRow('brix', no, no)]), null);
});

test('무게 감소: 누적 1.2%→2.1%면 처음 100kg당 추가 0.9kg, 처음 500kg이면 4.5kg', () => {
  const k = lossKg(compareRow('loss', ok(1.2), ok(2.1)), 500)!;
  assert.equal(k.per100.extra, 0.9); assert.equal(k.mine!.extra, 4.5);
  assert.match(summaryLine([compareRow('loss', ok(1.2), ok(2.1))], 500)!, /처음 500kg 기준 약 4\.50kg 더 줄어들/);
});

test('기간 계산: 기준일 11-26, 저장 시작 11-24 → 30일 뒤 12-26(32일째), 60일 뒤 2027-01-25(62일째)', () => {
  const t = daysBetween('2026-11-24', '2026-11-26');
  assert.deepEqual([addDays('2026-11-26', 30), t + 30, addDays('2026-11-26', 60), t + 60], ['2026-12-26', 32, '2027-01-25', 62]);
});

const hongro = (harvest: string) => ({id: 'h', name: 'h', variety: '홍로', harvest_date: harvest, intake_date: '2026-11-03', storage_start_date: '2026-11-03', initial_measured_on: '2026-11-03',
  storage: '일반 저온', mcp: '미처리', firmness: 70, brix: 14, acidity: 0.3, weight: 300, details: null} as any);

test('수확일: 11월 3일 수확 홍로는 계산하지 않고 이유를 알림, 10월 31일 수확·11월 3일 저장은 계산 가능', () => {
  const bad = lotPredictor(hongro('2026-11-03')).at('brix', 10);
  assert.equal(bad.ok, false); assert.match((bad as {reason: string}).reason, /수확 달 밖/);
  const good = lotPredictor(hongro('2026-10-31')).at('brix', 10);
  assert.ok(!('reason' in good) || !/수확 달 밖/.test(String((good as {reason?: string}).reason)));
});
