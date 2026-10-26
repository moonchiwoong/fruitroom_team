import test from 'node:test';
import assert from 'node:assert/strict';
import {isHongroVariety,HONGRO_DEDICATED_NOTICE} from '../lib/cultivar';
import {demoLots,demoAnalysis} from '../lib/demo-lots';
import {demoPrediction,restrictPredictionForVariety} from '../lib/lot-analysis';
import {formFromLot} from '../lib/tracker-form';
import {computeSeries,MODEL_VERSION,resolveModel,todayKST} from '../lib/tracker';
import {evaluatePrediction} from '../lib/ai/prediction';
import {baselineCore,observationFingerprint} from '../lib/ai/context';
import {AIError,type Actor,type AIContext,type DataAccess,type Evidence} from '../lib/ai/contracts';
import {withMcpClient} from '../lib/ai/mcp';
import {predictQuality} from '../lib/quality-models';
import {daysBetween} from '../lib/tracker';

const asOf=todayKST(),actor:Actor={id:'isolation-test-user',isTeam:false};
function fixture(variety='후지'){
  const lot={...demoLots()[0],owner_id:actor.id,variety};
  const analysis=demoAnalysis(lot,asOf),form=formFromLot(lot);
  if(isHongroVariety(variety)){
    form.temperature='0';form.storage='일반 저온';form.mcp='미처리';
    form.hongro.initial={firmness:'72',brix:'14.2',acidity:'0.38',weight:'',diameter:''};
  }
  const context:Extract<AIContext,{scope:'prediction'}>={mode:'real',scope:'prediction',lotId:lot.id,form,metric:'firmness',asOf,selectedDate:asOf,future:'same',useLatest:false,modelVersion:MODEL_VERSION,baseline:null};
  const data:DataAccess={authenticate:async()=>actor,listLots:async()=>[lot],getLot:async id=>id===lot.id?lot:null,getAnalysis:async()=>analysis};
  return {lot,analysis,context,data};
}

test('Hongro model routing recognizes Korean, Latin, spacing and full-width labels only',()=>{
  for(const value of ['홍로','거창 홍로','  Hongro  ','HONGRO','Geochang Hongro','홍 로','Ｈｏｎｇｒｏ'])assert.equal(isHongroVariety(value),true,value);
  for(const value of ['후지','Fuji','부사','',null,undefined,42])assert.equal(isHongroVariety(value),false,String(value));
});

test('legacy storage engine rejects Hongro without changing Fuji calculation',()=>{
  const options={metric:'firmness' as const,anchor:{day:0,date:'2026-09-01',value:72,kind:'실측' as const,source:'initial' as const},recorded:'cold' as const,future:'cold' as const,asOfDay:10};
  assert.equal(computeSeries({...options,variety:'후지'}).ok,true);
  for(const variety of ['홍로','Hongro']){
    const result=computeSeries({...options,variety});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.reason,HONGRO_DEDICATED_NOTICE);
    assert.equal(resolveModel({variety,storage:'일반 저온',mcp:'미처리'}).id,null);
  }
});

test('AI prediction uses the same Hongro model and retains cultivar-specific provenance',()=>{
  for(const variety of ['홍로','Hongro']){
    const f=fixture(variety);
    const result=evaluatePrediction({...f.context,observations:f.analysis.observations});
    const start=f.context.form.sameStart?f.context.form.intake_date:f.context.form.storage_start_date;
    const expected=predictQuality({cultivar:variety,storage:'cold',temperature:0,mcp:'untreated',metric:'firmness',day:daysBetween(start,asOf),anchor:{day:daysBetween(start,f.context.form.initial_measured_on||start),value:72}});
    assert.equal(result.value,expected.value);assert.ok(result.model.selectedPrediction.modelId?.includes('hongro'));
    assert.deepEqual(result.model.selectedPrediction.source,expected.source);
  }
  const fuji=fixture();assert.notEqual(evaluatePrediction({...fuji.context,observations:fuji.analysis.observations}).value,null);
});

test('MCP authoritative Hongro lot blocks a forged Fuji input while preserving measurement reads',async()=>{
  const f=fixture('거창 홍로');f.context.form={...f.context.form,variety:'후지'};
  await withMcpClient({data:f.data,actor,context:f.context},async client=>{
    for(const name of ['run_existing_quality_prediction','compare_measurement_with_prediction']){
      const result=await client.callTool({name,arguments:{}});assert.equal(result.isError,true);assert.equal((result.structuredContent as {code:string}).code,'cultivar_mismatch');
    }
    const result=await client.callTool({name:'get_quality_measurements',arguments:{}});assert.equal(result.isError,undefined);
    const e=(result.structuredContent as {evidence:Evidence}).evidence;assert.ok(Array.isArray(e.data.records)&&e.data.records.length>0);assert.equal((e.data.initial as {firmness:string}).firmness,'72');
  });
});

test('baseline signature includes cultivar and changing model conditions invalidates comparison',async()=>{
  const f=fixture(),c=f.context;
  assert.notEqual(baselineCore(c.form,false),baselineCore({...c.form,variety:'홍로'},false));
  assert.notEqual(baselineCore(c.form,false),baselineCore({...c.form,mcp:'처리'},false));
  assert.notEqual(baselineCore(c.form,false),baselineCore({...c.form,temperature:'4'},false));
  assert.notEqual(baselineCore(c.form,false),baselineCore({...c.form,loss_reference:true},false));
  for(const patch of [{variety:'홍로'},{storage:'CA' as const},{mcp:'처리' as const}]){
    c.baseline={label:'기준',conditionLabel:'기준',createdAt:new Date().toISOString(),asOf,modelVersion:MODEL_VERSION,future:'cold',form:{...c.form,...patch},useLatest:false,observationsFingerprint:observationFingerprint(f.analysis.observations)};
    await withMcpClient({data:f.data,actor,context:c},async client=>{
      const result=await client.callTool({name:'run_existing_quality_prediction',arguments:{}});assert.equal(result.isError,true);assert.equal((result.structuredContent as {code:string}).code,'baseline_mismatch');
    });
  }
});

test('legacy lot prediction never creates Hongro numeric results',()=>{
  const f=fixture('홍로'),result=demoPrediction(f.lot,f.analysis.stats,f.analysis.observations,asOf);
  assert.equal(result.mode,'unavailable');assert.equal(result.firmness,null);assert.equal(result.weightLoss,null);assert.match(result.reason??'',/전용 계산기/);
  const fuji=fixture(),old=demoPrediction(fuji.lot,fuji.analysis.stats,fuji.analysis.observations,asOf);assert.equal(old.mode,'demo_only');assert.notEqual(old.firmness,null);
});

test('legacy stored Hongro prediction is suppressed in responses without modifying source records',()=>{
  const f=fixture(),old={...demoPrediction(f.lot,f.analysis.stats,f.analysis.observations,asOf),unexpectedQualityValue:99};
  const before=JSON.stringify(old),result=restrictPredictionForVariety({...f.lot,variety:'Hongro'},old);
  assert.equal(result.mode,'unavailable');assert.equal(result.firmness,null);assert.equal(result.weightLoss,null);assert.equal(result.errorRange,null);assert.equal('unexpectedQualityValue' in result,false);assert.equal(JSON.stringify(old),before);
  assert.equal(restrictPredictionForVariety(f.lot,old),old);
});
