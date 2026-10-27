import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAll, summarizeForm, summarizeLot} from '../lib/status-summary';
import {emptyForm} from '../lib/tracker-form';
import {demoLots} from '../lib/demo-lots';
import {predictQuality} from '../lib/quality-models';
import type {Lot, Observation} from '../lib/lot-types';

const text = (s: ReturnType<typeof summarizeForm>) => s.blocks.flatMap(b => [b.heading, ...b.items.map(i => i.text)]).join('\n');
const obs = (date: string, firmness: number | null, defects = '없음'): Observation => ({id: date, lot_id: 'x', date, firmness, brix: null, weight: null, acidity: null, defects, sample_count: 5, notes: ''});

function fuji() {
  const f = emptyForm();
  f.name = '1번 저장고'; f.variety = '후지'; f.intake_date = '2026-09-01'; f.sameStart = true;
  f.storage = '일반 저온'; f.mcp = '미처리'; f.firmness = '70'; f.brix = '14'; f.acidity = '0.4';
  return f;
}

test('lot status uses the latest measurement as the anchor and the shared model for today and +30 days', () => {
  const s = summarizeForm(fuji(), [obs('2026-10-01', 66)], '2026-10-27');
  const t = text(s);
  assert.match(s.sub, /저장 56일째/);
  assert.match(t, /경도 66\.0 N \(10월 1일 실측\) — 처음\(9월 1일 70\.0 N\)보다 4\.0 N 낮습니다/);
  const expected = predictQuality({cultivar: '후지', storage: 'cold', temperature: null, mcp: 'untreated', metric: 'firmness', day: 56, anchor: {day: 30, value: 66}});
  assert.ok(expected.ok);
  assert.ok(t.includes(`경도 ${expected.value!.toFixed(1)} N (10월 1일 측정값에서 이어서 계산)`));
  assert.match(t, /30일 뒤\(11월 26일\)/);
  assert.match(t, /마지막 측정이 26일 전/);
});

test('missing values are not invented and unsupported conditions are explained instead of calculated', () => {
  const f = fuji(); f.brix = ''; f.missing.brix = true; f.mcp = '미확인';
  const t = text(summarizeForm(f, [], '2026-10-27'));
  assert.doesNotMatch(t, /당도 \d/);
  assert.match(t, /당도은\(는\) 미측정/);
  assert.match(t, /계산은 하지 않았어요: 적용 모델 없음: 1-MCP 처리 여부가 미확인/);
  assert.doesNotMatch(t, /오늘\(/);
});

test('Hongro uses only supported temperatures and flags defects', () => {
  const f = emptyForm();
  f.name = '홍로'; f.variety = '홍로'; f.intake_date = '2026-09-10'; f.sameStart = true; f.storage = '일반 저온'; f.mcp = '미처리'; f.temperature = '2';
  f.hongro.initial = {firmness: '68', brix: '14', acidity: '0.3', weight: '', diameter: ''};
  const t2 = text(summarizeForm(f, [obs('2026-10-20', 62, '주름')], '2026-10-27'));
  assert.match(t2, /정확히 0℃·4℃만/);
  assert.match(t2, /외관 관찰: 주름/);
  f.temperature = '0';
  const t0 = text(summarizeForm(f, [], '2026-10-27'));
  assert.match(t0, /감모율 1\.01 % \(저장 시작일부터 계산\)/); // 0.0215 × 47일
  assert.match(t0, /경도 58\.9 N \(오늘보다 −3\.6 N\)/);
});

test('all-lot summary only restates stored values and names stale lots', () => {
  const lots: Lot[] = demoLots().map((l, i) => ({...l, name: `물량${i}`, intake_date: '2026-09-01', storage_start_date: null, latest_observation: i === 0 ? {date: '2026-10-25', firmness: 60, brix: 13, acidity: null} : null}));
  const t = text(summarizeAll(lots, '2026-10-27'));
  assert.match(t, /물량0 .*최근 측정 10월 25일 · 경도 60\.0 N, 당도 13\.0 °Brix/);
  assert.match(t, /물량1 .*입고 후 측정 기록 없음/);
  assert.match(t, /14일 넘게 측정 기록이 없어요: 물량1/);
  assert.ok(summarizeLot(lots[0], [], '2026-10-27').title.startsWith('물량0'));
});
