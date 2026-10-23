// Hongro frontend regression with fictitious sessions only. No live account or database is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installFixtures,lots,user,userId,secondUser} from '../fixtures/browser-fixtures.mjs';

const require=createRequire(import.meta.url),{chromium}=require('playwright');
const baseURL=process.env.UI_TEST_BASE_URL||'http://127.0.0.1:3000';
const out=resolve(dirname(fileURLToPath(import.meta.url)),'artifacts');
await mkdir(out,{recursive:true});
const screenshotsOnly=process.env.HONGRO_SCREENSHOTS_ONLY==='1';
const checks=[],pageErrors=[],screenshots=[];
const run=async(name,fn)=>{if(screenshotsOnly)return;try{const detail=await fn();checks.push({name,status:'pass',detail:detail??null});console.log('PASS',name);}catch(e){checks.push({name,status:'fail',detail:e.stack});console.error('FAIL',name,e.message);}};
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
const requests=await installFixtures(context,{baseURL});
const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
// Hand-calculated fixture from the supplied coefficients; not synthetic training rows.
const weatherFixture={chang_min4:'5',chang_LC56:'950',chang_LC78:'1340',chang_9rain:'150'};

const chooseHongro=async page=>{
  const mobileMenu=page.getByRole('button',{name:'메뉴 열기',exact:true});
  if(await mobileMenu.isVisible())await mobileMenu.click();
  await page.getByRole('navigation',{name:'주요 메뉴',exact:true}).getByRole('button',{name:'품질 예측',exact:true}).click();
  await page.getByRole('button',{name:'홍로 · 거창',exact:true}).click();
  await page.locator('#hongro-predictor').waitFor();
};
const number=async locator=>{const text=await locator.innerText(),match=text.replace(/,/g,'').match(/[-+]?\d*\.?\d+/);assert.ok(match,`Expected numeric display: ${text}`);return Number(match[0]);};
const metric=(page,key,type='predicted')=>page.locator(`[data-hongro-metric="${key}"] [data-value="${type}"]`);
const values=async page=>Object.fromEntries(await Promise.all(['firmness','brix','acidity'].map(async key=>[key,await number(metric(page,key))])));
const fillMeasured=async(page,{firmness='68',brix='14.2',acidity='0.18',weight='',diameter=''}={})=>{
  await page.locator('#hongro-source-measured').click();
  for(const [key,value] of Object.entries({firmness,brix,acidity,weight,diameter}))await page.locator('#hongro-initial-'+key).fill(value);
};
const calculate=async(page,day,storage='cold0')=>{
  await page.locator('#hongro-storage-'+storage).click();
  await page.locator('#hongro-days').fill(String(day));
  await page.locator('#hongro-calculate').click();
  await page.locator('#hongro-results').waitFor();
  return values(page);
};
const noResult=async page=>{await page.waitForFunction(()=>!document.querySelector('#hongro-results'));assert.equal(await page.locator('#hongro-export').isDisabled(),true);};
const noOverflow=async page=>{const sizes=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth}));assert.ok(sizes.body<=sizes.width+1&&sizes.root<=sizes.width+1,JSON.stringify(sizes));return sizes;};
const capture=async(page,name,fullPage=true)=>{await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(fullPage){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForFunction(()=>Math.abs(scrollY)<1);}await page.screenshot({path:resolve(out,name),fullPage});screenshots.push(name);};

