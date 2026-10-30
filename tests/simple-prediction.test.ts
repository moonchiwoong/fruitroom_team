import assert from 'node:assert/strict';
import test from 'node:test';
import {simplePrediction} from '../lib/simple-prediction';
const weather={min4:4,lc56:920,lc78:1300,rain9:150};
test('장수와 영주는 후지의 지원 저장 조건만 비교한다',()=>{
  for (const region of ['jangsu','yeongju'] as const) {
    const result=simplePrediction(region,weather);
    assert.equal(result.cultivar,'fuji');
    assert.deepEqual(result.conditions.map(x=>x.label),['일반 저온 · 1-MCP 미처리','일반 저온 · 1-MCP 처리','CA 저장 · 1-MCP 미처리']);
    assert.equal(result.conditions[0]?.rows.at(-1)?.day,300);
    assert.equal(result.conditions[0]?.rows[0]?.values.firmness.value,null);
    assert.equal(result.conditions[0]?.rows[0]?.values.firmness.ok,false);
  }
});
test('거창 홍로는 0도와 4도 저온 미처리만 비교한다',()=>{
  const result=simplePrediction('geochang',weather);
  assert.equal(result.cultivar,'hongro');
  assert.deepEqual(result.conditions.map(x=>x.label),['일반 저온 0℃ · 1-MCP 미처리','일반 저온 4℃ · 1-MCP 미처리']);
  assert.equal(result.conditions[0]?.rows.at(-1)?.day,120);
  assert.equal(result.conditions[0]?.rows[0]?.values.firmness.ok,false);
  assert.equal(result.conditions[0]?.rows[0]?.values.firmness.value,null);
});
test('미지원 지역은 다른 지역의 식으로 대체하지 않는다',()=>{
  assert.throws(()=>simplePrediction('cheongsong' as never,weather));
});
