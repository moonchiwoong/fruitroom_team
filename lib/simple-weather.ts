/** Independent weather aggregation. Never fills missing observations. */
export const SIMPLE_REGIONS = {
  jangsu: {name: '장수', station: '장수군 장수읍', code: '597803A001', cultivar: '후지'},
  yeongju: {name: '영주', station: '영주시 봉현면', code: '036043F024', cultivar: '후지'},
  geochang: {name: '거창', station: '거창군 거창읍', code: '670807A001', cultivar: '홍로'},
} as const;
export type SimpleRegion = keyof typeof SIMPLE_REGIONS;
export type SimpleCultivar = 'fuji' | 'hongro';
export type SimpleWeatherKey = 'min4' | 'lc56' | 'lc78' | 'rain9';
export type SimpleWeather = {min4:number;lc56:number;lc78:number;rain9:number};
export type SimpleDailyObs = {date:string; mean:number|null; min:number|null; max:number|null; rain:number|null};
export type SimpleWeatherVariable = {key:SimpleWeatherKey; value:number|null; period:[string,string]; days:number; expectedDays:number; reason:string|null};
export const SIMPLE_STATIONS: Record<SimpleRegion, {code:string;name:string;cultivar:SimpleCultivar}> = {
  jangsu:{code:SIMPLE_REGIONS.jangsu.code,name:SIMPLE_REGIONS.jangsu.station,cultivar:'fuji'},
  yeongju:{code:SIMPLE_REGIONS.yeongju.code,name:SIMPLE_REGIONS.yeongju.station,cultivar:'fuji'},
  geochang:{code:SIMPLE_REGIONS.geochang.code,name:SIMPLE_REGIONS.geochang.station,cultivar:'hongro'},
};