try {
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'최근 물량에서 이어가기',exact:true}).waitFor();
  await chooseHongro(page);
  await run('홍로: 초기 빈 값은 자동 계산하지 않음',async()=>{
    assert.equal(await page.locator('#hongro-initial-firmness').inputValue(),'');
    assert.equal(await page.locator('#hongro-initial-brix').inputValue(),'');
    assert.equal(await page.locator('#hongro-initial-acidity').inputValue(),'');
    await noResult(page);
  });
  await run('홍로: 실측 초기값·0/60/120일·0/4℃ 결과 연결',async()=>{
    await fillMeasured(page);
    const zero=await calculate(page,0);assert.deepEqual(zero,{firmness:68,brix:14.2,acidity:.18});
    const day60=await calculate(page,60),day120=await calculate(page,120),cold4Day60=await calculate(page,60,'cold4'),cold4Day120=await calculate(page,120,'cold4');
    assert.deepEqual(day60,{firmness:61,brix:14.2,acidity:.18});
    assert.deepEqual(day120,{firmness:53.6,brix:14.2,acidity:.13});
    assert.deepEqual(cold4Day60,day60);assert.deepEqual(cold4Day120,{firmness:52.4,brix:14.2,acidity:.15});
    return {zero,cold0Day60:day60,cold0Day120:day120,cold4Day60,cold4Day120};
  });
  await run('홍로: -1/121일 차단·슬라이더 최대120일',async()=>{
    assert.equal(await page.locator('#hongro-day-slider').getAttribute('max'),'120');
    assert.equal(await page.locator('#hongro-day-slider').getAttribute('min'),'0');
    for(const day of ['-1','121']){await page.locator('#hongro-days').fill(day);await noResult(page);}
    await calculate(page,60);
  });
  await run('홍로: 초기값 출처 변경 시 누락값 차단',async()=>{
    await page.locator('#hongro-source-weather').click();await noResult(page);
    for(const key of ['chang_min4','chang_LC56','chang_LC78','chang_9rain'])assert.equal(await page.locator('#hongro-weather-'+key).inputValue(),'');
    await fillMeasured(page);await calculate(page,60);
  });
  await run('홍로: 기상 4변수 초기 회귀·누락 및 음수 회귀 결과 차단',async()=>{
    await page.locator('#hongro-source-weather').click();
    for(const [key,value] of Object.entries(weatherFixture))await page.locator('#hongro-weather-'+key).fill(value);
    const result=await calculate(page,0);
    assert.ok(Math.abs(result.firmness-57.995379)<.051);assert.ok(Math.abs(result.brix-13.42448)<.051);assert.ok(Math.abs(result.acidity-.215844)<.00051);
    await page.locator('#hongro-weather-chang_9rain').fill('');await noResult(page);
    for(const key of Object.keys(weatherFixture))await page.locator('#hongro-weather-'+key).fill('0');
    await noResult(page);
    await fillMeasured(page);await calculate(page,60);return {weather:weatherFixture,initial:result};
  });
  await run('홍로: 세 그래프와 경도N·산도%·당도°Brix 단위',async()=>{
    for(const [label,unit] of [['경도','N'],['산도','%'],['당도','°Brix']]) {
      const graph=page.getByRole('img',{name:new RegExp('^'+label+' 저장 변화 그래프(?: · |$)')});
      assert.equal(await graph.count(),1);assert.ok((await graph.getAttribute('aria-label')).includes(unit));assert.ok((await graph.textContent()).includes(unit));
    }
    assert.equal(await page.locator('#hongro-results svg[role="img"]').count(),3);
  });
  await run('홍로: 중량·직경은 초기 정보이며 저장 중 예측으로 확대하지 않음',async()=>{
    await fillMeasured(page,{weight:'245',diameter:'78'});await calculate(page,60);
    assert.equal(await page.locator('[data-hongro-metric="weight"], [data-hongro-metric="diameter"]').count(),0);
    const text=await page.locator('#hongro-predictor').innerText();assert.match(text,/중량/);assert.match(text,/직경/);
    assert.equal(await page.locator('#hongro-initial-weight').inputValue(),'245');assert.equal(await page.locator('#hongro-initial-diameter').inputValue(),'78');
    assert.equal(await page.locator('[data-hongro-initial="weight"]').innerText(),'245 g');assert.equal(await page.locator('[data-hongro-initial="diameter"]').innerText(),'78 mm');
  });
  if(screenshotsOnly){await fillMeasured(page,{weight:'245',diameter:'78'});await calculate(page,60);}
  await capture(page,'hongro-desktop.png');
  await run('홍로: 데스크톱1440 가로 넘침 없음',()=>noOverflow(page));
  await run('홍로: CSV에 전용 모델·품종·범위·단위 포함',async()=>{
    const wait=page.waitForEvent('download');await page.locator('#hongro-export').click();const download=await wait;
    const path=resolve(out,'hongro-fixture-export.csv');await download.saveAs(path);const csv=await readFile(path,'utf8');
    assert.match(csv,/홍로/);assert.match(csv,/거창/);assert.match(csv,/hongro-geochang-provided-2026-10-23/);assert.match(csv,/120/);assert.match(csv,/°Brix/);assert.match(csv,/검증 상태,.*(?:미검증|검증 미확인|검증 미완료|검증되지)/);
    assert.ok(!csv.includes('후지'));return {filename:download.suggestedFilename(),bytes:Buffer.byteLength(csv)};
  });
  await run('홍로: 새로고침 초안 복구와 사용자 A/B 분리',async()=>{
    await page.locator('#hongro-initial-firmness').fill('67.5');
    const key='appletrack:hongro:draft:v1:'+encodeURIComponent(userId);
    await page.waitForFunction(k=>localStorage.getItem(k)?.includes('67.5'),key);
    await page.reload({waitUntil:'domcontentloaded'});await chooseHongro(page);
    assert.equal(await page.locator('#hongro-initial-firmness').inputValue(),'67.5');
    const sessionB=await requests.setSession(secondUser,[]);
    await page.evaluate(s=>{const channel=new BroadcastChannel('sb-review-auth-token');channel.postMessage({event:'SIGNED_IN',session:s});channel.close();},sessionB);
    await page.waitForFunction(()=>!document.querySelector('#hongro-predictor'));
    await chooseHongro(page);assert.equal(await page.locator('#hongro-initial-firmness').inputValue(),'');await noResult(page);
    assert.ok(await page.evaluate(k=>localStorage.getItem(k)?.includes('67.5'),key));
    const sessionA=await requests.setSession(user,lots);
    await page.evaluate(s=>{const channel=new BroadcastChannel('sb-review-auth-token');channel.postMessage({event:'SIGNED_IN',session:s});channel.close();},sessionA);
    await page.waitForFunction(()=>!document.querySelector('#hongro-predictor'));
    await chooseHongro(page);assert.equal(await page.locator('#hongro-initial-firmness').inputValue(),'67.5');
  });
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
  const mobileRequests=await installFixtures(mobile,{baseURL});const mp=await mobile.newPage();mp.on('pageerror',e=>pageErrors.push(e.message));
  await mp.goto(baseURL,{waitUntil:'domcontentloaded'});await mp.getByRole('heading',{name:'최근 물량에서 이어가기',exact:true}).waitFor();await chooseHongro(mp);
  await fillMeasured(mp);await calculate(mp,60);
  await run('홍로: 모바일390 가로 넘침·3그래프 표시',async()=>{assert.equal(await mp.locator('#hongro-results svg[role="img"]').count(),3);return noOverflow(mp);});
  await capture(mp,'hongro-mobile-full.png');await mp.evaluate(()=>window.scrollTo({top:document.querySelector('#hongro-results').getBoundingClientRect().top+scrollY-80,behavior:'instant'}));await capture(mp,'hongro-mobile.png',false);
  await run('홍로: 실제 기록 변경 요청 없음',async()=>{
    const writes=[...requests,...mobileRequests].filter(r=>r.path.startsWith('/api/lots')&&!['GET','HEAD'].includes(r.method));assert.equal(writes.length,0);
  });
  await mobile.close();
} catch(e){checks.push({name:'Hongro harness execution',status:'fail',detail:e.stack});console.error(e);await capture(page,'hongro-failure.png').catch(()=>{});}
finally {
  await writeFile(resolve(out,screenshotsOnly?'hongro-screenshot-report.json':'hongro-ui-report.json'),JSON.stringify({environment:'local mock integration; fictitious users/lots; no production account/database',screenshotsOnly,checks,pageErrors,screenshots,requests},null,2));await browser.close();
}
if(checks.some(c=>c.status==='fail')||pageErrors.length)process.exitCode=1;
