import {AIError,chatSchema} from '@/lib/ai/contracts';
import {productionData,budgetStatus,reserveBudget} from '@/lib/ai/data';
import {providerSettings} from '@/lib/ai/provider';
import {answerQuestion} from '@/lib/ai/chat';
import {withConcurrency} from '@/lib/ai/limits';
import {json,fail,readBody,sameOrigin} from '@/lib/ai/http';
export const runtime='nodejs';
export const maxDuration=45;
export async function POST(req:Request){try{
  sameOrigin(req);const actor=await productionData.authenticate();
  const parsed=chatSchema.safeParse(await readBody(req));
  if(!parsed.success)throw new AIError('invalid_request','질문·선택 물량·입력 조건을 확인해 주세요.');
  const settings=providerSettings();
  if(!settings.available)throw new AIError('settings_required','현재 AI 설명을 불러올 수 없습니다. AI 연결 설정이 아직 완료되지 않았습니다.',503,settings.requiredSettings);
  const budget=await budgetStatus();if(!budget.available)throw new AIError('budget_unavailable',budget.reason??'현재 AI 설명을 불러올 수 없습니다.',503,budget.requiredSettings);
  const signal=AbortSignal.any([req.signal,AbortSignal.timeout(35000)]);
  return await withConcurrency(actor.id,async()=>json(await answerQuestion(parsed.data,{data:productionData,actor,config:settings.config,reserve:reserveBudget,signal})));
}catch(e){return fail(e);}}
