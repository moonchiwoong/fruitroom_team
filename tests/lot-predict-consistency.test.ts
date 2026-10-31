import test from 'node:test';
import assert from 'node:assert/strict';
import {lotPredictor} from '../lib/lot-predict';
import {predictQuality} from '../lib/quality-models';

// '내 사과'와 '자세히 보기'가 같은 규칙(기존 식 + 가장 최근 측정값에서 이어 계산)을 쓰는지 확인합니다.
const lot = {id: 'L', name: 'n', variety: '후지', intake_date: '2026-09-01', storage_start_date: '2026-09-01', initial_measured_on: '2026-09-01', storage: '일반 저온', mcp: '처리',
  firmness: 42, brix: 13.8, acidity: 0.35, details: {initial_same_start: true}} as any;
const obs = [{id: 'o1', lot_id: 'L', date: '2026-09-21', firmness: 40, brix: null, acidity: 0.33}] as any;
const base = {cultivar: '후지', storage: 'cold' as const, temperature: null, mcp: 'treated' as const, allowFujiReference: false};

test('측정 전 날짜는 처음 값에서, 측정 뒤로는 최근 측정값에서 이어 계산', () => {
  const p = lotPredictor(lot, obs);
  const a = p.at('brix', 60), e = predictQuality({...base, metric: 'brix', day: 60, anchor: {day: 0, value: 13.8}});
  assert.ok(a.ok && e.ok && Math.abs(a.value - e.value!) < 1e-9);
  const f = p.at('firmness', 60), g = predictQuality({...base, metric: 'firmness', day: 60, anchor: {day: 20, value: 40}});
  assert.ok(f.ok && g.ok && Math.abs(f.value - g.value!) < 1e-9);
  assert.equal(f.ok && f.from, 'measured');
});

test('측정한 날의 예상값은 그날 이전 기록만으로 계산', () => {
  const prior = lotPredictor(lot, []).at('firmness', 20), e = predictQuality({...base, metric: 'firmness', day: 20, anchor: {day: 0, value: 42}});
  assert.ok(prior.ok && e.ok && Math.abs(prior.value - e.value!) < 1e-9);
});
