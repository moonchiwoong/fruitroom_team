import {computeSeries, daysBetween, describeChange, fmtNum, isDate, measuredPoints, metricMeta, MODEL_RANGE, MODEL_VERSION, resolveModel, STORAGE_MODEL_VERIFIED, todayKST, valueAt, type Anchor} from '../tracker';
import {parseOptionalNumber, PRESSURE_REASON, QUALITY_POLICY_VERSION, TRACKED_LOSS_REASON} from '../quality-policy';
import {validateForm} from '../tracker-form';
import {AIError,type PredictionInput} from './contracts';
import {measurementCompatibility} from './context';
import {isHongroVariety} from '../cultivar';
import {estimateHongroInitial} from '../hongro';
import {predictQuality, MODEL_REGISTRY, type QualityInput} from '../quality-models';

const number=(v:unknown)=>{const n=parseOptionalNumber(v);return n.status==='valid'?n.value:null;};
export const modelInformation = () => ({
  modelVersion:MODEL_VERSION,policyVersion:QUALITY_POLICY_VERSION,verification:STORAGE_MODEL_VERIFIED,displayDays:MODEL_RANGE.displayDays,validatedDays:MODEL_RANGE.validatedDays,errorRange:null,
  used:['품종','설정 저장 온도(홍로 0℃·4℃ 모델 선택)','초기 품질값','계산 시작 측정일','저장 시작일','기록된 저장 방식·1-MCP 처리 여부','분석 기준일 이후 선택한 저장 조건'],
  notUsed:['산지별 저장 보정 계수','실제 온습도 이력','포장·사진','입력한 CA 가스 농도·1-MCP 처리 농도'],
  models:MODEL_REGISTRY,
  limitations:['독립 예측 정확도 검증 미완료. 표시 범위는 상품성 유지 기간이나 안전한 보관 기간이 아닙니다.','조건 변경 연결은 검증된 전환 모델이 아닌 조건 변경 시나리오입니다.',TRACKED_LOSS_REASON,'모델 감모율은 초기 중량 없이 계산하며 실측 감모율과 별도 표시합니다.',PRESSURE_REASON],
});

