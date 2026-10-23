import {serverClient} from '../supabase-server';
import {getAnalysis,getLot,listLots} from '../lot-server';
import {AIError,type DataAccess} from './contracts';

export const productionData:DataAccess={
  async authenticate(){
    const c=await serverClient(),{data,error}=await c.auth.getUser();
    if(error||!data.user)throw new AIError('authentication_required','로그인이 필요합니다.',401);
    const team=await c.from('team_members').select('user_id').eq('user_id',data.user.id).maybeSingle();
    if(team.error)throw new AIError('authorization_unavailable','접근 권한을 확인할 수 없습니다.',503);
    return {id:data.user.id,isTeam:!!team.data};
  },
  async listLots(){const response=await listLots();return (await response.json()).lots;},
  getLot,
  async getAnalysis(id,asOf){return getAnalysis(id,new Request('http://internal.invalid/analysis?asOf='+encodeURIComponent(asOf)));},
};

export async function budgetStatus(){
  const c=await serverClient(),result=await c.rpc('ai_budget_status');
  if(result.error)return {available:false,requiredSettings:['SUPABASE_AI_BUDGET_MIGRATION'],reason:'AI 설명 기능의 운영 설정이 아직 완료되지 않았습니다.'};
  return result.data?.available===true?{available:true}:{available:false,requiredSettings:['SUPABASE_AI_BUDGET_LIMITS'],reason:'AI 설명 기능이 비활성화되어 있거나 이용 한도에 도달했습니다.'};
}
export async function reserveBudget(requestId:string,cost:number){
  const c=await serverClient(),result=await c.rpc('reserve_ai_budget',{p_request_id:requestId,p_cost_usd:cost});
  if(result.error)throw new AIError('budget_unavailable','현재 AI 설명을 불러올 수 없습니다. 운영 한도를 확인할 수 없습니다.',503);
  if(result.data?.allowed!==true||result.data.reservation_id!==requestId)throw new AIError(result.data?.code??'budget_denied','AI 설명 이용 한도에 도달했거나 같은 요청이 이미 처리되었습니다. 잠시 후 다시 질문해 주세요.',429);
}
export async function consumeReadQuota(){
  const c=await serverClient(),result=await c.rpc('consume_ai_read_quota');
  if(result.error)throw new AIError('quota_unavailable','조회 요청 한도를 확인할 수 없습니다. 운영 설정이 필요합니다.',503);
  if(result.data!==true)throw new AIError('rate_limit','조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
}
