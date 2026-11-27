import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixtures, lots} from '../fixtures/browser-fixtures.mjs';

const {chromium} = createRequire(import.meta.url)('playwright');
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const start = '2025-11-01';
const longLot = {...lots[0], id: 'long-fuji', name: '장기 보관 후지', harvest_date: start, intake_date: start,
  storage_start_date: start, initial_measured_on: start, firmness: 70, latest_observation: null, observation_count: 0};
const august = '2026-08-28';
const weatherLot = {...lots[0], id: 'weather-pocheon', name: '포천 홍로', variety: '홍로', harvest_date: august, intake_date: august,
  storage_start_date: august, initial_measured_on: august, firmness: null, brix: null, acidity: null, latest_observation: null,
  details: {storage_temperature: 0, hongro: {source: 'weather', storage: 'cold0', region: 'pocheon',
    initial: {firmness: null, brix: null, acidity: null, weight: null, diameter: null},
    weather: {chang_min4: 6, chang_LC56: 1162.41, chang_LC78: 1343.11, chang_9rain: null}}}};
const observations = {chang_min4: 6, chang_LC56: 1162.41, chang_LC78: 1343.11, chang_9rain: 267.34};

async function openContext(width, options, date) {
  const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul'});
  const requests = await installFixtures(context, options);
  const page = await context.newPage();
  if (date) await page.clock.setFixedTime(new Date(`${date}T03:00:00Z`));
  return {context, page, requests};
}

try {
  for (const width of [1366, 390]) {
    {
      const {context, page} = await openContext(width, {initialLots: [longLot]}, shift(start, 240));
      await page.goto(`${base}/#home`);
      const summary = page.locator('.hs-metric').filter({hasText: '단단함'});
      await summary.waitFor();
      assert.match(await summary.innerText(), /66\.7\s*N/);
      await page.getByRole('button', {name: '자세히 보기'}).click();
      const chart = page.getByRole('img', {name: '단단함 저장 일수별 계산값'});
      await chart.getByText('240일', {exact: true}).waitFor();
      assert.match(await page.locator('.ma-row').filter({hasText: '단단함'}).innerText(), /66\.7\s*N/);
      const buttons = page.getByRole('group', {name: '저장 일수'}).getByRole('button');
      assert.deepEqual(await buttons.allTextContents(), ['30일', '60일', '90일', '120일', '150일', '200일', '오늘']);
      assert.equal(await chart.locator('.mc-today').getAttribute('x1'), '292');
      await page.getByRole('button', {name: '30일', exact: true}).click();
      await chart.getByText('200일', {exact: true}).waitFor();
      await context.close();
      console.log(`✓ ${width}px 후지 240일 요약·상세 일치 및 기본 200일 그래프와 날짜 버튼 유지`);
    }
    {
      const {context, page} = await openContext(width, {initialLots: [weatherLot]}, '2026-08-31');
      let called = false;
      await context.route('**/api/weather/hongro?*', route => { called = true; return route.abort(); });
      await page.goto(`${base}/#lot/${weatherLot.id}`);
      await page.getByText(/9월 1일부터 날씨로 자동 추정/).waitFor();
      await page.getByRole('img', {name: '무게 감소 저장 일수별 계산값'}).getByText('120일', {exact: true}).waitFor();
      assert.equal(called, false);
      await context.close();
    }
    for (const complete of [true, false]) {
      const {context, page} = await openContext(width, {initialLots: [weatherLot]}, '2026-09-15');
      let calls = 0;
      await context.route('**/api/weather/hongro?*', route => {
        const params = new URL(route.request().url()).searchParams;
        assert.equal(params.get('region'), 'pocheon');
        assert.equal(params.get('year'), '2026');
        calls++;
        return route.fulfill({json: {variables: Object.entries(observations).map(([key, value]) => ({key, value: complete || key !== 'chang_9rain' ? value : null}))}});
      });
      const weatherResponse = page.waitForResponse(response => response.url().includes('/api/weather/hongro'));
      await page.goto(`${base}/#home`);
      await weatherResponse;
      if (complete) {
        const brix = page.locator('.hs-metric').filter({hasText: '단맛'});
        await brix.waitFor();
        assert.match(await brix.innerText(), /15\.5\s*°Brix/);
      } else {
        await page.locator('.hs-none').waitFor();
        assert.equal(await page.locator('.hs-metric').filter({hasText: '단맛'}).count(), 0);
      }
      await page.getByRole('button', {name: '자세히 보기'}).click();
      await page.getByRole('button', {name: '측정 추가'}).waitFor();
      const row = page.locator('.ma-row').filter({hasText: '단맛'});
      if (complete) {
        await row.getByText(/15\.5/).waitFor();
        assert.equal(calls, 1, '요약에서 받은 값을 상세에서 재사용');
      } else {
        await row.getByText(/처음 측정값/).waitFor();
      }
      await context.close();
    }
    console.log(`✓ ${width}px 포천 9월 기상자료 조회, 요약·상세 간 재사용 및 누락 시 실측 입력 유지`);

    const records = Array.from({length: 101}, (_, index) => ({...longLot, id: `page-${index}`, name: `물량 ${index}`,
      details: index === 100 ? {archived_on: '2026-01-01'} : {}}));
    const {context, page, requests} = await openContext(width, {initialLots: records, lotPageSize: 30, delayLotPagesMs: 1100});
    await page.goto(`${base}/#lot/page-100`);
    await page.getByRole('heading', {name: '물량 100', exact: true}).waitFor();
    assert.ok(requests.some(request => request.id === 'page-100'));
    await page.locator('.ma-back').click();
    const rows = page.locator('.ma-list button.ma-card');
    await page.waitForFunction(() => document.querySelectorAll('.ma-list button.ma-card').length === 100);
    assert.equal(new Set(await rows.locator('b').allTextContents()).size, 100);
    assert.deepEqual(requests.filter(request => request.cursor).map(request => request.cursor), ['30', '60', '90']);
    await page.getByRole('button', {name: '출하 완료 1개 보기'}).click();
    await page.getByRole('button', {name: /물량 100/}).click();
    await page.getByRole('heading', {name: '물량 100', exact: true}).waitFor();
    await page.goto(`${base}/#lot/unavailable`);
    await page.getByRole('alert').filter({hasText: '주소의 사과 기록을 찾을 수 없어요'}).waitFor();
    await context.close();
    console.log(`✓ ${width}px 101건 조회, 오래된 상세 주소, 출하 완료 기록, 중복·누락 및 접근 불가 안내`);
  }
} finally {
  await browser.close();
}
