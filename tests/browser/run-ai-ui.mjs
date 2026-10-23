// Frontend-only AI lifecycle tests. The provider and every data request are fictitious.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {installFixtures,lots,today} from '../fixtures/browser-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const pending=[],checks=[],pageErrors=[];
const requests=await installFixtures(context,{aiFixture:{chat:body=>new Promise(resolve=>pending.push({body,resolve}))}});
const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
const answer=(text,lot=lots[0])=>({answer:text,retrievedAt:today+'T03:00:00Z',scopeLabel:lot.name,evidence:[{title:'가상 최근 측정',fields:[{label:'경도',value:68,unit:'N',date:today,kind:'실측',verification:'가상 브라우저 테스트 데이터'}]}],links:[{label:'가상 물량 기록 보기',page:'lots',lotId:lot.id}]});
const nextRequest=async count=>{await page.waitForFunction(()=>document.querySelector('.ai-transcript')?.getAttribute('aria-busy')==='true');for(let i=0;i<100&&pending.length<count;i++)await new Promise(r=>setTimeout(r,20));assert.ok(pending.length>=count);return pending[count-1];};
const run=async(name,fn)=>{try{await fn();checks.push({name,status:'pass'});console.log('PASS',name);}catch(e){checks.push({name,status:'fail',detail:e.stack});console.error('FAIL',name,e.message);throw e;}};
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByRole('button',{name:'내 물량에 질문하기',exact:true}).click();
  await page.getByRole('heading',{name:'기록에서 답을 찾아드릴게요.',exact:true}).waitFor();
  await run('AI mock 정상 답변·근거·조회범위·물량 링크 표시',async()=>{
    await page.locator('#assistant-question').fill('가상 최근 측정 요약');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    const request=await nextRequest(1);assert.equal(request.body.context.scope,'all');
    request.resolve(answer('가상 응답: 최근 경도 68 N입니다.'));
    await page.getByText('가상 응답: 최근 경도 68 N입니다.',{exact:true}).waitFor();
    await page.locator('.ai-evidence summary').click();
    assert.match(await page.locator('.ai-evidence').innerText(),/68 N/);
    assert.ok(await page.getByRole('button',{name:'가상 물량 기록 보기',exact:true}).isVisible());
  });
  await run('AI mock 생성 취소 뒤 늦은 응답 차단·다시 질문 가능',async()=>{
    await page.locator('#assistant-question').fill('취소할 질문');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    const request=await nextRequest(2);
    await page.getByRole('button',{name:'생성 취소',exact:true}).click();
    await page.getByText('답변 생성을 취소했습니다.',{exact:true}).waitFor();
    request.resolve(answer('취소 후 늦은 응답 — 표시되면 실패'));
    await page.locator('#assistant-question').fill('취소 후 새 질문');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    const fresh=await nextRequest(3);fresh.resolve(answer('취소 후 새 응답 정상'));
    await page.getByText('취소 후 새 응답 정상',{exact:true}).waitFor();
    assert.ok(!(await page.locator('.ai-transcript').innerText()).includes('취소 후 늦은 응답'));
  });
  await run('AI mock 범위 변경 시 기존 대화 삭제·이전 늦은 응답 격리',async()=>{
    await page.locator('#assistant-question').fill('이전 범위 질문');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    const stale=await nextRequest(4);
    await page.locator('#assistant-scope').selectOption(lots[1].id);
    await page.getByRole('heading',{name:'기록에서 답을 찾아드릴게요.',exact:true}).waitFor();
    assert.equal(await page.locator('.ai-turn').count(),0);
    stale.resolve(answer('이전 범위 늦은 응답 — 표시되면 실패'));
    await page.locator('#assistant-question').fill('새 범위 질문');
    await page.getByRole('button',{name:'보내기',exact:true}).click();
    const fresh=await nextRequest(5);assert.equal(fresh.body.context.lotId,lots[1].id);assert.equal(fresh.body.context.scope,'lot');
    fresh.resolve(answer('새 범위 응답 정상',lots[1]));
    await page.getByText('새 범위 응답 정상',{exact:true}).waitFor();
    assert.equal(await page.locator('.ai-turn').count(),1);
    assert.ok(!(await page.locator('.ai-transcript').innerText()).includes('이전 범위 늦은 응답'));
    assert.match(await page.locator('.ai-transcript').innerText(),/공유 물량/);
  });
  assert.deepEqual(pageErrors,[]);
} catch {process.exitCode=1;}
finally {
  for(const request of pending)request.resolve(answer('테스트 종료'));
  await writeFile(new URL('./artifacts/ai-ui-mock-report.json',import.meta.url),JSON.stringify({environment:'local mocked AI responses only; no provider/MCP connection verified',checks,pageErrors,requests},null,2));
  await browser.close();
}
