import {calculateHongro, HONGRO_WEATHER_FIELDS, type HongroResult, type HongroStorage} from './hongro';
import {parseOptionalNumber} from './quality-policy';

export type HongroTrackerForm = {
  source: 'measured' | 'weather';
  storage: HongroStorage;
  initial: Record<'firmness' | 'brix' | 'acidity' | 'weight' | 'diameter', string>;
  weather: Record<'chang_min4' | 'chang_LC56' | 'chang_LC78' | 'chang_9rain', string>;
};

export function emptyHongroForm(): HongroTrackerForm {
  return {source:'measured',storage:'cold0',initial:{firmness:'',brix:'',acidity:'',weight:'',diameter:''},weather:{chang_min4:'',chang_LC56:'',chang_LC78:'',chang_9rain:''}};
}

/** Explicit example mode only; callers must not save these as measured records. */
export function exampleHongroForm(): HongroTrackerForm {
  return {...emptyHongroForm(),initial:{firmness:'60',brix:'14',acidity:'0.35',weight:'280',diameter:'80'}};
}

export function hongroStorageStart(f:{sameStart:boolean;intake_date:string;storage_start_date:string}):string {
  return f.sameStart ? f.intake_date : f.storage_start_date;
}

export function validateHongroForm(h:HongroTrackerForm):Record<string,string> {
  const errors:Record<string,string>={};
  if(!h || !['measured','weather'].includes(h.source)) errors['hongro.source']='초기품질 출처를 선택해 주세요.';
  if(!h || !['cold0','cold4'].includes(h.storage)) errors['hongro.storage']='홍로는 0℃ 또는 4℃ 저온저장만 지원합니다.';
  if(!h) return errors;
  const check=(key:string,value:string|undefined,label:string,required:boolean,nonnegative:boolean)=>{
    const parsed=parseOptionalNumber(value ?? '');
    if(parsed.status==='missing'){if(required)errors[key]=`${label}을(를) 입력해 주세요.`;return;}
    if(parsed.status==='invalid'){errors[key]=`${label}: ${parsed.reason}`;return;}
    if(nonnegative && parsed.value<0)errors[key]=`${label}은(는) 0 이상이어야 합니다.`;
  };
  if(h.source==='measured'){
    const labels={firmness:'초기 경도',brix:'초기 당도',acidity:'초기 산도',weight:'초기 중량',diameter:'초기 횡경'};
    for(const key of Object.keys(labels) as (keyof typeof labels)[])check(`hongro.initial.${key}`,h.initial?.[key],labels[key],false,true);
  }else if(h.source==='weather'){
    for(const field of HONGRO_WEATHER_FIELDS)check(`hongro.weather.${field.key}`,h.weather?.[field.key],field.label,false,false);
  }
  return errors;
}

/** UI adapter only. All coefficients, units and day validation stay in the existing Hongro model. */
export function calculateHongroForm(h:HongroTrackerForm,days:number):HongroResult {
  if(!Number.isFinite(days)||days<0||days>120)throw new Error('홍로 저장일수는 실제 저장 시작일부터 0~120일이어야 합니다. 범위 밖 날짜는 계산하지 않습니다.');
  const errors=validateHongroForm(h);
  if(Object.keys(errors).length)throw new Error(Object.values(errors).join(' '));
  // 저장은 빈칸을 허용하지만, 계산은 필요한 값이 모두 있을 때만 합니다.
  const need=h.source==='weather'?HONGRO_WEATHER_FIELDS.filter(({key})=>!String(h.weather[key]??'').trim()).map(f=>f.label):(['firmness','brix','acidity'] as const).filter(k=>!String(h.initial[k]??'').trim()).map(k=>({firmness:'초기 경도',brix:'초기 당도',acidity:'초기 산도'})[k]);
  if(need.length)throw new Error(`계산에 필요한 입력이 비어 있어요: ${need.join(', ')}.`);
  const number=(value:string)=>{const p=parseOptionalNumber(value);if(p.status!=='valid')throw new Error('계산에 필요한 입력값을 확인해 주세요.');return p.value;};
  const common={cultivar:'hongro' as const,region:'geochang' as const,storage:h.storage,days};
  if(h.source==='weather')return calculateHongro({...common,source:'weather',weather:Object.fromEntries(HONGRO_WEATHER_FIELDS.map(({key})=>[key,number(h.weather[key])]))});
  const initial=Object.fromEntries(Object.entries(h.initial).filter(([,value])=>value.trim()!=='').map(([key,value])=>[key,number(value)]));
  return calculateHongro({...common,source:'measured',initial});
}
