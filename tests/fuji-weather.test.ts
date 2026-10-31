import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyForm, fujiWeatherEstimate, payloadFromForm, formFromLot} from '../lib/tracker-form';
import {predictAll} from '../lib/initial-quality';

const fuji = () => ({...emptyForm(), variety: '후지', intake_date: '2026-10-20', storage_start_date: '2026-10-20', sameStart: true, initialSameStart: true, mcp: '미처리' as const, mcpSelected: true,
  fuji: {source: 'weather' as const, region: 'jangsu' as const, year: '2026', weather: {rain9: '120', lc56: '850', lc78: '1250', min4: '4.5'}}});

test('후지 날씨 추정은 지역 식을 그대로 쓴다', () => {
  assert.deepEqual(fujiWeatherEstimate(fuji().fuji), predictAll('jangsu', {rain9: 120, lc56: 850, lc78: 1250, min4: 4.5}));
  assert.equal(fujiWeatherEstimate({...fuji().fuji, region: ''}), null);
  assert.equal(fujiWeatherEstimate({...fuji().fuji, weather: {...fuji().fuji.weather, min4: ''}}), null);
});

test('저장 시 경도·당도·산도 추정값, 출처는 날씨 기반 추정', () => {
  const p = payloadFromForm(fuji(), 'real') as any, e = predictAll('jangsu', {rain9: 120, lc56: 850, lc78: 1250, min4: 4.5});
  assert.equal(p.firmness, Math.round(e.firmness * 10) / 10);
  assert.equal(p.brix, Math.round(e.brix * 100) / 100);
  assert.equal(p.details.initial_source, '날씨 기반 추정');
  assert.equal(p.details.fuji_weather.region, 'jangsu');
  const clean = p.details;
  const back = formFromLot({id: 'x', name: 'n', variety: '후지', intake_date: '2026-10-20', storage_start_date: '2026-10-20', storage: '일반 저온', mcp: '미처리', details: clean} as any);
  assert.equal(back.fuji.source, 'weather'); assert.equal(back.fuji.weather.min4, '4.5');
});
