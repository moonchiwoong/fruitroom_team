import test from 'node:test';
import assert from 'node:assert/strict';
import {lotPredictor, latestObservation} from '../lib/lot-predict';
import {predictQuality} from '../lib/quality-models';
import {todayKST, addDays, fmtNum} from '../lib/tracker';

// 재현: 후지·일반 저온·1-MCP 미처리, 수확일=저장 시작일=오늘, 처음 단단함 60.0 N → 같은 날 ‘측정 추가’ 55.0 N
const T = todayKST();
const lot = {id: 'L', name: 'n', variety: '후지', harvest_date: T, intake_date: T, storage_start_date: T, initial_measured_on: T, storage: '일반 저온', mcp: '미처리',
  firmness: 60, brix: 13.5, acidity: 0.4, details: {initial_same_start: true, firmness_input: {value: 60, unit: 'N'}}} as any;
const base = {cultivar: '후지', storage: 'cold' as const, temperature: null, mcp: 'untreated' as const, allowFujiReference: false};
const exp = (metric: 'firmness' | 'brix' | 'acidity', day: number, anchor: {day: number; value: number}) => { const r = predictQuality({...base, metric, day, anchor}); assert.ok(r.ok && r.value !== null); return r.value!; };

test('저장 0일째 같은 날 실측 55.0 N이 처음 값 60.0 N보다 우선하고, 30일 뒤도 실측에서 이어 계산', () => {
  const p = lotPredictor(lot, [{id: 'o1', lot_id: 'L', date: T, firmness: 55, brix: null, acidity: null}] as any);
  const now = p.at('firmness', 0), d30 = p.at('firmness', 30);
  assert.ok(now.ok && d30.ok);
  assert.equal(now.from, 'measured'); assert.equal(now.first, 60);
  assert.ok(Math.abs(now.value - exp('firmness', 0, {day: 0, value: 55})) < 1e-9);
  assert.ok(Math.abs(d30.value - exp('firmness', 30, {day: 0, value: 55})) < 1e-9);
  assert.equal(fmtNum(d30.value, 1), '54.6'); // 요청서의 기대값과 같은지(계산 경로로 나온 값)
  // 측정 전(처음 값만) 계산은 60.0 → 59.6 — 비교용으로만 쓰는 값
  assert.equal(fmtNum(lotPredictor(lot, []).at('firmness', 30).ok ? (lotPredictor(lot, []).at('firmness', 30) as any).value : NaN, 1), '59.6');
});

test('단단함만 잰 경우 당도·산도는 처음 값에서 계산(출처도 처음 값)', () => {
  const p = lotPredictor(lot, [{id: 'o1', lot_id: 'L', date: T, firmness: 55, brix: null, acidity: null}] as any);
  const b = p.at('brix', 30);
  assert.ok(b.ok); assert.equal(b.from, 'initial');
  assert.ok(Math.abs(b.value - exp('brix', 30, {day: 0, value: 13.5})) < 1e-9);
});

test('같은 날 여러 측정은 목록과 같은 규칙(날짜·id 순서의 마지막)으로 하나만 쓴다', () => {
  const o = [{id: 'b', lot_id: 'L', date: T, firmness: 53, brix: null, acidity: null}, {id: 'a', lot_id: 'L', date: T, firmness: 57, brix: null, acidity: null}] as any;
  assert.equal(latestObservation(o, 'firmness')?.id, 'b');
  const p = lotPredictor(lot, [...o].reverse());
  const v = p.at('firmness', 0); assert.ok(v.ok && Math.abs(v.value - exp('firmness', 0, {day: 0, value: 53})) < 1e-9);
});

test('처음 값으로 지정된 측정 기록은 중복으로 쓰지 않고, 이후 저장일 측정은 그날부터 이어 계산', () => {
  const lot2 = {...lot, details: {...lot.details, initial_observation_id: 'init'}};
  const o = [{id: 'init', lot_id: 'L', date: T, firmness: 60, brix: 13.5, acidity: 0.4}] as any;
  const p = lotPredictor(lot2, o);
  const v = p.at('firmness', 0); assert.ok(v.ok); assert.equal(v.from, 'initial');
  // 과거 시작 사과에 10일째 측정
  const start = addDays(T, -20), lot3 = {...lot, harvest_date: start, intake_date: start, storage_start_date: start, initial_measured_on: start};
  const q = lotPredictor(lot3, [{id: 'o2', lot_id: 'L', date: addDays(start, 10), firmness: 50, brix: null, acidity: null}] as any);
  const before = q.at('firmness', 5), after = q.at('firmness', 40);
  assert.ok(before.ok && before.from === 'initial' && Math.abs(before.value - exp('firmness', 5, {day: 0, value: 60})) < 1e-9);
  assert.ok(after.ok && after.from === 'measured' && Math.abs(after.value - exp('firmness', 40, {day: 10, value: 50})) < 1e-9);
});
