import test from 'node:test';
import assert from 'node:assert/strict';
import {HONGRO_MODEL_VERSION, HONGRO_UNITS} from '../lib/hongro';
import {calculateHongroForm, emptyHongroForm, hongroStorageStart, validateHongroForm} from '../lib/hongro-tracker';
import {emptyForm, formFromLot, loadDraft, payloadFromForm, saveDraft, signature, validateForm} from '../lib/tracker-form';
import {demoLots} from '../lib/demo-lots';
import type {Lot, LotDetails} from '../lib/lot-types';
import {contextSchema} from '../lib/ai/contracts';
import {MODEL_VERSION} from '../lib/tracker';

function measuredForm() {
  const f=emptyForm();
  f.name='홍로 실측 물량';f.variety='거창 홍로';f.intake_date='2026-09-01';
  f.hongro.initial={firmness:'68',brix:'14.2',acidity:'0.18',weight:'',diameter:''};
  return f;
}
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const asLot=(payload:ReturnType<typeof payloadFromForm>):Lot=>({...demoLots()[0],...payload,details:payload.details as LotDetails});

test('unified Hongro form preserves measured 0/60/120-day endpoints for both temperatures',()=>{
  for(const storage of ['cold0','cold4'] as const)for(const days of [0,60,120]){
    const f=measuredForm();f.hongro.storage=storage;
    const r=calculateHongroForm(f.hongro,days);
    near(r.predicted.firmness,days===0?68:days===60?61:storage==='cold0'?53.6:52.4);
    near(r.predicted.acidity,days<=60?0.18:storage==='cold0'?0.13:0.15);
    assert.equal(r.predicted.brix,14.2);
    assert.equal('weight' in r.predicted,false);assert.equal('diameter' in r.predicted,false);
  }
});

test('Hongro form rejects missing active inputs and dates outside the 120-day model',()=>{
  const f=measuredForm();
  for(const days of [-1,120.001,NaN,Infinity])assert.throws(()=>calculateHongroForm(f.hongro,days));
  f.hongro.initial.acidity='';
  assert.ok(validateHongroForm(f.hongro)['hongro.initial.acidity']);
  assert.ok(validateForm(f,false)['hongro.initial.acidity']);
  assert.throws(()=>calculateHongroForm(f.hongro,0));
  f.hongro={...emptyHongroForm(),source:'weather'};
  assert.equal(Object.keys(validateHongroForm(f.hongro)).length,4);
  assert.equal(hongroStorageStart({...f,sameStart:true,storage_start_date:'2026-09-03'}),'2026-09-01');
  assert.equal(hongroStorageStart({...f,sameStart:false,storage_start_date:'2026-09-03'}),'2026-09-03');
});

test('Hongro serialization uses dedicated measured values and preserves model provenance',()=>{
  const f=measuredForm();f.hongro.storage='cold4';f.hongro.initial.weight='250';f.hongro.initial.diameter='80';
  f.firmness='999';f.brix='999';f.acidity='999';f.weight='999';f.storage='CA';f.mcp='처리';
  const p=payloadFromForm(f);
  const h=p.details.hongro;assert.ok(h);
  assert.equal(p.record_mode,'real');assert.equal(p.variety,'거창 홍로');
  assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[68,14.2,0.18,250]);
  assert.equal(p.storage,'일반 저온');assert.equal(p.mcp,'미처리');
  assert.equal(h.schemaVersion,1);assert.equal(h.modelVersion,HONGRO_MODEL_VERSION);assert.equal(h.mode,'real');
  assert.equal(h.cultivar,'hongro');assert.equal(h.region,'geochang');assert.equal(h.source,'measured');assert.equal(h.storage,'cold4');
  assert.deepEqual(h.units,HONGRO_UNITS);assert.equal(h.initial.diameter,80);
  for(const section of [p.details.mcp,p.details.ca,p.details.tracked])assert.ok(Object.values(section).every(value=>value===null));
  const restored=formFromLot(asLot(p));
  assert.deepEqual(restored.hongro,f.hongro);assert.equal(restored.variety,f.variety);
});

