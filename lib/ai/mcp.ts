import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {demoAnalysis,demoLots} from '../demo-lots';
import {formFromLot,signature} from '../tracker-form';
import {describeChange,fmtNum,metricMeta,todayKST} from '../tracker';
import {parseOptionalNumber} from '../quality-policy';
import type {Lot} from '../lot-types';
import {AIError,type AIContext,type Actor,type Analysis,type DataAccess,type Evidence,type EvidenceField} from './contracts';
import {evaluatePrediction,modelInformation} from './prediction';
import {baselineCore,observationFingerprint,measurementCompatibility} from './context';
import {normalizeCultivar} from '../quality-models';

export const TOOL_NAMES=['list_accessible_lots','get_lot_details','get_quality_measurements','get_environment_history_summary','run_existing_quality_prediction','compare_measurement_with_prediction','get_model_information'] as const;
export type ToolName=typeof TOOL_NAMES[number];
const noArgs=z.object({}).strict();
const lotArgs=z.object({lot_id:z.string().min(1).max(100).optional()}).strict();
const accessError=()=>new AIError('not_available','해당 물량을 조회할 수 없습니다.',404);
const privateLot=(l:Lot)=>({id:l.id,name:l.name,variety:l.variety,location:l.location,storage:l.storage,mcp:l.mcp,storageStartDate:l.storage_start_date??l.intake_date,initialMeasuredOn:l.initial_measured_on??null,observationCount:l.observation_count??null,teamShared:!!l.team_shared});

