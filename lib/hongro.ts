import {z} from 'zod';
import {predictQuality, HONGRO_FORMULAS, HONGRO_STORAGE_MODEL_VERSION, HONGRO_SOURCE, HONGRO_PAPER} from './quality-models';

/** Separate Hongro model: none of the Fuji coefficients or storage models are used. */
export const HONGRO_MODEL_VERSION = HONGRO_STORAGE_MODEL_VERSION;
export const HONGRO_DISCLAIMER = '본 결과는 합성자료 기반 초기품질 회귀식과 문헌을 참고해 구성한 저장 변화식을 연결한 참고용 시뮬레이션입니다. 실제 농가·과실에 대한 독립적인 예측 성능 검증은 완료되지 않았습니다. 실제 품질은 수확 숙도, 과실 개체차, 저장고 환경 등에 따라 달라질 수 있습니다.';
export const HONGRO_UNITS_CONFLICT = '초기 경도 회귀식의 단위는 N입니다(회귀식 작성자 확인, 2026-10-31). 제공 이미지의 N/mm 표기는 오기로 확인되어, 저장식의 N (Ø11 mm) 입력으로 그대로 이어 계산합니다.';
export const HONGRO_SUGAR_EQUATION_CONFLICT = '저장식 파일의 당도 비고에는 감소량이 적혀 있지만 명시 수식은 S(t)=S0입니다. 수식을 우선하여 두 저장 조건 모두 초기 당도를 유지합니다.';
export const HONGRO_STORAGE_LABELS = {cold0:'0℃ 저온저장',cold4:'4℃ 저온저장'} as const;
export const HONGRO_STORAGE_EQUATIONS = HONGRO_FORMULAS;
export const HONGRO_UNITS = {firmness:'N (Ø11 mm)',brix:'°Brix',acidity:'%',weight:'g',diameter:'mm'} as const;
export const HONGRO_DELTA_UNITS = {firmness:'N (Ø11 mm)',brix:'°Brix',acidity:'%p'} as const;
export const HONGRO_SOURCE_FILES = ['Screenshot_20261023_135647_Hancom Office Viewer (1).jpg',HONGRO_SOURCE,'chang_200.xlsx',HONGRO_PAPER] as const;

/** Ranges observed in the 200 supplied synthetic/reference rows; not validity limits. */
export const HONGRO_REFERENCE_RANGES = {
  chang_min4:{min:2.0214,max:9.0174},
  chang_LC56:{min:913.2838,max:985.2648},
  chang_LC78:{min:1242.4273,max:1441.0029},
  chang_9rain:{min:7.6325,max:543.0958},
} as const;
export const HONGRO_WEATHER_FIELDS = [
  {key:'chang_min4',label:'4월 일최저기온 평균',unit:'℃',reference:HONGRO_REFERENCE_RANGES.chang_min4},
  {key:'chang_LC56',label:'5~6월 누적 생장도일',unit:'℃·일',reference:HONGRO_REFERENCE_RANGES.chang_LC56},
  {key:'chang_LC78',label:'7~8월 누적 생장도일',unit:'℃·일',reference:HONGRO_REFERENCE_RANGES.chang_LC78},
  {key:'chang_9rain',label:'9월 누적 강수량',unit:'mm',reference:HONGRO_REFERENCE_RANGES.chang_9rain},
] as const;

/**
 * 농가가 숫자 대신 고르는 기상 선택지.
 * 값은 모델 참고 범위(HONGRO_REFERENCE_RANGES)의 20%·50%·80% 지점이며, 거창의 실제 평년값이 아닙니다.
 * 범위 밖 값으로 외삽하지 않도록 범위 안에서만 정합니다. 실제 기상자료가 확보되면 이 값만 바꾸면 됩니다.
 */
