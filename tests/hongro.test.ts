import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {calculateHongro,estimateHongroInitial,hongroInputSchema,HongroCalculationError,HONGRO_REGRESSION,HONGRO_REFERENCE_RANGES,type HongroInput} from '../lib/hongro';

const measured=(days=0,storage:'cold0'|'cold4'='cold0'):HongroInput=>({cultivar:'hongro',region:'geochang',source:'measured',storage,days,initial:{firmness:68,brix:14,acidity:0.18}});
const weather={chang_min4:5,chang_LC56:950,chang_LC78:1300,chang_9rain:200};
const weatherInput=()=>({cultivar:'hongro',region:'geochang',source:'weather',storage:'cold0',days:120,weather});
const near=(actual:number,expected:number,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('Hongro preserves measured input at day zero and does not invent optional initial measurements',()=>{
  const r=calculateHongro(measured());
  assert.deepEqual(r.predicted,{firmness:68,brix:14,acidity:0.18});
  assert.deepEqual(r.delta,{firmness:0,brix:0,acidity:0});
  assert.equal(r.initial.weight,undefined);assert.equal(r.initial.diameter,undefined);
  assert.equal(r.metadata.initialKind,'실측 입력');assert.equal(r.metadata.initialRegressionR2,null);
});
test('Hongro exact day 60 and 120 endpoints follow both attached storage equations',()=>{
  for(const storage of ['cold0','cold4'] as const){
    const at60=calculateHongro(measured(60,storage));
    near(at60.predicted.firmness,61);near(at60.predicted.acidity,0.18);near(at60.predicted.brix,14);
  }
  const cold0=calculateHongro(measured(120,'cold0')),cold4=calculateHongro(measured(120,'cold4'));
  near(cold0.predicted.firmness,53.6);near(cold4.predicted.firmness,52.4);
  near(cold0.predicted.acidity,0.13);near(cold4.predicted.acidity,0.15);
  assert.equal(cold0.predicted.brix,14);assert.equal(cold4.predicted.brix,14);
  near(cold0.delta.firmness,-14.4);near(cold4.delta.acidity,-0.03);
});
test('Hongro day 60 join is continuous and fractional days are evaluated without rounding',()=>{
  for(const storage of ['cold0','cold4'] as const){
    const left=calculateHongro(measured(60-1e-7,storage)),at=calculateHongro(measured(60,storage)),right=calculateHongro(measured(60+1e-7,storage));
    near(left.predicted.firmness,at.predicted.firmness,2e-8);near(right.predicted.firmness,at.predicted.firmness,2e-8);
    near(left.predicted.acidity,at.predicted.acidity,1e-9);near(right.predicted.acidity,at.predicted.acidity,1e-9);
  }
  near(calculateHongro(measured(30.5)).predicted.firmness,68-30.5*7/60);
});
test('Hongro storage lower bounds clamp firmness and acidity only, with constant sugar',()=>{
  const input={...measured(120),initial:{firmness:2,brix:0,acidity:0.01,weight:0,diameter:0}};
  const r=calculateHongro(input);
  assert.deepEqual(r.predicted,{firmness:0,brix:0,acidity:0});
  assert.ok(r.series.every(p=>p.firmness>=0&&p.acidity>=0&&p.brix===0));
  assert.deepEqual(r.delta,{firmness:-2,brix:0,acidity:-0.01});
});
test('Hongro comparison uses identical initial values and provides only three 0..120 day quality curves',()=>{
  const input={...measured(93.5,'cold4'),initial:{firmness:68,brix:14,acidity:0.18,weight:250,diameter:80}};
  const original=structuredClone(input),r=calculateHongro(input);
  assert.deepEqual(input,original);assert.deepEqual(r.initial,input.initial);
  for(const storage of ['cold0','cold4'] as const){
    const scenario=r.comparison[storage];assert.equal(scenario.series.length,121);
    assert.deepEqual(scenario.series.map(p=>p.days),Array.from({length:121},(_,i)=>i));
    assert.deepEqual(scenario.series[0],{days:0,firmness:68,brix:14,acidity:0.18});
    assert.ok(scenario.series.every(p=>!('weight' in p)&&!('diameter' in p)));
    assert.deepEqual(scenario.predicted,calculateHongro({...input,storage}).predicted);
  }
  assert.deepEqual(r.series,r.comparison.cold4.series);
});
test('Hongro regression preserves every transcribed coefficient and its variable mapping',()=>{
  const expected={
    diameter:[59.258570,-0.122297,0.108116,0.003106,-0.761469,0.8788],
    weight:[127.640760,-0.945435,0.743870,0.084457,2.540380,0.8968],
    firmness:[-46.266556,0.053485,0.035317,0.007695,0.994431,0.2495],
    brix:[-34.446960,-0.017218,0.053072,-0.003138,-1.283448,0.9009],
    acidity:[2.436584,-0.000036,-0.001896,0.000314,0.061400,0.8507],
  };
  for(const [metric,values] of Object.entries(expected)){
    const c=HONGRO_REGRESSION[metric as keyof typeof expected];
    assert.deepEqual([c.intercept,c.chang_LC56,c.chang_LC78,c.chang_9rain,c.chang_min4,c.r2],values);
  }
  const r=estimateHongroInitial(weather);
  // Independently evaluated with decimal arithmetic using the image's six-place coefficients.
  near(r.diameter,80.441075);near(r.weight,226.101810);near(r.firmness,56.967449);near(r.brix,11.144700);near(r.acidity,0.307384);
  const computed=calculateHongro(weatherInput());assert.deepEqual(computed.initial,r);
  assert.equal(computed.metadata.initialKind,'기상 회귀 추정');assert.equal(computed.metadata.initialRegressionR2?.firmness,0.2495);
});
test('Hongro reference ranges warn on extrapolation rather than reject a valid finite regression',()=>{
  assert.deepEqual(HONGRO_REFERENCE_RANGES.chang_min4,{min:2.0214,max:9.0174});
  const r=calculateHongro({...weatherInput(),weather:{...weather,chang_LC56:900}});
  assert.ok(r.warnings.some(w=>w.includes('chang_LC56')&&w.includes('참고 범위')));
  assert.equal(r.metadata.referenceData.isValidatedDomain,false);assert.ok(r.predicted.firmness>0);
});
test('Hongro negative or nonfinite regression output stops instead of clamping or changing coefficients',()=>{
  assert.throws(()=>estimateHongroInitial({chang_min4:0,chang_LC56:0,chang_LC78:0,chang_9rain:0}),e=>e instanceof HongroCalculationError&&e.invalidMetrics.includes('firmness')&&e.invalidMetrics.includes('brix'));
  assert.throws(()=>calculateHongro({...weatherInput(),weather:{chang_min4:Number.MAX_VALUE,chang_LC56:Number.MAX_VALUE,chang_LC78:Number.MAX_VALUE,chang_9rain:Number.MAX_VALUE}}),HongroCalculationError);
});
test('Hongro rejects wrong cultivar, region, storage, missing values, strings and invalid day boundaries',()=>{
  const invalid:unknown[]=[
    {...measured(),cultivar:'fuji'},{...measured(),region:'mungyeong'},{...measured(),storage:'ca'},
    {...measured(),days:-1},{...measured(),days:120.001},{...measured(),days:NaN},{...measured(),days:Infinity},{...measured(),days:''},{...measured(),days:'60'},
    {...measured(),initial:{firmness:68,brix:14}},{...measured(),initial:{firmness:-1,brix:14,acidity:0.18}},
    {...measured(),initial:{firmness:68,brix:'',acidity:0.18}},{...measured(),initial:{firmness:68,brix:NaN,acidity:0.18}},
    {...measured(),initial:{firmness:68,brix:14,acidity:0.18,weight:-1}},
    {...weatherInput(),weather:{chang_min4:5,chang_LC56:950,chang_LC78:1300}},
    {...weatherInput(),weather:{...weather,chang_9rain:'200'}},{...weatherInput(),weather:{...weather,chang_min4:Infinity}},
    {...measured(),weather},{...weatherInput(),initial:{firmness:68,brix:14,acidity:0.18}},
    {...measured(),source:'example'}, {},null,
  ];
  for(const input of invalid){assert.equal(hongroInputSchema.safeParse(input).success,false);assert.throws(()=>calculateHongro(input),z.ZodError);}
});
