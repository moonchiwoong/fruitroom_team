import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firmnessReach, reachText} from '../lib/target-reach';

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
