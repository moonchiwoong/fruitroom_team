import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lotRegionLabel} from '../lib/lot-region';
import {cleanDetails} from '../lib/lot-server';

test('홍로 날씨 시작 사과는 저장된 산지 이름을 보여 준다(충주가 거창으로 나오지 않음)', () => {
  assert.equal(lotRegionLabel({details: {hongro: {source: 'weather', region: 'chungju'}}} as never), '충주');
  assert.equal(lotRegionLabel({details: {hongro: {source: 'weather'}}} as never), null);
});
test('후지 날씨 시작 사과는 fuji_weather 산지를 쓴다', () => {
  assert.equal(lotRegionLabel({details: {fuji_weather: {region: 'gunwi'}}} as never), '군위');
});
test('홍로 실측 기록의 예전 공통 생산지보다 품종별로 실제 저장한 산지를 우선한다', () => {
  assert.equal(lotRegionLabel({details: {region: 'geochang', hongro: {source: 'measured', region: 'pocheon'}}} as never), '포천');
  assert.equal(lotRegionLabel({details: {hongro: {source: 'measured', region: 'chungju'}}} as never), '충주');
});
test('홍로 실측의 명시적 거창 선택과 과거의 기본값을 구분한다', () => {
  const hongro = {source: 'measured', region: 'geochang'};
  assert.deepEqual(cleanDetails({region: 'geochang', region_confirmed: true}), {region: 'geochang', region_confirmed: true});
  assert.deepEqual(cleanDetails({region: null, region_confirmed: true}), {region: null});
  assert.equal(lotRegionLabel({details: {region: 'geochang', region_confirmed: true, hongro}} as never), '거창');
  assert.equal(lotRegionLabel({details: {region: 'geochang', hongro}} as never), null);
  assert.equal(lotRegionLabel({details: {region: null, hongro}} as never), null);
  assert.equal(lotRegionLabel({details: {}} as never), null);
});
