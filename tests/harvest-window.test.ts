import test from 'node:test';
import assert from 'node:assert/strict';
import {harvestCultivar, harvestMonthError} from '../lib/harvest-window';
import {createLot, cleanDetails} from '../lib/lot-server';
import {InputError} from '../lib/lot-analysis';
import {emptyForm, payloadFromForm, validateForm} from '../lib/tracker-form';

test('품종 판별: 홍로·후지(부사·Fuji 포함)만 수확 달을 확인하고 그 밖의 품종은 제한하지 않음', () => {
  assert.equal(harvestCultivar('홍로'), 'hongro');
  assert.equal(harvestCultivar('후지'), 'fuji');
  assert.equal(harvestCultivar('미얀마 후지'), 'fuji');
  assert.equal(harvestCultivar('부사'), 'fuji');
  assert.equal(harvestCultivar('Fuji'), 'fuji');
  assert.equal(harvestCultivar('시나노골드'), null);
  assert.equal(harvestMonthError('시나노골드', '2026-03-10'), null);
});

test('홍로 8~10월, 후지 10~11월: 경계 달은 허용하고 3월 같은 날짜는 막음', () => {
  for (const d of ['2026-08-01', '2026-09-15', '2026-10-31']) assert.equal(harvestMonthError('홍로', d), null, d);
  for (const d of ['2026-03-10', '2026-07-31', '2026-11-01']) assert.match(harvestMonthError('홍로', d) ?? '', /홍로는 8~10월/, d);
  for (const d of ['2026-10-01', '2026-11-30']) assert.equal(harvestMonthError('후지', d), null, d);
  for (const d of ['2026-03-10', '2026-09-30', '2026-12-01']) assert.match(harvestMonthError('후지', d) ?? '', /후지는 10~11월/, d);
  assert.equal(harvestMonthError('후지', ''), null);
});

test('저장 전 검사(validateForm)는 범위 밖 수확일을 막고, 화면 미리보기 검사는 막지 않음', () => {
  const f = emptyForm(); f.variety = '후지'; f.name = '검사'; f.harvest_date = '2025-03-10'; f.intake_date = '2025-11-01'; f.storage_start_date = '2025-11-01';
  assert.match(validateForm(f, true).harvest_date ?? '', /후지는 10~11월/);
  assert.equal(validateForm(f, false).harvest_date, undefined);
  f.harvest_date = '2025-10-28';
  assert.equal(validateForm(f, true).harvest_date, undefined);
});

const request = (body: unknown) => new Request('https://fruitroom.example/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});

test('서버 등록도 범위 밖 수확일을 데이터베이스 접근 전에 거절함', async () => {
  const f = emptyForm(); f.variety = '후지'; f.name = '서버 검사'; f.harvest_date = '2025-03-10'; f.intake_date = '2025-11-01'; f.storage_start_date = '2025-11-01';
  const p = payloadFromForm(f);
  cleanDetails(p.details);
  await assert.rejects(() => createLot(request(p)), e => e instanceof InputError && /후지는 10~11월/.test(e.message));
});
