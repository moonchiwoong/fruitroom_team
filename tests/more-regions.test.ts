import test from 'node:test';
import assert from 'node:assert/strict';
import {HONGRO_REGRESSIONS, estimateHongroInitial, calculateHongro} from '../lib/hongro';
import {regions, predictAll} from '../lib/initial-quality';
import {computeHongroWeather, WEATHER_STATIONS, type DailyObs} from '../lib/rda-weather';
import coefs from './fixtures/regression5.json' with {type: 'json'};

// 회귀식(5).xlsx 46줄을 그대로 옮겼는지: 원본에서 뽑은 고정본(fixtures)과 한 값씩 비교합니다.
const M: Record<string, 'weight' | 'diameter' | 'firmness' | 'brix' | 'acidity'> = {weight: 'weight', diameter: 'diameter', firmness: 'firmness', brix: 'brix', acidity: 'acidity'};
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('후지 충주·군위·포천·화성 계수가 원본과 같음', () => {
  for (const reg of ['chungju', 'gunwi', 'pocheon', 'hwaseong'] as const) for (const m of Object.keys(M)) {
    const e = (coefs as any)['후지'][reg][m], q = regions[reg].equations[M[m]];
    assert.ok(close(q.intercept, e.i) && close(q.coef.min4, e.min4) && close(q.coef.lc56, e.lc56) && close(q.coef.lc78, e.lc78) && close(q.coef.rain9, e.rain) && q.r2 === e.r2, `${reg} ${m}`);
  }
});

test('홍로 충주·군위·포천·화성·장수 계수가 원본과 같음', () => {
  for (const reg of ['chungju', 'gunwi', 'pocheon', 'hwaseong', 'jangsu'] as const) for (const m of Object.keys(M)) {
    const e = (coefs as any)['홍로'][reg][m], q = HONGRO_REGRESSIONS[reg][M[m]];
    assert.ok(close(q.intercept, e.i) && close(q.chang_min4, e.min4) && close(q.chang_LC56, e.lc56) && close(q.chang_LC78, e.lc78) && close(q.chang_9rain, e.rain) && q.r2 === e.r2, `${reg} ${m}`);
  }
});

test('지역을 바꾸면 다른 식으로 계산하고, 거창은 그대로', () => {
  const w = {chang_min4: 6, chang_LC56: 900, chang_LC78: 1300, chang_9rain: 200};
  const g = estimateHongroInitial(w), c = estimateHongroInitial(w, 'gunwi');
  const e = (coefs as any)['홍로'].gunwi.brix;
  assert.ok(close(c.brix, e.i + e.min4 * 6 + e.lc56 * 900 + e.lc78 * 1300 + e.rain * 200));
  assert.notEqual(g.brix, c.brix);
  const r = calculateHongro({cultivar: 'hongro', region: 'gunwi', source: 'weather', storage: 'cold0', days: 30, weather: w});
  assert.equal(r.metadata.region, 'gunwi');
  const f = predictAll('pocheon', {rain9: 150, lc56: 900, lc78: 1300, min4: 5}), fe = (coefs as any)['후지'].pocheon.acidity;
  assert.ok(close(f.acidity, fe.i + fe.min4 * 5 + fe.lc56 * 900 + fe.lc78 * 1300 + fe.rain * 150));
});

test('충주·군위는 4~5월 최저기온, 8월 강수 / 거창은 4월, 9월', () => {
  const rows: DailyObs[] = [];
  for (let m = 4; m <= 9; m++) for (let d = 1; d <= new Date(Date.UTC(2024, m, 0)).getUTCDate(); d++)
    rows.push({date: `2024-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, mean: 20, min: m === 4 ? 2 : m === 5 ? 8 : 15, rain: m === 8 ? 1 : m === 9 ? 2 : 0});
  const get = (opt: {minTo: number; rainMonth: number}) => Object.fromEntries(computeHongroWeather(2024, rows, undefined, opt).map(v => [v.key, v.value]));
  const gw = get(WEATHER_STATIONS.gunwi), gc = get(WEATHER_STATIONS.geochang);
  assert.equal(gw.chang_min4, Math.round((2 * 30 + 8 * 31) / 61 * 100) / 100);
  assert.equal(gw.chang_9rain, 31);
  assert.equal(gc.chang_min4, 2);
  assert.equal(gc.chang_9rain, 60);
  assert.equal(gc.chang_LC56, 15 * 61);
});