export function validCalendarDate(value:string):boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms=Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===value;
}
function datesOfMonths(year:number,first:number,last:number):string[] {
  const out:string[]=[];
  for(let month=first;month<=last;month++) {
    const count=new Date(Date.UTC(year,month,0)).getUTCDate();
    for(let day=1;day<=count;day++) out.push(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
  }
  return out;
}
const finite=(n:number|null): n is number => typeof n==='number' && Number.isFinite(n);

/**
 * 홍로: 기존 거창 회귀식의 평균기온−5℃ 합계를 그대로 유지한다(음수 허용).
 * 후지: 농업날씨365 생장도일 정의인 max(0, (최고+최저)/2−5℃).
 * 후지 min4의 산출 정의는 아직 원자료에서 확정되지 않아 값으로 반환하지 않는다.
 * 관측자료는 수확일과 오늘 이전의 완결된 일자료만 사용한다.
 */
export function computeSimpleWeather(region:SimpleRegion, harvestDate:string, today:string, rows:SimpleDailyObs[]):SimpleWeatherVariable[] {
  if(!Object.hasOwn(SIMPLE_STATIONS,region) || !validCalendarDate(harvestDate) || !validCalendarDate(today)) throw new Error('날짜와 지역을 확인해 주세요.');
  const year=Number(harvestDate.slice(0,4));
  const duplicate=new Set<string>(), byDate=new Map<string,SimpleDailyObs>();
  for (const row of rows) {
    if(!validCalendarDate(row.date) || row.date>=harvestDate || row.date>=today) continue;
    if(byDate.has(row.date)) duplicate.add(row.date);
    else byDate.set(row.date,row);
  }
  type Spec={key:SimpleWeatherKey; first:number;last:number; value:(r:SimpleDailyObs)=>number|null; aggregate:'sum'|'mean'; unverified?:string};
  const geochang=region==='geochang';
  const specs:Spec[]=[
    {key:'min4',first:4,last:4,value:r=>r.min,aggregate:'mean',...(!geochang?{unverified:'후지 회귀식의 4월 최저기온 산출 방식 확인이 필요합니다.'}:{})},
    {key:'lc56',first:5,last:6,value:r=>geochang?(finite(r.mean)?r.mean-5:null):(finite(r.min)&&finite(r.max)&&r.min<=r.max?Math.max(0,(r.max+r.min)/2-5):null),aggregate:'sum'},
    {key:'lc78',first:7,last:8,value:r=>geochang?(finite(r.mean)?r.mean-5:null):(finite(r.min)&&finite(r.max)&&r.min<=r.max?Math.max(0,(r.max+r.min)/2-5):null),aggregate:'sum'},
    {key:'rain9',first:9,last:9,value:r=>finite(r.rain)&&r.rain>=0?r.rain:null,aggregate:'sum'},
  ];
  return specs.map(spec=>{
    const dates=datesOfMonths(year,spec.first,spec.last);
    const period:[string,string]=[dates[0],dates[dates.length-1]];
    const values:number[]=[];
    for(const date of dates) {
      const row=byDate.get(date);
      const v=row && !duplicate.has(date)?spec.value(row):null;
      if(finite(v)) values.push(v);
    }
    const base={key:spec.key,period,days:values.length,expectedDays:dates.length};
    if(period[1]>=harvestDate) return {...base,value:null,reason:'필요한 관측 기간이 수확일과 겹치거나 수확일 이후까지 이어져 계산하지 않아요.'};
    if(period[1]>=today) return {...base,value:null,reason:'필요한 관측 기간이 아직 끝나지 않아 계산하지 않아요.'};
    if(spec.unverified) return {...base,value:null,reason:spec.unverified};
    if(values.length!==dates.length) return {...base,value:null,reason:!geochang && (spec.key==='lc56'||spec.key==='lc78')?'완전한 일최고·일최저 자료가 필요해요. 현재 일최고 자료 연결은 확인되지 않았어요.':`필요한 일자료가 ${dates.length-values.length}일 누락되거나 중복돼 계산하지 않아요.`};
    const sum=values.reduce((a,b)=>a+b,0);
    const result=spec.aggregate==='mean'?sum/values.length:sum;
    return {...base,value:Math.round(result*100)/100,reason:null};
  });
}

export type HistoricalWeatherSample = {year:number;stationCode:string;rows:SimpleDailyObs[]};
export type WeatherEvidence = {
  key:SimpleWeatherKey; value:number|null; period:[string,string];
  kind:'observed'|'historical-estimate'|'unavailable'; reason:string|null;
  historicalYears:number[]; minimumYears:number; method:'arithmetic-mean'|null;
};

/**
 * 미래 재배기 입력을 같은 관측소의 과거 완결 관측 구간의 단순평균으로 대체한다.
 * 호출자는 사용할 연도 목록과 최소 완결 연도 수를 명시해야 한다. 최소 3년은
 * 독립 검증된 정확도 기준이 아니라 극단적으로 적은 자료를 막는 기술적 하한이다.
 * 관측이 끝난 기간의 결측, 정의 미확인 변수, 수확일과 겹치는 기간은 추정하지 않는다.
 */
export function estimateWeatherFromHistory(input:{
  region:SimpleRegion; harvestDate:string; today:string; currentRows:SimpleDailyObs[];
  history:HistoricalWeatherSample[]; minimumYears:number; method:'arithmetic-mean';
}):WeatherEvidence[] {
  const {region,harvestDate,today,currentRows,history,minimumYears,method}=input;
  if(!Object.hasOwn(SIMPLE_STATIONS,region)||!validCalendarDate(harvestDate)||!validCalendarDate(today)) throw new Error('날짜와 지역을 확인해 주세요.');
  if(!Number.isInteger(minimumYears)||minimumYears<3||minimumYears>30||method!=='arithmetic-mean'||history.length>30) throw new Error('과거 관측 연도와 최소 연도 수를 확인해 주세요.');
  const targetYear=Number(harvestDate.slice(0,4)), station=SIMPLE_STATIONS[region].code;
  const years=new Set<number>();
  for(const item of history) {
    if(!Number.isInteger(item.year)||item.year<2000||item.year>=targetYear||years.has(item.year)||item.stationCode!==station||!Array.isArray(item.rows)) throw new Error('과거 관측 연도 또는 관측소를 확인해 주세요.');
    years.add(item.year);
  }
  const target=computeSimpleWeather(region,harvestDate,today,currentRows);
  const historyValues=history.flatMap(item=>{
    const historicalHarvest=`${item.year}-${harvestDate.slice(5)}`;
    if(!validCalendarDate(historicalHarvest)) return [];
    return [{year:item.year,values:computeSimpleWeather(region,historicalHarvest,today,item.rows)}];
  });
  return target.map(variable=>{
    const base={key:variable.key,period:variable.period,minimumYears};
    if(variable.value!==null) return {...base,value:variable.value,kind:'observed' as const,reason:null,historicalYears:[],method:null};
    if(variable.period[1]>=harvestDate) return {...base,value:null,kind:'unavailable' as const,reason:'관측 기간이 수확일과 겹치거나 수확 이후까지 이어져 과거값으로 대체하지 않아요.',historicalYears:[],method:null};
    if(variable.period[1]<today) return {...base,value:null,kind:'unavailable' as const,reason:variable.reason ?? '관측을 확인해 주세요.',historicalYears:[],method:null};
    const complete=historyValues.flatMap(entry=>{
      const v=entry.values.find(x=>x.key===variable.key);
      return v?.value==null?[]:[{year:entry.year,value:v.value}];
    }).sort((a,b)=>a.year-b.year);
    const usedYears=complete.map(x=>x.year);
    if(complete.length<minimumYears) return {...base,value:null,kind:'unavailable' as const,reason:`같은 관측소의 완결된 과거 자료가 ${complete.length}년으로, 필요한 ${minimumYears}년보다 적거나 변수 정의가 확인되지 않았어요.`,historicalYears:usedYears,method:null};
    const mean=complete.reduce((sum,x)=>sum+x.value,0)/complete.length;
    return {...base,value:Math.round(mean*100)/100,kind:'historical-estimate' as const,reason:'명시된 과거 연도 관측의 단순평균이며, 해당 수확연도의 날씨 예보나 실측은 아닙니다. 예측 정확도는 검증되지 않았어요.',historicalYears:usedYears,method};
  });
}
