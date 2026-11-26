// 비회원 체험(/try): 예시 사과에도 소비자 선호 비교·목표 저장일·서울가락 경매가가 나오는지. 개인 데이터 API는 부르지 않음.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = process.env.UI_TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
try {
  for (const w of [1366, 390]) {
    const context = await browser.newContext({viewport: {width: w, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
    const dataCalls = [];
    await context.route('https://review.supabase.co/**', r => { if (/\/rest\/v1\//.test(r.request().url())) dataCalls.push(r.request().url()); return r.fulfill({status: 401, contentType: 'application/json', body: '{}'}); });
    await context.route('**/api/market/**', r => r.fulfill({status: 503, contentType: 'application/json', body: '{"status":"unavailable"}'}));
    const page = await context.newPage(); await page.goto(`${base}/try`);
    await page.locator('.hs-today .hs-hl').waitFor({timeout: 30000});
    assert.equal(await page.getByRole('heading', {name: '요약', level: 1}).count(), 1, '체험은 요약부터');
    assert.equal(await page.getByRole('heading', {name: '사과 경매가'}).count(), 1);
    const btn = await page.locator('.hs-today .hs-more').boundingBox(), wide = await page.locator('.hs-today .hs-more-wide').boundingBox();
    assert.ok(btn.height >= 40 && wide.height >= 44, `자세히 버튼 크기 ${btn.height}/${wide.height}`);
    await page.locator('.hs-today .hs-more-wide').click();
    const cc = page.locator('section[aria-label="소비자 선호와 비교"]'), ts = page.locator('section[aria-label="목표 저장일"]');
    await cc.waitFor({timeout: 30000}); await ts.waitFor();
    assert.match(await cc.innerText(), /오늘 단맛/); assert.equal(await cc.getByRole('button', {name: '오늘 잰 당도 기록하기'}).count(), 0);
    await ts.getByRole('radio').first().click(); assert.match(await ts.innerText(), /캘린더에 등록/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (w >= 1000) { const a = await cc.boundingBox(), b = await ts.boundingBox(); assert.ok(Math.abs(a.y - b.y) < 2 && Math.abs(a.height - b.height) < 2, `두 카드 위치·높이 ${JSON.stringify([a.y, a.height, b.y, b.height])}`); }
    assert.equal(dataCalls.length, 0, '개인 데이터 API 호출 없음');
    console.log(`✓ ${w}px 체험: 요약(경매가 포함) → 예시 상세 소비자 선호 비교 · 목표 저장일 · 경매가 카드 · 개인 데이터 호출 0건`);
    await page.screenshot({path: `tests/browser/artifacts/guest-cards-${w}.png`, fullPage: true});
    await context.close();
  }
} finally { await browser.close(); }