test('weather-derived Hongro data is not saved as measured quality and survives a round trip',()=>{
  const f=measuredForm();f.hongro.source='weather';f.hongro.storage='cold4';
  f.hongro.weather={chang_min4:'5',chang_LC56:'950',chang_LC78:'1300',chang_9rain:'200'};
  const result=calculateHongroForm(f.hongro,0),p=payloadFromForm(f);
  const h=p.details.hongro;assert.ok(h);
  assert.equal(result.metadata.initialKind,'기상 회귀 추정');
  assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[null,null,null,null]);
  assert.equal(h.source,'weather');assert.deepEqual(h.weather,{chang_min4:5,chang_LC56:950,chang_LC78:1300,chang_9rain:200});
  assert.deepEqual(formFromLot(asLot(p)).hongro,f.hongro);
});

test('Fuji payload excludes stale Hongro inputs and keeps Fuji measurements and conditions',()=>{
  const f=measuredForm();f.variety='후지';f.firmness='72';f.brix='14';f.acidity='0.38';f.weight='285';
  f.storage='CA';f.mcp='처리';f.tracked.sample_id='fuji-sample';
  const p=payloadFromForm(f);
  assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[72,14,0.38,285]);
  assert.equal(p.storage,'CA');assert.equal(p.mcp,'처리');assert.equal('hongro' in p.details,false);
  assert.ok('tracked' in p.details);assert.equal(p.details.tracked.sample_id,'fuji-sample');
  const fakeHongroDetails=payloadFromForm(measuredForm()).details;
  assert.deepEqual(formFromLot({...asLot(p),details:fakeHongroDetails as LotDetails}).hongro,emptyHongroForm());
});

test('example mode cannot produce a real record payload for either cultivar',()=>{
  for(const variety of ['후지','홍로'])assert.throws(()=>payloadFromForm({...measuredForm(),variety},'example'),/예시/);
  const f=measuredForm();const before=signature(f);
  payloadFromForm(f);assert.equal(signature(f),before);
  f.hongro.storage='cold4';assert.notEqual(signature(f),before);
});

test('legacy Hongro records keep their measurements but do not invent dedicated model provenance',()=>{
  const legacy:Lot={...demoLots()[0],variety:'홍로',firmness:72,brix:14.2,acidity:0.38,weight:285,details:{}};
  const f=formFromLot(legacy);
  assert.equal(f.firmness,'72');assert.equal(f.brix,'14.2');assert.equal(f.acidity,'0.38');assert.equal(f.weight,'285');
  assert.deepEqual(f.hongro,emptyHongroForm());
  assert.throws(()=>calculateHongroForm(f.hongro,0),/입력/);
});

test('AI request validation accepts current Fuji forms and upgrades older forms without Hongro fields',()=>{
  const context={mode:'example',scope:'prediction',lotId:null,form:emptyForm(),metric:'firmness',asOf:'2026-09-01',selectedDate:'2026-09-01',future:'same',useLatest:false,modelVersion:MODEL_VERSION,baseline:null};
  const current=contextSchema.parse(context);
  assert.equal(current.scope,'prediction');if(current.scope!=='prediction')return;
  assert.deepEqual(current.form.hongro,emptyHongroForm());
  const {hongro,...legacyForm}=context.form;
  const legacy=contextSchema.parse({...context,form:legacyForm});
  assert.equal(legacy.scope,'prediction');if(legacy.scope!=='prediction')return;
  assert.deepEqual(legacy.form.hongro,hongro);
  assert.equal(contextSchema.safeParse({...context,form:{...context.form,unexpected:true}}).success,false);
});

