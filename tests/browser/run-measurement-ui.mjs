// Focused regression for explicit mismatches and missing measurement metadata.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {installFixtures,lots} from '../fixtures/browser-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
const checks=[],pageErrors=[];
const measure={probe_mm:11,peeled:'껍질 제거',position:'적도부',fruit_temp:5,instrument:'가상 기기'};
const shot=async(page,name,fullPage=true)=>{
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:new URL('./artifacts/'+name,import.meta.url).pathname,fullPage});
};
try {
  for(const variant of ['match','mismatch','missing']) {
    const caseLots=variant==='missing'?lots:[{...lots[0],details:{...lots[0].details,measure}},...lots.slice(1)];
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
    await installFixtures(context,{initialLots:caseLots,analysisTransform:value=>({...value,observations:value.observations.map(o=>({...o,details:{...o.details,...(variant==='missing'?{}:{measure:{...measure,probe_mm:variant==='match'?'11.0':8}})}}))})});
    const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto('http://127.0.0.1:3000');
    await page.locator('.recent-lot').filter({hasText:lots[0].name}).click();await page.locator('.qt-result-number').waitFor();
    const values=page.locator('.qt-latest-values dd');assert.match(await values.nth(0).innerText(),/68\.0 N/);
    if(variant==='mismatch') {
      assert.equal(await values.nth(1).innerText(),'제공 안 함');assert.equal(await values.nth(2).innerText(),'비교 불가');
      assert.match(await page.locator('.qt-latest .qt-measure-compatibility').innerText(),/측정 조건 불일치/);
    } else {
      assert.match(await values.nth(1).innerText(),/\d/);assert.ok(!(await values.nth(2).innerText()).includes('비교 불가'));
      if(variant==='match')assert.equal(await page.locator('.qt-latest .qt-measure-compatibility').count(),0);
      else assert.match(await page.locator('.qt-latest .qt-measure-compatibility').innerText(),/측정 조건 확인 필요/);
    }
    await page.getByRole('button',{name:'측정값과 비교',exact:true}).click();
    const rows=page.locator('.qt-obs tbody tr:not(.qt-obs-condition)');assert.equal(await rows.count(),2);
    for(let i=0;i<2;i++) {
      const cells=rows.nth(i).locator('td');assert.match(await cells.nth(2).innerText(),/\d/);
      if(variant==='mismatch'){assert.equal(await cells.nth(3).innerText(),'제공 안 함');assert.equal(await cells.nth(4).innerText(),'비교 불가');}
      else {assert.match(await cells.nth(3).innerText(),/\d/);assert.ok(!(await cells.nth(4).innerText()).includes('비교 불가'));}
    }
    assert.equal(await page.locator('.qt-obs-condition').count(),variant==='match'?0:2);
    if(variant==='missing') {
      await page.getByRole('button',{name:'측정값과 비교',exact:true}).click();
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await shot(page,'desktop-prediction.png',false);await shot(page,'desktop-prediction-full.png');
    }
    await page.setViewportSize({width:360,height:800});
    const sizes=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth}));
    assert.ok(sizes.body<=361&&sizes.root<=361,JSON.stringify(sizes));
    if(variant==='missing') {
      await page.locator('.qt-main').scrollIntoViewIfNeeded();await shot(page,'mobile-prediction.png',false);await shot(page,'mobile-prediction-full.png');
    }
    if(variant==='mismatch') {
      await page.locator('.qt-latest').scrollIntoViewIfNeeded();await shot(page,'mobile-measurement-mismatch.png',false);
    }
    checks.push({name:variant==='match'?'측정조건 일치: 최근·펼친 비교 유지 (11과11.0 동등)':variant==='mismatch'?'측정조건 불일치: 실측 유지·계산차이 숨김·이유 표시':'측정조건 누락: 비교 유지·확인 필요 안내',status:'pass',mobileOverflow:sizes});
    console.log('PASS',checks.at(-1).name);await context.close();
  }
  assert.deepEqual(pageErrors,[]);
} catch(e){checks.push({name:'Focused measurement regression',status:'fail',detail:e.stack});console.error(e);process.exitCode=1;}
finally{await writeFile(new URL('./artifacts/measurement-ui-report.json',import.meta.url),JSON.stringify({environment:'local mock integration; fictitious measurement metadata',checks,pageErrors},null,2));await browser.close();}
