import {productionData,consumeReadQuota} from '@/lib/ai/data';
import {serveMcpHttp} from '@/lib/ai/mcp';
import {fail,json,readBody,sameOrigin} from '@/lib/ai/http';
import {withConcurrency} from '@/lib/ai/limits';
export const runtime='nodejs';
export const maxDuration=30;
/** First-party cookie-authenticated endpoint. This is not an anonymous/OAuth public MCP service. */
export async function POST(req:Request){try{
  sameOrigin(req);const actor=await productionData.authenticate();await consumeReadQuota();const body=await readBody(req);
  return await withConcurrency(actor.id,()=>serveMcpHttp(req,{data:productionData,actor,context:{mode:'real',scope:'all'},signal:AbortSignal.any([req.signal,AbortSignal.timeout(20000)]),maxCalls:1},body));
}catch(e){return fail(e);}}
export async function GET(){return json({error:'독립적인 이벤트 스트림을 제공하지 않습니다.'},405);}
export async function DELETE(){return json({error:'서버에 대화 세션을 보관하지 않습니다.'},405);}
