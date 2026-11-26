// 요약 화면 경매가 카드: 서울가락 시세만(내 산지 경매가 없음), 그래프 크기·사유 칸. 시세 자료는 고정 값으로 대체.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const garak = {status: 'ready', variety: '후지', today: {date: '2026-11-26', per10kg: 28880, kg: 15320}, yesterday: {date: '2026-11-25', per10kg: 31564, kg: 11410},
  years: [[2020, 26386], [2021, 17704], [2022, 21308], [2023, 37379], [2024, 36646], [2025, 43533], [2026, 29029]].map(([year, per10kg]) => ({year, from: '', to: `${year}-11-26`, per10kg, kg: 1, days: 6})), partial: false};
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const calls = [];
try {
  for (const [w, zoom] of [[1366, 1.1], [390, 1], [360, 1]]) {
    const context = await browser.newContext({viewport: {width: Math.round(w / zoom), height: 900}, deviceScaleFactor: zoom, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
    await installFixtures(context, {initialLots: lots});
    await context.route('**/api/market/**', r => { calls.push(new URL(r.request().url()).pathname); return r.request().url().includes('/garak') ? r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(garak)}) : r.fulfill({status: 404, body: '{}'}); });
    const page = await context.newPage(); await page.goto('http://127.0.0.1:3000/#home');
    const card = page.locator('section.apple-auction'); await card.locator('.gk-chart').waitFor({timeout: 30000});
    assert.equal(await card.getByText('내 산지 경매가').count(), 0);
    const tops = await card.locator('.gk-tile dd').evaluateAll(es => es.map(e => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().height)]));
    assert.equal(new Set(tops.map(t => t[0])).size, 1, `시세 값 높이 맞춤 ${JSON.stringify(tops)}`);
    assert.ok(tops.every(t => t[1] < 42), `값과 ‘원’ 한 줄 ${JSON.stringify(tops)}`);
    const box = await card.locator('.gk-chart svg').boundingBox();
    assert.ok(box.width <= 481 && box.height <= 211, `그래프 크기 ${box.width}x${box.height}`);
    assert.equal(await card.evaluate(e => e.scrollWidth > e.clientWidth + 1), false);
    assert.equal(await card.locator('.gk-why:not(.empty)').count(), 0, '처음엔 아무 해도 고르지 않음');
    assert.equal(await card.locator('.gk-chart svg circle[r="5"]').count(), 0, '처음엔 빨간 큰 점 없음');
    const dot = card.locator('.gk-chart svg g[role="button"]').last();
    assert.equal(await card.locator('.gk-why-btns').count(), 0, '연도 버튼 없음');
    if (w >= 1000) { const sv = await card.locator('.gk-chart svg').boundingBox(), why = await card.locator('.gk-why').boundingBox(); assert.ok(Math.abs(sv.y - why.y) < 2 && Math.abs(sv.height - why.height) < 2, `그래프·이유 칸 맞춤 ${JSON.stringify([sv.y, sv.height, why.y, why.height])}`); }
    await dot.click(); assert.match(await card.locator('.gk-why:not(.empty)').innerText(), /2026년 이맘때 값이 낮았던 이유/, 'ⓘ 눌러 열림');
    assert.equal(await card.locator('.gk-chart svg circle[r="5"]').count(), 1, '고른 해에 빨간 점');
    await dot.click(); assert.equal(await card.locator('.gk-why:not(.empty)').count(), 0, 'ⓘ 다시 눌러 닫힘');
    assert.match(await card.innerText(), /전년 대비\(최근 7일 평균\) ▼ 33\.3%/);
    console.log(`✓ ${w}px(배율 ${zoom}) 서울가락 시세만 · 그래프 ${Math.round(box.width)}x${Math.round(box.height)} · 사유 칸`);
    await card.screenshot({path: `tests/browser/artifacts/garak-card-${w}.png`}); await context.close();
  }
  assert.ok(calls.every(p => p === '/api/market/apple-auctions/garak'), `불필요한 경매 호출: ${calls}`);
} finally { await browser.close(); }
