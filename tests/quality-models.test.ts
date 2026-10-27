import test from 'node:test';
import assert from 'node:assert/strict';
import {predictQuality,getQualitySeries,predictAllQuality,calculateMeasuredLoss,MODEL_REGISTRY,FUJI_MODEL_VERSION,HONGRO_REFERENCE_NOTICE,type QualityInput,type QualityMetric} from '../lib/quality-models';
import {computeSeries,valueAt} from '../lib/tracker';
import {storageValue} from '../lib/initial-quality';

const near=(actual:number|null,expected:number,epsilon=1e-10)=>assert.ok(actual!==null&&Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);
const hongro=(metric:QualityMetric='firmness',day=0,temperature=0):QualityInput=>({cultivar:'홍로',storage:'cold',temperature,mcp:'untreated',metric,day,anchor:metric==='loss'?undefined:{day:0,value:metric==='firmness'?68:metric==='brix'?14:0.18}});
const fuji=(metric:QualityMetric='loss',day=0):QualityInput=>({...hongro(metric,day),cultivar:'후지',temperature:null});

test('shared model registry is unique and returns explicit provenance, null failures, percent units',()=>{
  assert.equal(new Set(MODEL_REGISTRY.map(m=>m.id)).size,MODEL_REGISTRY.length);
  const r=predictQuality(hongro());assert.equal(r.ok,true);assert.equal(r.unit,'N');assert.ok(r.source.length===2);assert.equal(r.range?.max,120);assert.match(r.validation,/근사 모델/);
  const unavailable=predictQuality({...hongro(),anchor:null});assert.equal(unavailable.ok,false);assert.equal(unavailable.value,null);assert.match(unavailable.reason??'',/초기/);
  near(predictQuality(hongro('acidity')).value,0.18);near(predictQuality(fuji('loss',120)).value,1.62084);
});
test('day zero preserves all available model initial values and loss zero without weighing',()=>{
  for(const temperature of [0,4])for(const metric of ['firmness','brix','acidity'] as const){const input=hongro(metric,0,temperature);near(predictQuality(input).value,input.anchor!.value);}
  for(const storage of ['cold','ca'] as const)for(const mcp of ['untreated','treated'] as const){
    if(storage==='ca'&&mcp==='treated')continue;
    for(const metric of ['firmness','brix','acidity','loss'] as const){const input={...fuji(metric),storage,mcp};near(predictQuality(input).value,metric==='loss'?0:input.anchor!.value);}
  }
  near(predictQuality(hongro('loss')).value,0);near(predictQuality(hongro('loss',0,4)).value,0);
});
test('Hongro 60-day boundary is continuous and 120-day endpoints depend on initial values',()=>{
  for(const temperature of [0,4]){
    for(const metric of ['firmness','brix','acidity'] as const){
      const center=predictQuality(hongro(metric,60,temperature)).value!;
      near(predictQuality(hongro(metric,60-1e-7,temperature)).value,center,2e-8);
      near(predictQuality(hongro(metric,60+1e-7,temperature)).value,center,2e-8);
    }
    near(predictQuality(hongro('firmness',60,temperature)).value,61);
    near(predictQuality(hongro('firmness',120,temperature)).value,temperature===0?53.6:52.4);
    near(predictQuality(hongro('acidity',120,temperature)).value,temperature===0?0.13:0.15);
    near(predictQuality({...hongro('firmness',120,temperature),anchor:{day:0,value:72}}).value,temperature===0?57.6:56.4);
    near(predictQuality(hongro('brix',120,temperature)).value,14);
    const overflow=predictQuality(hongro('firmness',121,temperature));assert.equal(overflow.value,null);assert.match(overflow.reason??'',/모델 적용 범위 초과/);
  }
});
test('condition selection rejects absent cultivar, Hongro temperature interpolation, CA and MCP',()=>{
  for(const patch of [{cultivar:'아오리'},{temperature:2},{temperature:null},{storage:'ca' as const},{mcp:'treated' as const},{mcp:'unknown' as const},{storage:'other' as const}]){
    const r=predictQuality({...hongro(),...patch});assert.equal(r.ok,false);assert.equal(r.value,null);assert.equal(r.modelId,null);
  }
  assert.notEqual(predictQuality(hongro('firmness',100,0)).value,predictQuality(hongro('firmness',100,4)).value);
  assert.notEqual(predictQuality(fuji('firmness',100)).value,predictQuality(hongro('firmness',100)).value);
  assert.deepEqual(predictQuality({...hongro(),region:'거창'}),predictQuality({...hongro(),region:'청송'}));
  assert.match(predictQuality({...fuji(),temperature:4}).warnings.join(' '),/온도가 명시되지/);
});
test('Hongro loss uses the dedicated 0℃·4℃ workbook equations (E8·E9) within 0~120 days',()=>{
  const at0=predictQuality(hongro('loss',120));near(at0.value,0.0215*120);assert.equal(at0.kind,'모델 계산');assert.equal(at0.modelId,'hongro-cold0-loss');assert.equal(at0.range?.max,120);
  near(predictQuality(hongro('loss',60,4)).value,0.0272*60);near(predictQuality(hongro('loss',120,4)).value,3.264);
  assert.equal(predictQuality(hongro('loss',121)).value,null);
  assert.equal(predictQuality(hongro('loss',60,2)).value,null);
  assert.equal(predictQuality({...hongro('loss',60),storage:'ca'}).value,null);
  assert.equal(predictQuality({...hongro('loss',60),mcp:'unknown'}).value,null);
  // 다른 품종 식으로 대체하지 않습니다.
  assert.equal(predictQuality({...hongro('loss',60,2),allowFujiReference:true}).value,null);
});
test('late anchors use original nonlinear and piecewise time axis, including ratio models',()=>{
  const day=100,t0=50,measured=65;
  near(predictQuality({...hongro('firmness',day),anchor:{day:t0,value:measured}}).value,measured-(60-t0)*7/60-(day-60)*7.4/60);
  near(predictQuality({...hongro('acidity',100),anchor:{day:80,value:0.17}}).value,0.17-20*0.05/60);
  near(predictQuality({...fuji('brix',220),anchor:{day:150,value:14}}).value,14-0.006*20);
  near(predictQuality({...fuji('acidity',100),anchor:{day:50,value:0.3}}).value,0.3*Math.exp(-0.004377*50));
  const loss=predictQuality({...fuji('loss',120),anchor:{day:60,value:1}});near(loss.value,1+(0.007807*120+0.0000475*120*120)-(0.007807*60+0.0000475*60*60));
  assert.equal(predictQuality({...hongro('firmness',10),anchor:{day:20,value:60}}).value,null);
  assert.equal(predictQuality({...hongro(),day:-1}).value,null);
  assert.equal(predictQuality({...hongro(),anchor:{day:-1,value:60}}).value,null);
});
test('Hongro clamps after applying the raw delta, never clamps the offset function early',()=>{
  near(predictQuality({...hongro('firmness',120),anchor:{day:60,value:10}}).value,2.6);
  near(predictQuality({...hongro('firmness',120),anchor:{day:60,value:1}}).value,0);
  near(predictQuality({...hongro('acidity',120),anchor:{day:60,value:0.01}}).value,0);
});
test('measured and predicted loss are independent and missing evidence is not zero',()=>{
  const first={sampleId:'sample-a',date:'2026-09-01',weight:200};
  const later={sampleId:'sample-a',date:'2026-10-01',weight:190};
  const measured=calculateMeasuredLoss(first,later);near(measured.value,5);assert.equal(measured.kind,'실측');
  for(const bad of [{...later,sampleId:'b'},{...later,date:'2026-02-30'},{...later,date:'2026-08-31'},{...later,weight:null}]){
    const result=calculateMeasuredLoss(first,bad);assert.equal(result.value,null);assert.equal(result.ok,false);
  }
  const predicted=predictQuality(fuji('loss',30));assert.equal(predicted.kind,'모델 계산');assert.notEqual(predicted.value,measured.value);
  const series=computeSeries({variety:'후지',metric:'loss',anchor:null,recorded:'cold',future:'cold',asOfDay:30});
  assert.equal(series.ok,true);const at=valueAt(series,30);assert.equal(at.status,'ok');if(at.status==='ok')near(at.value,predicted.value!);
});
test('series, legacy wrappers, metrics and serializable exports share the same exact values',()=>{
  for(const input of [fuji('loss'),fuji('firmness'),hongro('firmness'),hongro('loss')]){
    const points=getQualitySeries(input,{to:120}),json=JSON.parse(JSON.stringify(points));
    for(const day of [0,60,120]){
      assert.deepEqual(points[day],{day,...predictQuality({...input,day})});assert.deepEqual(json[day],points[day]);
    }
  }
  near(storageValue('mcp','firmness',120,{firmness:72,brix:14,acidity:0.18}),72);
  const mcp=predictQuality({...fuji('firmness',120),mcp:'treated'});assert.equal(mcp.modelVersion,FUJI_MODEL_VERSION);assert.ok(mcp.warnings.some(w=>w.includes('E6')&&w.includes('불일치')));
  const all=predictAllQuality({cultivar:'홍로',storage:'cold',temperature:0,mcp:'untreated',day:120,anchors:{firmness:{day:0,value:68},brix:{day:0,value:14},acidity:{day:0,value:0.18}}});
  near(all.firmness.value,53.6);near(all.loss.value,2.58);
});
test('condition transitions preserve time axis and are marked as unvalidated scenarios',()=>{
  const r=computeSeries({variety:'후지',metric:'brix',anchor:{day:50,date:'2026-10-21',value:14,kind:'실측',source:'initial'},recorded:'cold',future:'mcp',asOfDay:150});
  const before=valueAt(r,150),after=valueAt(r,220);assert.equal(before.status,'ok');assert.equal(after.status,'ok');
  if(before.status==='ok'&&after.status==='ok'){
    near(before.value,13.95);near(after.value,before.value+(0.002*220+0.004*120-0.022*20)-(0.002*150+0.004*50));
    assert.ok(after.result?.warnings.some(w=>w.includes('조건 변경 시나리오')));
  }
});
