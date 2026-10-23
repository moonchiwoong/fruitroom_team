// Local UI review only. These records are fictitious and never reach Supabase.
import {readFile} from 'node:fs/promises';
export const userId = '11111111-1111-4111-8111-111111111111';
export const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const start = shift(today, -28);

export const user = {
  id: userId, aud: 'authenticated', role: 'authenticated',
  email: 'local-review@example.invalid', email_confirmed_at: `${start}T00:00:00Z`,
  created_at: `${start}T00:00:00Z`, updated_at: `${today}T00:00:00Z`,
  app_metadata: {provider: 'email', providers: ['email']},
  user_metadata: {name: '검증 예시', affiliation: '가상 테스트 농가', region: 'cheongsong'},
};
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const sessionFor = user => ({
  access_token: `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+7200,iat:Math.floor(Date.now()/1000)})}.fixture-only`,
  refresh_token: 'local-fixture-not-a-real-token', token_type: 'bearer',
  expires_in: 7200, expires_at: Math.floor(Date.now()/1000)+7200, user,
});
export const session=sessionFor(user);
export const secondUser={...user,id:'66666666-6666-4666-8666-666666666666',email:'local-review-b@example.invalid',user_metadata:{name:'검증 예시 B',affiliation:'가상 테스트 농가 B',region:'jangsu'}};

const common = {
  variety: '후지', harvest_date: shift(start,-1), intake_date: start, storage_start_date: start,
  initial_measured_on: start, initial_sample_count: 10, sensor_id: 'TEST-01',
  quantity: 120, storage: '일반 저온', mcp: '미처리', packaging: '예시 상자',
  firmness: 72, brix: 14.2, weight: 285, acidity: 0.38,
  notes: '로컬 검증용 가상 자료입니다. 실제 고객 기록이 아닙니다.',
  created_at: `${start}T03:00:00Z`, environment_count: 4, observation_count: 2, photo_count: 0,
  owner_id: userId, team_shared: false,
  details: {measure:{probe_mm:11.1,peeled:'껍질 제거',position:'적도부',instrument:'가상 기기'},tracked:{count:10,initial_weight:285,sample_id:'TEST-SAMPLE-01'}},
};
export const lots = [
  {...common, id:'22222222-2222-4222-8222-222222222222', name:'[검증 예시] 후지 1호', location:'테스트 저장고 A'},
  {...common, id:'33333333-3333-4333-8333-333333333333', name:'[검증 예시] 공유 물량', location:'테스트 저장고 B',team_shared:true,firmness:75,brix:14.8,observation_count:0,environment_count:0,details:{}},
  {...common, id:'44444444-4444-4444-8444-444444444444', name:'[검증 예시] 미측정 물량',variety:'감홍', location:'테스트 저장고 C',firmness:null,brix:null,acidity:null,weight:null,observation_count:0,environment_count:0,details:{}},
];

export function analysis(lot, asOf=today) {
  const observations = lot.id===lots[0].id ? [14,27].map((day,i)=>({
    id:`55555555-5555-4555-8555-55555555555${i}`,lot_id:lot.id,date:shift(start,day),
    firmness:70-i*2,brix:14.3+i*.1,weight:282-i*3,acidity:.37-i*.01,tracked_weight:282-i*3,
    sample_count:10,defects:'없음',notes:'가상 후속 측정',
    details:{tracked:{sample_id:'TEST-SAMPLE-01'}},
  })).filter(o=>o.date<=asOf) : [];
  return {lot,asOf,observations,photos:[],prediction:null,stats:{
    count:0,meanTemperature:null,sdTemperature:null,meanHumidity:null,sdHumidity:null,minTemperature:null,maxTemperature:null,
    gapCount:0,missingSlots:0,expectedIntervalMinutes:null,outOfRangeHours:0,coverageHours:0,futureExcluded:0,
    lastRecorded:null,stale:true,rows:[],
  }};
}