const presetAt=(key:keyof typeof HONGRO_REFERENCE_RANGES,f:number,digits:number)=>{const r=HONGRO_REFERENCE_RANGES[key];return Number((r.min+(r.max-r.min)*f).toFixed(digits));};
export const HONGRO_WEATHER_PRESETS:Record<keyof typeof HONGRO_REFERENCE_RANGES,{question:string;options:{id:'low'|'mid'|'high';label:string;hint:string;value:number}[]}>={
  chang_min4:{question:'봄 (4월)',options:[
    {id:'low',label:'쌀쌀',hint:'늦추위·늦서리가 있었던 해',value:presetAt('chang_min4',0.2,1)},
    {id:'mid',label:'보통',hint:'예년과 비슷한 봄',value:presetAt('chang_min4',0.5,1)},
    {id:'high',label:'따뜻',hint:'꽃이 일찍 핀 해',value:presetAt('chang_min4',0.8,1)}]},
  chang_LC56:{question:'초여름 (5~6월)',options:[
    {id:'low',label:'서늘',hint:'초여름이 선선했던 해',value:presetAt('chang_LC56',0.2,0)},
    {id:'mid',label:'보통',hint:'예년과 비슷한 초여름',value:presetAt('chang_LC56',0.5,0)},
    {id:'high',label:'더움',hint:'초여름이 일찍 더웠던 해',value:presetAt('chang_LC56',0.8,0)}]},
  chang_LC78:{question:'여름 (7~8월)',options:[
    {id:'low',label:'시원',hint:'비가 잦거나 폭염이 적었던 해',value:presetAt('chang_LC78',0.2,0)},
    {id:'mid',label:'보통',hint:'예년과 비슷한 여름',value:presetAt('chang_LC78',0.5,0)},
    {id:'high',label:'무더움',hint:'열대야·폭염이 길었던 해',value:presetAt('chang_LC78',0.8,0)}]},
  chang_9rain:{question:'9월 비',options:[
    {id:'low',label:'적음',hint:'맑은 날이 이어진 해',value:presetAt('chang_9rain',0.2,0)},
    {id:'mid',label:'보통',hint:'가을비가 예년 정도',value:presetAt('chang_9rain',0.5,0)},
    {id:'high',label:'많음',hint:'태풍·잦은 가을비가 있던 해',value:presetAt('chang_9rain',0.8,0)}]},
};

/** Exact transcription from the attached coefficient image; no fitting to synthetic rows. (거창) */
export const HONGRO_REGRESSION = {
  diameter:{intercept:59.258570,chang_LC56:-0.122297,chang_LC78:0.108116,chang_9rain:0.003106,chang_min4:-0.761469,r2:0.8788},
  weight:{intercept:127.640760,chang_LC56:-0.945435,chang_LC78:0.743870,chang_9rain:0.084457,chang_min4:2.540380,r2:0.8968},
  firmness:{intercept:-46.266556,chang_LC56:0.053485,chang_LC78:0.035317,chang_9rain:0.007695,chang_min4:0.994431,r2:0.2495},
  brix:{intercept:-34.446960,chang_LC56:-0.017218,chang_LC78:0.053072,chang_9rain:-0.003138,chang_min4:-1.283448,r2:0.9009},
  acidity:{intercept:2.436584,chang_LC56:-0.000036,chang_LC78:-0.001896,chang_9rain:0.000314,chang_min4:0.061400,r2:0.8507},
} as const;
/** 지역별 홍로 초기 품질 회귀식. 거창은 위 식, 나머지는 회귀식(5).xlsx 그대로 옮김(2026-11-22).
 *  chang_9rain: 그 지역의 강수 변수(충주·군위·포천·화성 8월, 거창·장수 9월). chang_min4: 충주·군위는 4~5월 평균.
 *  경도 단위는 N(작성자 확인, 원본 표의 ‘N/mm’ 표기는 오기). */
