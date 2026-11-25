// 품종별 수확 달 제한(홍로 8~10월, 후지 10~11월) 화면 검증. 가상 기록만 쓰고 데이터 요청은 fixture가 가로챕니다.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const errors = [];
const ok = name => console.log('✓', name);
const show = (label, text) => console.log(`    └ ${label}: ${String(text).replace(/\s+/g, ' ').trim().slice(0, 160)}`);

try {
  for (const width of [1366, 388]) {
    const tag = `${width}px`;
    // 1. 공개 체험 · 홍로(거창): 3월은 막고 결과를 보여 주지 않음 → 9월은 통과
    {
      const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
      await context.route('https://review.supabase.co/**', r => r.fulfill({status: 401, contentType: 'application/json', body: '{}'}));
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/try`);
      await page.getByRole('tab', {name: '내 사과로 해 보기'}).click();
      await page.getByText('지역으로 시작').first().click();
      await page.locator('.rmp-chips button').filter({hasText: '거창'}).click();
      await page.locator('#na-harvest').fill('2026-03-10');
      const err = page.locator('#na-harvest-err');
      await err.waitFor();
      show('홍로 3/10 입력', await err.innerText());
      assert.match(await err.innerText(), /홍로는 8~10월에 수확한 사과만/);
      assert.equal(await page.locator('#na-harvest').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#na-result').count(), 0);
      await page.locator('#na-harvest').fill('2026-09-15');
      await err.waitFor({state: 'detached'});
      show('홍로 9/15 입력 후 안내', (await page.locator('#na-harvest-err').count()) ? '남음' : '없음');
      ok(`${tag} 체험 홍로: 3월 차단·결과 숨김 → 9월 통과`);
      // 후지(청송): 9월은 막고 10월은 통과
      await page.goto(`${base}/try`);
      await page.getByRole('tab', {name: '내 사과로 해 보기'}).click();
      await page.getByText('지역으로 시작').first().click();
      await page.locator('.rmp-chips button').filter({hasText: '청송'}).click();
      await page.locator('#na-harvest').fill('2026-09-15');
      await err.waitFor();
      show('후지 9/15 입력', await err.innerText());
      assert.match(await err.innerText(), /후지는 10~11월/);
      await page.locator('#na-harvest').fill('2026-10-28');
      await err.waitFor({state: 'detached'});
      ok(`${tag} 체험 후지: 9월 차단 → 10월 통과`);
      await context.close();
    }
    // 2. 로그인 · 사과 정보 수정: 수확일을 3월로 바꾸면 안내하고 저장 요청을 보내지 않음
    {
      const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
      await installFixtures(context, {initialLots: lots});
      const writes = [];
      context.on('request', r => { if (/\/api\/lots/.test(r.url()) && ['POST', 'PATCH', 'PUT'].includes(r.method())) writes.push(r.method()); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      const lot = lots.find(l => /후지/.test(l.variety)) ?? lots[0];
      await page.goto(`${base}/#lot/${lot.id}`); await page.locator('.ma-detail h1').waitFor();
      await page.getByRole('button', {name: /사과 정보 수정/}).click();
      const more = page.locator('details.ld-more');
      if (!(await more.evaluate(d => d.open))) await more.locator('summary').click();
      await page.locator('#le-harvest').fill('2026-03-10');
      const alert = page.locator('.ld-err');
      await alert.waitFor();
      show(`수정 창 ${lot.variety} 3/10 입력`, await alert.innerText());
      assert.match(await alert.innerText(), /후지는 10~11월/);
      await page.getByRole('button', {name: /^저장/}).last().click();
      await page.waitForTimeout(400);
      show('저장 누른 뒤 서버 저장 요청 수', writes.length);
      assert.equal(writes.length, 0);
      assert.ok(await page.locator('#le-harvest').isVisible(), '수정 창이 닫히지 않아야 함');
      ok(`${tag} 사과 정보 수정: 3월 수확일 안내·저장 요청 0건`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
