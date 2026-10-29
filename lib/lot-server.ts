import {serverClient} from './supabase-server';
import {InputError,numberOrNull,validDate,parseCsv,summarizeEnvironment,demoPrediction,endOfKoreanDay,restrictPredictionForVariety} from './lot-analysis';
import {today,type Lot,type EnvRow,type Observation,type Photo} from './lot-types';
import {restrictLegacyLoss} from './quality-policy';
import {HONGRO_DEDICATED_REASON,isHongroVariety} from './cultivar';
import {HONGRO_MODEL_VERSION,HONGRO_UNITS} from './hongro';
async function clientUser(){const c=await serverClient();const {data,error}=await c.auth.getUser();if(error||!data.user)throw new InputError('로그인이 필요합니다.');return {c,user:data.user};}
async function client(){const c=await serverClient();const {data,error}=await c.auth.getUser();if(error||!data.user)throw new InputError('로그인이 필요합니다.');return c;}
function checked<T>(r:{data:T;error:unknown}):T{if(r.error)throw r.error;return r.data;}
async function storage(){return (await client()).storage.from(process.env.SUPABASE_STORAGE_BUCKET||'fruitroom_files');}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});}
export function errorResponse(e:unknown){if(e instanceof InputError)return json({error:e.message,...(e.rows?{rows:e.rows}:{})},400);console.error('Storage request failed',e instanceof Error?e.message:'Unknown');return json({error:'기록을 불러오거나 저장하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.'},503);}
export function checkOrigin(req:Request){if(Number(req.headers.get('content-length')??0)>6*1024*1024)throw new InputError('업로드 파일이 너무 큽니다.');const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new InputError('같은 사이트에서 다시 요청해 주세요.');}
export async function getLot(id:string){const c=await client();const lot=checked(await c.from('lots').select('*').eq('id',id).maybeSingle()) as Lot|null;if(!lot)throw new InputError('물량을 찾을 수 없습니다.');return lot;}
async function payload(req:Request){const text=await req.text();if(text.length>30000)throw new InputError('입력 내용이 너무 깁니다.');try{const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new InputError('입력 형식을 확인해 주세요.');}}
function short(v:unknown,label:string,optional=false,max=120){if(typeof v!=='string'||(!optional&&!v.trim())||v.length>max)throw new InputError(`${label}를 확인해 주세요.`);return v.trim();}
export async function listLots(){const c=await client();const lots=checked(await c.from('lots').select('*').order('created_at',{ascending:false}).limit(100))||[];const result=await Promise.all(lots.map(async(l:any)=>{const [e,o,f]=await Promise.all([c.from('environment').select('timestamp',{count:'exact'}).eq('lot_id',l.id).order('timestamp',{ascending:false}).limit(1),c.from('observations').select('defects,date,firmness,brix,acidity',{count:'exact'}).eq('lot_id',l.id).order('date',{ascending:false}).order('id',{ascending:false}).limit(1),c.from('files').select('id',{count:'exact',head:true}).eq('lot_id',l.id).eq('kind','photo')]);if(e.error||o.error||f.error)throw e.error||o.error||f.error;return {...l,environment_count:e.count||0,observation_count:o.count||0,photo_count:f.count||0,latest_defects:o.data?.[0]?.defects,latest_observation:o.data?.[0]?{date:o.data[0].date,firmness:o.data[0].firmness,brix:o.data[0].brix,acidity:o.data[0].acidity??null}:null,last_environment:e.data?.[0]?.timestamp};}));return json({lots:result});}
// ── 물량 기록: 이름·품종·입고일만 필수, 나머지는 측정·확인한 항목만 저장 ──
function lotFields(p:any,partial:boolean,variety:unknown=p.variety){
 const out:Record<string,unknown>={};const has=(k:string)=>Object.prototype.hasOwnProperty.call(p,k);
 if(p.mode==='example'||p.sampleOnly===true||(has('record_mode')&&p.record_mode!=='real'))throw new InputError('예시 데이터는 실제 물량 기록으로 저장할 수 없습니다.');
 const hongro=isHongroVariety(variety);
 const optText=(k:string,label:string,max=120)=>{if(!has(k))return;const v=p[k];out[k]=v===null||v===undefined||v===''?null:short(v,label,true,max)||null;};
 const optDate=(k:string,label:string)=>{if(!has(k))return;out[k]=p[k]===null||p[k]===''?null:validDate(p[k],label);};
 if(!partial||has('name'))out.name=short(p.name,'물량 이름');
 if(!partial||has('variety'))out.variety=short(p.variety,'품종');
 if(!partial||has('intake_date'))out.intake_date=validDate(p.intake_date,'입고일');
 optDate('harvest_date','수확일');optDate('storage_start_date','저장 시작일');optDate('initial_measured_on','초기 측정일');
 optText('location','저장고 위치');optText('sensor_id','센서 번호',60);optText('packaging','포장 형태');
 if(has('quantity'))out.quantity=numberOrNull(p.quantity,0.1,1000000,'저장 수량');
 if(has('initial_sample_count')){const n=numberOrNull(p.initial_sample_count,1,10000,'표본 수');if(n!==null&&!Number.isInteger(n))throw new InputError('표본 수는 정수로 입력해 주세요.');out.initial_sample_count=n;}
 if(has('firmness'))out.firmness=numberOrNull(p.firmness,0,hongro?Number.MAX_VALUE:300,'초기 경도 N');
 if(has('brix'))out.brix=numberOrNull(p.brix,0,hongro?Number.MAX_VALUE:40,'초기 당도 °Brix');
 if(has('acidity'))out.acidity=numberOrNull(p.acidity,0,hongro?Number.MAX_VALUE:10,'초기 산도 %');
 if(has('weight'))out.weight=numberOrNull(p.weight,hongro?0:1,hongro?Number.MAX_VALUE:2000,'평균 중량 g');
 if(!partial||has('storage')){const v=p.storage??'일반 저온';if(!['일반 저온','CA','기타'].includes(v))throw new InputError('저장 방식을 확인해 주세요.');out.storage=v;}
 if(!partial||has('mcp')){const v=p.mcp??'미확인';if(!['미처리','처리','미확인'].includes(v))throw new InputError('1-MCP 처리 여부를 확인해 주세요.');out.mcp=v;}
 if(has('notes'))out.notes=short(p.notes??'','메모',true,1000);
 if(has('details'))out.details=cleanDetails(p.details);
 const d=(k:string)=>out[k] as string|null|undefined;
 if(d('harvest_date')&&d('intake_date')&&d('harvest_date')!>d('intake_date')!)throw new InputError('수확일은 입고일보다 늦을 수 없습니다.');
 for(const k of ['harvest_date','intake_date','storage_start_date','initial_measured_on'])if(d(k)&&d(k)!>today())throw new InputError('미래 날짜는 입력할 수 없습니다.');
 return out;
}
/** 측정 정보·1-MCP 처리 이력·CA 저장 환경·추적 표본. 정해진 항목만 저장합니다. */
export function cleanDetails(v:unknown){
 if(v===null||v===undefined)return {};
 if(typeof v!=='object'||Array.isArray(v))throw new InputError('세부 정보 형식을 확인해 주세요.');
 const s=v as Record<string,any>,o:Record<string,unknown>={};
 const num=(x:unknown,min:number,max:number,label:string)=>numberOrNull(x,min,max,label);
 const txt=(x:unknown,label:string,max=80)=>x===undefined||x===null||x===''?null:short(x,label,true,max)||null;
 const date=(x:unknown,label:string)=>x===undefined||x===null||x===''?null:validDate(x,label);
 if(Object.hasOwn(s,'storage_temperature'))o.storage_temperature=num(s.storage_temperature,-20,50,'설정 저장 온도 ℃');
 if(Object.hasOwn(s,'loss_reference')){if(typeof s.loss_reference!=='boolean')throw new InputError('후지 기반 참고 추정 선택값을 확인해 주세요.');o.loss_reference=s.loss_reference;}
 if(Object.hasOwn(s,'initial_source')&&s.initial_source!==null){if(!['실측','날씨 기반 추정'].includes(s.initial_source))throw new InputError('초기 품질 출처를 확인해 주세요.');o.initial_source=s.initial_source;}
 if(Object.hasOwn(s,'quantity_unit')&&s.quantity_unit!==null){if(!['kg','상자'].includes(s.quantity_unit))throw new InputError('저장 수량 단위는 상자 또는 kg만 저장합니다.');o.quantity_unit=s.quantity_unit;}
 if(Object.hasOwn(s,'initial_observation_id'))o.initial_observation_id=s.initial_observation_id===null||s.initial_observation_id===''?null:short(s.initial_observation_id,'예측 기준 측정 기록',false,80);
 if(Object.hasOwn(s,'initial_history')){if(!Array.isArray(s.initial_history)||s.initial_history.length>20)throw new InputError('이전 초기 측정 이력 형식을 확인해 주세요.');o.initial_history=s.initial_history.map((h:any)=>{if(!h||typeof h!=='object')throw new InputError('이전 초기 측정 이력 형식을 확인해 주세요.');return {date:date(h.date,'이전 초기 측정일'),firmness:num(h.firmness,0,Number.MAX_VALUE,'이전 초기 경도'),brix:num(h.brix,0,Number.MAX_VALUE,'이전 초기 당도'),acidity:num(h.acidity,0,Number.MAX_VALUE,'이전 초기 산도'),sample_count:num(h.sample_count,1,10000,'이전 초기 표본 수'),observation_id:txt(h.observation_id,'이전 기준 기록',80),replaced_at:typeof h.replaced_at==='string'&&h.replaced_at.length<=40?h.replaced_at:null};});}
 if(Object.hasOwn(s,'initial_same_start')){if(typeof s.initial_same_start!=='boolean')throw new InputError('측정일 연결 선택값을 확인해 주세요.');o.initial_same_start=s.initial_same_start;}
 if(s.firmness_input){const f=s.firmness_input;if(!['N','kgf'].includes(f.unit))throw new InputError('경도 단위는 N 또는 kgf만 저장합니다.');o.firmness_input={value:num(f.value,0,300,'입력한 경도'),unit:f.unit};}
 if(Object.hasOwn(s,'not_measured')){if(!Array.isArray(s.not_measured)||s.not_measured.some((k:unknown)=>!['firmness','brix','acidity'].includes(k as string)))throw new InputError('미측정 항목을 확인해 주세요.');o.not_measured=[...new Set(s.not_measured as string[])];}
 if(s.measure){const m=s.measure;o.measure={probe_mm:num(m.probe_mm,0.5,50,'탐침 직경 mm'),peeled:m.peeled===undefined||m.peeled===null||m.peeled===''?null:(['껍질 제거','껍질 포함'].includes(m.peeled)?m.peeled:(()=>{throw new InputError('껍질 제거 여부를 확인해 주세요.');})()),position:txt(m.position,'측정 위치'),fruit_temp:num(m.fruit_temp,-5,40,'과실 온도 °C'),instrument:txt(m.instrument,'측정 기기')};}
 if(s.mcp){const m=s.mcp;o.mcp={treated_on:date(m.treated_on,'1-MCP 처리일'),product:txt(m.product,'제품명'),concentration:txt(m.concentration,'농도',40),hours:num(m.hours,0,500,'처리 시간 h'),temp:num(m.temp,-5,40,'처리 온도 °C')};}
 if(s.ca){const m=s.ca;o.ca={from:date(m.from,'CA 시작일'),to:date(m.to,'CA 종료일'),o2:num(m.o2,0,21,'산소 농도 %'),co2:num(m.co2,0,30,'이산화탄소 농도 %')};}
 if(s.tracked){const m=s.tracked;const c=num(m.count,1,10000,'추적 표본 수');if(c!==null&&!Number.isInteger(c))throw new InputError('추적 표본 수는 정수로 입력해 주세요.');o.tracked={sample_id:txt(m.sample_id,'추적 표본 ID',80),count:c,initial_weight:num(m.initial_weight,1,2000,'추적 표본 초기 평균 중량 g')};}
 if(s.hongro!==undefined&&s.hongro!==null){
  const h=s.hongro;
  if(typeof h!=='object'||Array.isArray(h)||h.schemaVersion!==1||h.cultivar!=='hongro'||h.region!=='geochang'||h.modelVersion!==HONGRO_MODEL_VERSION)throw new InputError('거창 홍로 모델 정보를 확인해 주세요.');
  if(h.mode!=='real')throw new InputError('예시 데이터는 실제 물량 기록으로 저장할 수 없습니다.');
  if(!['measured','weather'].includes(h.source))throw new InputError('홍로 초기품질 출처를 확인해 주세요.');
  if(!['cold0','cold4'].includes(h.storage))throw new InputError('홍로는 0℃ 또는 4℃ 저온저장만 지원합니다.');
  for(const key of ['initial','weather'])if(!h[key]||typeof h[key]!=='object'||Array.isArray(h[key]))throw new InputError('홍로 초기품질·기상자료 형식을 확인해 주세요.');
  if(!h.units||typeof h.units!=='object'||Object.entries(HONGRO_UNITS).some(([key,unit])=>h.units[key]!==unit))throw new InputError('홍로 초기품질 단위를 확인해 주세요.');
  const initial={firmness:num(h.initial.firmness,0,Number.MAX_VALUE,'홍로 초기 경도'),brix:num(h.initial.brix,0,Number.MAX_VALUE,'홍로 초기 당도'),acidity:num(h.initial.acidity,0,Number.MAX_VALUE,'홍로 초기 산도'),weight:num(h.initial.weight,0,Number.MAX_VALUE,'홍로 초기 중량'),diameter:num(h.initial.diameter,0,Number.MAX_VALUE,'홍로 초기 횡경')};
  const weather={chang_min4:num(h.weather.chang_min4,-Number.MAX_VALUE,Number.MAX_VALUE,'4월 일최저기온 평균'),chang_LC56:num(h.weather.chang_LC56,-Number.MAX_VALUE,Number.MAX_VALUE,'5~6월 누적 생장도일'),chang_LC78:num(h.weather.chang_LC78,-Number.MAX_VALUE,Number.MAX_VALUE,'7~8월 누적 생장도일'),chang_9rain:num(h.weather.chang_9rain,-Number.MAX_VALUE,Number.MAX_VALUE,'9월 누적 강수량')};
  o.hongro={schemaVersion:1,modelVersion:HONGRO_MODEL_VERSION,cultivar:'hongro',region:'geochang',mode:'real',source:h.source,storage:h.storage,initial,weather,units:{...HONGRO_UNITS}};
 }
 return o;
}
function checkLotModel(l:Record<string,unknown>){
 const h=(l.details as {hongro?:any}|null|undefined)?.hongro;
 if(!isHongroVariety(l.variety)){if(h)throw new InputError('후지 물량에 홍로 모델 입력을 저장할 수 없습니다.');return;}
 // Legacy observational records have no prediction provenance. Keep them editable;
 // the tracker restores empty Hongro inputs and never infers a model from these fields.
 if(!h)return;
 // Unsupported storage conditions remain truthful records. The model selector
 // returns unavailable instead of rewriting CA/MCP or applying a Fuji equation.
 for(const metric of ['firmness','brix','acidity','weight']){
  const expected=h.source==='measured'?h.initial[metric]:null;
  if((l[metric]??null)!==(expected??null))throw new InputError('홍로 초기품질은 선택한 출처의 입력값과 함께 저장해 주세요. 기상 추정값은 실측값으로 저장할 수 없습니다.');
 }
}
function checkLotDates(l:Record<string,unknown>){const start=l.storage_start_date||l.intake_date;if(typeof start==='string'&&typeof l.initial_measured_on==='string'&&l.initial_measured_on<start)throw new InputError('초기 측정일이 저장 시작일보다 빠릅니다.');if(typeof l.harvest_date==='string'&&typeof l.intake_date==='string'&&l.harvest_date>l.intake_date)throw new InputError('수확일은 입고일보다 늦을 수 없습니다.');}
export async function createLot(req:Request){checkOrigin(req);const p=await payload(req);
 const f=lotFields(p,false);checkLotDates(f);checkLotModel(f);const id=crypto.randomUUID();
 const lot={id,...f,created_at:new Date().toISOString(),team_shared:p.team_shared===true||p.team_shared==='on'||p.team_shared==='true'};
 const c=await client();const count=await c.from('lots').select('id',{count:'exact',head:true});if(count.error)throw count.error;if((count.count||0)>=100)throw new InputError('최대 100개 물량까지 등록할 수 있습니다.');
 checked(await c.from('lots').insert(lot));return json({lot:checked(await c.from('lots').select('*').eq('id',id).single())},201);}
