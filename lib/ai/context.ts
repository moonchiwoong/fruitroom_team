import type {Observation} from '../lot-types';
import type {TrackerForm} from '../tracker-form';
/** Reproduction fingerprint only, never an authentication credential. */
export function observationFingerprint(observations:Observation[]){
  const encoded=JSON.stringify([...observations].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(o=>[o.id,o.date,o.firmness,o.brix,o.acidity??null,o.tracked_weight??null,o.sample_count,o.details?.tracked?.sample_id??null,o.details?.measure??null]));
  // Compact reproduction check shared by browser and server; never used for authorization.
  let a=2166136261,b=2246822519;for(let i=0;i<encoded.length;i++){a=Math.imul(a^encoded.charCodeAt(i),16777619);b=Math.imul(b^encoded.charCodeAt(i),3266489917);}
  return `v1:${observations.length}:${encoded.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`;
}
export function baselineCore(form:TrackerForm,useLatest:boolean){
  return JSON.stringify({variety:form.variety,start:form.sameStart?form.intake_date:form.storage_start_date,measuredOn:form.initial_measured_on,firmness:form.firmness,brix:form.brix,acidity:form.acidity,tracked:form.tracked,measure:form.measure,storage:form.storage,mcp:form.mcp,useLatest});
}
type MeasurementConditions={probe_mm?:unknown;peeled?:unknown;position?:unknown;fruit_temp?:unknown;instrument?:unknown}|null|undefined;
/** Explicit differences prohibit comparisons; missing metadata remains clearly unverified. */
export function measurementCompatibility(initial:MeasurementConditions,later:MeasurementConditions):{status:'match'|'unknown'|'mismatch';comparable:boolean;reason:string|null}{
  const keys=['probe_mm','peeled','position','fruit_temp','instrument'] as const;
  let missing=false;
  for(const key of keys){
    const normalize=(value:unknown)=>value===null||value===undefined?'':String(value).trim();
    const a=normalize(initial?.[key]),b=normalize(later?.[key]);
    if(!a||!b){missing=true;continue;}
    const equal=key==='probe_mm'||key==='fruit_temp'?Number(a)===Number(b):a===b;
    if(!equal)return {status:'mismatch',comparable:false,reason:'초기와 후속 기록의 측정 조건이 달라 변화량·계산 차이를 비교하지 않습니다.'};
  }
  return missing?{status:'unknown',comparable:true,reason:'측정 조건 기록이 일부 없어 조건 일치를 확인하지 못했습니다. 비교값 해석 전에 측정 조건을 확인해 주세요.'}:{status:'match',comparable:true,reason:null};
}
