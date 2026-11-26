import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
try {
  for (const w of [1366, 390]) {
    const context = await browser.newContext({viewport: {width: w, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
    await installFixtures(context, {initialLots: lots});
    await context.route('**/api/market/**', r => r.fulfill({status: 503, contentType: 'application/json', body: '{}'}));
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:3000/#lot/${lots[0].id}`);
    await page.locator('section[aria-label="목표 저장일"]').waitFor();
    let box;
    if (w >= 1000) { box = page.locator('.mc').filter({has: page.locator('.mc-pref')}); }
    else { const ag = page.locator('section.ag'); await ag.getByRole('button', {name: '단맛'}).click(); box = ag; await assert.equal(await ag.locator('.ag-pref').count(), 1); }
    await box.first().waitFor();
    const txt = await box.first().innerText();
    assert.match(txt, /소비자 선호 하한 13 °Brix/);
    assert.match(txt, /(오늘부터 \d+일 뒤|저장 \d+일째).*13 °Brix 아래로 내려가요|이미 13 °Brix보다 낮아요|\d+일 안에는 13 °Brix 아래로 내려가지 않아요/);
    const legend = (await box.first().locator(w >= 1000 ? '.mc-legend' : '.ag-legend').innerText()).replace(/\s+/g, ' ');
    console.log(`✓ ${w}px 단맛 그래프 소비자 선호 하한선 · 범례: ${legend}`);
    await box.first().screenshot({path: `tests/browser/artifacts/consumer-line-${w}.png`});
    await context.close();
  }
} finally { await browser.close(); }
