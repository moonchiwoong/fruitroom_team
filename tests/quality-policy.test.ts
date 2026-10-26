import test from 'node:test';
import assert from 'node:assert/strict';
import {allowModelMetric, isCalendarDate, parseOptionalNumber, pressureConversion, restrictLegacyLoss, trackedLoss} from '../lib/quality-policy';
import {addDays, computeSeries, daysBetween, describeChange, isDate, kgfToN, measuredPoints, nToKgf, valueAt, type MetricId} from '../lib/tracker';
import {clearDraft, emptyForm, loadDraft, payloadFromForm, saveDraft, validateForm} from '../lib/tracker-form';
import {numberOrNull} from '../lib/lot-analysis';
import {csvCell, rowsToCsv} from '../lib/csv';

test('numeric inputs distinguish missing, invalid and actual zero', () => {
  for (const v of ['', '   ', null, undefined]) assert.deepEqual(parseOptionalNumber(v), {status:'missing'});
  for (const v of [0, '0', ' 0.00 ']) assert.deepEqual(parseOptionalNumber(v), {status:'valid',value:0});
  for (const v of ['0x10', '1,200', '10 N', 'NaN', Infinity, {}, [], false]) assert.equal(parseOptionalNumber(v).status,'invalid');
  assert.deepEqual(parseOptionalNumber('0.125'),{status:'valid',value:0.125});
});

test('server numeric validation does not coerce whitespace or invalid format to zero', () => {
  assert.equal(numberOrNull('   ',0,300,'경도'),null);
  assert.equal(numberOrNull('0',0,300,'경도'),0);
  for(const v of ['0x10','invalid',NaN,{}]) assert.throws(()=>numberOrNull(v,0,300,'경도'));
  assert.throws(()=>numberOrNull(301,0,300,'경도'),/저장 허용 범위/);
});

test('invalid calendar dates never throw and leap days are strict', () => {
  for(const d of ['2026-13-01','2026-00-01','2026-02-30','2026-02-29','2026-01-99','junk','']) {
    assert.doesNotThrow(()=>isDate(d)); assert.equal(isCalendarDate(d),false);
  }
  assert.equal(isDate('2024-02-29'),true);
  assert.equal(isDate('2026-10-23'),true);
});

test('calendar day arithmetic preserves day zero, leap day and year boundaries', () => {
  assert.equal(daysBetween('2026-10-23','2026-10-23'),0);
  assert.equal(daysBetween('2024-02-28','2024-03-01'),2);
  assert.equal(daysBetween('2025-12-31','2026-01-01'),1);
  assert.equal(addDays('2024-02-28',1),'2024-02-29');
  assert.equal(addDays('2026-13-01',1),'');
  assert.equal(addDays('0099-12-31',1),'0100-01-01');
});

const initial={sampleId:'tracked-A',weight:300,date:'2026-09-01'};
test('tracked loss requires a confirmed matching sample, weights and ordered dates', () => {
  assert.deepEqual(trackedLoss(initial,{sampleId:'tracked-A',weight:285,date:'2026-09-11'}),{ok:true,value:5});
  for(const later of [
    {sampleId:'tracked-B',weight:285,date:'2026-09-11'},
    {weight:285,date:'2026-09-11'},
    {sampleId:'tracked-A',weight:285,date:'2026-08-31'},
    {sampleId:'tracked-A',weight:285,date:'2026-13-01'},
    {sampleId:'tracked-A',weight:null,date:'2026-09-11'},
  ]) assert.equal(trackedLoss(initial,later).ok,false);
  assert.equal(trackedLoss({...initial,weight:0},{sampleId:'tracked-A',weight:0,date:'2026-09-11'}).ok,false);
  assert.equal(trackedLoss({...initial,date:null},{sampleId:'tracked-A',weight:285,date:'2026-09-11'}).ok,false);
  assert.deepEqual(trackedLoss(initial,{sampleId:'tracked-A',weight:0,date:'2026-09-11'}),{ok:true,value:100});
});

test('old observations without sample identity are not reinterpreted as measured loss', () => {
  const row={id:'o1',date:'2026-09-11',firmness:0,brix:null,tracked_weight:285,sample_count:10};
  assert.deepEqual(measuredPoints('loss',[row],'2026-09-01','실측',300),[]);
  assert.deepEqual(measuredPoints('loss',[row],'2026-09-01','실측',300,{sampleId:'tracked-A',date:'2026-09-01'}),[]);
  const valid={...row,details:{tracked:{sample_id:'tracked-A'}}};
  const points=measuredPoints('loss',[valid],'2026-09-01','실측',300,{sampleId:'tracked-A',date:'2026-09-01'});
  assert.equal(points.length,1);assert.equal(points[0].value,5);assert.equal(points[0].date,'2026-09-11');
  assert.equal(measuredPoints('firmness',[row],'2026-09-01','실측',null)[0].value,0);
});

test('model loss needs no measured weight and remains separate from tracked observations', () => {
  const options={metric:'loss' as const,anchor:{day:0,date:'2026-09-01',value:0,kind:'실측' as const,source:'initial' as const},recorded:'cold' as const,future:'cold' as const,asOfDay:10};
  for(const anchor of [null,options.anchor,{...options.anchor,kind:'예시' as const}]) {
    const curve=computeSeries({...options,anchor});
    assert.equal(curve.ok,true);
    const day0=valueAt(curve,0),day120=valueAt(curve,120);
    assert.equal(day0.status,'ok');if(day0.status==='ok')assert.equal(day0.value,0);
    assert.equal(day120.status,'ok');if(day120.status==='ok')assert.ok(Math.abs(day120.value-1.62084)<1e-12);
  }
  assert.equal(allowModelMetric('loss','모델 계산').ok,true);
  assert.equal(trackedLoss({sampleId:'a',date:'2026-09-01',weight:null},{sampleId:'a',date:'2026-09-02',weight:280}).ok,false);
});