export async function updateLot(id:string,req:Request){checkOrigin(req);const existing=await getLot(id);const p=await payload(req);
 const f=lotFields(p,true,p.variety??existing.variety);
 const {c,user}=await clientUser();
 if(Object.prototype.hasOwnProperty.call(p,'team_shared')){
  // 공유 범위는 물량을 만든 사람만 바꿉니다. 공유받은 팀원은 기록을 보고·추가·수정할 수 있습니다(DB 권한 정책과 같음).
  if(existing.owner_id&&existing.owner_id!==user.id)throw new InputError('공유 범위는 물량을 등록한 사람만 바꿀 수 있어요.');
  f.team_shared=p.team_shared===true||p.team_shared==='true';
 }
 if(!Object.keys(f).length)throw new InputError('바꿀 항목이 없습니다.');
 const variety=(f.variety as string|undefined)??existing.variety;
 const initialChanged=(['firmness','brix','acidity','initial_measured_on'] as const).some(k=>k in f&&(f[k]??null)!==(existing[k]??null));
 if(f.details||initialChanged){
  // 세부 정보는 보낸 항목만 바꾸고 나머지(예측 기준 기록 연결·이력·수량 단위 등)는 보존합니다.
  const merged:Record<string,unknown>={...(existing.details??{}),...((f.details as object)??{})};
  if(!isHongroVariety(variety))delete merged.hongro;
  // 초기값을 직접 고치면 더 이상 연결된 측정 기록과 같지 않으므로 연결만 해제합니다(이력은 보존).
  if(initialChanged&&merged.initial_observation_id)merged.initial_observation_id=null;
  f.details=merged;
 }
 checkLotDates({...existing,...f});checkLotModel({...existing,...f});
 checked(await c.from('lots').update(f).eq('id',id));return json({lot:await getLot(id)});}