export async function installFixtures(context, {baseURL='http://127.0.0.1:3000', initialLots=lots, delayAnalysisMs=0, analysisTransform=value=>value, aiFixture=null}={}) {
  const requests=[];
  let activeUser=user,activeSession=session,activeLots=initialLots;
  const setSession=async(nextUser,nextLots)=>{
    activeUser=nextUser;activeSession=sessionFor(nextUser);activeLots=nextLots;
    await context.addCookies([{name:'sb-review-auth-token',value:`base64-${encode(activeSession)}`,url:baseURL,sameSite:'Lax'}]);
    return activeSession;
  };
  requests.setSession=setSession;
  await setSession(user,initialLots);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
    if(process.env.PRETENDARD_FONT && url.hostname==='cdn.jsdelivr.net' && url.pathname.endsWith('.css')) {
      requests.push({path:url.pathname,method:request.method(),mock:true});
      return route.fulfill({status:200,contentType:'text/css',body:`@font-face{font-family:'Pretendard Variable';font-style:normal;font-weight:45 920;font-display:swap;src:url('${baseURL}/__ui-fixture-font.woff2') format('woff2-variations')}`});
    }
    if(url.hostname==='review.supabase.co') {
      requests.push({path:url.pathname,method:request.method(),mock:true});
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
      if(url.pathname==='/auth/v1/user')return json(activeUser);
      if(url.pathname==='/auth/v1/token')return json(activeSession);
      if(url.pathname==='/auth/v1/logout')return json({});
      if(url.pathname==='/rest/v1/profiles')return json({...activeUser.user_metadata,default_inputs:null});
      if(url.pathname==='/rest/v1/team_members')return json(activeUser.id===userId?{user_id:userId}:null);
      if(url.pathname==='/rest/v1/quality_predictions' && ['GET','HEAD'].includes(request.method()))return route.fulfill({status:200,contentType:'application/json',body:request.method()==='HEAD'?'':'[]',headers:{'content-range':'0-0/0','access-control-allow-origin':'*','access-control-expose-headers':'content-range'}});
      return json({error:'Unconfigured local fixture'},404);
    }
    if(['127.0.0.1','localhost'].includes(url.hostname)) {
      if(url.pathname==='/__ui-fixture-font.woff2' && process.env.PRETENDARD_FONT)return route.fulfill({status:200,contentType:'font/woff2',body:await readFile(process.env.PRETENDARD_FONT),headers:{'access-control-allow-origin':'*'}});
      if(url.pathname==='/api/lots') {
        requests.push({path:url.pathname,method:request.method(),mock:true});
        return request.method()==='GET'?json({lots:activeLots}):json({error:'Local UI review never writes records'},405);
      }
      if(/^\/api\/lots\/[^/]+\/analysis$/.test(url.pathname)) {
        requests.push({path:url.pathname,method:request.method(),mock:true});
        const lot=activeLots.find(l=>l.id===url.pathname.split('/')[3]);
        if(delayAnalysisMs)await new Promise(resolve=>setTimeout(resolve,delayAnalysisMs));
        return lot?json(analysisTransform(analysis(lot,url.searchParams.get('asOf')||today))):json({error:'물량을 찾을 수 없습니다.'},404);
      }
      if(url.pathname.startsWith('/api/ai')) {
        requests.push({path:url.pathname,method:request.method(),mock:true});
        if(aiFixture&&url.pathname==='/api/ai/status')return json({available:true});
        if(aiFixture&&url.pathname==='/api/ai/chat') {
          const answer=await aiFixture.chat(request.postDataJSON());
          try{return await json(answer);}catch(error){requests.push({path:url.pathname,mock:true,afterAbort:true,error:String(error)});return;}
        }
        return json({error:'현재 AI 설명을 불러올 수 없습니다',code:'AI_NOT_CONFIGURED',configured:false},503);
      }
      if(url.pathname.startsWith('/api/'))return json({error:'Local UI review never writes records'},405);
      return route.continue();
    }
    // Prevent all real service, font, analytics and other external requests.
    requests.push({path:`${url.hostname}${url.pathname}`,method:request.method(),blocked:true});
    return route.abort();
  });
  return requests;
}
