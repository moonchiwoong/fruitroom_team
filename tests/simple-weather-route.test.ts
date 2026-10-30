import test from 'node:test';
import assert from 'node:assert/strict';
import {GET} from '../app/api/weather/simple/route';

const url=(query:string)=>new Request(`https://example.test/api/weather/simple?${query}`);

test('unsupported regional cultivar combination is rejected before weather lookup',async()=>{
  const response=await GET(url('region=jangsu&cultivar=hongro&harvest_date=2025-10-10'));
  assert.equal(response.status,400);
});

test('upstream error cannot echo a service key',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch;
  const secret='test-sensitive-key';
  process.env.RDA_SERVICE_KEY=secret;
  globalThis.fetch=async()=>new Response(`<result_Code>401</result_Code><result_Msg>${secret}</result_Msg>`,{status:200});
  try {
    const response=await GET(url('region=jangsu&cultivar=fuji&harvest_date=2025-10-10'));
    assert.equal(response.status,502);
    assert.equal((await response.text()).includes(secret),false);
  } finally {
    globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('Fuji does not claim readiness when observed data or maximum-temperature field are unavailable',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch;
  process.env.RDA_SERVICE_KEY='test-key';
  const requested:string[]=[];
  globalThis.fetch=async(input)=>{requested.push(String(input));return new Response('<result_Code>200</result_Code><total_Count>0</total_Count>',{status:200});};
  try {
    const response=await GET(url('region=yeongju&cultivar=fuji&harvest_date=2025-10-10'));
    const result=await response.json();
    assert.equal(response.status,200);
    assert.equal(result.station.code,'036043F024');
    assert.equal(result.ready,false);
    assert.equal(result.variables.find((x:{key:string})=>x.key==='lc56').value,null);
    assert.ok(requested.every(x=>new URL(x).searchParams.get('obsr_Spot_Cd')==='036043F024'));
  } finally {
    globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

function monthlyXml(year:number,month:number,station:string) {
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const rows=Array.from({length:days},(_,i)=>`<item><obsr_Spot_Cd>${station}</obsr_Spot_Cd><date_Time>${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}</date_Time><tmprt_150>14</tmprt_150><tmprt_150Lwet>2</tmprt_150Lwet><rn>2</rn></item>`).join('');
  return `<result_Code>200</result_Code><total_Count>${days}</total_Count>${rows}`;
}

test('future monthly periods use five past years and retain observed versus estimated provenance',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key'; Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  const requested:{year:number;month:number}[]=[];let active=0, peak=0;
  globalThis.fetch=async(input)=>{
    const q=new URL(String(input)).searchParams;
    const year=Number(q.get('search_Year')),month=Number(q.get('search_Month'));
    assert.equal(q.get('obsr_Spot_Cd'),'670807A001');requested.push({year,month});active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1));active--;
    return new Response(monthlyXml(year,month,'670807A001'),{status:200});
  };
  try {
    const response=await GET(url('region=geochang&cultivar=hongro&harvest_date=2026-10-10'));
    const result=await response.json();
    assert.equal(response.status,200);assert.equal(result.ready,true);
    assert.equal(result.variables.find((v:{key:string})=>v.key==='min4').kind,'observed');
    assert.equal(result.variables.find((v:{key:string})=>v.key==='lc56').kind,'observed');
    const lc78=result.variables.find((v:{key:string})=>v.key==='lc78');
    assert.equal(lc78.kind,'historical-estimate');assert.deepEqual(lc78.historicalYears,[2021,2022,2023,2024,2025]);
    assert.equal(lc78.value,558);
    const rain=result.variables.find((v:{key:string})=>v.key==='rain9');assert.equal(rain.kind,'historical-estimate');assert.equal(rain.value,60);
    assert.equal(requested.length,19);assert.equal(result.retrieval.requests,19);assert.ok(peak<=4);
    assert.ok(requested.every(v=>v.year===2026 || (v.year>=2021 && v.year<=2025)));
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('unavailable history is excluded by year and fewer than three complete years blocks estimates',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key';Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  globalThis.fetch=async(input)=>{
    const q=new URL(String(input)).searchParams, year=Number(q.get('search_Year')), month=Number(q.get('search_Month'));
    return year<=2023?new Response('',{status:503}):new Response(monthlyXml(year,month,'670807A001'),{status:200});
  };
  try {
    const response=await GET(url('region=geochang&cultivar=hongro&harvest_date=2026-10-10'));
    const result=await response.json();
    const value=result.variables.find((v:{key:string})=>v.key==='lc78');
    assert.equal(result.ready,false);assert.equal(value.value,null);assert.equal(value.kind,'unavailable');
    assert.deepEqual(value.historicalYears,[2024,2025]);assert.ok(result.retrieval.incompleteRequests>0);
    assert.ok(result.limitations.some((s:string)=>s.includes('조회가 실패')));
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('historical estimates do not fetch or use September when harvest is before September ends',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key';Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  const requestedMonths:number[]=[];
  globalThis.fetch=async(input)=>{const q=new URL(String(input)).searchParams, year=Number(q.get('search_Year')),month=Number(q.get('search_Month'));requestedMonths.push(month);return new Response(monthlyXml(year,month,'670807A001'),{status:200});};
  try {
    const response=await GET(url('region=geochang&cultivar=hongro&harvest_date=2026-09-15'));
    const result=await response.json();
    assert.equal(result.variables.find((v:{key:string})=>v.key==='rain9').value,null);
    assert.equal(result.variables.find((v:{key:string})=>v.key==='rain9').kind,'unavailable');
    assert.equal(requestedMonths.includes(9),false);assert.ok(requestedMonths.length<=30);
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('a future harvest year requires no more than thirty upstream calls',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key';Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  let calls=0;
  globalThis.fetch=async(input)=>{calls++;const q=new URL(String(input)).searchParams,year=Number(q.get('search_Year')),month=Number(q.get('search_Month'));return new Response(monthlyXml(year,month,'670807A001'),{status:200});};
  try {
    const response=await GET(url('region=geochang&cultivar=hongro&harvest_date=2027-10-10'));
    const result=await response.json();assert.equal(result.ready,true);assert.equal(calls,30);assert.equal(result.retrieval.requests,30);
    assert.deepEqual(result.historyPolicy.years,[2021,2022,2023,2024,2025]);
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('each variable uses its own complete years and the minimum of three is accepted',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key';Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  globalThis.fetch=async(input)=>{
    const q=new URL(String(input)).searchParams,year=Number(q.get('search_Year')),month=Number(q.get('search_Month'));
    if(year<=2022 && month===9) return new Response('',{status:503});
    return new Response(monthlyXml(year,month,'670807A001'),{status:200});
  };
  try {
    const result=await (await GET(url('region=geochang&cultivar=hongro&harvest_date=2026-10-10'))).json();
    const summer=result.variables.find((v:{key:string})=>v.key==='lc78');
    const rain=result.variables.find((v:{key:string})=>v.key==='rain9');
    assert.deepEqual(summer.historicalYears,[2021,2022,2023,2024,2025]);
    assert.deepEqual(rain.historicalYears,[2023,2024,2025]);
    assert.equal(rain.kind,'historical-estimate');assert.equal(rain.value,60);assert.equal(result.ready,true);
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});

test('a cancelled request makes no upstream calls',async()=>{
  const previousKey=process.env.RDA_SERVICE_KEY, previousFetch=globalThis.fetch, previousNow=Date.now;
  process.env.RDA_SERVICE_KEY='test-key';Date.now=()=>Date.parse('2026-07-15T00:00:00Z');
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected fetch');};
  try {
    const abort=new AbortController();abort.abort();
    const request=new Request('https://example.test/api/weather/simple?region=geochang&cultivar=hongro&harvest_date=2026-10-10',{signal:abort.signal});
    const response=await GET(request);assert.equal(response.status,502);assert.equal(calls,0);
  } finally {
    Date.now=previousNow;globalThis.fetch=previousFetch;
    if(previousKey===undefined) delete process.env.RDA_SERVICE_KEY; else process.env.RDA_SERVICE_KEY=previousKey;
  }
});
