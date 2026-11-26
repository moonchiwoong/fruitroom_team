// 요약 ‘오늘’ 배치: 계산되는 항목 수(4·3·2·1·0개)가 달라도 카드 칸에 빈자리가 생기지 않는지(PC·폰).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const base = lots[0];
const cases = [
  ['4개', {}], ['3개', {acidity: null}], ['2개', {acidity: null, brix: null}], ['1개', {acidity: null, brix: null, firmness: null}],
  ['0개', {variety: '감홍', firmness: null, brix: null, acidity: null, weight: null, details: {}}],
];
try {
  for (const w of [1366, 390]) for (const [tag, patch] of cases) {
    const context = await browser.newContext({viewport: {width: w, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
    await installFixtures(context, {initialLots: [{...base, ...patch, id: `55555555-5555-4555-8555-55555555555${cases.findIndex(c => c[0] === tag)}`, observation_count: 0, environment_count: 0, latest_observation: null, name: `배치 ${tag}`}]});
    await context.route('**/api/market/**', r => r.fulfill({status: 503, contentType: 'application/json', body: '{}'}));
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3000/#home');
    await page.locator('.hs-today .hs-grid, .hs-today .hs-none').first().waitFor({timeout: 30000}); await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const t = document.querySelector('.hs-today').getBoundingClientRect(), g = document.querySelector('.hs-today .hs-grid');
      const out = {cards: g ? g.children.length : 0, hole: false, hl: !!document.querySelector('.hs-today .hs-hl')};
      if (g) { const gr = g.getBoundingClientRect(), kids = [...g.children].map(e => e.getBoundingClientRect()); const lastTop = Math.max(...kids.map(k => Math.round(k.top))); const lastRow = kids.filter(k => Math.round(k.top) === lastTop); out.hole = Math.max(...lastRow.map(k => k.right)) < gr.right - 4; }
      else { const n = document.querySelector('.hs-today .hs-none').getBoundingClientRect(); out.hole = n.right < t.right - 4; }
      out.overflow = document.documentElement.scrollWidth > innerWidth + 1; return out;
    });
    assert.equal(r.hole, false, `${w}px ${tag}: 카드 줄 끝에 빈칸 ${JSON.stringify(r)}`); assert.equal(r.overflow, false);
    console.log(`✓ ${w}px 계산 ${tag}: 칸 ${r.cards} · 빈칸 없음 · 한 줄 요약 ${r.hl ? '있음' : '없음'}`);
    await page.locator('.hs-today').screenshot({path: `tests/browser/artifacts/summary-${w}-${tag}.png`}); await context.close();
  }
} finally { await browser.close(); }