/** Browser, CSV and the read-only AI tools use the same registry and time axis. */
export function evaluatePrediction(input:PredictionInput){
  const {form,mode,metric,asOf,selectedDate}=input;
  const hongro=isHongroVariety(form.variety);
  const errors=validateForm(form,false);
  const relevant=['intake_date','storage_start_date','initial_measured_on','temperature',...(metric==='loss'?[]:[hongro?`hongro.initial.${metric}`:metric])].flatMap(k=>errors[k]?[errors[k]]:[]);
  if(relevant.length)throw new AIError('invalid_input','입력 조건을 확인해 주세요. '+relevant.join(' '));
  const start=form.sameStart?form.intake_date:form.storage_start_date;
  if(!isDate(start)||!isDate(asOf)||!isDate(selectedDate)||asOf<start||asOf>todayKST())throw new AIError('invalid_dates','저장 시작일·분석 기준일·선택 날짜를 확인해 주세요.');
  const measuredOn=form.initial_measured_on||start;
  if(!isDate(measuredOn))throw new AIError('invalid_dates','초기 측정일을 확인해 주세요.');
  if(measuredOn>asOf && metric!=='loss')throw new AIError('initial_after_analysis','초기 측정일이 분석 기준일 이후라 해당 기준일의 계산에 사용할 수 없습니다.');
  const t0=daysBetween(start,measuredOn),asOfDay=daysBetween(start,asOf),day=daysBetween(start,selectedDate);
  const kind=mode==='example'?'예시':'실측';
  const observations=input.observations.filter(o=>o.date<=asOf);
  const measured=measuredPoints(metric,observations,start,kind,number(form.tracked.initial_weight),{sampleId:form.tracked.sample_id,date:form.initial_measured_on});
  const latest=input.useLatest&&metric!=='loss'?[...measured].reverse().find(p=>p.day>=t0):undefined;
  let initial=metric==='loss'?null:number(hongro?form.hongro.initial[metric]:form[metric]);
  let initialError:string|null=null;
  if(hongro && form.hongro.source==='weather' && metric!=='loss'){
    try{initial=estimateHongroInitial(Object.fromEntries(Object.entries(form.hongro.weather).map(([k,v])=>[k,number(v)])))[metric];}
    catch(error){initial=null;initialError=error instanceof Error?error.message:'기상 초기값을 계산하지 못했습니다.';}
  }
  const anchor:Anchor|null=metric==='loss'?null:latest?{day:latest.day,date:latest.date,value:latest.value,kind:latest.kind,source:'latest'}:initial===null?null:{day:t0,date:measuredOn,value:initial,kind,source:'initial'};
  const recorded=resolveModel({...form,temperature:number(form.temperature)}),future=input.future==='same'?recorded:{id:input.future,reason:input.future?'':'선택 조건을 확인해 주세요.'};
  const condition:QualityInput={cultivar:form.variety,storage:form.storage==='일반 저온'?'cold':form.storage==='CA'?'ca':'other',temperature:number(form.temperature),mcp:form.mcp==='처리'?'treated':form.mcp==='미처리'?'untreated':'unknown',metric,day,anchor,allowFujiReference:form.loss_reference};
  const prediction=predictQuality(condition);
  const series=computeSeries({variety:form.variety,temperature:number(form.temperature),metric,anchor,recorded:recorded.id,recordedReason:recorded.reason,future:future.id,futureReason:future.reason,asOfDay});
  const at=hongro?(prediction.ok?{status:'ok' as const,value:prediction.value!,segment:day<=asOfDay?'past' as const:'future' as const}:{status:day>120?'out' as const:'unavailable' as const,reason:initialError??prediction.reason??'계산 불가'}):valueAt(series,day);
  const selectedPrediction={...(at.status==='ok' && 'result' in at && at.result ? at.result : prediction),ok:at.status==='ok',value:at.status==='ok'?at.value:null,reason:at.status==='ok'?null:at.reason};
  const measuredLossPoints=metric==='loss'?measured:measuredPoints('loss',observations,start,kind,number(form.tracked.initial_weight),{sampleId:form.tracked.sample_id,date:form.initial_measured_on});
  const measuredAt=measuredLossPoints.find(p=>p.date===selectedDate);
  const measuredLoss={status:measuredAt?'ok' as const:'unavailable' as const,value:measuredAt?.value??null,reason:measuredAt?null:TRACKED_LOSS_REASON,kind:'실측' as const,date:selectedDate,unit:'%'};
  const meta=metricMeta[metric],last=[...measured].reverse().find(p=>p.day>=0);
  const conditions=measurementCompatibility(form.measure,observations.find(o=>o.id===last?.id)?.details?.measure);
  const canCompare=metric==='loss'?t0===0:conditions.comparable;
  const comparison=last&&canCompare?(hongro?(()=>{const p=predictQuality({...condition,day:last.day});return p.ok?{status:'ok' as const,value:p.value!}:null;})():valueAt(series,last.day)):null;
  const display=(v:number)=>fmtNum(v,meta.digits);
  return {
    metric,label:meta.label,unit:meta.unit,date:selectedDate,storageDay:day,asOf,initialMeasuredOn:form.initial_measured_on||null,calculationStartDate:metric==='loss'?start:anchor?.date??null,
    status:at.status,value:at.status==='ok'?at.value:null,displayValue:at.status==='ok'?display(at.value):null,reason:at.status==='ok'?null:at.reason,
    dataKind:mode==='example'?'예시':selectedPrediction.kind,verification:selectedPrediction.validation,
    change:at.status==='ok'&&anchor?describeChange(metric,at.value,anchor.value):null,
    measuredLoss,
    latestComparison:last?{date:last.date,measured:last.value,displayMeasured:display(last.value),sampleCount:last.sampleCount,calculated:comparison?.status==='ok'?comparison.value:null,displayCalculated:comparison?.status==='ok'?display(comparison.value):null,difference:comparison?.status==='ok'?describeChange(metric,last.value,comparison.value):null,conditions,reason:metric==='loss'&&!canCompare?'실측 감모율의 초기 측정일이 저장 시작일과 달라 동일 기간 비교를 하지 않습니다.':!conditions.comparable?conditions.reason:comparison?.status==='ok'?conditions.reason:'비교 계산값이 없습니다.'}:null,
    conditions:{storageStartDate:start,recorded:recorded.id,future:future.id,temperature:number(form.temperature),useLatest:input.useLatest,initial:anchor?.value??null,sourceMode:mode},model:{...modelInformation(),selectedPrediction},
  };
}
