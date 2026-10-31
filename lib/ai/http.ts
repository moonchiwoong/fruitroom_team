import {AIError} from './contracts';
export const MAX_BODY_BYTES=48*1024;
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export function fail(error:unknown){
  const e=error instanceof AIError?error:new AIError('unavailable','현재 AI 설명을 불러올 수 없습니다. 기존 품질 예측과 물량 기록은 계속 이용할 수 있습니다.',503);
  return json({error:e.message,code:e.code,...(e.settingsRequired?{settingsRequired:e.settingsRequired}:{})},e.status);
}
export function sameOrigin(req:Request){
  const origin=req.headers.get('origin');
  // 배포 환경에서는 req.url 주소가 실제 접속 주소와 다를 수 있어, 브라우저가 보낸 Host와 비교합니다.
  const hosts=[req.headers.get('x-forwarded-host'),req.headers.get('host'),new URL(req.url).host].filter(Boolean).flatMap(h=>String(h).split(',').map(x=>x.trim()));
  let oh='';try{oh=origin?new URL(origin).host:'';}catch{oh='invalid';}
  if(origin&&!hosts.includes(oh))throw new AIError('origin_denied','같은 사이트에서 다시 요청해 주세요.',403);
  if(req.headers.get('sec-fetch-site')==='cross-site')throw new AIError('origin_denied','같은 사이트에서 다시 요청해 주세요.',403);
}
export async function readBody(req:Request){
  if(!req.headers.get('content-type')?.includes('application/json'))throw new AIError('invalid_content_type','JSON 요청이 필요합니다.',415);
  if(Number(req.headers.get('content-length')??0)>MAX_BODY_BYTES)throw new AIError('request_too_large','요청이 너무 큽니다.',413);
  const reader=req.body?.getReader();if(!reader)throw new AIError('invalid_body','요청 내용이 없습니다.');
  const chunks:Uint8Array[]=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BODY_BYTES){await reader.cancel();throw new AIError('request_too_large','요청이 너무 큽니다.',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AIError('invalid_json','요청 형식을 확인해 주세요.');}
}
