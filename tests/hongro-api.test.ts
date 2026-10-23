import test from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../app/api/predictions/hongro/route';

const base = {cultivar:'hongro',region:'geochang',source:'measured',storage:'cold0',days:0,initial:{firmness:68,brix:14.2,acidity:0.18}};
const call = (body: unknown, headers: Record<string,string> = {}) => POST(new Request('https://fruitroom.example/api/predictions/hongro', {method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));
const close = (actual:number, expected:number) => assert.ok(Math.abs(actual-expected)<1e-10, `${actual} != ${expected}`);

test('홍로 API: 0/60/120일 두 온도는 명세의 최종값을 반환',async()=>{
  for(const storage of ['cold0','cold4']) for(const days of [0,60,120]) {
    const r=await call({...base,storage,days}); assert.equal(r.status,200);
    const body=await r.json();
    close(body.predicted.firmness,days===0?68:days===60?61:storage==='cold0'?53.6:52.4);
    close(body.predicted.acidity,days<=60?0.18:storage==='cold0'?0.13:0.15);
    close(body.predicted.brix,14.2);
    assert.equal('weight' in body.predicted,false);
    assert.equal('diameter' in body.predicted,false);
  }
});
test('홍로 API: 직접 요청도 잘못된 일수·품종·지역·저장법·누락·문자열 차단',async()=>{
  const invalid = [
    {...base,days:-1},{...base,days:120.001},{...base,days:'120'},
    {...base,days:null},{...base,days:1e308},{...base,cultivar:'fuji'},
    {...base,region:'cheongsong'},{...base,storage:'ca'},{...base,storage:'mcp'},
    {...base,initial:{firmness:68,brix:14.2}},{...base,initial:{...base.initial,acidity:''}},
    {...base,source:'weather',weather:{chang_LC56:950,chang_LC78:1350,chang_9rain:200}},
  ];
  for(const body of invalid) { const r=await call(body);assert.equal(r.status,400,JSON.stringify(body));assert.equal('predicted' in await r.json(),false); }
});
test('홍로 API: JSON·본문크기·동일 출처 검증',async()=>{
  assert.equal((await call(base,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await call(base,{'origin':'https://another.example'})).status,403);
  assert.equal((await call(base,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await call({...base,padding:'a'.repeat(9000)})).status,413);
  assert.equal((await POST(new Request('https://fruitroom.example/api/predictions/hongro',{method:'POST',headers:{'Content-Type':'application/json'},body:'{' }))).status,400);
});
