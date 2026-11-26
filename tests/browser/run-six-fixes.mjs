// 6개 수정 회귀 검증(가상 기록만 사용, 모든 데이터 요청은 fixture가 가로챔).
// 1 같은 날 실측·로딩·오류·늦은 응답 / (2 출하 비교는 기능 삭제로 제외) / 3 날짜 기준 / 4 체험 안내 / 5 안내 버튼 이름 / 6 상세 주소
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {installFixtures, lots, today} from '../fixtures/browser-fixtures.mjs';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const base = 'http://127.0.0.1:3000';
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const md = d => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`, mds = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`; // 출하 비교는 ‘○월 ○일’, 품질 날짜 줄은 기존 ‘월/일’ 표기

// 재현 기록: 후지·일반 저온·1-MCP 미처리, 수확일=저장 시작일=오늘, 처음 단단함 60.0 N
const T0 = {...lots[0], id: '77777777-7777-4777-8777-777777777777', name: '[검증] 오늘 시작 후지', harvest_date: today, intake_date: today, storage_start_date: today, initial_measured_on: today,
  firmness: 60, brix: 13.5, acidity: 0.4, weight: null, observation_count: 1, latest_observation: {date: today, firmness: 55, brix: null, acidity: null, defects: ''},
  details: {initial_same_start: true, firmness_input: {value: 60, unit: 'N'}}};
const caseLots = [T0, ...lots];
const sameDay = value => value.lot.id === T0.id ? {...value, observations: [{id: '88888888-8888-4888-8888-888888888888', lot_id: T0.id, date: today, firmness: 55, brix: null, acidity: null, weight: null, defects: '', sample_count: 5, notes: '', details: {}}]} : value;

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox']});
const results = [], errors = [];
const ok = (name, detail = '') => { results.push({name, ok: true, detail}); console.log('✓', name, detail); };
async function ctxFor(width, opts = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
  const req = await installFixtures(context, {initialLots: caseLots, analysisTransform: sameDay, ...opts});
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  return {context, page, req};
}
const show = (label, text) => console.log(`    └ ${label}: ${String(text).replace(/\s+/g, ' ').trim().slice(0, 160)}`);
const bodyHas = async (page, re) => re.test(await page.locator('main').innerText());

