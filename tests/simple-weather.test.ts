import test from 'node:test';
import assert from 'node:assert/strict';
import {computeSimpleWeather, estimateWeatherFromHistory, SIMPLE_STATIONS, validCalendarDate, type SimpleDailyObs} from '../lib/simple-weather';

function allDays(year:number, obs:Omit<SimpleDailyObs,'date'>):SimpleDailyObs[] {
  const rows:SimpleDailyObs[]=[];
  for(let m=4;m<=9;m++) for(let d=1;d<=new Date(Date.UTC(year,m,0)).getUTCDate();d++) {
    rows.push({date:`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,...obs});
  }
  return rows;
}
const get=(items:ReturnType<typeof computeSimpleWeather>,key:string)=>items.find(x=>x.key===key)!;
const sample=()=>allDays(2025,{mean:4,min:2,max:8,rain:1});

test('station identifiers and valid regional cultivar combinations are explicit',()=>{
  assert.deepEqual(SIMPLE_STATIONS.jangsu,{code:'597803A001',name:'장수군 장수읍',cultivar:'fuji'});
  assert.deepEqual(SIMPLE_STATIONS.yeongju,{code:'036043F024',name:'영주시 봉현면',cultivar:'fuji'});
  assert.deepEqual(SIMPLE_STATIONS.geochang,{code:'670807A001',name:'거창군 거창읍',cultivar:'hongro'});
  assert.equal(validCalendarDate('2025-02-29'),false);
  assert.equal(validCalendarDate('2024-02-29'),true);
});

test('Geochang retains its original mean-temperature definition, without a zero floor',()=>{
  const data=computeSimpleWeather('geochang','2025-10-10','2025-11-01',sample());
  assert.equal(get(data,'min4').value,2);
  assert.equal(get(data,'lc56').value,-61);
  assert.equal(get(data,'lc78').value,-62);
  assert.equal(get(data,'rain9').value,30);
});

test('Fuji GDD uses the daily high-low average with a zero floor',()=>{
  let data=computeSimpleWeather('jangsu','2025-10-10','2025-11-01',sample());
  assert.equal(get(data,'lc56').value,0);
  assert.equal(get(data,'min4').value,null);
  data=computeSimpleWeather('yeongju','2025-10-10','2025-11-01',allDays(2025,{mean:4,min:2,max:18,rain:1}));
  assert.equal(get(data,'lc56').value,305);
  assert.equal(get(data,'lc78').value,310);
});

test('unverified daily maximum blocks Fuji GDD rather than guessing a field',()=>{
  const data=computeSimpleWeather('jangsu','2025-10-10','2025-11-01',allDays(2025,{mean:20,min:10,max:null,rain:1}));
  assert.equal(get(data,'lc56').value,null);
  assert.match(get(data,'lc56').reason!,/일최고/);
  assert.equal(get(data,'rain9').value,30);
});

test('full period must precede both harvest day and today',()=>{
  const beforeEnd=computeSimpleWeather('geochang','2025-09-15','2025-11-01',sample());
  assert.equal(get(beforeEnd,'rain9').value,null);
  assert.equal(get(beforeEnd,'rain9').days,14);
  const ongoing=computeSimpleWeather('geochang','2025-10-10','2025-09-15',sample());
  assert.equal(get(ongoing,'rain9').value,null);
  assert.equal(get(ongoing,'rain9').days,14);
  const onLastDay=computeSimpleWeather('geochang','2025-09-30','2025-11-01',sample());
  assert.equal(get(onLastDay,'rain9').value,null);
});

test('missing, duplicate, or invalid precipitation never becomes a calculated value',()=>{
  const rows=sample();
  const missing=rows.filter(x=>x.date!=='2025-05-01');
  assert.equal(get(computeSimpleWeather('geochang','2025-10-10','2025-11-01',missing),'lc56').value,null);
  const duplicate=[...rows,rows.find(x=>x.date==='2025-09-02')!];
  assert.equal(get(computeSimpleWeather('geochang','2025-10-10','2025-11-01',duplicate),'rain9').value,null);
  const negative=rows.map(r=>r.date==='2025-09-02'?{...r,rain:-1}:r);
  assert.equal(get(computeSimpleWeather('geochang','2025-10-10','2025-11-01',negative),'rain9').value,null);
});

const oldGeochangYears=(years:number[])=>years.map(year=>({year,stationCode:'670807A001',rows:allDays(year,{mean:14,min:3,max:18,rain:2})}));
const historyInput=()=>({region:'geochang' as const,harvestDate:'2027-10-10',today:'2027-03-01',currentRows:[],history:oldGeochangYears([2024,2025,2026]),minimumYears:3,method:'arithmetic-mean' as const});

test('future periods use labelled mean only from explicitly selected complete years',()=>{
  const data=estimateWeatherFromHistory(historyInput());
  const rain=data.find(v=>v.key==='rain9')!;
  assert.equal(rain.value,60);
  assert.equal(rain.kind,'historical-estimate');
  assert.deepEqual(rain.historicalYears,[2024,2025,2026]);
  assert.equal(rain.method,'arithmetic-mean');
  assert.match(rain.reason!,/실측은 아닙니다/);
});

test('observed periods remain observed and missing past observations are not imputed',()=>{
  const target=allDays(2027,{mean:20,min:4,max:22,rain:1});
  const base={...historyInput(),today:'2027-05-01'};
  const complete=estimateWeatherFromHistory({...base,currentRows:target});
  const april=complete.find(v=>v.key==='min4')!;
  assert.equal(april.kind,'observed');assert.equal(april.value,4);assert.deepEqual(april.historicalYears,[]);
  const missing=estimateWeatherFromHistory({...base,currentRows:target.filter(v=>v.date!=='2027-04-02')});
  assert.equal(missing.find(v=>v.key==='min4')!.kind,'unavailable');
  assert.equal(missing.find(v=>v.key==='lc56')!.kind,'historical-estimate');
});

test('historical estimates never use an input period beyond harvest date',()=>{
  const data=estimateWeatherFromHistory({...historyInput(),harvestDate:'2027-09-15'});
  const rain=data.find(v=>v.key==='rain9')!;
  assert.equal(rain.kind,'unavailable');assert.equal(rain.value,null);assert.deepEqual(rain.historicalYears,[]);
});

test('incomplete past years cannot satisfy the explicit minimum',()=>{
  const input=historyInput();
  input.history[0].rows=input.history[0].rows.filter(v=>v.date!=='2024-09-10');
  const rain=estimateWeatherFromHistory(input).find(v=>v.key==='rain9')!;
  assert.equal(rain.kind,'unavailable');assert.deepEqual(rain.historicalYears,[2025,2026]);
  assert.throws(()=>estimateWeatherFromHistory({...input,minimumYears:2}));
  assert.throws(()=>estimateWeatherFromHistory({...input,history:[input.history[0],input.history[0]]}));
  assert.throws(()=>estimateWeatherFromHistory({...input,history:[{...input.history[0],stationCode:'wrong'}]}));
});

test('unverified Fuji fields cannot be manufactured from historical values',()=>{
  const history=[2024,2025,2026].map(year=>({year,stationCode:'597803A001',rows:allDays(year,{mean:14,min:3,max:null,rain:2})}));
  const data=estimateWeatherFromHistory({...historyInput(),region:'jangsu',history});
  assert.equal(data.find(v=>v.key==='min4')!.kind,'unavailable');
  assert.equal(data.find(v=>v.key==='lc56')!.kind,'unavailable');
  assert.equal(data.find(v=>v.key==='rain9')!.kind,'historical-estimate');
});
