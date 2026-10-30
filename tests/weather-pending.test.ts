import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherPending, lotPredictor} from '../lib/lot-predict';
import {predictAll} from '../lib/initial-quality';

const fujiLot = (inputs: any, estimate: any = null) => ({id: 'f', name: 'f', variety: '후지', intake_date: '2026-09-25', storage_start_date: '2026-09-25', initial_measured_on: '2026-09-25', harvest_date: '2026-09-25',
  storage: '일반 저온', mcp: '미처리', firmness: null, brix: null, acidity: null, details: {initial_same_start: true, initial_source: '날씨 기반 추정', fuji_weather: {region: 'jangsu', year: 2026, inputs, estimate}}} as any);

test('날씨 값이 비어 저장된 물량을 찾아낸다', () => {
  assert.deepEqual(weatherPending(fujiLot({rain9: null, lc56: 850, lc78: 1250, min4: 4.5})), {region: 'jangsu', year: 2026});
  assert.equal(weatherPending(fujiLot({rain9: 120, lc56: 850, lc78: 1250, min4: 4.5}, {firmness_nmm: 1, brix: 1, acidity: 1, weight: 1, diameter: 1})), null);
});

test('9월이 끝난 뒤 받은 값으로 당도·산도 처음 값을 추정해 이어 계산한다', () => {
  const lot = fujiLot({rain9: null, lc56: 850, lc78: 1250, min4: 4.5});
  assert.equal(lotPredictor(lot).at('brix', 30).ok, false);
  const ov = {chang_min4: 4.5, chang_LC56: 850, chang_LC78: 1250, chang_9rain: 120};
  const r = lotPredictor(lot, [], ov).at('brix', 0);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(Math.abs(r.value - predictAll('jangsu', {rain9: 120, lc56: 850, lc78: 1250, min4: 4.5}).brix) < 1e-9);
  assert.equal(lotPredictor(lot, [], ov).at('firmness', 30).ok, false); // 후지 경도는 연결하지 않음
});
