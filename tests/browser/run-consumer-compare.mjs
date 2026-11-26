// 상세 ‘소비자 선호와 비교’ + 목표 저장일 당도 대조 + 수확일 범위 밖 기록. 가상 기록만 사용.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const show = (l, t) => console.log(`    └ ${l}: ${String(t).replace(/\s+/g, ' ').trim().slice(0, 300)}`);
const errors = [];
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const badHongro = {...lots[0], id: '99999999-9999-4999-8999-999999999999', name: '[검증] 11월 수확 홍로', variety: '홍로', harvest_date: '2026-11-03', details: {...(lots[0].details ?? {}), region: 'pocheon'}};
try {
  for (const [width, big] of [[390, false], [1440, false], [390, true]]) {
    const tag = `${width}px${big ? ' 큰 글자' : ''}`;
    const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', deviceScaleFactor: 2});
    await installFixtures(context, {initialLots: [...lots, badHongro]});
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/#lot/${lots[0].id}`);
    if (big) await page.locator('.big-text-toggle').first().click();
    const cc = page.locator('section[aria-label="소비자 선호와 비교"]'); await cc.waitFor({timeout: 20000});
    const ts = page.locator('section[aria-label="목표 저장일"]');
    const before = {when: await cc.locator('.cc-when').innerText()};
    show(`${tag} 카드`, await cc.innerText());
    await ts.getByRole('radio', {name: '30일'}).click(); const n30 = await ts.locator('.ts-res').innerText().catch(() => '');
    await ts.getByRole('radio', {name: '60일'}).click(); const n60 = await ts.locator('.ts-res').innerText().catch(() => '');
    show('목표일 30일 당도 대조', n30); show('목표일 60일 당도 대조', n60);
    assert.equal(await cc.locator('.cc-when').innerText(), before.when, '비교 기준(30일 뒤→60일 뒤)은 그대로');
    assert.match(before.when, /^\d{1,2}\/\d{1,2} → \d{1,2}\/\d{1,2}$/);
    // 측정 창: 날짜 오늘·당도 비어 있음, 취소하면 목표일 선택 유지
    await cc.getByRole('button', {name: '오늘 잰 당도 기록하기'}).click();
    await page.locator('#mf-date').waitFor();
    const mf = {date: await page.locator('#mf-date').inputValue(), brix: await page.locator('#mf-brix').inputValue()};
    show('측정 창 기본값', JSON.stringify(mf)); assert.equal(mf.date, today); assert.equal(mf.brix, '');
    await page.getByRole('dialog').getByRole('button', {name: '취소', exact: true}).click();
    await page.locator('#mf-date').waitFor({state: 'detached'});
    assert.equal(await ts.getByRole('radio', {checked: true}).innerText(), '60일', '취소 뒤 목표일 선택 유지');
    const overflow = await cc.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, '가로 넘침');
    await cc.screenshot({path: `tests/browser/artifacts/consumer-compare-${width}${big ? '-big' : ''}.png`});
    // 수확일 범위 밖 홍로
    await page.goto(`${base}/#lot/${badHongro.id}`); await page.locator('.ma-detail h1').waitFor();
    const alert = page.getByRole('alert').filter({hasText: '수확 달'}); await alert.waitFor();
    show('11월 수확 홍로 안내', await alert.first().innerText());
    const ccBad = await page.locator('section[aria-label="소비자 선호와 비교"]').innerText();
    show('11월 수확 홍로 비교 카드', ccBad); assert.match(ccBad, /비교할 값이 없어요/); assert.equal(await page.locator('section[aria-label="소비자 선호와 비교"] .cc-val').count(), 0);
    console.log(`✓ ${tag}: 비교 카드·당도 대조·측정 창 기본값·취소 유지·수확일 범위 밖 처리`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