type ObsRow={id:string;lot_id:string;date:string;firmness:number|null;brix:number|null;acidity:number|null;weight:number|null;tracked_weight:number|null;sample_count:number|null;details?:{measure?:unknown}|null};
/** 측정 기록 한 건을 예측 기준 초기 측정으로 지정합니다. 기존 측정 기록은 그대로 두고, 이전 기준값은 이력에 남깁니다. */
async function setInitialFromObservation(lot:Lot,o:ObsRow){
 if([o.firmness,o.brix,o.acidity].every(v=>v===null||v===undefined))throw new InputError('경도·당도·산도 중 하나 이상 측정한 기록만 예측 기준 초기 측정으로 지정할 수 있어요.');
 const start=lot.storage_start_date||lot.intake_date;
 if(o.date<start)throw new InputError('저장 시작일보다 이른 측정은 예측 기준으로 지정할 수 없어요. 저장 시작일을 먼저 확인해 주세요.');
 const d:Record<string,any>={...(lot.details??{})};
 const history=Array.isArray(d.initial_history)?[...d.initial_history]:[];
 const prevHas=[lot.firmness,lot.brix,lot.acidity].some(v=>v!==null&&v!==undefined);
 if(prevHas)history.unshift({date:lot.initial_measured_on??null,firmness:lot.firmness,brix:lot.brix,acidity:lot.acidity??null,sample_count:lot.initial_sample_count??null,observation_id:d.initial_observation_id??null,replaced_at:new Date().toISOString()});
 d.initial_history=history.slice(0,20);
 d.initial_observation_id=o.id;d.initial_source='실측';d.initial_same_start=o.date===start;
 d.firmness_input=o.firmness!==null&&o.firmness!==undefined?{value:o.firmness,unit:'N'}:null;
 d.not_measured=(['firmness','brix','acidity'] as const).filter(k=>o[k]===null||o[k]===undefined);
 if(o.details?.measure)d.measure=o.details.measure;
 if(isHongroVariety(lot.variety)&&d.hongro)d.hongro={...d.hongro,source:'measured',initial:{...d.hongro.initial,firmness:o.firmness,brix:o.brix,acidity:o.acidity}};
 const update={firmness:o.firmness,brix:o.brix,acidity:o.acidity??null,initial_measured_on:o.date,initial_sample_count:o.sample_count??null,details:d};
 checkLotDates({...lot,...update});checkLotModel({...lot,...update});
 const c=await client();checked(await c.from('lots').update(update).eq('id',lot.id));
}
export async function setInitial(id:string,req:Request){checkOrigin(req);const lot=await getLot(id);const p=await payload(req);const oid=short(p.observation_id,'측정 기록',false,80);
 const c=await client();const o=checked(await c.from('observations').select('*').eq('id',oid).eq('lot_id',id).maybeSingle()) as ObsRow|null;if(!o)throw new InputError('이 물량의 측정 기록을 찾을 수 없습니다.');
 await setInitialFromObservation(lot,o);return json({lot:await getLot(id)});}
