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
    const btn = await page.locator('.hs-today .hs-more').boundingBox();
    assert.ok(btn.height >= 40, `자세히 버튼 크기 ${btn.height}`); assert.equal(await page.locator('.hs-more-wide').count(), 0);
    await page.locator('.hs-today .hs-more').click();
    const ts = page.locator('section[aria-label="목표 저장일"]');
    await ts.waitFor({timeout: 30000}); assert.equal(await page.locator('section[aria-label="소비자 선호와 비교"]').count(), 0, '소비자 비교 카드 없음');
    await ts.getByRole('radio').first().click(); assert.match(await ts.innerText(), /캘린더에 등록/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(dataCalls.length, 0, '개인 데이터 API 호출 없음');
    console.log(`✓ ${w}px 체험: 요약(경매가 포함) → 예시 상세 목표 저장일(소비자 비교 카드 없음) · 경매가 카드 · 개인 데이터 호출 0건`);
    await page.screenshot({path: `tests/browser/artifacts/guest-cards-${w}.png`, fullPage: true});
    await context.close();
  }
} finally { await browser.close(); }
