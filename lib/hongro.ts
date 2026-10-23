import {z} from 'zod';

/** Separate Hongro model: none of the Fuji coefficients or storage models are used. */
export const HONGRO_MODEL_VERSION = 'hongro-geochang-provided-2026-10-23';
export const HONGRO_DISCLAIMER = '본 결과는 합성자료 기반 초기품질 회귀식과 문헌을 참고해 구성한 저장 변화식을 연결한 참고용 시뮬레이션입니다. 실제 농가·과실에 대한 독립적인 예측 성능 검증은 완료되지 않았습니다. 실제 품질은 수확 숙도, 과실 개체차, 저장고 환경 등에 따라 달라질 수 있습니다.';
export const HONGRO_UNITS_CONFLICT = '초기 회귀 계수 이미지에는 경도가 N/mm로, 저장식과 참고 논문에는 N(직경 11 mm 탐침)으로 표기되어 있습니다. 원자료 단위의 동일성은 확인되지 않았습니다. 요청에 따라 회귀 수치를 변환하지 않고 N (Ø11 mm)로 이어 계산하므로 해석에 이 불확실성이 남습니다.';
export const HONGRO_SUGAR_EQUATION_CONFLICT = '저장식 파일의 당도 비고에는 감소량이 적혀 있지만 명시 수식은 S(t)=S0입니다. 수식을 우선하여 두 저장 조건 모두 초기 당도를 유지합니다.';
export const HONGRO_STORAGE_LABELS = {cold0:'0℃ 저온저장',cold4:'4℃ 저온저장'} as const;
export const HONGRO_STORAGE_EQUATIONS = {
  cold0:{firmness:'F(t) = MAX(0, F0 - MIN(t, 60) × (7.0/60) - MAX(t-60, 0) × (7.4/60))',acidity:'A(t) = MAX(0, A0 - MAX(t-60, 0) × (0.05/60))',brix:'S(t) = S0'},
  cold4:{firmness:'F(t) = MAX(0, F0 - MIN(t, 60) × (7.0/60) - MAX(t-60, 0) × (8.6/60))',acidity:'A(t) = MAX(0, A0 - MAX(t-60, 0) × (0.03/60))',brix:'S(t) = S0'},
} as const;
export const HONGRO_UNITS = {firmness:'N (Ø11 mm)',brix:'°Brix',acidity:'%',weight:'g',diameter:'mm'} as const;
export const HONGRO_DELTA_UNITS = {firmness:'N (Ø11 mm)',brix:'°Brix',acidity:'%p'} as const;
export const HONGRO_SOURCE_FILES = ['Screenshot_20261023_135647_Hancom Office Viewer (1).jpg','거창_품질예측식.xlsx','chang_200.xlsx','거창사과_저온저장.pdf'] as const;

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

/** Exact transcription from the attached coefficient image; no fitting to synthetic rows. */
export const HONGRO_REGRESSION = {
  diameter:{intercept:59.258570,chang_LC56:-0.122297,chang_LC78:0.108116,chang_9rain:0.003106,chang_min4:-0.761469,r2:0.8788},
  weight:{intercept:127.640760,chang_LC56:-0.945435,chang_LC78:0.743870,chang_9rain:0.084457,chang_min4:2.540380,r2:0.8968},
  firmness:{intercept:-46.266556,chang_LC56:0.053485,chang_LC78:0.035317,chang_9rain:0.007695,chang_min4:0.994431,r2:0.2495},
  brix:{intercept:-34.446960,chang_LC56:-0.017218,chang_LC78:0.053072,chang_9rain:-0.003138,chang_min4:-1.283448,r2:0.9009},
  acidity:{intercept:2.436584,chang_LC56:-0.000036,chang_LC78:-0.001896,chang_9rain:0.000314,chang_min4:0.061400,r2:0.8507},
} as const;