export async function getAnalysis(id:string,req:Request){const lot=await getLot(id);const asOf=validDate(new URL(req.url).searchParams.get('asOf')??today());if(asOf<lot.intake_date||asOf>today())throw new InputError('분석 기준일은 입고일부터 오늘 사이여야 합니다.');const c=await client();let er:EnvRow[]=[];for(let offset=0;offset<20000;offset+=1000){const rows=checked(await c.from('environment').select('timestamp,sensor_id,temperature,humidity').eq('lot_id',id).eq('sensor_id',lot.sensor_id).order('timestamp').range(offset,offset+999)) as EnvRow[];er.push(...rows);if(rows.length<1000)break;}const [o,f,p]=await Promise.all([c.from('observations').select('*').eq('lot_id',id).lte('date',asOf).order('date').order('id'),c.from('files').select('id,date,name,notes').eq('lot_id',id).eq('kind','photo').lte('date',asOf).order('date').order('created_at'),c.from('predictions').select('result').eq('lot_id',id).eq('as_of',asOf).order('created_at',{ascending:false}).limit(1)]);const obs=checked(o),photos=checked(f),pred=checked(p);return {lot,asOf,stats:summarizeEnvironment(er,lot,asOf),observations:obs as Observation[],photos:photos as Photo[],prediction:pred?.[0]?restrictPredictionForVariety(lot,restrictLegacyLoss(JSON.parse(pred[0].result))):null};}
export async function uploadEnvironment(id:string,req:Request){checkOrigin(req);const lot=await getLot(id);const form=await req.formData();const file=form.get('file');if(!(file instanceof File)||file.size>1024*1024)throw new InputError('1MB 이하의 UTF-8 CSV를 선택해 주세요.');if(!lot.sensor_id)throw new InputError('물량 기본 정보에 센서 번호를 먼저 입력해 주세요. CSV의 sensor_id와 같은 값이어야 합니다.');const raw=await file.text();const parsed=parseCsv(raw,lot.sensor_id);const c=await client();const count=await c.from('environment').select('id',{count:'exact',head:true}).eq('lot_id',id);if(count.error)throw count.error;if((count.count||0)+parsed.rows.length>20000)throw new InputError('물량별 기록은 최대 20,000개까지 저장할 수 있습니다.');const fileId=crypto.randomUUID(),key=`lots/${id}/csv/${fileId}.csv`;const store=await storage();checked(await store.upload(key,raw,{contentType:'text/csv; charset=utf-8'}));let inserted=0;try{for(let i=0;i<parsed.rows.length;i+=500){const rows=parsed.rows.slice(i,i+500).map(row=>({...row,lot_id:id}));const result=checked(await c.from('environment').upsert(rows,{onConflict:'lot_id,sensor_id,timestamp',ignoreDuplicates:true}).select('id'));inserted+=result?.length||0;}checked(await c.from('files').insert({id:fileId,lot_id:id,kind:'csv',key,name:file.name.slice(0,180),mime:'text/csv',date:today(),notes:'원본 환경 기록',created_at:new Date().toISOString()}));return json({inserted,duplicates:parsed.duplicates+parsed.rows.length-inserted,mismatched:parsed.mismatched,originalSaved:true});}catch(e){await store.remove([key]);throw e;}}
function observationFields(lot:Lot,p:any){const date=validDate(p.date,'측정일');if(date<lot.intake_date||date>today())throw new InputError('측정일은 입고일부터 오늘 사이여야 합니다.');
 // 측정한 사과 수는 선택 항목입니다. 비우면 미기록(null)으로 둡니다.
 const sample_count=numberOrNull(p.sample_count,1,10000,'측정한 사과 수');if(sample_count!==null&&!Number.isInteger(sample_count))throw new InputError('측정한 사과 수는 1 이상의 정수로 입력해 주세요.');
 const firmness=numberOrNull(p.firmness,0,300,'경도 N'),brix=numberOrNull(p.brix,0,40,'당도 °Brix'),weight=numberOrNull(p.weight,1,2000,'표본 평균 중량'),acidity=numberOrNull(p.acidity,0,10,'산도 %'),tracked_weight=numberOrNull(p.tracked_weight,1,2000,'추적 표본 평균 중량');
 if([firmness,brix,weight,acidity,tracked_weight].every(x=>x===null)&&(!p.defects||p.defects==='미확인'))throw new InputError('측정한 항목을 하나 이상 입력해 주세요.');
 const defects=short(p.defects??'미확인','외관 관찰');if(!['없음','주름','멍·손상','부패 의심','미확인'].includes(defects))throw new InputError('외관 관찰값을 확인해 주세요.');
 return {date,firmness,brix,weight,acidity,tracked_weight,defects,sample_count,notes:short(p.notes??'','메모',true,1000),details:cleanDetails(p.details)};}
