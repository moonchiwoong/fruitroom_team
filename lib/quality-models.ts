/**
 * Authoritative storage model registry. Screens, CSV, API and appearance consume
 * these results; the registry never derives coefficients from origin or sensors.
 * Numeric acidity and loss use percentage units (0.18 means 0.18%, not 18%).
 */
import {isHongroVariety} from './cultivar';
import {trackedLoss, type TrackedWeight} from './quality-policy';

export type QualityMetric = 'firmness' | 'brix' | 'acidity' | 'loss';
export type QualityCultivar = 'fuji' | 'hongro';
export type QualityStorage = 'cold' | 'ca' | 'other';
export type QualityMcp = 'treated' | 'untreated' | 'unknown';
export type QualityAnchor = {day:number; value:number};
export type ModelRange = {min:number; max:number; validatedDays:null};
export const QUALITY_MODEL_VERSION = 'appletrack-storage@2026-10-26.1';
export const FUJI_MODEL_VERSION = 'fuji-xlsx-2026-10-26.1';
export const HONGRO_STORAGE_MODEL_VERSION = 'hongro-xlsx-approximation-2026-10-26.1';
export const QUALITY_METRICS:QualityMetric[] = ['firmness','brix','acidity','loss'];
export const QUALITY_UNITS:Record<QualityMetric,string> = {firmness:'N',brix:'°Brix',acidity:'%',loss:'%'};
export const FUJI_SOURCE = 'data/evidence/사과_품질예측_회귀식.xlsx';
export const HONGRO_SOURCE = 'data/evidence/거창_품질예측식(1).xlsx';
export const HONGRO_PAPER = 'data/evidence/kjfp-25-7-779.pdf';
export const FUJI_MCP_SOURCE_NOTE = '최신 사과_품질예측_회귀식.xlsx Sheet1!E6의 y=y0를 사용합니다. 이전 data/storage-quality-model.xlsx E6에는 이차식이 있으며 보존했습니다. 최신 파일 C6의 ‘2차’ 분류와 유지식 E6의 불일치는 미해결입니다.';
export const HONGRO_REFERENCE_NOTICE = '홍로에 대해 검증되지 않은 후지 기반 참고 추정';
export const HONGRO_NO_LOSS_REASON = '자료 부족: 홍로 저온 저장 감모율 모델이 없습니다. 후지 식으로 참고 추정 보기를 명시적으로 선택한 경우에만 별도 참고값을 제공합니다.';
export const MODEL_RANGE_NOTICE = '표시 범위는 상품성 유지 기간이나 안전한 보관 기간을 보장하지 않습니다.';
const UNVALIDATED = '독립 예측 정확도 검증 미완료';
const FUJI_TEMPERATURE_NOTE = '후지 원자료에 저장 온도가 명시되지 않아 선택 온도에서의 적용 타당성은 미확인입니다. 온도 보정이나 센서 이력 보정은 적용하지 않습니다.';

export type ModelDefinition = {
  id:string;version:string;cultivar:QualityCultivar;label:string;storage:'cold'|'ca';
  temperature:number|null;mcp:'treated'|'untreated';metric:QualityMetric;unit:string;
  formula:string;source:string[];range:ModelRange;validation:string;warnings:string[];
  connection:'delta'|'ratio';
};
export type PredictionResult = {
  ok:boolean;value:number|null;unit:string;kind:'실측'|'모델 계산'|'참고 추정';
  modelId:string|null;modelVersion:string|null;source:string[];formula:string|null;
  range:ModelRange|null;validation:string;reason:string|null;warnings:string[];
};
export type QualityInput = {
  cultivar:string;storage:QualityStorage;temperature:number|null;mcp:QualityMcp;
  metric:QualityMetric;day:number;anchor?:QualityAnchor|null;allowFujiReference?:boolean;
  /** Kept for provenance only. Region never selects or scales a storage model. */
  region?:string;
};
export type QualityPoint = PredictionResult & {day:number};