const nonnegative = z.number().finite().min(0);
export const hongroInitialSchema = z.object({
  firmness:nonnegative,brix:nonnegative,acidity:nonnegative,weight:nonnegative.optional(),diameter:nonnegative.optional(),
}).strict();
export const hongroWeatherSchema = z.object({
  chang_min4:z.number().finite(),chang_LC56:z.number().finite(),chang_LC78:z.number().finite(),chang_9rain:z.number().finite(),
}).strict();
const common = {
  cultivar:z.literal('hongro'),region:z.literal('geochang'),storage:z.enum(['cold0','cold4']),days:z.number().finite().min(0).max(120),
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
export function estimateHongroInitial(value:unknown):Required<HongroInitial>{
  const weather=hongroWeatherSchema.parse(value),initial={} as Required<HongroInitial>;
  for(const metric of Object.keys(HONGRO_REGRESSION) as HongroMetric[]){
    const c=HONGRO_REGRESSION[metric];
    initial[metric]=c.intercept+c.chang_LC56*weather.chang_LC56+c.chang_LC78*weather.chang_LC78+c.chang_9rain*weather.chang_9rain+c.chang_min4*weather.chang_min4;
  }
  const invalid=(Object.keys(initial) as HongroMetric[]).filter(metric=>!Number.isFinite(initial[metric])||initial[metric]<0);
  if(invalid.length)throw new HongroCalculationError(invalid);
  return initial;
}

function qualityAt(initial:HongroInitial,storage:HongroStorage,days:number):HongroQuality{
  const early=Math.min(days,60),late=Math.max(days-60,0);
  return {
    firmness:Math.max(0,initial.firmness-early*(7/60)-late*((storage==='cold0'?7.4:8.6)/60)),
    acidity:Math.max(0,initial.acidity-late*((storage==='cold0'?0.05:0.03)/60)),
    brix:initial.brix,
  };
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
  const initial:HongroInitial=input.source==='measured'?{...input.initial}:estimateHongroInitial(input.weather);
  const comparison={cold0:scenario(initial,'cold0',input.days),cold4:scenario(initial,'cold4',input.days)};
  const selected=comparison[input.storage];
  const warnings:string[]=[];
  if(input.source==='weather'){
    warnings.push(HONGRO_UNITS_CONFLICT,'초기 경도 회귀식의 R²는 0.2495입니다. 합성자료에 대한 적합도이며 독립 검증 성능이나 저장 예측 정확도를 뜻하지 않습니다.');
    for(const {key,reference} of HONGRO_WEATHER_FIELDS){
      const v=input.weather[key];
      if(v<reference.min||v>reference.max)warnings.push(`${key} 입력 ${v}는 chang_200.xlsx 합성자료 참고 범위 ${reference.min}~${reference.max} 밖입니다. 이 범위는 검증된 적용 범위가 아니며, 외삽 계산의 불확실성을 확인해 주세요.`);
    }
  }
  const metadata={
    modelVersion:HONGRO_MODEL_VERSION,cultivar:input.cultivar,region:input.region,initialSource:input.source,
    initialKind:input.source==='measured'?'실측 입력' as const:'기상 회귀 추정' as const,
    storageModel:'사용자 제공 구간 선형식',validation:'독립 예측 성능 검증 미완료 · 0~120일은 구현 범위이며 독립적으로 검증된 적용 기간이 아님',displayDays:{min:0,max:120},
    sourceFiles:HONGRO_SOURCE_FILES,initialRegressionR2:input.source==='weather'?Object.fromEntries((Object.keys(HONGRO_REGRESSION) as HongroMetric[]).map(key=>[key,HONGRO_REGRESSION[key].r2])) as Record<HongroMetric,number>:null,
    referenceData:{file:'chang_200.xlsx',rows:200,kind:'synthetic' as const,isValidatedDomain:false as const},
    disclaimer:HONGRO_DISCLAIMER,unitsConflict:HONGRO_UNITS_CONFLICT,sugarEquationConflict:HONGRO_SUGAR_EQUATION_CONFLICT,
  };
  return {input,initial,predicted:selected.predicted,delta:selected.delta,series:selected.series,comparison,warnings,metadata};
}
