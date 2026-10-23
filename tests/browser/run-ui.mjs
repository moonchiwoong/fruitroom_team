import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installFixtures,lots,today} from '../fixtures/browser-fixtures.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const baseURL=process.env.UI_TEST_BASE_URL||'http://127.0.0.1:3000';
const out=resolve(dirname(fileURLToPath(import.meta.url)),'artifacts');
await mkdir(out,{recursive:true});
const checks=[],shots=[],errors=[];
const run=async(name,fn)=>{try{const detail=await fn();checks.push({name,status:'pass',detail:detail??null});console.log('PASS',name);}catch(e){checks.push({name,status:'fail',detail:e.message});console.log('FAIL',name,e.message);}};
let launch={headless:true,args:['--no-sandbox']};
if(process.env.CHROMIUM_PACKAGE) {
  const module=require(process.env.CHROMIUM_PACKAGE), packaged=module.default??module;
  launch={headless:true,args:packaged.args,executablePath:await packaged.executablePath()};
} else if(process.env.CHROMIUM_EXECUTABLE_PATH) launch.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;
const browser=await chromium.launch(launch);
const prepareShot=async page=>{await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);};
const capture=async(page,name)=>{await prepareShot(page);await page.screenshot({path:resolve(out,name),fullPage:true});shots.push(name);};
const screenshotView=async(page,name)=>{await prepareShot(page);await page.screenshot({path:resolve(out,name),fullPage:false});shots.push(name);};
const openMenu=async page=>{const toggle=page.getByRole('button',{name:'메뉴 열기',exact:true});if(await toggle.isVisible())await toggle.click();};
const navigate=async(page,label)=>{await openMenu(page);await page.getByRole('navigation',{name:'주요 메뉴',exact:true}).getByRole('button',{name:label,exact:true}).click();};
const noOverflow=async page=>{
  const sizes=await page.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,root:document.documentElement.scrollWidth}));
  assert.ok(sizes.body<=sizes.width+1&&sizes.root<=sizes.width+1,JSON.stringify(sizes));return sizes;
};
const hookErrors=page=>page.on('pageerror',e=>errors.push(e.message));
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
const requests=await installFixtures(context,{baseURL});
const page=await context.newPage();hookErrors(page);
try {
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'최근 물량에서 이어가기'}).waitFor({timeout:45000});
  await page.getByRole('button',{name:/\[검증 예시\] 후지 1호/}).waitFor();
  await run('메뉴 3개와 별도 계정 메뉴',async()=>{
    const labels=await page.getByRole('navigation',{name:'주요 메뉴',exact:true}).locator(':scope > button').allTextContents();
    assert.deepEqual(labels,['홈','품질 예측','물량 관리']);
    assert.ok(await page.getByRole('button',{name:'내 정보',exact:true}).count()>0);return labels;
  });
  await capture(page,'desktop-home.png');
  await run('데스크톱 홈 가로 넘침 없음',()=>noOverflow(page));
  await run('홈 AI 전체 물량 범위·연결 미설정 표시',async()=>{
    await page.getByRole('button',{name:'내 물량에 질문하기',exact:true}).click();
    await page.getByRole('heading',{name:'현재 AI 설명을 불러올 수 없습니다',exact:true}).waitFor();
    assert.equal(await page.locator('#assistant-scope').inputValue(),'all');
    assert.equal(await page.locator('#assistant-question').isDisabled(),true);
    const panel=await page.locator('.ai-assistant-panel').boundingBox();
    assert.ok(panel&&Math.abs(panel.y)<1&&Math.abs(panel.x+panel.width-1440)<1&&Math.abs(panel.height-1000)<1,JSON.stringify(panel));
    await screenshotView(page,'desktop-ai-unconfigured.png');
    await page.getByRole('button',{name:'AI 도우미 닫기',exact:true}).click();
  });
  await run('최근 물량 → 저장된 입력으로 품질 예측',async()=>{
    await page.locator('.recent-lot').filter({hasText:lots[0].name}).click();
    await page.locator('.qt-result-number').waitFor();
    assert.equal(await page.locator('.qt-top select').inputValue(),lots[0].id);
    assert.equal(await page.getByRole('tab',{name:'경도',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#qt-condition-comparison').count(),0);
    assert.equal(await page.locator('#qt-input-editor').isVisible(),false);
  });
  await screenshotView(page,'desktop-prediction.png');
  await capture(page,'desktop-prediction-full.png');
  await run('예측 AI 맥락·닫은 뒤 선택 날짜 보존',async()=>{
    const date=await page.locator('#qt-selected-date').inputValue();
    await page.getByRole('button',{name:'이 결과 물어보기',exact:true}).click();
    await page.getByRole('heading',{name:'애플트랙 AI 도우미',exact:true}).waitFor();
    assert.equal(await page.locator('#assistant-scope').inputValue(),lots[0].id);
    assert.match(await page.locator('.ai-context-note').innerText(),new RegExp(date));
    await page.getByRole('button',{name:'AI 도우미 닫기',exact:true}).click();
    assert.equal(await page.locator('#qt-selected-date').inputValue(),date);
  });
  await run('지표 변경 시 결과·그래프·실측 비교 변경',async()=>{
    await page.getByRole('tab',{name:'당도',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'당도',exact:true}).getAttribute('aria-selected'),'true');
    assert.match(await page.locator('.qt-result-number').innerText(),/°Brix/);
    assert.match(await page.locator('.qt-chart-heading').innerText(),/당도/);
    assert.match(await page.getByRole('region',{name:'최근 실측 비교'}).innerText(),/°Brix/);
    await page.getByRole('tab',{name:'산도',exact:true}).click();
    assert.match(await page.locator('.qt-result-number').innerText(),/%/);
    await page.getByRole('tab',{name:'경도',exact:true}).click();
  });
  await run('선택 날짜와 슬라이더 양방향·저장 0일차',async()=>{
    await page.locator('#qt-selected-date').fill(lots[0].storage_start_date);
    assert.equal(await page.locator('#qt-selected-day').inputValue(),'0');
    await page.locator('#qt-selected-day').focus();await page.locator('#qt-selected-day').press('ArrowRight');
    assert.equal(await page.locator('#qt-selected-day').inputValue(),'1');
    const next=new Date(Date.parse(lots[0].storage_start_date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    assert.equal(await page.locator('#qt-selected-date').inputValue(),next);
    await page.locator('#qt-selected-date').fill(today);
  });
  await run('최근 실측 비교는 선택 미래 날짜와 독립된 같은 날짜',async()=>{
    const before=await page.locator('.qt-latest-values').innerText();
    await page.locator('#qt-selected-date').fill(new Date(Date.parse(today+'T00:00:00Z')+10*86400000).toISOString().slice(0,10));
    assert.equal(await page.locator('.qt-latest-values').innerText(),before);
  });
  await run('저장 조건 비교 펼침·기준 고정·현재 조건 변경',async()=>{
    await page.getByRole('button',{name:'저장 조건 비교',exact:true}).click();
    await page.getByRole('button',{name:'비교 기준으로 고정',exact:true}).click();
    const baseline=await page.locator('.qt-table').first().locator('tbody tr').first().locator('td').nth(1).innerText();
    await page.getByRole('radio',{name:'1-MCP 처리 + 저온저장',exact:true}).click();
    assert.equal(await page.locator('.qt-table').first().locator('tbody tr').first().locator('td').nth(1).innerText(),baseline);
    await page.getByRole('button',{name:'비교 해제',exact:true}).click();
    await page.getByRole('button',{name:'저장 조건 비교',exact:true}).click();
    assert.equal(await page.locator('#qt-condition-comparison').count(),0);
  });
  await run('실제 물량 감모율은 측정일에만 표시',async()=>{
    await page.getByRole('tab',{name:'감모율',exact:true}).click();
    await page.locator('#qt-selected-date').fill(today);
    assert.equal(await page.locator('.qt-result-number').count(),0);
    await page.locator('#qt-selected-date').fill(new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10));
    assert.match(await page.locator('.qt-result-number').innerText(),/2\.11/);
  });
  await run('예시 모드와 실제 물량 전환 표시',async()=>{
    await page.getByRole('tab',{name:'예시로 체험',exact:true}).click();
    await page.getByText('예시로 체험 중',{exact:true}).waitFor();
    await page.getByRole('tab',{name:'경도',exact:true}).click();
    await page.getByRole('tab',{name:'실측값 사용',exact:true}).click();
    await page.locator('.qt-top select').waitFor();
    await page.locator('.qt-result-number').waitFor();
    assert.equal(await page.getByText('예시로 체험 중',{exact:true}).count(),0);
  });
  await run('품질 입력 초안 접기·새로고침 복구',async()=>{
    await navigate(page,'홈');
    await page.locator('.recent-lot').filter({hasText:lots[0].name}).click();
    await page.getByRole('button',{name:'입력 수정',exact:true}).click();
    await page.locator('#tf-firmness').fill('71.5');
    await page.getByRole('button',{name:'입력 접기',exact:true}).click();
    await page.getByRole('button',{name:'입력 수정',exact:true}).click();
    assert.equal(await page.locator('#tf-firmness').inputValue(),'71.5');
    await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.includes('draft')&&localStorage.getItem(k)?.includes('71.5')));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'입력 수정',exact:true}).click();
    assert.equal(await page.locator('#tf-firmness').inputValue(),'71.5');
  });
  await run('CSV 결과 내보내기: 실측 입력·모델·측정 기록 보존',async()=>{
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'결과 내보내기',exact:true}).click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/애플트랙_결과_.*\.csv$/);
    const path=resolve(out,'fixture-prediction-export.csv');await download.saveAs(path);
    const csv=await readFile(path,'utf8');
    assert.ok(csv.includes(lots[0].name));assert.match(csv,/초기 경도,71\.5,N,실측/);
    assert.match(csv,/\[모델 정보\]/);assert.match(csv,/미검증/);assert.match(csv,/\[측정 기록\]/);
    assert.match(csv,/경도\(N\) 계산/);return {filename:download.suggestedFilename(),bytes:Buffer.byteLength(csv)};
  });
  await run('3D 외관 예시: 기본 접힘·캔버스·회전·확대·다시 접기',async()=>{
    const disclosure=page.locator('details.qt-3d');
    assert.equal(await disclosure.getAttribute('open'),null);
    await disclosure.locator('summary').click();
    await page.locator('.three-mount canvas').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.viewer-loading'));
    const canvas=await page.locator('.three-mount canvas').boundingBox();
    assert.ok(canvas&&canvas.width>100&&canvas.height>100);
    try {
      await disclosure.scrollIntoViewIfNeeded();await screenshotView(page,'desktop-3d-example.png');
      await page.getByRole('button',{name:'자동 회전',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'자동 회전 정지',exact:true}).getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'확대',exact:true}).click();
      await page.getByRole('button',{name:'시점 초기화',exact:true}).click();
    } finally {
      if(await disclosure.getAttribute('open')!==null)await disclosure.locator('summary').click();
    }
    assert.equal(await page.locator('.three-mount canvas').count(),0);
    return {canvasWidth:canvas.width,canvasHeight:canvas.height,note:'Local browser render; native WebGL vs software fallback is not asserted.'};
  });
  await run('물량 이름·품종·위치 검색 및 빈 검색 결과',async()=>{
    await navigate(page,'물량 관리');await page.locator('#lot-search-input').waitFor();
    await page.locator('#lot-search-input').fill('저장고 B');assert.equal(await page.locator('.lot-card').count(),1);
    await page.locator('#lot-search-input').fill('감홍');assert.equal(await page.locator('.lot-card').count(),1);
    await page.locator('#lot-search-input').fill('없는 물량');assert.equal(await page.locator('.lot-card').count(),0);
    await page.getByRole('button',{name:'검색 지우기',exact:true}).click();assert.equal(await page.locator('.lot-card').count(),3);
  });
  await capture(page,'desktop-lots.png');
  await run('물량 상세 AI 선택 물량 범위',async()=>{
    await page.getByRole('button',{name:'이 물량 상태 요약',exact:true}).click();
    assert.equal(await page.locator('#assistant-scope').inputValue(),lots[0].id);
    await page.getByRole('button',{name:'AI 도우미 닫기',exact:true}).click();
  });
  await run('데스크톱 물량 화면 가로 넘침 없음',()=>noOverflow(page));
  await run('모델 정보 기존 #model 주소 유지',async()=>{
    await page.goto(baseURL+'/#model',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'모델 정보',exact:true}).waitFor();
    assert.match(await page.locator('main').innerText(),/검증/);
  });
  await run('내 정보: 별도 계정 화면·가상 프로필·공유 권한 안내',async()=>{
    await page.getByRole('button',{name:'내 정보',exact:true}).click();
    await page.getByRole('heading',{name:'내 정보',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.account-form input')?.value==='검증 예시');
    assert.equal(await page.getByLabel('이름',{exact:true}).inputValue(),'검증 예시');
    assert.ok(await page.getByText('local-review@example.invalid',{exact:true}).isVisible());
    assert.match(await page.locator('.account').innerText(),/팀원 계정/);
    assert.equal(await page.locator('.account-logout').isVisible(),true);
  });
  await run('가상 세션 로그아웃 → 기존 로그인 화면',async()=>{
    await page.locator('.account-logout').click();
    await page.getByRole('button',{name:'로그인',exact:true}).waitFor();
    assert.ok(requests.some(r=>r.path==='/auth/v1/logout'&&r.mock));
    return 'Only the local fixture session was signed out.';
  });

  const mobile=await browser.newContext({viewport:{width:360,height:800},isMobile:true,hasTouch:true,locale:'ko-KR',timezoneId:'Asia/Seoul',reducedMotion:'reduce'});
  const mobileRequests=await installFixtures(mobile,{baseURL});
  const mp=await mobile.newPage();hookErrors(mp);await mp.goto(baseURL,{waitUntil:'domcontentloaded'});
  await mp.getByRole('heading',{name:'최근 물량에서 이어가기'}).waitFor();
  await run('모바일 홈 360px 가로 넘침 없음',()=>noOverflow(mp));
  await capture(mp,'mobile-home.png');
  await mp.locator('.recent-lot').filter({hasText:lots[0].name}).click();await mp.locator('.qt-result-number').waitFor();
  await run('모바일 결과가 입력 수정 영역보다 위',async()=>{
    const main=await mp.locator('.qt-main').boundingBox(),input=await mp.locator('.qt-input').boundingBox();
    assert.ok(main&&input&&main.y<input.y,JSON.stringify({main,input}));return {resultY:main.y,inputY:input.y};
  });
  await run('모바일 품질 예측 360px 가로 넘침 없음',()=>noOverflow(mp));
  await mp.locator('.qt-main').scrollIntoViewIfNeeded();
  await screenshotView(mp,'mobile-prediction.png');await capture(mp,'mobile-prediction-full.png');
  await run('모바일 AI 미설정·닫기 복귀·가로 넘침 없음',async()=>{
    const date=await mp.locator('#qt-selected-date').inputValue();
    await mp.getByRole('button',{name:'이 결과 물어보기',exact:true}).click();
    await mp.getByRole('heading',{name:'현재 AI 설명을 불러올 수 없습니다',exact:true}).waitFor();
    const panel=await mp.locator('.ai-assistant-panel').boundingBox();
    assert.ok(panel&&Math.abs(panel.x)<1&&Math.abs(panel.y)<1&&Math.abs(panel.width-360)<1&&Math.abs(panel.height-800)<1,JSON.stringify(panel));
    await noOverflow(mp);await screenshotView(mp,'mobile-ai-unconfigured.png');
    await mp.getByRole('button',{name:'AI 도우미 닫기',exact:true}).click();
    assert.equal(await mp.locator('#qt-selected-date').inputValue(),date);
  });
  await navigate(mp,'물량 관리');await mp.locator('#lot-search-input').waitFor();
  await run('모바일 물량 목록 → 상세 → 목록',async()=>{
    await mp.locator('#lot-choice-'+lots[0].id).click();
    await mp.getByRole('region',{name:'선택 물량 상세'}).waitFor();
    assert.equal(await mp.getByRole('complementary',{name:'물량 목록'}).isVisible(),false);
    await screenshotView(mp,'mobile-lot-detail.png');
    await mp.getByRole('button',{name:'물량 목록으로',exact:true}).click();
    assert.equal(await mp.locator('#lot-search-input').isVisible(),true);
  });
  await run('모바일 물량 목록 360px 가로 넘침 없음',()=>noOverflow(mp));
  await capture(mp,'mobile-lots.png');
  await run('실제 데이터 변경 요청 없음',async()=>{
    const writes=[...requests,...mobileRequests].filter(r=>r.path.startsWith('/api/lots')&&r.method!=='GET');
    assert.equal(writes.length,0);return {mockRequests:requests.length+mobileRequests.length};
  });
  await mobile.close();
} catch(e) {checks.push({name:'Harness execution',status:'fail',detail:e.stack});console.error(e);await capture(page,'failure-desktop.png').catch(()=>{});}
finally {
  await writeFile(resolve(out,'ui-test-report.json'),JSON.stringify({generatedAt:new Date().toISOString(),environment:'local mock integration; no production data',baseURL,checks,screenshots:shots,pageErrors:errors,requests},null,2));
  await browser.close();
}
if(checks.some(c=>c.status==='fail')||errors.length)process.exitCode=1;