type FujiMethod = 'cold'|'mcp'|'ca';
const positive = (n:number)=>Math.max(0,n);
/** Unclamped source functions, used for differences on the ORIGINAL time axis. */
const fujiCurve:Record<QualityMetric,Record<FujiMethod,(t:number)=>number>> = {
  loss:{cold:t=>0.007807*t+0.0000475*t*t,mcp:t=>0.017524*t,ca:t=>0.012591*t},
  firmness:{cold:t=>-0.013733*t,mcp:()=>0,ca:t=>-0.004178*t},
  brix:{cold:t=>-0.001*t+0.001*positive(t-100)-0.006*positive(t-200),mcp:t=>0.002*t+0.004*positive(t-100)-0.022*positive(t-200),ca:t=>-0.003*t+0.013*positive(t-100)-0.016*positive(t-200)},
  acidity:{cold:t=>Math.exp(-0.004377*t),mcp:t=>1-(1/3)*Math.min(t/100,1),ca:t=>1-(1/3)*Math.min(t/100,1)},
};
export const FUJI_FORMULAS:Record<QualityMetric,Record<FujiMethod,string>> = {
  loss:{cold:'L(t) = 0.007807t + 0.0000475t²',mcp:'L(t) = 0.017524t',ca:'L(t) = 0.012591t'},
  firmness:{cold:'F(t) = F0 − 0.013733t',mcp:'F(t) = F0',ca:'F(t) = F0 − 0.004178t'},
  brix:{cold:'S(t) = S0 − 0.001t + 0.001·MAX(t−100,0) − 0.006·MAX(t−200,0)',mcp:'S(t) = S0 + 0.002t + 0.004·MAX(t−100,0) − 0.022·MAX(t−200,0)',ca:'S(t) = S0 − 0.003t + 0.013·MAX(t−100,0) − 0.016·MAX(t−200,0)'},
  acidity:{cold:'A(t) = A0·EXP(−0.004377t)',mcp:'A(t) = A0·(1 − (1/3)·MIN(t/100,1))',ca:'A(t) = A0·(1 − (1/3)·MIN(t/100,1))'},
};
export const HONGRO_FORMULAS = {
  cold0:{firmness:'F(t) = MAX(0, F0 − MIN(t,60) × 7.0/60 − MAX(t−60,0) × 7.4/60)',brix:'S(t) = S0',acidity:'A(t) = MAX(0, A0 − MAX(t−60,0) × 0.05/60)'},
  cold4:{firmness:'F(t) = MAX(0, F0 − MIN(t,60) × 7.0/60 − MAX(t−60,0) × 8.6/60)',brix:'S(t) = S0',acidity:'A(t) = MAX(0, A0 − MAX(t−60,0) × 0.03/60)'},
} as const;

export const MODEL_REGISTRY:ModelDefinition[] = [
  ...(['cold','mcp','ca'] as const).flatMap(method=>QUALITY_METRICS.map(metric=>({
    id:`fuji-${method}-${metric}`,version:FUJI_MODEL_VERSION,cultivar:'fuji' as const,
    label:`후지 ${method==='cold'?'일반 저온 저장':method==='mcp'?'1-MCP + 저온 저장':'CA 저장'}`,
    storage:method==='ca'?'ca' as const:'cold' as const,temperature:null,mcp:method==='mcp'?'treated' as const:'untreated' as const,
    metric,unit:QUALITY_UNITS[metric],formula:FUJI_FORMULAS[metric][method],source:[FUJI_SOURCE],
    range:{min:0,max:300,validatedDays:null},validation:`${UNVALIDATED} · 원자료 관측·검증 기간 미기재 · 0~300일은 기존 UI 표시 범위`,
    warnings:[FUJI_TEMPERATURE_NOTE,MODEL_RANGE_NOTICE,...(method==='mcp'&&metric==='firmness'?[FUJI_MCP_SOURCE_NOTE]:[])],
    connection:metric==='acidity'?'ratio' as const:'delta' as const,
  }))),
  ...([0,4] as const).flatMap(temperature=>(['firmness','brix','acidity'] as const).map(metric=>({
    id:`hongro-cold${temperature}-${metric}`,version:HONGRO_STORAGE_MODEL_VERSION,cultivar:'hongro' as const,
    label:`홍로 일반 저온 저장 ${temperature}℃`,storage:'cold' as const,temperature,mcp:'untreated' as const,
    metric,unit:QUALITY_UNITS[metric],formula:HONGRO_FORMULAS[temperature===0?'cold0':'cold4'][metric],
    source:[HONGRO_SOURCE,HONGRO_PAPER],range:{min:0,max:120,validatedDays:null},
    validation:`엑셀 근사 모델 · 논문이 직접 제시한 회귀식으로 확인되지 않음 · ${UNVALIDATED}`,
    warnings:[MODEL_RANGE_NOTICE,...(metric==='brix'?['엑셀 명시 수식 S(t)=S0를 사용합니다. 비고의 감소 설명에서 계수를 만들지 않습니다.']:[])],
    connection:'delta' as const,
  }))),
];
const definitions=new Map(MODEL_REGISTRY.map(model=>[model.id,model]));