function sampleCountRequired(e:unknown){const code=(e as {code?:string})?.code;if(code==='23502')return new InputError('현재 데이터베이스는 측정한 사과 수를 꼭 입력해야 합니다. 사과 수를 입력하거나, 관리자에게 supabase/2026-10-30_optional_sample_count.sql 적용을 요청해 주세요.');return e;}
export async function addObservation(id:string,req:Request){checkOrigin(req);const lot=await getLot(id);const p=await payload(req);const fields=observationFields(lot,p);
 const c=await client();const oid=crypto.randomUUID();const row={id:oid,lot_id:id,...fields};
 const r=await c.from('observations').insert(row);if(r.error)throw sampleCountRequired(r.error);
 if(p.set_initial===true)await setInitialFromObservation(lot,row as ObsRow);
 return json({saved:true,id:oid},201);}
/** 기존 측정 기록을 고칩니다(새로 추가하지 않음). 예측 기준 기록이면 물량의 초기값도 함께 맞춥니다. */
export async function updateObservation(id:string,req:Request){checkOrigin(req);const lot=await getLot(id);const p=await payload(req);const oid=short(p.observation_id,'측정 기록',false,80);const fields=observationFields(lot,p);
 const c=await client();const r=await c.from('observations').update(fields).eq('id',oid).eq('lot_id',id).select('*');if(r.error)throw sampleCountRequired(r.error);
 const row=(r.data as ObsRow[]|null)?.[0];if(!row)throw new InputError('이 물량의 측정 기록을 찾을 수 없습니다.');
 if(p.set_initial===true||lot.details?.initial_observation_id===oid)await setInitialFromObservation(await getLot(id),row);
 return json({saved:true,id:oid});}
