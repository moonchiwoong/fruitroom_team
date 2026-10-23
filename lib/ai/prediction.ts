import {computeSeries, daysBetween, describeChange, fmtNum, isDate, measuredPoints, metricMeta, MODEL_RANGE, MODEL_VERSION, resolveModel, STORAGE_MODEL_VERIFIED, todayKST, valueAt, type Anchor} from '../tracker';
import {parseOptionalNumber, PRESSURE_REASON, QUALITY_POLICY_VERSION, TRACKED_LOSS_REASON} from '../quality-policy';
import {validateForm} from '../tracker-form';
import {AIError,type PredictionInput} from './contracts';
import {measurementCompatibility} from './context';

const number=(v:unknown)=>{const n=parseOptionalNumber(v);return n.status==='valid'?n.value:null;};
export const modelInformation = () => ({
  modelVersion:MODEL_VERSION,policyVersion:QUALITY_POLICY_VERSION,verification:STORAGE_MODEL_VERIFIED,displayDays:MODEL_RANGE.displayDays,validatedDays:MODEL_RANGE.validatedDays,errorRange:null,
  used:['초기 품질값','계산 시작 측정일','저장 시작일','기록된 저장 방식·1-MCP 처리 여부','분석 기준일 이후 선택한 저장 조건'],
  notUsed:['품종별 보정','실제 온습도 이력','포장·사진','입력한 CA 가스 농도·1-MCP 처리 농도'],
  limitations:['시연용 계산입니다. 적용 기간과 예측 오차 범위는 검증되지 않았습니다.','출하일·남은 보관 가능 기간·식품 안전성·신선도 등급을 판정하지 않습니다.',TRACKED_LOSS_REASON,PRESSURE_REASON],
});

/** UI의 같은 순수 계산 엔진과 입력·출력 정책을 사용합니다. 계수나 수식을 복제하지 않습니다. */
export function evaluatePrediction(input:PredictionInput){
  const {form,mode,metric,asOf,selectedDate}=input;
  const errors=validateForm(form,false);
  const relevant=['intake_date','storage_start_date','initial_measured_on',...(metric==='loss'?['tracked_weight','tracked_count','tracked_sample_id']:[metric])].flatMap(k=>errors[k]?[errors[k]]:[]);
  if(relevant.length)throw new AIError('invalid_input','입력 조건을 확인해 주세요. '+relevant.join(' '));
  const start=form.sameStart?form.intake_date:form.storage_start_date;
  if(!isDate(start)||!isDate(asOf)||!isDate(selectedDate)||asOf<start||asOf>todayKST())throw new AIError('invalid_dates','저장 시작일·분석 기준일·선택 날짜를 확인해 주세요.');
  const measuredOn=form.initial_measured_on||start;
  if(!isDate(measuredOn))throw new AIError('invalid_dates','초기 측정일을 확인해 주세요.');
  if(measuredOn>asOf)throw new AIError('initial_after_analysis','초기 측정일이 분석 기준일 이후라 해당 기준일의 계산에 사용할 수 없습니다.');
  const t0=daysBetween(start,measuredOn),asOfDay=daysBetween(start,asOf),day=daysBetween(start,selectedDate);
  const kind=mode==='example'?'예시':'실측';
  const observations=input.observations.filter(o=>o.date<=asOf);
  const measured=measuredPoints(metric,observations,start,kind,number(form.tracked.initial_weight),{sampleId:form.tracked.sample_id,date:form.initial_measured_on});
  const latest=input.useLatest?[...measured].reverse().find(p=>p.day>=t0):undefined;
  const initial=metric==='loss'?0:number(form[metric]);
  const anchor:Anchor|null=latest?{day:latest.day,date:latest.date,value:latest.value,kind:latest.kind,source:'latest'}:initial===null?null:{day:t0,date:measuredOn,value:initial,kind,source:'initial'};
  const recorded=resolveModel(form),future=input.future==='same'?recorded:{id:input.future,reason:input.future?'':'선택 조건을 확인해 주세요.'};
  const series=computeSeries({metric,anchor,recorded:recorded.id,recordedReason:recorded.reason,future:future.id,futureReason:future.reason,asOfDay});
  const realLoss=mode==='real'&&metric==='loss';
  const measuredAt=measured.find(p=>p.date===selectedDate);
  const at=realLoss?(measuredAt?{status:'ok' as const,value:measuredAt.value,segment:'past' as const}:{status:'unavailable' as const,reason:TRACKED_LOSS_REASON}):valueAt(series,day);
  const meta=metricMeta[metric];
  const last=[...measured].reverse().find(p=>p.day>=0);
  const conditions=measurementCompatibility(form.measure,observations.find(o=>o.id===last?.id)?.details?.measure);
  const comparison=last&&!realLoss&&conditions.comparable?valueAt(series,last.day):null;
  const display=(v:number)=>fmtNum(v,meta.digits);
  const model=modelInformation();
  return {
    metric,label:meta.label,unit:meta.unit,date:selectedDate,storageDay:day,asOf,initialMeasuredOn:form.initial_measured_on||null,calculationStartDate:anchor?.date??null,
    status:at.status,value:at.status==='ok'?at.value:null,displayValue:at.status==='ok'?display(at.value):null,reason:at.status==='ok'?null:at.reason,
    dataKind:mode==='example'?'예시':realLoss?'실측':'모델 계산',verification:realLoss?'중량 실측 기반 계산':STORAGE_MODEL_VERIFIED,
    change:at.status==='ok'&&anchor?describeChange(metric,at.value,anchor.value):null,
    latestComparison:last?{date:last.date,measured:last.value,displayMeasured:display(last.value),sampleCount:last.sampleCount,calculated:comparison?.status==='ok'?comparison.value:null,displayCalculated:comparison?.status==='ok'?display(comparison.value):null,difference:comparison?.status==='ok'?describeChange(metric,last.value,comparison.value):null,conditions,reason:realLoss?'실측 중량 기반 감모율에는 모델 계산값을 대조하지 않습니다.':!conditions.comparable?conditions.reason:comparison?.status==='ok'?conditions.reason:comparison?.reason??'비교 계산값이 없습니다.'}:null,
    conditions:{storageStartDate:start,recorded:recorded.id,future:future.id,useLatest:input.useLatest,initial:anchor?.value??null,sourceMode:mode},model,
  };
}
