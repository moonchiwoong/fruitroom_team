import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REGION_KEYS, REGIONS, FUJI_REGION_KEYS, HONGRO_REGION_KEYS} from '../lib/regions';
import {regions as FUJI_TABLE} from '../lib/initial-quality';
import {HONGRO_REGRESSIONS} from '../lib/hongro';
import {WEATHER_STATIONS} from '../lib/rda-weather';
import {PROFILE_REGIONS} from '../lib/profile-regions';
import {MAP_PINS} from '../components/region-map-picker';

const sorted = (a: readonly string[]) => [...a].sort();

test('산지 목록과 산지 정보가 서로 맞는다', () => {
  assert.deepEqual(sorted(Object.keys(REGIONS)), sorted(REGION_KEYS));
  for (const k of [...FUJI_REGION_KEYS, ...HONGRO_REGION_KEYS]) assert.ok(REGION_KEYS.includes(k), k);
  for (const k of REGION_KEYS) assert.ok((FUJI_REGION_KEYS as readonly string[]).includes(k) || (HONGRO_REGION_KEYS as readonly string[]).includes(k), `${k}: 회귀식이 있는 품종이 없음`);
});
test('품종별 산지 목록 = 회귀식 계수가 있는 산지', () => {
  assert.deepEqual(sorted(Object.keys(FUJI_TABLE)), sorted(FUJI_REGION_KEYS));
  assert.deepEqual(sorted(Object.keys(HONGRO_REGRESSIONS)), sorted(HONGRO_REGION_KEYS));
  for (const k of FUJI_REGION_KEYS) { assert.equal(FUJI_TABLE[k].name, REGIONS[k].label); assert.equal(FUJI_TABLE[k].area, REGIONS[k].area); }
});
// 한 파일로 모으기 전의 값과 똑같은지(정리 전 코드에 적혀 있던 값 그대로).
test('관측지점·기간이 정리 전과 같다', () => {
  assert.deepEqual(WEATHER_STATIONS, {
    geochang: {name: '거창군 거창읍', code: '670807A001', label: '거창', cultivar: '홍로', minTo: 4, rainMonth: 9},
    cheongsong: {name: '청송군 청송읍', code: null, label: '청송', cultivar: '후지', minTo: 4, rainMonth: 9},
    jangsu: {name: '장수군 장수읍', code: null, label: '장수', cultivar: '후지·홍로', minTo: 4, rainMonth: 9},
    yeongju: {name: '영주시 봉현면', code: null, label: '영주', cultivar: '후지', minTo: 4, rainMonth: 9},
    chungju: {name: '충주시 안림동', code: null, label: '충주', cultivar: '후지·홍로', minTo: 5, rainMonth: 8},
    gunwi: {name: '군위군 소보면', code: null, label: '군위', cultivar: '후지·홍로', minTo: 5, rainMonth: 8},
    pocheon: {name: '포천시 영북면', code: null, label: '포천', cultivar: '후지·홍로', minTo: 4, rainMonth: 8},
    hwaseong: {name: '화성시 마도면', code: null, label: '화성', cultivar: '후지·홍로', minTo: 4, rainMonth: 8},
  });
});
test('내 정보 주 산지·지도 점이 정리 전과 같다', () => {
  assert.deepEqual(PROFILE_REGIONS, [
    {id: 'geochang', name: '거창', area: '경남 거창군 · 홍로'}, {id: 'cheongsong', name: '청송', area: '경북 청송군 · 후지'},
    {id: 'jangsu', name: '장수', area: '전북 장수군 · 후지·홍로'}, {id: 'yeongju', name: '영주', area: '경북 영주시 · 후지'},
    {id: 'chungju', name: '충주', area: '충북 충주시 · 후지·홍로'}, {id: 'gunwi', name: '군위', area: '대구 군위군 · 후지·홍로'},
    {id: 'pocheon', name: '포천', area: '경기 포천시 · 후지·홍로'}, {id: 'hwaseong', name: '화성', area: '경기 화성시 · 후지·홍로'},
  ]);
  assert.deepEqual(MAP_PINS, {
    pocheon: {x: 172, y: 91, cultivars: ['후지', '홍로']}, hwaseong: {x: 138.5, y: 171, cultivars: ['후지', '홍로'], left: true},
    chungju: {x: 238.5, y: 197, cultivars: ['후지', '홍로']}, yeongju: {x: 302, y: 219, cultivars: ['후지']},
    cheongsong: {x: 342, y: 263, cultivars: ['후지']}, gunwi: {x: 297.5, y: 284.5, cultivars: ['후지', '홍로']},
    jangsu: {x: 202, y: 352, cultivars: ['후지', '홍로'], left: true}, geochang: {x: 237, y: 348, cultivars: ['홍로']},
  });
});