export async function uploadPhoto(id:string,req:Request){checkOrigin(req);const lot=await getLot(id);const form=await req.formData();const file=form.get('file');const date=validDate(form.get('date'));if(date<lot.intake_date||date>today())throw new InputError('촬영일은 입고일부터 오늘 사이여야 합니다.');if(!(file instanceof File)||file.size>4*1024*1024)throw new InputError('4MB 이하의 JPG·PNG·WebP 사진을 선택해 주세요.');const bytes=new Uint8Array(await file.arrayBuffer());let mime='';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')mime='image/png';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')mime='image/webp';if(!mime)throw new InputError('JPG·PNG·WebP 형식만 지원합니다.');const fid=crypto.randomUUID(),key=`lots/${id}/photos/${fid}`;const store=await storage();checked(await store.upload(key,bytes,{contentType:mime}));try{const c=await client();checked(await c.from('files').insert({id:fid,lot_id:id,kind:'photo',key,name:file.name.slice(0,180),mime,date,notes:short(String(form.get('notes')??''),'촬영 메모',true,500),created_at:new Date().toISOString()}));return json({saved:true,id:fid},201);}catch(e){await store.remove([key]);throw e;}}
export async function photoResponse(fid:string){const c=await client();const f=checked(await c.from('files').select('key,mime').eq('id',fid).eq('kind','photo').maybeSingle());if(!f)return new Response('Not found',{status:404});const signed=checked(await (await storage()).createSignedUrl(f.key,60));if(!signed)throw new Error('Photo URL unavailable');return Response.redirect(signed.signedUrl,302);}
export async function makePrediction(id:string,req:Request){checkOrigin(req);const data=await getAnalysis(id,req);if(isHongroVariety(data.lot.variety))throw new InputError(HONGRO_DEDICATED_REASON);const prediction=demoPrediction(data.lot,data.stats,data.observations,data.asOf);const c=await client();checked(await c.from('predictions').insert({id:crypto.randomUUID(),lot_id:id,as_of:data.asOf,result:JSON.stringify(prediction),created_at:new Date().toISOString()}));return json({prediction});}