try {
  for (const width of [1366, 388]) {
    const tag = `${width}px`;
    // ---- 1. 지연 응답 동안 임시 수치 없음 → 응답 후 55.0 N·실측, 30일 뒤 54.6 N
    {
      const {context, page} = await ctxFor(width, {delayAnalysisMs: 2500});
      await page.goto(`${base}/#home`);
      await page.locator('.hs-table tr:visible, .hs-apple:visible').first().waitFor();
      const pick = page.locator('.hs-table tr:visible, .hs-apple:visible').filter({hasText: T0.name}).first(); await pick.click();
      await page.getByText('측정 기록 확인 중…').first().waitFor();
      assert.ok(!(await bodyHas(page, /60\.0\s*N|59\.6/)), '요약 로딩 중 임시 60.0/59.6');
      show('요약 로딩 중 숫자 검색(60.0 N|59.6)', (await page.locator('main').innerText()).match(/60\.0\s*N|59\.6/) ?? '없음');
      await page.locator('.hs-metric').first().waitFor({timeout: 10000});
      const card = await page.locator('.hs-metric').first().innerText();
      assert.match(card, /55\.0/); assert.match(card, /오늘 실측/);
      show('요약 카드', card);
      ok(`${tag} 1 요약: 로딩 중 임시값 없음 → 55.0 N 오늘 실측`);
      await page.locator('.hs-sec .hs-link').filter({hasText: '자세히'}).first().click();
      await page.waitForURL(new RegExp(`#lot/${T0.id}`));
      await page.getByText('측정 기록 확인 중…').first().waitFor();
      assert.ok(!(await bodyHas(page, /60\.0\s*N|59\.6/)), '상세 로딩 중 임시 60.0/59.6');
      show('상세 로딩 중 숫자 검색(60.0 N|59.6)', (await page.locator('main').innerText()).match(/60\.0\s*N|59\.6/) ?? '없음');
      await page.locator('.ma-row').filter({hasText: '이날 실측'}).first().waitFor({timeout: 10000});
      const row = await page.locator('.ma-row').first().innerText();
      assert.match(row, /55\.0 N/); assert.match(row, /이날 실측/);
      const brixRow = await page.locator('.ma-row').filter({hasText: '단맛'}).innerText(); assert.ok(!/실측/.test(brixRow), '단맛은 실측 아님');
      show('상세 단단함 행', row); show('단맛 행', brixRow);
      await page.locator('.ma-days button').filter({hasText: /^30일$/}).click();
      const row30 = await page.locator('.ma-row').first().innerText(); show('30일째 단단함 행', row30);
      assert.match(row30, /54\.6 N/);
      ok(`${tag} 1 상세: 55.0 N 이날 실측 · 30일째 54.6 N · 단맛 출처 계산`);
      const shipLeft = (await page.locator('#ship-compare').count()) + ((await page.locator('main').innerText()).match(/출하 조건 비교|원\/kg/g)?.length ?? 0);
      show('상세의 출하 비교 흔적 수', shipLeft); assert.equal(shipLeft, 0);
      assert.equal(await page.getByRole('button', {name: '캘린더에 추가', exact: true}).count(), 0);
      assert.ok(await page.getByRole('region', {name: '목표 저장일'}).isVisible());
      assert.ok(await page.getByRole('button', {name: '측정 추가', exact: true}).isVisible());
      ok(`${tag} 캘린더 버튼 제거 · 권장 측정일과 측정 추가 표시`);
      // ---- 6. 새로고침·뒤로 가기·직접 열기
      const urlBefore = page.url(); await page.reload(); await page.locator('.ma-detail h1').waitFor();
      show('새로고침 전/후 주소', `${new URL(urlBefore).hash} → ${new URL(page.url()).hash}`); show('새로고침 후 제목', await page.locator('.ma-detail h1').innerText());
      assert.equal(await page.locator('.ma-detail h1').innerText(), T0.name);
      await page.goBack(); await page.waitForURL(/#(lots|home)$/); show('뒤로 가기 후 주소', new URL(page.url()).hash);
      await page.locator('.ma-detail').waitFor({state: 'detached', timeout: 5000});
      ok(`${tag} 6 상세 새로고침 같은 기록 · 뒤로 가기 목록`);
      await context.close();
    }
    // ---- 1. 조회 실패: 실측 라벨 없음 + 오류 안내 / 늦은 이전 응답이 덮어쓰지 않음
    {
      const {context, page} = await ctxFor(width);
      await context.route(/\/api\/lots\/[^/]+\/analysis/, r => r.fulfill({status: 500, contentType: 'application/json', body: '{"error":"테스트 실패"}'}));
      await page.goto(`${base}/#lot/${T0.id}`); await page.locator('.ma-detail h1').waitFor();
      await page.getByRole('alert').filter({hasText: '측정 기록을 불러오지 못해'}).waitFor();
      show('조회 실패 안내', await page.getByRole('alert').filter({hasText: '측정 기록을 불러오지 못해'}).innerText()); show('조회 실패 시 단단함 행', await page.locator('.ma-row').first().innerText());
      assert.ok(!(await page.locator('.ma-row').first().innerText()).includes('실측'));
      ok(`${tag} 1 조회 실패: 오류 안내, 계산값에 실측 라벨 없음 (직접 주소 열기)`);
      await context.close();
    }
    {
      const {context, page} = await ctxFor(width);
      await page.goto(`${base}/#lot/does-not-exist`);
      await page.getByRole('alert').filter({hasText: '찾을 수 없어요'}).waitFor();
      ok(`${tag} 6 없는 기록 주소: 목록에서 안내`);
      // 늦은 응답: T0 응답을 붙잡아 둔 채 다른 사과로 바꾼 뒤 풀어도 덮어쓰지 않음
      let held = null;
      await context.route(new RegExp(`/api/lots/${T0.id}/analysis`), r => { held = r; });
      await page.goto(`${base}/#home`); await page.locator('.hs-table tr:visible, .hs-apple:visible').filter({hasText: T0.name}).first().click();
      await page.locator('.hs-table tr:visible, .hs-apple:visible').filter({hasText: lots[0].name}).first().click();
      await page.locator('.hs-metric').first().waitFor();
      const before = await page.locator('.hs-metric').first().innerText();
      for (let i = 0; i < 30 && !held; i++) await page.waitForTimeout(100);
      if (held) await held.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({observations: [{id: 'late', lot_id: T0.id, date: today, firmness: 1, brix: null, acidity: null}]})});
      await page.waitForTimeout(800);
      show('늦은 응답 전/후 카드 동일', `${before === await page.locator('.hs-metric').first().innerText()}`);
      assert.equal(await page.locator('.hs-metric').first().innerText(), before);
      ok(`${tag} 1 늦게 온 이전 사과 응답이 화면을 덮지 않음`);
      await context.close();
    }
    // ---- 3. 저장 시작일 ≠ 오늘(기존 예시: 28일 전 시작)
    {
      const {context, page} = await ctxFor(width);
      await page.goto(`${base}/#lot/${lots[0].id}`); await page.locator('.ma-days').first().waitFor();
      const start = shift(today, -28);
      await page.locator('.ma-days button').filter({hasText: /^30일$/}).click();
      assert.match(await page.locator('.ma-date').innerText(), new RegExp(`${mds(shift(start, 30))} 기준 \\(저장 30일째\\)`));
      assert.match(await page.locator('.ma-daybasis').innerText(), new RegExp(`저장 시작일\\(${mds(start)}\\)부터`));
      ok(`${tag} 3 시작일≠오늘: 품질 30일=${md(shift(start, 30))}(저장 30일째), 버튼 기준 안내`);
      // ---- 5. 안내 버튼 접근성 이름 + 키보드 열고 닫기
      const guide = page.getByRole('button', {name: '안내', exact: true}).first();
      show('안내 버튼 접근성 이름', await guide.getAttribute('aria-label'));
      await guide.focus(); await page.keyboard.press('Enter');
      await page.getByRole('dialog', {name: '애플트랙 사용 안내'}).waitFor();
      assert.match(await page.getByRole('dialog').innerText(), /저장 시작일부터/);
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state: 'detached'});
      ok(`${tag} 5 ‘안내’ 이름으로 찾기·Enter 열기·Esc 닫기 · 3 안내 문구`);
      await context.close();
    }
    // ---- 4. 공개 체험: 지역으로 시작 안내
    {
      const context = await browser.newContext({viewport: {width, height: 900}, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce'});
      await context.route('https://review.supabase.co/**', r => r.fulfill({status: 401, contentType: 'application/json', body: '{}'}));
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/try`);
      show('체험 화면 출하 비교 흔적 수', await page.locator('#ship-compare').count()); assert.equal(await page.locator('#ship-compare').count(), 0);
      await page.getByRole('tab', {name: '내 사과로 해 보기'}).click();
      await page.getByText('지역으로 시작').first().click();
      const hint = page.locator('.na-guest-hint');
      show('산지 선택 전 안내', await hint.innerText());
      assert.match(await hint.innerText(), /생산지를 먼저/); assert.ok(!/저장고 온도/.test(await hint.innerText()));
      await page.locator('.rmp-chips button').filter({hasText: '청송'}).click();
      show('청송 선택 후 안내', await hint.innerText());
      assert.match(await hint.innerText(), /보관 방식·1-MCP/); assert.ok(!/저장고 온도/.test(await hint.innerText()));
      await page.locator('.rmp-chips button').filter({hasText: '거창'}).click();
      show('거창 선택 후 안내', await hint.innerText());
      assert.match(await hint.innerText(), /저장고 온도/); assert.ok(!/1-MCP/.test(await hint.innerText()));
      ok(`${tag} 4 체험 안내: 산지 전 → 청송(후지: 보관 방식·1-MCP) → 거창(홍로: 저장고 온도)`);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('./artifacts/six-fixes.json', import.meta.url), JSON.stringify({results, errors}, null, 2)).catch(() => {});
  await browser.close();
}