export type HongroRegion = 'geochang'|'chungju'|'gunwi'|'pocheon'|'hwaseong'|'jangsu';
export const HONGRO_REGIONS:HongroRegion[] = ['geochang','chungju','gunwi','pocheon','hwaseong','jangsu'];
export const HONGRO_REGRESSIONS:Record<HongroRegion,Record<keyof typeof HONGRO_REGRESSION,{intercept:number;chang_LC56:number;chang_LC78:number;chang_9rain:number;chang_min4:number;r2:number}>> = {
  geochang:HONGRO_REGRESSION,
  chungju:{
    diameter:{intercept:127.841325,chang_LC56:-0.007126,chang_LC78:-0.045229,chang_9rain:0.023802,chang_min4:2.848969,r2:0.865},
    weight:{intercept:718.229305,chang_LC56:-0.081797,chang_LC78:-0.417228,chang_9rain:0.214179,chang_min4:21.366317,r2:0.8122},
    firmness:{intercept:-115.466307,chang_LC56:0.044021,chang_LC78:0.088039,chang_9rain:0.049827,chang_min4:1.42278,r2:0.2238},
    brix:{intercept:0.046131,chang_LC56:-0.012584,chang_LC78:0.01688,chang_9rain:0.00535,chang_min4:0.211175,r2:0.3442},
    acidity:{intercept:1.430783,chang_LC56:-0.000206,chang_LC78:-0.000777,chang_9rain:-0.000101,chang_min4:0.005928,r2:0.7645},
  },
  gunwi:{
    diameter:{intercept:113.702769,chang_LC56:-0.069562,chang_LC78:0.018491,chang_9rain:0.01957,chang_min4:1.270512,r2:0.6484},
    weight:{intercept:410.398271,chang_LC56:-0.633666,chang_LC78:0.252598,chang_9rain:0.168365,chang_min4:11.02651,r2:0.7799},
    firmness:{intercept:36.467422,chang_LC56:0.015148,chang_LC78:0.00039,chang_9rain:0.008281,chang_min4:1.4926,r2:0.2979},
    brix:{intercept:-0.743316,chang_LC56:0.009389,chang_LC78:0.005103,chang_9rain:0.000107,chang_min4:-0.083357,r2:0.7207},
    acidity:{intercept:-1.992089,chang_LC56:0.00022,chang_LC78:0.001882,chang_9rain:-0.000548,chang_min4:-0.070528,r2:0.7877},
  },
  pocheon:{
    diameter:{intercept:184.371943,chang_LC56:-0.049318,chang_LC78:-0.029745,chang_9rain:-0.017587,chang_min4:-2.231221,r2:0.7767},
    weight:{intercept:1145.732851,chang_LC56:-0.508121,chang_LC78:-0.25688,chang_9rain:-0.134925,chang_min4:-12.241416,r2:0.7634},
    firmness:{intercept:-430.62627,chang_LC56:0.208654,chang_LC78:0.247471,chang_9rain:-0.010467,chang_min4:-1.525086,r2:0.8957},
    brix:{intercept:14.737445,chang_LC56:0.00546,chang_LC78:-0.003247,chang_9rain:-0.000587,chang_min4:-0.18206,r2:0.8538},
    acidity:{intercept:-0.645415,chang_LC56:-0.000756,chang_LC78:0.001183,chang_9rain:0.000189,chang_min4:-0.013268,r2:0.838},
  },
  hwaseong:{
    diameter:{intercept:84.699412,chang_LC56:-0.063448,chang_LC78:0.052899,chang_9rain:0.012779,chang_min4:-1.397697,r2:0.3911},
    weight:{intercept:191.131409,chang_LC56:-0.618234,chang_LC78:0.552134,chang_9rain:0.147295,chang_min4:-12.030841,r2:0.3868},
    firmness:{intercept:-361.352702,chang_LC56:0.225278,chang_LC78:0.165133,chang_9rain:-0.02638,chang_min4:-1.224087,r2:0.9405},
    brix:{intercept:6.147595,chang_LC56:0.003302,chang_LC78:0.003168,chang_9rain:-0.001232,chang_min4:-0.027597,r2:0.5606},
    acidity:{intercept:-0.405473,chang_LC56:-0.000761,chang_LC78:0.001202,chang_9rain:3.2e-05,chang_min4:-0.039581,r2:0.5125},
  },
  jangsu:{
    diameter:{intercept:93.137736,chang_LC56:-0.02031,chang_LC78:0.004978,chang_9rain:0.008893,chang_min4:0.315845,r2:0.3895},
    weight:{intercept:301.077668,chang_LC56:-0.059176,chang_LC78:-0.001851,chang_9rain:0.115007,chang_min4:0.04896,r2:0.3734},
    firmness:{intercept:39.526677,chang_LC56:0,chang_LC78:0,chang_9rain:0.216543,chang_min4:2.481844,r2:0.399},
    brix:{intercept:14.487552,chang_LC56:-0.00393,chang_LC78:0.000881,chang_9rain:0.001949,chang_min4:-0.106394,r2:0.7703},
    acidity:{intercept:0.017979,chang_LC56:0.000554,chang_LC78:-2.2e-05,chang_9rain:-0.000269,chang_min4:-0.019181,r2:0.8041},
  },
};
export const isHongroRegion=(v:unknown):v is HongroRegion=>HONGRO_REGIONS.includes(v as HongroRegion);

