import test from 'node:test';
import assert from 'node:assert/strict';
import {getQualitySeries, predictQuality, QUALITY_METRICS, type QualityInput} from '../lib/quality-models';
import {storageValue, type StorageId} from '../lib/initial-quality';
import {calculateHongro} from '../lib/hongro';
import {buildQualityExportRows, buildQualityExportCsv, type QualityExportInput} from '../lib/quality-export';
import {emptyForm} from '../lib/tracker-form';
import {addDays, computeSeries, metricMeta, valueAt, type MetricId, type Series, type Anchor} from '../lib/tracker';

const initial={firmness:68,brix:14.2,acidity:0.18};
const near=(actual:number|null,expected:number)=>assert.ok(actual!==null&&Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('legacy Fuji values and plotted series delegate to the authoritative model registry',()=>{
  for(const method of ['cold','mcp','ca'] as StorageId[])for(const metric of QUALITY_METRICS)for(const day of [0,60,120,240]){
    const input:QualityInput={cultivar:'후지',storage:method==='ca'?'ca':'cold',mcp:method==='mcp'?'treated':'untreated',temperature:null,metric,day,anchor:metric==='loss'?undefined:{day:0,value:initial[metric]}};
    const authoritative=predictQuality(input);
    assert.equal(authoritative.ok,true);
    near(storageValue(method,metric,day,initial),authoritative.value!);
    const plotted=computeSeries({variety:'후지',metric,anchor:metric==='loss'?null:{day:0,date:'2026-09-01',value:initial[metric],kind:'실측',source:'initial'},recorded:method,future:method,asOfDay:60});
    const at=valueAt(plotted,day);assert.equal(at.status,'ok');if(at.status==='ok')near(at.value,authoritative.value!);
  }
});

test('Hongro API adapter and graph points retain identical values and units for both temperatures',()=>{
  for(const storage of ['cold0','cold4'] as const)for(const day of [0,60,90,120]){
    const api=calculateHongro({cultivar:'hongro',region:'geochang',storage,source:'measured',initial,days:day});
    for(const metric of ['firmness','brix','acidity'] as const){
      const input:QualityInput={cultivar:'홍로',storage:'cold',temperature:storage==='cold0'?0:4,mcp:'untreated',metric,day,anchor:{day:0,value:initial[metric]}};
      const value=predictQuality(input),series=getQualitySeries(input),point=series.find(p=>p.day===day)!;
      near(api.predicted[metric],value.value!);assert.equal(point.value,value.value);
      assert.equal(point.modelVersion,value.modelVersion);assert.deepEqual(point.source,value.source);
      assert.equal(point.unit,metric==='firmness'?'N':metric==='brix'?'°Brix':'%');
    }
  }
});

test('late measured anchors cross Hongro segment boundaries on the original storage axis',()=>{
  for(const temperature of [0,4]){
    const input:QualityInput={cultivar:'홍로',storage:'cold',temperature,mcp:'untreated',metric:'firmness',day:90,anchor:{day:45,value:65}};
    const last=getQualitySeries(input,{to:90}).at(-1)!;
    near(last.value,65-15*7/60-30*(temperature===0?7.4:8.6)/60);
    assert.equal(last.value,predictQuality(input).value);
    assert.notEqual(last.value,predictQuality({...input,day:45,anchor:{day:0,value:65}}).value);
    assert.equal(getQualitySeries(input,{from:44,to:45})[0].value,null);
  }
});

function exportFixture(cultivar:'홍로'|'후지',day:number,reference=false,changedCondition=false):QualityExportInput {
  const form=emptyForm();form.variety=cultivar;form.storage='일반 저온';form.mcp='미처리';form.temperature='0';form.loss_reference=reference;
  form.harvest_date='2026-08-31';form.intake_date='2026-09-01';form.initial_measured_on='2026-09-01';
  const anchors={} as Record<MetricId,Anchor|null>,series={} as Record<MetricId,Series>,modelResults={} as QualityExportInput['modelResults'];
  for(const metric of QUALITY_METRICS){
    anchors[metric]=metric==='loss'?null:{day:0,date:form.intake_date,value:initial[metric],kind:'실측',source:'initial'};
    const input:QualityInput={cultivar,storage:'cold',temperature:0,mcp:'untreated',metric,day,anchor:anchors[metric],allowFujiReference:reference};
    if(cultivar==='후지')series[metric]=computeSeries({variety:form.variety,metric,anchor:anchors[metric],recorded:'cold',future:changedCondition?'ca':'cold',asOfDay:60,horizon:120});
    else {
      const points=getQualitySeries(input,{to:120});
      series[metric]=points[0].ok?{ok:true,startDay:0,endDay:120,asOfDay:60,past:'cold',future:'cold',points:points.filter(p=>p.ok).map(p=>({day:p.day,value:p.value!,segment:p.day<=60?'past':'future',result:p}))}:{ok:false,reason:points[0].reason!};
    }
    const at=valueAt(series[metric],day);
    modelResults[metric]=at.status==='ok'&&at.result?at.result:predictQuality(input);
  }
  return {mode:'real',lotName:'테스트 사과',form,startDate:form.intake_date,selDate:addDays(form.intake_date,day),selDay:day,asOf:addDays(form.intake_date,60),asOfDay:60,futureLabel:changedCondition?'CA 저장':'현재 조건 유지',futureId:changedCondition?'ca':'same',baseline:null,series,modelResults,anchors,measured:{firmness:[],brix:[],acidity:[],loss:[{date:addDays(form.intake_date,120),day:120,value:5,sampleCount:10,kind:'실측',id:'tracked-measurement-120'}]}};
}

test('actual CSV builder exports selected and plotted loss values with percent/reference provenance',()=>{
  for(const allowFujiReference of [false,true]){
    const input=exportFixture('홍로',120,allowFujiReference),rows=buildQualityExportRows(input),csv=buildQualityExportCsv(input),selected=input.modelResults.loss;
    const summary=rows.find(row=>row[0]==='감모율'&&['true','false'].includes(String(row[1])))!;
    const graph=rows.find(row=>row[0]===120&&row[2]==='감모율');
    const measured=rows.find(row=>row[6]==='tracked-measurement-120')!;
    assert.ok(csv.startsWith('\uFEFF애플트랙 품질 결과\n'));
    assert.deepEqual(summary.slice(1,8),[String(selected.ok),selected.value===null?'null':selected.value,'%',selected.kind,selected.modelId||'',selected.modelVersion||'',selected.source.join(' / ')]);
    assert.deepEqual(measured,['감모율',input.selDate,120,5,'%','실측','tracked-measurement-120']);
    // 홍로 0℃ 전용 감모율 식(엑셀 E8)을 쓰며, 다른 품종 식으로 대체하지 않습니다.
    near(Number(summary[2]),0.0215*120);assert.equal(graph?.[3],summary[2]);assert.equal(graph?.[5],'모델 계산');assert.equal(selected.modelId,'hongro-cold0-loss');assert.ok(!csv.includes('후지 기반 참고 추정'));
  }
});

test('actual CSV builder preserves 121-day null results while retaining valid graph and measured records',()=>{
  const input=exportFixture('홍로',121,true),rows=buildQualityExportRows(input);
  for(const metric of QUALITY_METRICS){
    const selected=input.modelResults[metric],summary=rows.find(row=>row[0]===metricMeta[metric].label&&row[1]==='false')!;
    assert.equal(selected.value,null);assert.equal(summary[2],'null');assert.equal(summary[10],selected.reason);assert.match(String(summary[10]),/모델 적용 범위 초과/);
  }
  assert.equal(rows.some(row=>row[0]===121&&typeof row[2]==='string'),false);
  assert.ok(rows.some(row=>row[0]===120&&row[2]==='감모율'&&Math.abs(Number(row[3])-0.0215*120)<1e-12));
  assert.ok(rows.some(row=>row[6]==='tracked-measurement-120'&&row[3]===5));
});

test('actual CSV builder preserves condition-change metadata, baseline and the exact chart values',()=>{
  const input=exportFixture('후지',120,false,true),baseline=exportFixture('후지',120);
  input.baseline={label:'저온 유지 기준',createdAt:'2026-10-26T00:00:00Z',conditionLabel:'일반 저온',asOf:input.asOf,form:baseline.form,series:baseline.series};
  const rows=buildQualityExportRows(input),csv=buildQualityExportCsv(input);
  assert.deepEqual(rows.find(row=>row[0]==='조건 변경 시나리오'),['조건 변경 시나리오','저장 방식 전환 효과 미검증']);
  assert.deepEqual(rows.find(row=>row[0]==='조건 전환 저장일수'),['조건 전환 저장일수',60]);
  assert.deepEqual(rows.find(row=>row[0]==='고정 비교 기준'),['고정 비교 기준','저온 유지 기준']);
  assert.deepEqual(rows.find(row=>row[0]==='고정 입력'),['고정 입력',JSON.stringify(baseline.form)]);
  for(const metric of QUALITY_METRICS){
    const summary=rows.find(row=>row[0]===metricMeta[metric].label&&row[1]==='true')!;
    const graph=rows.find(row=>row[0]===120&&row[2]===metricMeta[metric].label)!;
    const at=valueAt(input.series[metric],120);assert.equal(at.status,'ok');if(at.status==='ok')assert.equal(summary[2],at.value);
    assert.equal(graph[3],summary[2]);assert.equal(graph[6],input.modelResults[metric].modelId);
    assert.ok(String(graph[10]).includes('조건 변경 시나리오'));
  }
  assert.ok(csv.includes('실측 기록 — 모델 계산과 별도'));
});