test('Hongro draft restores nested inputs, isolates identity and upgrades old drafts without example values',()=>{
  const saved=new Map<string,string>(),prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}}});
  try{
    const f=measuredForm();f.hongro.initial.firmness='0';f.hongro.weather.chang_9rain='0';
    const draft={form:f,baseSig:'saved-base',savedAt:'2026-10-23T00:00:00Z'};
    assert.equal(saveDraft('user-A','real','hongro-A',draft),true);
    assert.deepEqual(loadDraft('user-A','real','hongro-A'),draft);
    for(const [user,mode,lot] of [['user-B','real','hongro-A'],['user-A','example','hongro-A'],['user-A','real','hongro-B']])assert.equal(loadDraft(user,mode,lot),null);
    const key='appletrack:draft:v1:user-A:real:hongro-A';
    const partial=JSON.parse(saved.get(key)!);partial.form.hongro={source:'weather',initial:{firmness:'0'},weather:{chang_9rain:'0'}};
    saved.set(key,JSON.stringify(partial));
    const restored=loadDraft('user-A','real','hongro-A')!;
    assert.equal(restored.form.hongro.source,'weather');assert.equal(restored.form.hongro.storage,'cold0');
    assert.equal(restored.form.hongro.initial.firmness,'0');assert.equal(restored.form.hongro.initial.brix,'');
    assert.equal(restored.form.hongro.weather.chang_9rain,'0');assert.equal(restored.form.hongro.weather.chang_min4,'');
    delete partial.form.hongro;saved.set(key,JSON.stringify(partial));
    assert.deepEqual(loadDraft('user-A','real','hongro-A')?.form.hongro,emptyHongroForm());
  }finally{if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window');}
});

test('switching to Hongro weather input ignores invalid inactive measurements when saving',()=>{
  for(const key of ['firmness','brix','acidity','weight','diameter'] as const)for(const value of ['-1','invalid','1e999']){
    const f=measuredForm();
    f.hongro.initial[key]=value;
    f.hongro.source='weather';
    f.hongro.weather={chang_min4:'5',chang_LC56:'950',chang_LC78:'1300',chang_9rain:'200'};
    const before=signature(f);
    assert.deepEqual(validateForm(f,true),{});
    assert.doesNotThrow(()=>calculateHongroForm(f.hongro,30));
    const p=payloadFromForm(f),h=p.details.hongro;assert.ok(h);
    assert.equal(h.initial[key],null);
    assert.deepEqual(h.weather,{chang_min4:5,chang_LC56:950,chang_LC78:1300,chang_9rain:200});
    assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[null,null,null,null]);
    const restored=formFromLot(asLot(p));
    assert.equal(restored.hongro.initial[key],'');
    assert.deepEqual(restored.hongro.weather,f.hongro.weather);
    assert.equal(signature(f),before,'serialization must not change the working draft');
  }
});

test('switching to Hongro measured input ignores malformed inactive weather when saving',()=>{
  for(const key of ['chang_min4','chang_LC56','chang_LC78','chang_9rain'] as const)for(const value of ['invalid','1e999']){
    const f=measuredForm();f.hongro.source='weather';f.hongro.weather[key]=value;
    f.hongro.source='measured';
    const before=signature(f);
    assert.deepEqual(validateForm(f,true),{});
    assert.doesNotThrow(()=>calculateHongroForm(f.hongro,30));
    const p=payloadFromForm(f),h=p.details.hongro;assert.ok(h);
    assert.equal(h.weather[key],null);
    assert.deepEqual([p.firmness,p.brix,p.acidity,p.weight],[68,14.2,0.18,null]);
    const restored=formFromLot(asLot(p));
    assert.equal(restored.hongro.weather[key],'');
    assert.deepEqual(restored.hongro.initial,f.hongro.initial);
    assert.equal(signature(f),before);
  }
});

test('inactive Hongro values that are valid survive saving, including zero and negative weather',()=>{
  const f=measuredForm();
  f.hongro.weather={chang_min4:'-2',chang_LC56:'0',chang_LC78:'1300',chang_9rain:'200'};
  assert.deepEqual(formFromLot(asLot(payloadFromForm(f))).hongro,f.hongro);
  f.hongro.source='weather';f.hongro.initial={firmness:'0',brix:'0',acidity:'0',weight:'0',diameter:'0'};
  assert.deepEqual(formFromLot(asLot(payloadFromForm(f))).hongro,f.hongro);
});

test('active Hongro input errors remain visible and block calculation after source switching',()=>{
  const f=measuredForm();f.hongro.initial.weight='-1';
  assert.ok(validateForm(f,true)['hongro.initial.weight']);
  assert.throws(()=>calculateHongroForm(f.hongro,30));
  f.hongro.source='weather';f.hongro.weather={chang_min4:'invalid',chang_LC56:'950',chang_LC78:'1300',chang_9rain:'200'};
  assert.ok(validateForm(f,true)['hongro.weather.chang_min4']);
  assert.throws(()=>calculateHongroForm(f.hongro,30));
  assert.throws(()=>payloadFromForm(f));
});