const nonnegative = z.number().finite().min(0);
export const hongroInitialSchema = z.object({
  firmness:nonnegative,brix:nonnegative,acidity:nonnegative,weight:nonnegative.optional(),diameter:nonnegative.optional(),
}).strict();
export const hongroWeatherSchema = z.object({
  chang_min4:z.number().finite(),chang_LC56:z.number().finite(),chang_LC78:z.number().finite(),chang_9rain:z.number().finite(),
}).strict();
const common = {
  cultivar:z.literal('hongro'),region:z.enum(['geochang','chungju','gunwi','pocheon','hwaseong','jangsu']),storage:z.enum(['cold0','cold4']),days:z.number().finite().min(0).max(120),
};
export const hongroInputSchema = z.discriminatedUnion('source',[
  z.object({...common,source:z.literal('measured'),initial:hongroInitialSchema}).strict(),
  z.object({...common,source:z.literal('weather'),weather:hongroWeatherSchema}).strict(),
]);
export type HongroInput = z.infer<typeof hongroInputSchema>;
export type HongroInitial = z.infer<typeof hongroInitialSchema>;
export type HongroWeather = z.infer<typeof hongroWeatherSchema>;
export type HongroStorage = HongroInput['storage'];
export type HongroQuality = Pick<HongroInitial,'firmness'|'brix'|'acidity'>;
export type HongroPoint = HongroQuality & {days:number};
export type HongroScenario = {predicted:HongroQuality;delta:HongroQuality;series:HongroPoint[]};
export type HongroMetric = keyof typeof HONGRO_REGRESSION;
export class HongroCalculationError extends Error {
  readonly code='invalid_regression_result';
  constructor(public readonly invalidMetrics:HongroMetric[]){
    super(`초기 회귀 계산에서 음수 또는 유효하지 않은 값이 나왔습니다 (${invalidMetrics.join(', ')}). 계수와 입력값·단위를 확인해 주세요. 해당 값을 0으로 바꾸거나 저장 계산을 진행하지 않습니다.`);
    this.name='HongroCalculationError';
  }
}

/** Only the weather regression supplies optional initial diameter/weight; no time curves for them. */
export function estimateHongroInitial(value:unknown,region:HongroRegion='geochang'):Required<HongroInitial>{
  const weather=hongroWeatherSchema.parse(value),initial={} as Required<HongroInitial>;
  for(const metric of Object.keys(HONGRO_REGRESSION) as HongroMetric[]){
    const c=HONGRO_REGRESSIONS[region][metric];
    initial[metric]=c.intercept+c.chang_LC56*weather.chang_LC56+c.chang_LC78*weather.chang_LC78+c.chang_9rain*weather.chang_9rain+c.chang_min4*weather.chang_min4;
  }
  const invalid=(Object.keys(initial) as HongroMetric[]).filter(metric=>!Number.isFinite(initial[metric])||initial[metric]<0);
  if(invalid.length)throw new HongroCalculationError(invalid);
  return initial;
}

