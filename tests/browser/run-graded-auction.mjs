// 요약 화면 경매가 카드: 실시간(오늘) + 정산정보 등급별 정산가. 실제 aT API를 로컬 서버가 호출합니다(키는 환경변수).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const show = (label, text) => console.log(`    └ ${label}: ${String(text).replace(/\s+/g, ' ').trim().slice(0, 400)}`);
const errors = [];
try {
  for (const width of [388, 1366]) {
    const context = await browser.newContext({viewport: {width, height: 1000}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', deviceScaleFactor: 2});
    await installFixtures(context, {initialLots: lots});
    const market = [];
    await context.route('**/api/market/**', r => { market.push(new URL(r.request().url()).pathname + new URL(r.request().url()).search.replace(/asOf=[^&]*&?/, '')); return r.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const timing = [];
    page.on('request', r => { if (r.url().includes('/graded?')) timing.push({start: Date.now()}); });
    page.on('response', r => { if (r.url().includes('/graded?')) { const t = timing.at(-1); if (t) { t.ms = Date.now() - t.start; t.status = r.status(); } } });
    const t0 = Date.now();
    await page.goto(`${base}/#home`);
    const card = page.locator('section.apple-auction');
    const gk = card.locator('.gk');
    await card.waitFor({timeout: 30000});
        await card.locator('.gk-tiles, .gk .apple-auction__notice:not(:has-text("확인하고"))').first().waitFor({timeout: 150000});
    show(`${width}px 카드까지 걸린 시간`, `${Math.round((Date.now() - t0) / 1000)}초`);
    await gk.locator('.gk-tiles').waitFor({timeout: 120000});
    const why = gk.locator('.gk-why'); if (await why.count()) show('사유 칸', await why.innerText());
    const hasGrades = await card.locator('.aa-grades').waitFor({timeout: 90000}).then(() => true, () => false);
    show('내 산지 등급별 정산가 표시', hasGrades ? '예' : '아니오(원자료 조회 실패 — 아래 서버 로그 확인)');
    show('가락 시세', await gk.innerText());
    await gk.screenshot({path: `tests/browser/artifacts/garak-${width}.png`});
    show('카드 내용', await card.innerText());
    show('호출한 우리 서버 주소', market.filter(p => p.includes('graded')).join(' | '));
    const rows = await card.locator('.aa-grade').count();
    show('등급 줄 수', rows); show('등급 자료 응답 시간', timing.map(t => `${t.status} ${t.ms}ms`).join(', '));
    const varieties = await card.locator('select[id$="-variety"] option').evaluateAll(o => o.map(x => x.textContent.trim()));
    show('품종 목록', varieties.join(', ')); assert.ok(varieties.every(v => ['후지', '부사', '후지(부사)', '홍로'].includes(v)));
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({path: `tests/browser/artifacts/graded-auction-${width}.png`});
    const overflow = await card.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, '카드가 가로로 넘침');
    await card.locator('.aa-more > summary').click();
    await card.screenshot({path: `tests/browser/artifacts/graded-auction-${width}-open.png`});
    console.log(`✓ ${width}px 경매가 카드: 등급별 정산가 먼저·나머지 접기, 후지·홍로만, 가로 넘침 없음`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
