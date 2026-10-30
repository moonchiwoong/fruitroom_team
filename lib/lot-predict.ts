// ‘내 사과’ 화면용: 저장된 물량 하나를 기존 예측식(quality-models)으로 계산합니다.
// 새 식이나 보정은 없습니다. 품질 예측 화면과 같은 입력(품종·보관·온도·1-MCP·초기값)을 씁니다.
// 같은 항목을 초기값 이후에 직접 잰 기록이 있으면, 가장 최근 측정값에서 이어 계산합니다(식은 그대로, 출발점만 바뀜).
import type {Lot, Observation} from './lot-types';
import {formFromLot, firmnessToN, effectiveInitialMeasuredOn} from './tracker-form';
import {predictQuality} from './quality-models';
import {calculateHongroForm} from './hongro-tracker';
import {isHongroVariety} from './cultivar';
import {daysBetween, isDate, fmtNum, metricMeta, todayKST, type MetricId} from './tracker';
import {storageStart} from './lot-readiness';

export const EASY_LABEL: Record<MetricId, string> = {firmness: '단단함', brix: '단맛(당도)', acidity: '신맛(산도)', loss: '무게 감소'};
export const EASY_METRICS: MetricId[] = ['firmness', 'loss', 'brix', 'acidity'];

/** 처음 값 대비 변화를 반올림해 ‘약’으로 표현합니다. 판정이 아니라 계산값의 표현입니다. */
export function easyChange(m: MetricId, value: number, first: number | null): string {
  if (m === 'loss') return `약 ${fmtNum(value, 1)}% 줄어듦`;
  if (first === null || !Number.isFinite(first) || first === 0) return fmtNum(value, metricMeta[m].digits);
  const rel = (value - first) / first * 100;
  if (Math.abs(rel) < 0.5) return '처음과 비슷';
  const pct = Math.max(1, Math.round(Math.abs(rel)));
  return `처음보다 약 ${pct}% ${m === 'firmness' ? (rel < 0 ? '물러짐' : '단단해짐') : rel < 0 ? '낮아짐' : '높아짐'}`;
}

const num = (s: unknown) => { const t = String(s ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

export type LotPoint = {ok: true; value: number; first: number | null; from: 'initial' | 'measured' | 'weather' | 'model'} | {ok: false; reason: string};

export function lotPredictor(lot: Lot, observations: Observation[] = []) {
  const form = formFromLot(lot);
  const hongro = isHongroVariety(form.variety);
  const start = storageStart(lot);
  const weather = hongro && form.hongro.source === 'weather';
  const measuredOn = effectiveInitialMeasuredOn(form);
  let initial: Record<'firmness' | 'brix' | 'acidity', number | null> = {firmness: null, brix: null, acidity: null};
  if (weather) {
    try { const r = calculateHongroForm(form.hongro, 0); initial = {firmness: r.initial.firmness, brix: r.initial.brix, acidity: r.initial.acidity}; } catch { /* 날씨 값이 없으면 계산하지 않음 */ }
  } else {
    const src = hongro ? form.hongro.initial : form;
    initial = {firmness: form.missing.firmness ? null : firmnessToN(String(src.firmness ?? ''), form.firmness_unit), brix: form.missing.brix ? null : num(src.brix), acidity: form.missing.acidity ? null : num(src.acidity)};
  }
  const t0 = !isDate(start) ? null : weather ? 0 : isDate(measuredOn) ? daysBetween(start, measuredOn) : null;
  const baseDate = weather ? start : measuredOn;
  const latest = (m: 'firmness' | 'brix' | 'acidity') => [...observations]
    .filter(o => o[m] !== null && o[m] !== undefined && isDate(o.date) && (!isDate(baseDate) || o.date > baseDate))
    .sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null;
  const todayDay = isDate(start) ? daysBetween(start, todayKST()) : null;

  function at(m: MetricId, day: number): LotPoint {
    if (!isDate(start)) return {ok: false, reason: '저장 시작일이 없어요.'};
    const base = {cultivar: form.variety, storage: (form.storage === '일반 저온' ? 'cold' : form.storage === 'CA' ? 'ca' : 'other') as 'cold' | 'ca' | 'other',
      temperature: num(form.temperature), mcp: (form.mcp === '처리' ? 'treated' : form.mcp === '미처리' ? 'untreated' : 'unknown') as 'treated' | 'untreated' | 'unknown',
      metric: m, day, allowFujiReference: false};
    if (m === 'loss') { const r = predictQuality({...base, anchor: {day: 0, value: 0}}); return r.ok && r.value !== null ? {ok: true, value: r.value, first: 0, from: 'model'} : {ok: false, reason: r.reason || '계산할 수 없어요.'}; }
    const obs = latest(m), first = initial[m];
    const anchor = obs ? {day: daysBetween(start, obs.date), value: obs[m] as number} : first !== null && t0 !== null ? {day: t0, value: first} : null;
    if (!anchor) return {ok: false, reason: '처음 측정값이 있어야 계산돼요.'};
    if (day < anchor.day) return {ok: false, reason: '측정일 이전이에요.'};
    const r = predictQuality({...base, anchor});
    return r.ok && r.value !== null ? {ok: true, value: r.value, first: first ?? anchor.value, from: obs ? 'measured' : weather ? 'weather' : 'initial'} : {ok: false, reason: (r.reason || '계산할 수 없어요.').replace(/^적용 모델 없음:\s*/, '')};
  }
  return {start, todayDay, weather, at};
}
