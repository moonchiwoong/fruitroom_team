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
      const opts = sel => page.locator(`${sel} option`).allInnerTexts();
      assert.deepEqual(await opts('#le-variety'), ['후지', '홍로', '기타 (직접 입력)']);
      assert.ok(!(await opts('#le-mcp')).includes('모름'), '1-MCP에 모름 없음');
      ok(`${tag} 사과 정보 수정: 품종 ${(await opts('#le-variety')).join('/')} · 1-MCP ${(await opts('#le-mcp')).join('/')}`);
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
