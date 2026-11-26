// 목표 저장일 카드: 일수/날짜 선택 → 계산값 표시 → 캘린더 파일(.ics) 내려받기. 가상 기록만 사용.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const errors = [];
const show = (label, text) => console.log(`    └ ${label}: ${String(text).replace(/\s+/g, ' ').trim().slice(0, 200)}`);
try {
  for (const width of [1366, 388]) {
    const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', acceptDownloads: true});
    await installFixtures(context, {initialLots: lots});
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const lot = lots[0];
    await page.goto(`${base}/#lot/${lot.id}`);
    const card = page.locator('section[aria-label="목표 저장일"]');
    await card.waitFor({timeout: 15000});
    assert.equal(await page.getByText('다음 권장 측정일').count(), 0);
    show('카드 처음', await card.innerText());
    await card.getByRole('radio', {name: '60일'}).click();
    const txt = await card.innerText(); show('60일 고른 뒤', txt);
    assert.match(txt, /저장 60일째/); assert.match(txt, /단단함\s*[\d.]+\s*N/);
    const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', {name: '캘린더에 등록'}).click()]);
    const ics = (await readFile(await dl.path(), 'utf8')).replace(/\r\n /g, '');
    show('내려받은 파일 이름', dl.suggestedFilename()); assert.match(dl.suggestedFilename(), /^appletrack-target-\d{4}-\d{2}-\d{2}\.ics$/);
    show('파일 일정 시각', ics.match(/DTSTART;TZID[^\r\n]*/)?.[0]); show('파일 제목', ics.match(/SUMMARY:[^\r\n]*/)?.[0]);
    assert.match(ics, /DTSTART;TZID=Asia\/Seoul:\d{8}T090000/); assert.match(ics, /저장 60일째/); assert.match(ics, /BEGIN:VALARM/);
    // 날짜 직접 입력: 오늘은 막힘
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    await card.locator('input[type=date]').fill(today);
    const err = card.getByRole('alert'); await err.waitFor(); show('오늘 날짜 입력', await err.innerText());
    assert.match(await err.innerText(), /오늘 이후/);
    assert.equal(await card.getByRole('button', {name: '캘린더에 등록'}).count(), 0);
    // 새로고침해도 마지막으로 고른 값(오늘) 대신 기억한 값이 유지되는지: 다시 60일 고르고 새로고침
    await card.getByRole('radio', {name: '60일'}).click(); await page.reload(); await card.waitFor();
    show('새로고침 후 선택', await card.getByRole('radio', {checked: true}).innerText());
    assert.equal(await card.getByRole('radio', {checked: true}).innerText(), '60일');
    console.log(`✓ ${width}px 목표 저장일: 60일 선택·계산값·캘린더 파일·오늘 날짜 차단·새로고침 유지`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
