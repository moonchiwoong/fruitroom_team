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
const weatherVariables = Object.entries(observations).map(([key, value]) => ({key, value}));

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

    {
      const {context, page} = await openContext(width, {}, '2026-11-27');
      const calls = [];
      let finishRetry, finishOld;
      const retryGate = new Promise(resolve => { finishRetry = resolve; });
      const oldGate = new Promise(resolve => { finishOld = resolve; });
      let requestOld;
      const oldStarted = new Promise(resolve => { requestOld = resolve; });
      await context.route('**/api/weather/hongro?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        const query = `${params.get('region')}:${params.get('year')}`;
        calls.push(query);
        if (calls.length === 1) return route.fulfill({status: 502, json: {error: '가상 기상 장애'}});
        if (calls.length === 2) await retryGate;
        if (query === 'pocheon:2025') {
          requestOld();
          await oldGate;
          return route.fulfill({status: 502, json: {error: '이전 요청 오류'}}).catch(() => {});
        }
        return route.fulfill({json: {variables: weatherVariables}});
      });
      await page.goto(`${base}/#lots`);
      await page.getByRole('button', {name: '새 사과', exact: true}).click();
      await page.getByRole('button', {name: /지역으로 시작/}).click();
      await page.locator('.rmp-chips button').filter({hasText: '포천'}).click();
      const harvest = page.locator('#na-harvest');
      const weather = page.locator('.na-wx');
      await harvest.fill('2026-11-10');
      await weather.getByText(/가상 기상 장애/).waitFor();
      await weather.getByRole('button', {name: '다시 불러오기'}).click();
      await weather.getByText(/모으는 중/).waitFor();
      finishRetry();
      await weather.getByText(/2026년 농업기상 포천시 영북면 관측/).waitFor();
      await harvest.fill('2026-11-11');
      await weather.getByText(/2026년 농업기상 포천시 영북면 관측/).waitFor();
      await harvest.fill('2025-11-10');
      await oldStarted;
      await page.locator('.rmp-chips button').filter({hasText: '화성'}).click();
      await weather.getByText(/2025년 농업기상 화성/).waitFor();
      finishOld();
      assert.deepEqual(calls, ['pocheon:2026', 'pocheon:2026', 'pocheon:2025', 'hwaseong:2025']);
      assert.match(await weather.innerText(), /2025년 농업기상 화성/);
      await context.close();
      console.log(`✓ ${width}px 기상 재시도, 같은 연도 자료 유지, 산지·연도 변경 시 이전 응답 격리`);
    }
    {
      const legacy = {...weatherLot, id: 'old-measured', name: '기존 실측 홍로', brix: 13.8, details: {
        ...weatherLot.details, region: 'geochang', hongro: {...weatherLot.details.hongro, source: 'measured', initial: {brix: 13.8}},
      }};
      const unknown = {...legacy, id: 'unknown-measured', name: '산지 미확인 홍로', details: {
        ...legacy.details, hongro: {...legacy.details.hongro, region: 'geochang'},
      }};
      const initialLots = [legacy, unknown, weatherLot, longLot];
      const {context, page} = await openContext(width, {initialLots}, '2026-11-27');
      await context.route(/\/api\/lots$/, route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const input = route.request().postDataJSON();
        assert.equal(input.details.region, 'pocheon');
        assert.equal(input.details.hongro.region, 'pocheon');
        assert.equal(input.details.region_confirmed, true);
        const lot = {...legacy, ...input, id: 'new-measured'};
        initialLots.push(lot);
        return route.fulfill({status: 201, json: {lot}});
      });
      await page.goto(`${base}/#lots`);
      const card = name => page.locator('.ma-card').filter({hasText: name});
      await card(legacy.name).getByText(/홍로 · 포천/).waitFor();
      await card(weatherLot.name).getByText(/홍로 · 포천/).waitFor();
      assert.doesNotMatch(await card(unknown.name).innerText(), /거창/);
      await card(legacy.name).click();
      await page.locator('.ma-title p').getByText(/홍로 · 포천/).waitFor();
      await page.locator('.ma-back').click();
      await page.getByRole('button', {name: '새 사과', exact: true}).click();
      await page.getByRole('button', {name: /직접 잰 값으로 시작/}).click();
      await page.locator('label').filter({has: page.locator('input[name="na-cultivar"][value="홍로"]')}).click();
      await page.locator('label').filter({has: page.locator('input[name="na-region-h"][value="pocheon"]')}).click();
      await page.locator('label').filter({has: page.locator('input[name="na-temp"][value="0"]')}).click();
      await page.locator('#na-harvest').fill('2026-09-15');
      await page.getByPlaceholder('예: 14.2').fill('14.3');
      const saved = page.waitForResponse(response => response.url().endsWith('/api/lots') && response.request().method() === 'POST');
      await page.getByRole('button', {name: '저장하기', exact: true}).click();
      const newLot = (await (await saved).json()).lot;
      await page.locator('.ma-title p').getByText(/홍로 · 포천/).waitFor();
      await page.locator('.ma-back').click();
      await card(newLot.name).getByText(/홍로 · 포천/).waitFor();
      await context.close();
      console.log(`✓ ${width}px 기존·신규 실측 홍로 생산지, 기상 홍로 및 산지 미확인 기록`);
    }
    for (const withArchived of [true, false]) {
      const archived = {...longLot, details: {archived_on: '2026-01-01'}};
      const {context, page} = await openContext(width, {initialLots: withArchived ? [archived] : []});
      await page.goto(`${base}/#lots`);
      if (withArchived) {
        await page.getByText('현재 보관 중인 사과가 없어요.', {exact: true}).waitFor();
        await page.getByRole('button', {name: '출하 완료 1개 보기'}).click();
        await page.getByRole('button', {name: /장기 보관 후지/}).click();
        await page.getByRole('heading', {name: archived.name, exact: true}).waitFor();
      } else {
        await page.getByText('아직 등록한 사과가 없어요.', {exact: true}).waitFor();
        await page.getByRole('button', {name: '첫 사과 등록하기'}).waitFor();
      }
      await context.close();
    }
    {
      const context = await browser.newContext({viewport: {width, height: 900}});
      await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(`${base}/try`);
      await page.getByRole('button', {name: '계산 근거', exact: true}).first().click();
      await page.getByText(/거창·청송·장수·영주·충주·군위·포천·화성 총 8곳/).waitFor();
      await page.getByText(/품종마다 지원 산지가 달라요\(후지 7곳, 홍로 6곳\)/).waitFor();
      await context.close();
      console.log(`✓ ${width}px 출하 완료와 첫 등록 빈 상태 분리, 공개 계산 근거 8곳 안내`);
    }
  }
} finally {
  await browser.close();
}