export function normalizeQualityCultivar(value:unknown):QualityCultivar|null {
  if(isHongroVariety(value))return 'hongro';
  if(typeof value!=='string')return null;
  const normalized=value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');
  return ['후지','부사','fuji','fujiapple'].includes(normalized)?'fuji':null;
}
export const normalizeCultivar = normalizeQualityCultivar;
function unavailable(input:QualityInput,reason:string,model?:ModelDefinition,reference=false):PredictionResult {
  return {ok:false,value:null,unit:QUALITY_UNITS[input.metric]??'',kind:reference?'참고 추정':'모델 계산',modelId:model?.id??null,modelVersion:model?.version??null,source:model?.source.slice()??[],formula:model?.formula??null,range:model?{...model.range,...(reference?{max:120}:{})}:null,validation:reference?`${HONGRO_REFERENCE_NOTICE} · ${UNVALIDATED}`:model?.validation??'적용 모델 없음',reason,warnings:model?.warnings.slice()??[]};
}
/** Select by cultivar AND condition; no other cultivar is an implicit fallback. */
export function selectQualityModel(input:QualityInput):{model:ModelDefinition|null;reference:boolean;reason:string|null} {
  const cultivar=normalizeQualityCultivar(input.cultivar);
  if(!cultivar)return {model:null,reference:false,reason:'적용 모델 없음: 선택한 품종의 저장 예측식이 없습니다.'};
  if(!['cold','ca','other'].includes(input.storage)||!['treated','untreated','unknown'].includes(input.mcp))return {model:null,reference:false,reason:'저장 방식과 1-MCP 처리 여부를 확인해 주세요.'};
  if(input.mcp==='unknown')return {model:null,reference:false,reason:'적용 모델 없음: 1-MCP 처리 여부가 미확인입니다.'};
  if(input.storage==='other'||(input.storage==='ca'&&input.mcp==='treated'))return {model:null,reference:false,reason:'적용 모델 없음: 선택한 저장 방식·1-MCP 조합의 자료가 없습니다.'};
  if(input.temperature!==null&&(typeof input.temperature!=='number'||!Number.isFinite(input.temperature)))return {model:null,reference:false,reason:'유효한 저장 온도를 입력해 주세요.'};
  if(cultivar==='hongro'){
    if(input.storage!=='cold'||input.mcp!=='untreated')return {model:null,reference:false,reason:'적용 모델 없음: 홍로는 1-MCP 미처리 일반 저온 저장 0℃·4℃ 식만 있습니다.'};
    if(input.temperature!==0&&input.temperature!==4)return {model:null,reference:false,reason:'적용 모델 없음: 홍로는 정확히 0℃·4℃만 지원하며 온도 보간을 하지 않습니다.'};
    if(input.metric==='loss'){
      if(!input.allowFujiReference)return {model:null,reference:false,reason:HONGRO_NO_LOSS_REASON};
      return {model:definitions.get('fuji-cold-loss')!,reference:true,reason:null};
    }
    const model=definitions.get(`hongro-cold${input.temperature}-${input.metric}`)??null;
    return {model,reference:false,reason:model?null:'적용 모델 없음: 예측 항목을 확인해 주세요.'};
  }
  const method=input.storage==='ca'?'ca':input.mcp==='treated'?'mcp':'cold';
  const model=definitions.get(`fuji-${method}-${input.metric}`)??null;
  return {model,reference:false,reason:model?null:'적용 모델 없음: 예측 항목을 확인해 주세요.'};
}
function curve(model:ModelDefinition,t:number):number {
  if(model.cultivar==='fuji'){
    const method:FujiMethod=model.storage==='ca'?'ca':model.mcp==='treated'?'mcp':'cold';
    return fujiCurve[model.metric][method](t);
  }
  if(model.metric==='firmness')return -Math.min(t,60)*7/60-Math.max(t-60,0)*(model.temperature===0?7.4:8.6)/60;
  if(model.metric==='acidity')return -Math.max(t-60,0)*(model.temperature===0?0.05:0.03)/60;
  return 0;
}
/** Main calculator: raw data remain null on failure; zero is only a computed value. */
export function predictQuality(input:QualityInput):PredictionResult {
  const selection=selectQualityModel(input),{model,reference}=selection;
  if(!model)return unavailable(input,selection.reason??'적용 모델 없음');
  const result=unavailable(input,'',model,reference),range=result.range!;
  if(typeof input.day!=='number'||!Number.isFinite(input.day)||input.day<0)return {...result,reason:'저장일수가 음수이거나 유효하지 않습니다.'};
  if(input.day>range.max)return {...result,reason:`모델 적용 범위 초과: ${range.min}~${range.max}일 범위에서만 표시합니다.`};
  const anchor=input.anchor??(input.metric==='loss'?{day:0,value:0}:null);
  if(!anchor)return {...result,reason:'필요한 초기 측정값이 없습니다.'};
  if(typeof anchor.value!=='number'||!Number.isFinite(anchor.value)||anchor.value<0||typeof anchor.day!=='number'||!Number.isFinite(anchor.day)||anchor.day<0)return {...result,reason:'초기 측정값과 저장 시작일 기준 측정일을 확인해 주세요.'};
  if(anchor.day>range.max)return {...result,reason:`모델 적용 범위 초과: 초기 측정일이 ${range.max}일을 넘었습니다.`};
  if(input.day<anchor.day)return {...result,reason:'선택한 날짜가 초기 측정일 이전입니다. 측정 전 값을 역산하지 않습니다.'};
  const at=curve(model,input.day),base=curve(model,anchor.day);
  let value=model.connection==='ratio'?anchor.value*(at/base):anchor.value+(at-base);
  if(model.cultivar==='hongro'&&(input.metric==='firmness'||input.metric==='acidity'))value=Math.max(0,value);
  if(!Number.isFinite(value))return {...result,reason:'유효한 계산값을 얻지 못했습니다.'};
  const warnings=[...result.warnings];
  if(reference)warnings.push(HONGRO_REFERENCE_NOTICE,'홍로 표시 범위 0~120일 제한은 후지 식의 홍로 적용 타당성을 검증해 주지 않습니다.');
  if(anchor.day>0)warnings.push(model.connection==='ratio'?'저장 시작일 시간축에서 비율 g(t)/g(t0)로 측정값을 연결했습니다.':'저장 시작일 시간축에서 변화량 g(t)−g(t0)로 측정값을 연결했습니다.');
  return {...result,ok:true,value,reason:null,warnings};
}
export function getQualitySeries(input:QualityInput,options:{from?:number;to?:number;step?:number}={}):QualityPoint[] {
  const selected=selectQualityModel(input),max=selected.reference?120:selected.model?.range.max??(normalizeQualityCultivar(input.cultivar)==='hongro'?120:300);
  const from=options.from??input.anchor?.day??0,to=options.to??max,step=options.step??1;
  if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(step)||step<=0||to<from||Math.ceil((to-from)/step)>10000)return [];
  return Array.from({length:Math.floor((to-from)/step)+1},(_,i)=>{const day=from+i*step;return {day,...predictQuality({...input,day})};});
}
export function predictAllQuality(input:Omit<QualityInput,'metric'|'anchor'>&{anchors?:Partial<Record<QualityMetric,QualityAnchor|null>>}):Record<QualityMetric,PredictionResult> {
  return Object.fromEntries(QUALITY_METRICS.map(metric=>[metric,predictQuality({...input,metric,anchor:input.anchors?.[metric]})])) as Record<QualityMetric,PredictionResult>;
}
/** Compatibility entry point: still calls the same registry, with day-zero anchors. */
export function fujiStorageValue(method:FujiMethod,metric:QualityMetric,day:number,initial:{firmness:number;brix:number;acidity:number}):number {
  const result=predictQuality({cultivar:'fuji',storage:method==='ca'?'ca':'cold',temperature:null,mcp:method==='mcp'?'treated':'untreated',metric,day,anchor:metric==='loss'?undefined:{day:0,value:initial[metric]}});
  return result.value??NaN;
}
/** Measurement calculation is separately labelled and never silently used as a model. */
export function calculateMeasuredLoss(initial:TrackedWeight,later:TrackedWeight):PredictionResult {
  const measured=trackedLoss(initial,later);
  return {ok:measured.ok,value:measured.ok?measured.value:null,unit:'%',kind:'실측',modelId:'tracked-weight-loss',modelVersion:'tracked-weight-loss@1',source:['동일 추적 표본의 초기·후속 중량 측정 기록'],formula:'L = 100 × (초기 중량 − 후속 중량) / 초기 중량',range:null,validation:measured.ok?'동일 추적 표본 ID·중량·측정 시점 확인':'실측 근거 부족',reason:measured.ok?null:measured.reason,warnings:[]};
}
