// Simulates a Supabase cross-tab SIGNED_IN event using fictitious local sessions only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {installFixtures,lots,secondUser,today} from '../fixtures/browser-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const requests=await installFixtures(context),page=await context.newPage();
const result={environment:'local mock integration; fictitious Supabase cross-tab session events',status:'fail',checks:[]};
try {
  await page.goto('http://127.0.0.1:3000');
  await page.locator('.recent-lot').filter({hasText:lots[0].name}).click();
  await page.locator('.qt-result-number').waitFor();
  await page.getByRole('button',{name:'입력 수정',exact:true}).click();
  const shift=days=>new Date(Date.parse(lots[0].storage_start_date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  await page.locator('#tf-initial_measured_on').fill(shift(10));
  await page.locator('#qt-analysis-asof').fill(shift(5));
  await page.waitForFunction(()=>!document.querySelector('.qt-result-number'));
  assert.match(await page.locator('.qt-main').innerText(),/초기 측정일.*분석 기준일/);
  result.checks.push({name:'초기 측정일이 분석 기준일 이후이면 결과 숫자 차단·사유 표시',status:'pass'});
  console.log('PASS',result.checks.at(-1).name);
  await page.locator('#tf-initial_measured_on').fill(lots[0].storage_start_date);
  await page.locator('#qt-analysis-asof').fill(today);
  await page.locator('.qt-result-number').waitFor();
  await page.locator('#tf-firmness').fill('71.5');
  await page.getByRole('button',{name:'이 결과 물어보기',exact:true}).click();
  await page.locator('.ai-assistant-panel').waitFor();
  const secondSession=await requests.setSession(secondUser,[]);
  await page.evaluate(s=>{const channel=new BroadcastChannel('sb-review-auth-token');channel.postMessage({event:'SIGNED_IN',session:s});channel.close();},secondSession);
  await page.waitForFunction(()=>!document.querySelector('.ai-assistant-panel'));
  await page.waitForFunction(()=>document.querySelector('#tf-firmness')?.value==='');
  assert.equal(await page.locator('.qt-top select').inputValue(),'new');
  assert.ok(!(await page.locator('body').innerText()).includes(lots[0].name));
  await page.getByRole('button',{name:'내 정보',exact:true}).click();
  await page.getByRole('heading',{name:'검증 예시 B',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.account-form input')?.value==='검증 예시 B');
  assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'검증 예시 B');
  assert.match(await page.locator('.account').innerText(),/개인 계정/);
  result.status='pass';result.detail='A → B without page reload: prior AI context, lot list and draft values cleared; B profile and personal permission message rendered.';
  result.checks.push({name:'같은 페이지에서 가상 사용자 A → B 변경 시 이전 물량·AI·초안 제거',status:'pass'});
  console.log('PASS',result.detail);
}catch(e){result.error=e.stack;console.error(e);await page.screenshot({path:new URL('./artifacts/auth-switch-failure.png',import.meta.url).pathname,fullPage:true});process.exitCode=1;}
finally{result.requests=requests;await writeFile(new URL('./artifacts/auth-switch-report.json',import.meta.url),JSON.stringify(result,null,2));await browser.close();}