function qualityAt(initial:HongroInitial,storage:HongroStorage,days:number):HongroQuality{
  return Object.fromEntries((['firmness','brix','acidity'] as const).map(metric=>{
    const result=predictQuality({cultivar:'hongro',storage:'cold',temperature:storage==='cold0'?0:4,mcp:'untreated',metric,day:days,anchor:{day:0,value:initial[metric]}});
    if(!result.ok||result.value===null)throw new Error(result.reason??'홍로 계산값 없음');
    return [metric,result.value];
  })) as HongroQuality;
}
function scenario(initial:HongroInitial,storage:HongroStorage,days:number):HongroScenario{
  const predicted=qualityAt(initial,storage,days);
  return {predicted,delta:{firmness:predicted.firmness-initial.firmness,brix:predicted.brix-initial.brix,acidity:predicted.acidity-initial.acidity},
    series:Array.from({length:121},(_,day)=>({days:day,...qualityAt(initial,storage,day)}))};
}
export type HongroResult = ReturnType<typeof calculateHongro>;

/** Shared pure entry point for browser and API. No coercion, implicit sample input or storage writes. */
export function calculateHongro(value:unknown){
  const input=hongroInputSchema.parse(value);
  const initial:HongroInitial=input.source==='measured'?{...input.initial}:estimateHongroInitial(input.weather,input.region);
  const comparison={cold0:scenario(initial,'cold0',input.days),cold4:scenario(initial,'cold4',input.days)};
  const selected=comparison[input.storage];
  const warnings:string[]=[];
  if(input.source==='weather'){
    warnings.push(`초기 경도 회귀식의 R²는 ${HONGRO_REGRESSIONS[input.region].firmness.r2}입니다. 학습 자료에 대한 적합도이며 독립 검증 성능이나 저장 예측 정확도를 뜻하지 않습니다.`);
    if(input.region==='geochang')for(const {key,reference} of HONGRO_WEATHER_FIELDS){
      const v=input.weather[key];
      if(v<reference.min||v>reference.max)warnings.push(`${key} 입력 ${v}는 chang_200.xlsx 합성자료 참고 범위 ${reference.min}~${reference.max} 밖입니다. 이 범위는 검증된 적용 범위가 아니며, 외삽 계산의 불확실성을 확인해 주세요.`);
    }
  }
  const metadata={
    modelVersion:HONGRO_MODEL_VERSION,cultivar:input.cultivar,region:input.region,initialSource:input.source,
    initialKind:input.source==='measured'?'실측 입력' as const:'기상 회귀 추정' as const,
    storageModel:'제공 엑셀 근사 모델 · 논문 직접 회귀식으로 확인되지 않음',validation:'독립 예측 성능 검증 미완료 · 0~120일은 구현 범위이며 독립적으로 검증된 적용 기간이 아님',displayDays:{min:0,max:120},
    sourceFiles:HONGRO_SOURCE_FILES,initialRegressionR2:input.source==='weather'?Object.fromEntries((Object.keys(HONGRO_REGRESSION) as HongroMetric[]).map(key=>[key,HONGRO_REGRESSIONS[input.region][key].r2])) as Record<HongroMetric,number>:null,
    referenceData:{file:'chang_200.xlsx',rows:200,kind:'synthetic' as const,isValidatedDomain:false as const},
    disclaimer:HONGRO_DISCLAIMER,unitsConflict:HONGRO_UNITS_CONFLICT,sugarEquationConflict:HONGRO_SUGAR_EQUATION_CONFLICT,
  };
  return {input,initial,predicted:selected.predicted,delta:selected.delta,series:selected.series,comparison,warnings,metadata};
}
