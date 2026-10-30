import {predictAll} from './initial-quality';
import {estimateHongroInitial} from './hongro';
import {predictQuality, selectQualityModel, type QualityInput, type QualityMetric} from './quality-models';
export type SimpleRegion = 'jangsu' | 'yeongju' | 'geochang';
export type SimpleWeather = {min4:number; lc56:number; lc78:number; rain9:number};
export const SIMPLE_REGIONS = {jangsu:{name:'장수',cultivar:'후지'},yeongju:{name:'영주',cultivar:'후지'},geochang:{name:'거창',cultivar:'홍로'}} as const;

export const SIMPLE_CONDITIONS = {
  fuji:[{label:'일반 저온 · 1-MCP 미처리',storage:'cold',temperature:null,mcp:'untreated'}, {label:'일반 저온 · 1-MCP 처리',storage:'cold',temperature:null,mcp:'treated'}, {label:'CA 저장 · 1-MCP 미처리',storage:'ca',temperature:null,mcp:'untreated'}],
  hongro:[{label:'일반 저온 0℃ · 1-MCP 미처리',storage:'cold',temperature:0,mcp:'untreated'}, {label:'일반 저온 4℃ · 1-MCP 미처리',storage:'cold',temperature:4,mcp:'untreated'}],
} as const;
export function simplePrediction(region: SimpleRegion, weather: SimpleWeather) {
  if (!Object.hasOwn(SIMPLE_REGIONS,region)) throw new Error('지역을 확인해 주세요.');
  const cultivar = SIMPLE_REGIONS[region].cultivar === '후지' ? 'fuji' : 'hongro';
  const initial = cultivar === 'fuji' ? predictAll(region as 'jangsu'|'yeongju',weather) : estimateHongroInitial({chang_min4:weather.min4,chang_LC56:weather.lc56,chang_LC78:weather.lc78,chang_9rain:weather.rain9});
  for (const key of ['firmness','brix','acidity'] as const) if (!Number.isFinite(initial[key]) || initial[key] < 0) throw new Error('기상 회귀 결과가 유효하지 않아 예측을 표시하지 않아요.');
  const days = cultivar==='hongro' ? [0,30,60,90,120] : [0,30,60,90,120,180,240,300];
  const metrics:QualityMetric[]=['firmness','brix','acidity','loss'];
  const conditions=SIMPLE_CONDITIONS[cultivar].map(c=>{
    const base:QualityInput={cultivar,storage:c.storage,temperature:c.temperature,mcp:c.mcp,metric:'firmness',day:0,anchor:{day:0,value:initial.firmness}};
    if (!selectQualityModel(base).model) return null;
    return {label:c.label, rows:days.map(day=>({day, values:Object.fromEntries(metrics.map(metric=>{
      // 초기 회귀는 N/mm로, 저장식은 N으로 표기되어 있어 동일 단위라고 가정하지 않는다.
      const result=predictQuality({...base,metric,day,anchor:metric==='loss'||metric==='firmness'?null:{day:0,value:initial[metric]}});
      return [metric,metric==='firmness'?{...result,reason:'초기 경도와 저장식의 단위 관계 확인이 필요합니다.'}:result];
    })) as Record<QualityMetric,ReturnType<typeof predictQuality>>}))};
  }).filter((c):c is NonNullable<typeof c>=>c!==null);
  return {cultivar,initial,conditions};
}
