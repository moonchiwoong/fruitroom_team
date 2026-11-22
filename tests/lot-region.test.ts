import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lotRegionLabel} from '../lib/lot-region';

test('홍로 날씨 시작 사과는 저장된 산지 이름을 보여 준다(충주가 거창으로 나오지 않음)', () => {
  assert.equal(lotRegionLabel({details: {hongro: {source: 'weather', region: 'chungju'}}} as never), '충주');
  assert.equal(lotRegionLabel({details: {hongro: {source: 'weather'}}} as never), '거창');
});
test('후지 날씨 시작 사과는 fuji_weather 산지를 쓴다', () => {
  assert.equal(lotRegionLabel({details: {fuji_weather: {region: 'gunwi'}}} as never), '군위');
});
test('산지 정보가 없으면 이름을 지어내지 않는다', () => {
  assert.equal(lotRegionLabel({details: {hongro: {source: 'measured', region: 'chungju'}}} as never), null);
  assert.equal(lotRegionLabel({details: {}} as never), null);
});
