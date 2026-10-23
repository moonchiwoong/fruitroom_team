import {AIError} from './contracts';
// Supplemental process-local concurrency protection. Billing/rate enforcement
// lives in the durable Supabase reservation RPC, not in this map.
const active=new Map<string,number>();
export async function withConcurrency<T>(actorId:string,run:()=>Promise<T>){
  const count=active.get(actorId)??0;
  if(count>=2||active.size>10000)throw new AIError('busy','이미 답변을 생성하고 있습니다. 잠시 기다려 주세요.',429);
  active.set(actorId,count+1);
  try{return await run();}finally{const n=(active.get(actorId)??1)-1;if(n<=0)active.delete(actorId);else active.set(actorId,n);}
}