test('diameter alone never authorizes pressure conversion', () => {
  assert.equal(pressureConversion(9.80665,{diameterMm:11.1}).ok,false);
  assert.equal(pressureConversion(9.80665,{diameterMm:11.1,effectiveAreaCm2:1,methodConfirmed:true}).ok,false);
  assert.deepEqual(pressureConversion(9.80665,{diameterMm:11.1,effectiveAreaCm2:1,methodConfirmed:true,assumption:'유효 면적 확인',evidence:'측정법 근거 test-fixture'}),{ok:true,value:1});
});

test('force display conversion preserves the standard and zero', () => {
  assert.equal(kgfToN(1),9.80665);assert.equal(nToKgf(9.80665),1);assert.equal(nToKgf(0),0);
});

test('legacy prediction output has no unsubstantiated weight loss', () => {
  const raw={weightLoss:4,firmness:72,limitations:['검증 미확인']};
  const guarded=restrictLegacyLoss(raw);
  assert.equal(guarded.weightLoss,null);assert.equal(guarded.firmness,72);assert.equal(raw.weightLoss,4);
});

test('form payload preserves missing and zero and serializes sample identity', () => {
  const f=emptyForm();f.firmness='0';f.tracked.sample_id=' tracked-A ';
  const p=payloadFromForm(f);
  assert.equal(p.firmness,0);assert.equal(p.brix,null);assert.equal(p.details.tracked.sample_id,'tracked-A');
  f.brix='not-a-number';assert.throws(()=>payloadFromForm(f));
  f.brix='';f.initial_measured_on='2026-13-01';assert.match(validateForm(f,false).initial_measured_on??'',/날짜/);
});

test('draft recovery is isolated by user, lot and mode and upgrades nested sample fields', () => {
  const saved=new Map<string,string>();const prior=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)}}});
  try {
    const draft={form:emptyForm(),baseSig:'base',savedAt:'2026-10-23T00:00:00Z'};
    draft.form.firmness='0';assert.equal(saveDraft('A','real','lot1',draft),true);
    assert.equal(loadDraft('A','real','lot1')?.form.firmness,'0');
    for(const [u,m,l] of [['B','real','lot1'],['A','example','lot1'],['A','real','lot2']]) assert.equal(loadDraft(u,m,l),null);
    const key='appletrack:draft:v1:A:real:lot1';const old=JSON.parse(saved.get(key)!);delete old.form.tracked.sample_id;saved.set(key,JSON.stringify(old));
    assert.equal(loadDraft('A','real','lot1')?.form.tracked.sample_id,'');
    clearDraft('A','real','lot1');assert.equal(loadDraft('A','real','lot1'),null);
  } finally { if(prior) Object.defineProperty(globalThis,'window',prior); else Reflect.deleteProperty(globalThis,'window'); }
});

test('rounded zero difference uses the unchanged summary', () => {
  assert.equal(describeChange('firmness',72.001,72).short,'변화 없음');
});

test('CSV names cannot become formulas while signed numeric measurements remain numeric', () => {
  for(const value of ['=1+1','+SUM(A1:A2)','@SUM(A1:A2)','-SUM(A1:A2)','\t=HYPERLINK("https://example.invalid")']) assert.ok(csvCell(value).replace(/^"/,'').startsWith("'"));
  assert.equal(csvCell(-1.25),'-1.25');assert.equal(csvCell('-1.25'),'-1.25');assert.equal(csvCell('+2.0'),'+2.0');
  assert.equal(csvCell('후지, A동'),'"후지, A동"');assert.equal(csvCell('표본 "A"'),'"표본 ""A"""');
  assert.equal(rowsToCsv([['이름','측정값'],['=1+1',-0.3]]),"이름,측정값\n'=1+1,-0.3");
});

// Cold/CA parity comes from the uploaded source. MCP firmness now follows the
// verified latest workbook's E6 (y=y0), with provenance retained in model metadata.
const parity: [MetricId,'cold'|'mcp'|'ca',number,number][]=[
  ['firmness','cold',71.848937,71.731953],['firmness','mcp',72,71.883016],['firmness','ca',71.954042,71.837058],
  ['brix','cold',14.189,14.105],['brix','mcp',14.222,14.138],['brix','ca',14.167,14.083],
  ['acidity','cold',0.36213760094920483,0.3266835700870449],['acidity','mcp',0.36592592592592593,0.3301010101010101],['acidity','ca',0.36592592592592593,0.3301010101010101],
];
test('verified workbook models preserve the original time axis across a condition-change scenario', () => {
  for(const [metric,recorded,v14,v42] of parity){
    const initialValue=metric==='firmness'?72:metric==='brix'?14.2:0.38;
    const s=computeSeries({metric,anchor:{day:3,date:'2026-09-04',value:initialValue,kind:'실측',source:'initial'},recorded,future:'ca',asOfDay:14});
    for(const [day,expected] of [[3,initialValue],[14,v14],[42,v42]]){const a=valueAt(s,day);assert.equal(a.status,'ok');if(a.status==='ok')assert.ok(Math.abs(a.value-expected)<1e-12,`${metric}/${recorded}/day${day}`);}
    assert.equal(valueAt(s,2).status,'before');assert.equal(valueAt(s,NaN).status,'unavailable');
  }
});
