import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firmnessReach, metricReach, prefReachText, reachText} from '../lib/target-reach';

const fake = (vals: (d: number) => number, todayDay: number | null, start = '2026-10-01') => ({todayDay, start, at: (_m: string, d: number) => ({ok: true as const, value: vals(d), first: vals(0), from: 'initial' as const})}) as never;

test('기준에 처음 닿는 날을 오늘부터 찾는다', () => {
  const r = firmnessReach(fake(d => 70 - d * 0.1, 10), 65, 200);
  assert.deepEqual(r, {kind: 'at', day: 50, date: '2026-11-20', inDays: 40});
  assert.equal(reachText(r, 65), '계산상 저장 50일째(11월 20일쯤) 내 기준 65 N에 닿아요 · 오늘부터 40일 뒤');
});
test('범위 안에 안 닿으면 날짜를 만들지 않는다', () => {
  assert.deepEqual(firmnessReach(fake(() => 70, 10), 50, 200), {kind: 'none', maxDay: 200});
  assert.deepEqual(firmnessReach(fake(() => 40, 10), 50, 200), {kind: 'already'});
  assert.deepEqual(firmnessReach(fake(() => 70, 10), null, 200), {kind: 'na'});
});

test('소비자 선호 하한(13 °Brix): 처음 13 아래로 내려가는 날과 범례 문구', () => {
  // 14.4에서 하루 0.01씩 내려감 → 오늘(10일째) 14.3, 13 미만은 141일째부터(13.0은 아직 하한 안)
  const r = metricReach(fake(d => 14.4 - d * 0.01, 10), 'brix', 13, 300);
  assert.equal(r.kind, 'at'); if (r.kind === 'at') { assert.equal(r.day, 141); assert.equal(r.inDays, 131); assert.equal(r.date, '2027-02-19'); }
  assert.equal(prefReachText(r, 13), '오늘부터 131일 뒤(2월 19일쯤) 13 °Brix 아래로 내려가요');
  assert.equal(prefReachText(metricReach(fake(() => 12.5, 10), 'brix', 13, 300), 13), '계산상 이미 13 °Brix보다 낮아요');
  assert.equal(prefReachText(metricReach(fake(() => 13, 10), 'brix', 13, 120), 13), '120일 안에는 13 °Brix 아래로 내려가지 않아요');
});