export function createQualityMcpServer(options:{data:DataAccess;actor:Actor;context:AIContext;signal?:AbortSignal;maxCalls?:number}){
  const {data,actor,context,signal}=options;
  const server=new McpServer({name:'appletrack-quality-readonly',version:'2026.10.23'});
  let calls=0;
  async function authorize(){
    if(signal?.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);
    if(++calls>(options.maxCalls??12))throw new AIError('tool_limit','한 번에 조회할 수 있는 범위를 초과했습니다.',429);
    const current=await data.authenticate();
    if(current.id!==actor.id)throw new AIError('authentication_changed','로그인 상태가 바뀌었습니다. 다시 열어 주세요.',401);
    return current;
  }
  function selectedId(args:{lot_id?:string}){
    if(context.mode==='example'){
      if(args.lot_id)throw accessError();
      return null;
    }
    if(context.scope==='prediction'&&!context.lotId&&args.lot_id)throw accessError();
    const selected=context.scope==='all'?null:context.lotId;
    if(selected&&args.lot_id&&selected!==args.lot_id)throw accessError();
    return selected??args.lot_id??null;
  }
  function assertLot(lot:Lot|null,current:Actor){
    if(!lot||!(lot.owner_id===current.id||(lot.team_shared&&current.isTeam)))throw accessError();
    return lot;
  }
  async function load(args:{lot_id?:string},current:Actor):Promise<{analysis:Analysis;id:string|null;draft:boolean}>{
    const id=selectedId(args),asOf=context.scope==='prediction'?context.asOf:todayKST();
    if(context.mode==='example'){
      const lot=demoLots()[0],a=demoAnalysis(lot,asOf);
      return {analysis:{...a,observations:a.observations.map(o=>({...o,acidity:null,tracked_weight:null}))},id:null,draft:false};
    }
    if(!id){
      if(context.scope!=='prediction')throw new AIError('lot_required','조회할 물량을 선택해 주세요.');
      return {analysis:{lot:{name:'미저장 예측 입력'} as Lot,observations:[],stats:null},id:null,draft:true};
    }
    let lot:Lot|null;
    try{lot=await data.getLot(id);}catch{throw accessError();}
    assertLot(lot,current);
    const analysis=await data.getAnalysis(id,asOf);
    const refreshed=await data.authenticate();
    if(refreshed.id!==actor.id)throw new AIError('authentication_changed','로그인 상태가 바뀌었습니다.',401);
    assertLot(analysis.lot,refreshed);
    if(signal?.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);
    return {analysis,id,draft:false};
  }
  async function predictionFor(args:{lot_id?:string},current:Actor){
    if(context.scope!=='prediction')throw new AIError('prediction_context_required','품질 예측 화면에서 지표와 날짜를 선택한 뒤 질문해 주세요.');
    const loaded=await load(args,current),c=context.scope==='prediction'?context:null;
    const f=c?c.form:formFromLot(loaded.analysis.lot);
    if(!loaded.draft && normalizeCultivar(f.variety)!==normalizeCultivar(loaded.analysis.lot.variety))throw new AIError('cultivar_mismatch','기록된 물량의 품종과 입력 품종이 다릅니다. 품종을 확인한 뒤 계산해 주세요.',422);
    const draft=loaded.draft||(context.mode==='real'&&!!c&&signature(c.form)!==signature(formFromLot(loaded.analysis.lot)));
    const result=evaluatePrediction({form:f,mode:context.mode,observations:loaded.analysis.observations,asOf:c?.asOf??todayKST(),selectedDate:c?.selectedDate??todayKST(),metric:c?.metric??'firmness',future:c?.future??'same',useLatest:c?.useLatest??false});
    let baseline:ReturnType<typeof evaluatePrediction>|null=null;
    if(c?.baseline){
      const b=c.baseline;
      if(b.asOf!==c.asOf||baselineCore(b.form,b.useLatest)!==baselineCore(c.form,c.useLatest)||b.observationsFingerprint!==observationFingerprint(loaded.analysis.observations.filter(o=>o.date<=c.asOf)))throw new AIError('baseline_mismatch','고정 비교 기준의 초기값·과거 조건·측정 이력이 다릅니다. 기준을 다시 설정해 주세요.');
      baseline=evaluatePrediction({form:b.form,mode:context.mode,observations:loaded.analysis.observations,asOf:b.asOf,selectedDate:c.selectedDate,metric:c.metric,future:b.future,useLatest:b.useLatest});
    }
    return {...loaded,draft,result,baseline};
  }
  function register(name:ToolName,title:string,schema:typeof lotArgs|typeof noArgs,handler:(args:{lot_id?:string},current:Actor)=>Promise<Evidence>){
    server.registerTool(name,{title,description:title+' — 현재 인증 사용자와 조회 범위 내에서 읽기만 수행합니다.',inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async (args:{lot_id?:string})=>{
      try{
        const current=await authorize(),evidence=await handler(args,current);
        return {content:[{type:'text' as const,text:JSON.stringify(evidence)}],structuredContent:{evidence}};
      }catch(error){
        const e=error instanceof AIError?error:new AIError('tool_unavailable','기록을 조회하지 못했습니다. 기존 물량 화면에서 확인해 주세요.',503);
        return {isError:true,content:[{type:'text' as const,text:e.message}],structuredContent:{error:e.message,code:e.code}};
      }
    });
  }
  register('list_accessible_lots','접근 가능한 물량',noArgs,async(_args,current)=>{
    if(context.mode==='example')return {tool:'list_accessible_lots',title:'예시 범위',summary:'기능 확인용 예시 물량 한 개만 조회합니다. 실제 고객 기록은 조회하지 않습니다.',data:{mode:'example',lots:[{id:null,name:'예시 물량 · 후지'}],partial:false}};
    if(context.scope==='prediction'&&!context.lotId)return {tool:'list_accessible_lots',title:'미저장 예측 입력',summary:'현재 입력만 조회하며 실제 물량 목록을 조회하지 않습니다.',data:{mode:'real',lots:[],draft:true,partial:false}};
    const chosen=context.scope==='all'?null:context.lotId;
    const lots=chosen?[assertLot(await data.getLot(chosen),current)]:(await data.listLots()).filter(l=>l.owner_id===current.id||(l.team_shared&&current.isTeam));
    const partial=lots.length>=100;
    return {tool:'list_accessible_lots',title:'접근 가능한 물량',summary:`현재 접근 가능한 물량 ${lots.length}개를 조회했습니다.${partial?' 조회 상한에 도달해 일부 목록일 수 있습니다.':''}`,data:{lots:lots.map(privateLot),partial,limit:100}};
  });
  register('get_lot_details','물량·저장 조건',lotArgs,async(args,current)=>{
    const {analysis,id,draft}=await load(args,current),c=context.scope==='prediction'?context:null;
    const details=draft||context.mode==='example'?{name:draft?'미저장 예측 입력':'예시 물량 · 후지',variety:c?.form.variety,storage:c?.form.storage,mcp:c?.form.mcp}:privateLot(analysis.lot);
    return {tool:'get_lot_details',title:String(details.name),summary:draft?'정식 기록이 아닌 현재 예측 화면의 미저장 입력입니다.':context.mode==='example'?'기능 확인용 가상 물량입니다.':'접근 권한이 확인된 저장 물량입니다. 입력 조건은 기록을 자동 변경하지 않습니다.',data:{lotId:id,mode:context.mode,draft,details}};
  });
  register('get_quality_measurements','초기·후속 측정 기록',lotArgs,async(args,current)=>{
    const {analysis,id,draft}=await load(args,current),c=context.scope==='prediction'?context:null;
    const f=context.mode==='example'||draft?c!.form:formFromLot(analysis.lot),kind=context.mode==='example'?'예시':draft?'미저장 입력':'실측';
    const rows=analysis.observations.slice(-30).map(o=>({date:o.date,sampleCount:o.sample_count,firmness:o.firmness,brix:o.brix,acidity:o.acidity??null}));
    const last=rows.at(-1),metrics=['firmness','brix','acidity'] as const;
    const latestByMetric=Object.fromEntries(metrics.map(m=>[m,[...analysis.observations].reverse().find(o=>o[m]!==null&&o[m]!==undefined)]));
    const fields:EvidenceField[]=metrics.map(m=>{const row=latestByMetric[m];return {label:`최근 ${metricMeta[m].label}`,value:row?fmtNum(row[m]!,metricMeta[m].digits):null,unit:metricMeta[m].unit,date:row?.date,kind};});
    const initialChanges=metrics.map(m=>{
      const row=latestByMetric[m],n=parseOptionalNumber(f[m]),validDate=!!f.initial_measured_on&&f.initial_measured_on<=(c?.asOf??todayKST()),conditions=measurementCompatibility(f.measure,row?.details?.measure);
      const value=n.status==='valid'?n.value:null;
      fields.push({label:`초기 ${metricMeta[m].label}`,value:value===null?null:fmtNum(value,metricMeta[m].digits),unit:metricMeta[m].unit,date:f.initial_measured_on||undefined,kind});
      const change=value!==null&&validDate&&row&&row.date>=f.initial_measured_on&&conditions.comparable?describeChange(m,row[m]!,value):null;
      return {metric:m,initialDate:f.initial_measured_on||null,latestDate:row?.date??null,change,conditions,summary:change?`${metricMeta[m].label}: 초기 ${f.initial_measured_on} 대비 최근 ${row!.date} ${kind} ${change.short}. ${conditions.reason??''}`:`${metricMeta[m].label}: ${!conditions.comparable?conditions.reason:'초기·최근 측정값과 실제 측정일이 모두 확인되지 않아 변화량을 비교하지 않습니다.'}`};
    });
    const partial=analysis.observations.length>=1000||analysis.observations.length>rows.length;
    return {tool:'get_quality_measurements',title:'초기·후속 측정 기록',summary:last?`${last.date} 기록이 가장 최근입니다. 각 지표는 해당 값이 있는 최근 측정일을 따로 표시합니다. ${initialChanges.map(v=>v.summary).join(' ')}${partial?' 조회 또는 반환 범위가 제한되어 일부 기록입니다.':''}`:'후속 측정 기록 없음. 없는 값을 0이나 예시값으로 채우지 않습니다.',fields,data:{lotId:id,mode:context.mode,draft,initial:{source:kind,date:f.initial_measured_on||null,firmness:f.firmness||null,brix:f.brix||null,acidity:f.acidity||null},initialChanges,records:rows,partial,asOf:c?.asOf??todayKST()}};
  });
  register('get_environment_history_summary','온습도 이력 요약',lotArgs,async(args,current)=>{
    const {analysis,id}=await load(args,current),s=analysis.stats;
    return {tool:'get_environment_history_summary',title:'온습도 이력',summary:s?.count?`조회된 온습도 기록 ${s.count}개입니다. 기록 공백 ${s.gapCount}곳이며 현재 품질 계산식에는 반영되지 않습니다.`:'조회 가능한 온습도 기록이 없습니다. 현재 품질 계산식에는 온습도 이력이 반영되지 않습니다.',fields:[{label:'평균 온도',value:s?.meanTemperature==null?null:fmtNum(s.meanTemperature,2),unit:'°C',kind:context.mode==='example'?'예시':'실측'},{label:'평균 습도',value:s?.meanHumidity==null?null:fmtNum(s.meanHumidity,1),unit:'%',kind:context.mode==='example'?'예시':'실측'}],data:{lotId:id,count:s?.count??0,meanTemperature:s?.meanTemperature??null,meanHumidity:s?.meanHumidity??null,gapCount:s?.gapCount??null,lastRecorded:s?.lastRecorded??null,partial:(s?.rows.length??0)>=20000,usedInModel:false}};
  });
  register('run_existing_quality_prediction','선택 날짜의 기존 계산 결과',lotArgs,async(args,current)=>{
    const {result,baseline,id,draft}=await predictionFor(args,current);
    return {tool:'run_existing_quality_prediction',title:`${result.date} ${result.label}`,summary:result.displayValue===null?result.reason??'계산에 필요한 기록이 없습니다.':`${result.date} · 저장 ${result.storageDay}일차 ${result.label} ${result.displayValue} ${result.unit}. ${result.dataKind} · ${result.verification}.${draft?' 미저장 입력을 사용한 시뮬레이션입니다.':''}`,fields:[{label:result.label,value:result.displayValue,unit:result.unit,date:result.date,kind:result.dataKind,verification:result.verification}],data:{lotId:id,draft,...result,baseline}};
  });
  register('compare_measurement_with_prediction','같은 날짜 실측·계산 비교',lotArgs,async(args,current)=>{
    const {result,id,draft}=await predictionFor(args,current),c=result.latestComparison;
    return {tool:'compare_measurement_with_prediction',title:'최근 실측과 같은 날짜 계산',summary:(!c?'후속 측정 기록 없음.':c.calculated===null?`${c.date}: ${c.reason}`:`${c.date} 실측 ${c.displayMeasured} ${result.unit}, 같은 날짜 계산 ${c.displayCalculated} ${result.unit}. 차이 ${c.difference?.short}. ${c.reason??''}`)+(draft?' 미저장 입력을 사용한 시뮬레이션입니다.':''),fields:c?[{label:'실측',value:c.displayMeasured,unit:result.unit,date:c.date,kind:context.mode==='example'?'예시':'실측'},{label:'동일 날짜 계산',value:c.displayCalculated,unit:result.unit,date:c.date,kind:'모델 계산',verification:'검증 미확인'}]:[],data:{lotId:id,draft,comparison:c,unit:result.unit,model:result.model}};
  });
  register('get_model_information','계산 근거·적용 범위',noArgs,async()=>({tool:'get_model_information',title:'계산 근거·적용 범위',summary:'품종·저장 방식·설정 온도·1-MCP 처리 여부로 근거가 있는 모델을 선택합니다. 예측 정확도는 독립 검증 미완료이며 산지 입력, 센서 온습도 이력과 사진은 저장 계산에 반영하지 않습니다.',data:modelInformation()}));
  return server;
}

/** 실제 SDK Client ↔ Server 프로토콜 연결. 매 대화 요청마다 새 인스턴스를 생성하고 항상 닫습니다. */
export async function withMcpClient<T>(options:Parameters<typeof createQualityMcpServer>[0],run:(client:Client)=>Promise<T>){
  const server=createQualityMcpServer(options),client=new Client({name:'appletrack-customer-assistant',version:'2026.10.23'});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  try{await server.connect(serverTransport);await client.connect(clientTransport);return await run(client);}
  finally{await client.close();await server.close();}
}

/** First-party authenticated Streamable HTTP. No cross-request sessions or resumable customer cache. */
export async function serveMcpHttp(request:Request,options:Parameters<typeof createQualityMcpServer>[0],body:unknown){
  const server=createQualityMcpServer(options),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{await server.connect(transport);const response=await transport.handleRequest(request,{parsedBody:body});response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response;}
  finally{await server.close();}
}
