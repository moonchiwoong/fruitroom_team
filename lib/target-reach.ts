// 농가가 정한 단단함 기준(‘내 기준’)에 계산상 언제 닿는지. 오늘(또는 저장 시작)부터 계산 범위 안에서만 찾고, 없으면 날짜를 만들지 않습니다.
import type {lotPredictor} from '@/lib/lot-predict';
import {addDays, type MetricId} from '@/lib/tracker';

export type Reach = {kind: 'at'; day: number; date: string | null; inDays: number | null} | {kind: 'already'} | {kind: 'none'; maxDay: number} | {kind: 'na'};

/** 한 항목의 계산값이 기준 아래로 처음 내려가는 날(오늘 또는 저장 시작부터). */
export function metricReach(p: ReturnType<typeof lotPredictor>, m: MetricId, target: number | null | undefined, maxDay: number): Reach {
  if (!(typeof target === 'number' && Number.isFinite(target) && target > 0)) return {kind: 'na'};
  const from = p.todayDay !== null && p.todayDay >= 0 ? Math.min(p.todayDay, maxDay) : 0;
  const now = p.at(m, from);
  if (!now.ok) return {kind: 'na'};
  if (now.value < target || (m === 'firmness' && now.value <= target)) return {kind: 'already'};
  for (let d = from + 1; d <= maxDay; d++) { const r = p.at(m, d); if (r.ok && (m === 'firmness' ? r.value <= target : r.value < target)) return {kind: 'at', day: d, date: p.start ? addDays(p.start, d) : null, inDays: p.todayDay !== null && p.todayDay >= 0 ? d - p.todayDay : null}; }
  return {kind: 'none', maxDay};
}

export const firmnessReach = (p: ReturnType<typeof lotPredictor>, target: number | null | undefined, maxDay: number) => metricReach(p, 'firmness', target, maxDay);

/** 소비자 선호 당도 하한선 도달 안내(범례 옆 짧은 문구). */
export function prefReachText(r: Reach, min: number): string | null {
  const md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  if (r.kind === 'at') return `${r.inDays !== null ? `오늘부터 ${r.inDays}일 뒤` : `저장 ${r.day}일째`}${r.date ? `(${md(r.date)}쯤)` : ''} ${min} °Brix 아래로 내려가요`;
  if (r.kind === 'already') return `계산상 이미 ${min} °Brix보다 낮아요`;
  if (r.kind === 'none') return `${r.maxDay}일 안에는 ${min} °Brix 아래로 내려가지 않아요`;
  return null;
}

export function reachText(r: Reach, target: number): string | null {
  const md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  if (r.kind === 'at') return `계산상 저장 ${r.day}일째${r.date ? `(${md(r.date)}쯤)` : ''} 내 기준 ${target} N에 닿아요${r.inDays !== null ? ` · 오늘부터 ${r.inDays}일 뒤` : ''}`;
  if (r.kind === 'already') return `계산상 이미 내 기준 ${target} N보다 낮아요`;
  if (r.kind === 'none') return `계산 범위(${r.maxDay}일) 안에서는 내 기준 ${target} N에 닿지 않아요`;
  return null;
}
