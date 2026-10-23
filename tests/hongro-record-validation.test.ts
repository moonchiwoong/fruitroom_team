import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanDetails, createLot} from '../lib/lot-server';
import {InputError} from '../lib/lot-analysis';
import {emptyForm, payloadFromForm} from '../lib/tracker-form';
import {HONGRO_MODEL_VERSION, HONGRO_UNITS} from '../lib/hongro';

function record() {
  const form=emptyForm();form.variety='홍로';form.name='홍로 검증';form.intake_date='2020-09-01';
  form.hongro.initial={firmness:'68',brix:'14.2',acidity:'0.18',weight:'0',diameter:'0'};
  return payloadFromForm(form);
}
const request=(body:unknown)=>new Request('https://fruitroom.example/api/lots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('server allowlist preserves Hongro zeros, missing weather and exact provenance',()=>{
  const p=record(),result=cleanDetails(p.details) as Record<string,any>;
  assert.deepEqual(result,p.details);
  assert.ok(result.hongro);
  assert.equal(result.hongro.initial.weight,0);assert.equal(result.hongro.initial.diameter,0);
  assert.equal(result.hongro.weather.chang_min4,null);
  assert.equal(result.hongro.modelVersion,HONGRO_MODEL_VERSION);assert.deepEqual(result.hongro.units,HONGRO_UNITS);
  const extra={...p.details,untrusted:'discard',hongro:{...result.hongro,unexpectedPrediction:99,initial:{...result.hongro.initial,extra:99}}};
  assert.deepEqual(cleanDetails(extra),result);
});

test('server rejects altered Hongro origin, units, source, model, storage and nonfinite numbers',()=>{
  const base=cleanDetails(record().details) as Record<string,any>,h=base.hongro;
  const variants=[
    {...h,schemaVersion:2},{...h,cultivar:'fuji'},{...h,region:'cheongsong'},
    {...h,modelVersion:'other-model'},{...h,mode:'example'},
    {...h,source:'unknown'},{...h,storage:'ca'},
    {...h,initial:[]},{...h,weather:null},{...h,units:{...h.units,firmness:'kgf'}},
    {...h,initial:{...h.initial,firmness:-1}},{...h,initial:{...h.initial,brix:Infinity}},
    {...h,weather:{...h.weather,chang_min4:NaN}},
  ];
  for(const hongro of variants)assert.throws(()=>cleanDetails({...base,hongro}),InputError);
});

test('create-record rejects examples and cultivar/condition mismatches before database access',async()=>{
  const p=record();
  for(const patch of [{record_mode:'example'},{mode:'example'},{sampleOnly:true},{record_mode:'unknown'}]){
    await assert.rejects(()=>createLot(request({...p,...patch})),e=>e instanceof InputError&&/예시/.test(e.message));
  }
  for(const patch of [{variety:'후지',weight:250},{storage:'CA'},{mcp:'처리'},{firmness:72}]){
    await assert.rejects(()=>createLot(request({...p,...patch})),e=>e instanceof InputError&&/홍로/.test(e.message));
  }
});

test('create-record refuses a weather estimate relabeled as measured quality',async()=>{
  const f=emptyForm();f.name='홍로 기상';f.variety='홍로';f.intake_date='2020-09-01';f.hongro.source='weather';
  f.hongro.weather={chang_min4:'5',chang_LC56:'950',chang_LC78:'1300',chang_9rain:'200'};
  const p=payloadFromForm(f);
  assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[null,null,null,null]);
  await assert.rejects(()=>createLot(request({...p,firmness:56.967449})),e=>e instanceof InputError&&/실측값으로 저장할 수 없습니다/.test(e.message));
});
