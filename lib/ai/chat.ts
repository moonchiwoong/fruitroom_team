import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {AIError,type Actor,type ChatRequest,type ChatResponse,type DataAccess,type Evidence} from './contracts';
import {withMcpClient,type ToolName} from './mcp';
import {buildProviderBody,explain,requestBudgetCeiling,type ProviderConfig} from './provider';

async function call(client:Client,name:ToolName,args:Record<string,string>,signal:AbortSignal):Promise<Evidence>{
  const result=await client.callTool({name,arguments:args},undefined,{signal,timeout:10000});
  if(result.isError)throw new AIError('tool_unavailable',((result.structuredContent as {error?:string})?.error??'기록을 조회할 수 없습니다.'),503);
  const evidence=(result.structuredContent as {evidence?:Evidence})?.evidence;
  if(!evidence)throw new AIError('tool_invalid','조회 근거를 확인할 수 없습니다.',503);
  return evidence;
}
export async function collectEvidence(input:ChatRequest,data:DataAccess,actor:Actor,signal:AbortSignal){
  return withMcpClient({data,actor,context:input.context,signal,maxCalls:8},async client=>{
    const discovered=await client.listTools();
    if(discovered.tools.length!==7)throw new AIError('tool_configuration','조회 기능의 설정을 확인할 수 없습니다.',503);
    const evidence:Evidence[]=[],c=input.context,q=input.question;
    if(c.scope==='all'){
      const list=await call(client,'list_accessible_lots',{},signal);evidence.push(list);
      // Broad scope uses list counts. Never send a partial set as an all-lot audit.
      const lots=(list.data.lots??[]) as {id:string;name:string;observationCount?:number}[];
      if(/측정|경도|당도|산도|요약/.test(q)&&!/없는|없음|누락/.test(q)){
        for(const lot of lots.slice(0,3)){
          const record=await call(client,'get_quality_measurements',{lot_id:lot.id},signal);
          record.title=lot.name+' · '+record.title;evidence.push(record);
        }
        if(lots.length>3)evidence.push({tool:'list_accessible_lots',title:'조회 범위 안내',summary:'상세 측정은 최근 등록된 물량 중 최대 세 개만 조회했습니다. 다른 물량은 조회 범위를 바꿔 질문해 주세요.',data:{partial:true,reviewed:Math.min(lots.length,3),listed:lots.length}});
      }
      if(/없는|없음|누락/.test(q)){
        const missing=lots.filter(l=>l.observationCount===0);
        evidence.push({tool:'list_accessible_lots',title:'후속 측정 기록 없는 물량',summary:missing.length?missing.map(l=>l.name).join(', ')+'의 후속 측정 기록이 없습니다.':'조회된 목록에서 후속 측정 기록이 없는 물량을 찾지 못했습니다. 초기 측정과는 별도입니다.',data:{partial:list.data.partial,lots:missing.map(l=>({id:l.id,name:l.name}))}});
      }
    }else{
      evidence.push(await call(client,'get_lot_details',{},signal));
      evidence.push(await call(client,'get_quality_measurements',{},signal));
      if(c.scope==='prediction'){
        evidence.push(await call(client,'run_existing_quality_prediction',{},signal));
        if(/비교|실측|차이|측정/.test(q))evidence.push(await call(client,'compare_measurement_with_prediction',{},signal));
      }else if(/예측|계산/.test(q)){
        evidence.push({tool:'get_model_information',title:'예측 조건 선택 필요',summary:'계산할 지표와 날짜는 품질 예측 화면에서 선택한 뒤 질문해 주세요. 물량 화면에서는 저장된 실측 기록을 조회합니다.',data:{predictionContextRequired:true}});
      }
      if(/온습도|온도|습도|환경|센서|공백/.test(q))evidence.push(await call(client,'get_environment_history_summary',{},signal));
    }
    evidence.push(await call(client,'get_model_information',{},signal));
    return evidence;
  });
}
export async function answerQuestion(input:ChatRequest,dependencies:{data:DataAccess;actor:Actor;config:ProviderConfig;reserve:(requestId:string,cost:number)=>Promise<void>;signal:AbortSignal;fetcher?:typeof fetch}):Promise<ChatResponse>{
  const {data,actor,config,signal}=dependencies;
  if(signal.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);
  await dependencies.reserve(input.requestId,requestBudgetCeiling(config));
  const evidence=await collectEvidence(input,data,actor,signal);
  if(signal.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);
  const body=buildProviderBody(config,input.question,evidence);
  if(signal.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);
  const explanation=await explain(config,body,signal,dependencies.fetcher);
  const current=await data.authenticate();if(current.id!==actor.id)throw new AIError('authentication_changed','로그인 상태가 바뀌었습니다.',401);
  // Recheck all actually queried lots after generation; shared access may have been revoked.
  const ids=new Set<string>();for(const e of evidence){if(typeof e.data.lotId==='string')ids.add(e.data.lotId);if(Array.isArray(e.data.lots))for(const l of e.data.lots)if(l&&typeof l.id==='string')ids.add(l.id);}
  for(const id of ids){if(signal.aborted)throw new AIError('cancelled','요청을 취소했습니다.',499);const lot=await data.getLot(id);if(!lot||!(lot.owner_id===current.id||(lot.team_shared&&current.isTeam)))throw new AIError('access_changed','물량 접근 권한이 바뀌었습니다. 조회 범위를 다시 선택해 주세요.',403);}
  const priority=/비교|차이/.test(input.question)?['compare_measurement_with_prediction','get_quality_measurements','run_existing_quality_prediction','list_accessible_lots']:['get_quality_measurements','run_existing_quality_prediction','compare_measurement_with_prediction','list_accessible_lots'];
  const main=evidence.filter(e=>priority.includes(e.tool)||e.data.predictionContextRequired===true).sort((a,b)=>(a.data.predictionContextRequired?-1:priority.indexOf(a.tool))-(b.data.predictionContextRequired?-1:priority.indexOf(b.tool))).slice(0,2).map(e=>e.summary).join('\n');
  const c=input.context,id=c.scope==='all'?null:c.lotId;
  const detail=evidence.find(e=>e.tool==='get_lot_details');
  const scopeLabel=c.mode==='example'?'예시 물량 · 가상 데이터':c.scope==='all'?'내 전체 물량':detail?.title??'현재 예측 입력';
  return {answer:[main,explanation].filter(Boolean).join('\n\n'),retrievedAt:new Date().toISOString(),scopeLabel,evidence,links:[...(id?[{label:'물량 상세 보기',lotId:id,page:'lots' as const},{label:'품질 변화 보기',lotId:id,page:'track' as const}]:[]),{label:'계산 근거·적용 범위',page:'model'}],provider:{model:config.model,protocol:'openai-compatible'}};
}
