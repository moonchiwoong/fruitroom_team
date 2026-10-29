import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineObservation, lotReadiness, lotSummary} from '../lib/lot-readiness';
import {demoLots} from '../lib/demo-lots';
import type {Lot, Observation} from '../lib/lot-types';

const lot = (p: Partial<Lot>): Lot => ({...demoLots()[0], variety: '후지', storage: '일반 저온', mcp: '미처리', firmness: 70, brix: 14, acidity: 0.4, initial_measured_on: '2026-09-01', details: {}, ...p});

test('readiness follows the shared model rules and never assumes a missing date or unknown 1-MCP', () => {
  assert.equal(lotReadiness(lot({})).status, 'ready');
  assert.equal(lotReadiness(lot({initial_measured_on: null})).status, 'needs-date');
  assert.equal(lotReadiness(lot({firmness: null, brix: null, acidity: null})).status, 'needs-initial');
  assert.equal(lotReadiness(lot({mcp: '미확인'})).status, 'conditions');
  assert.equal(lotReadiness(lot({variety: '감홍'})).status, 'unsupported');
  assert.equal(lotReadiness(lot({variety: '홍로', details: {storage_temperature: 2}})).status, 'conditions');
  assert.equal(lotReadiness(lot({variety: '홍로', details: {storage_temperature: 4}})).status, 'ready');
});

test('baseline is only the explicitly linked observation, not the oldest one', () => {
  const obs = [{id: 'a', date: '2026-09-01'}, {id: 'b', date: '2026-09-10'}] as Observation[];
  assert.equal(baselineObservation(lot({}), obs), null);
  assert.equal(baselineObservation(lot({details: {initial_observation_id: 'b'}}), obs)?.id, 'b');
});

test('summary counts each lot once, keeps units apart and counts distinct storages', () => {
  const a = lot({id: 'a', quantity: 100, location: 'A저장고', details: {quantity_unit: '상자'}});
  const s = lotSummary([a, a, lot({id: 'b', quantity: 500, location: ' A저장고 ', details: {quantity_unit: 'kg'}}), lot({id: 'c', quantity: null, location: null})], l => l.id === 'b');
  assert.deepEqual([s.count, s.totals['상자'], s.totals.kg, s.missingQuantity, s.storages, s.shared, s.noStorage], [3, 100, 500, 1, 1, 1, 1]);
});
