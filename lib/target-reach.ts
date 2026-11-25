// 농가가 정한 단단함 기준(‘내 기준’)에 계산상 언제 닿는지. 오늘(또는 저장 시작)부터 계산 범위 안에서만 찾고, 없으면 날짜를 만들지 않습니다.
import type {lotPredictor} from '@/lib/lot-predict';
import {addDays} from '@/lib/tracker';

export type Reach = {kind: 'at'; day: number; date: string | null; inDays: number | null} | {kind: 'already'} | {kind: 'none'; maxDay: number} | {kind: 'na'};

export function firmnessReach(p: ReturnType<typeof lotPredictor>, target: number | null | undefined, maxDay: number): Reach {
  if (!(typeof target === 'number' && Number.isFinite(target) && target > 0)) return {kind: 'na'};
  const from = p.todayDay !== null && p.todayDay >= 0 ? Math.min(p.todayDay, maxDay) : 0;
  const now = p.at('firmness', from);
  if (!now.ok) return {kind: 'na'};
  if (now.value <= target) return {kind: 'already'};
  for (let d = from + 1; d <= maxDay; d++) { const r = p.at('firmness', d); if (r.ok && r.value <= target) return {kind: 'at', day: d, date: p.start ? addDays(p.start, d) : null, inDays: p.todayDay !== null && p.todayDay >= 0 ? d - p.todayDay : null}; }
  return {kind: 'none', maxDay};
}

export function reachText(r: Reach, target: number): string | null {
  const md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  if (r.kind === 'at') return `계산상 저장 ${r.day}일째${r.date ? `(${md(r.date)}쯤)` : ''} 내 기준 ${target} N에 닿아요${r.inDays !== null ? ` · 오늘부터 ${r.inDays}일 뒤` : ''}`;
  if (r.kind === 'already') return `계산상 이미 내 기준 ${target} N보다 낮아요`;
  if (r.kind === 'none') return `계산 범위(${r.maxDay}일) 안에서는 내 기준 ${target} N에 닿지 않아요`;
  return null;
}
