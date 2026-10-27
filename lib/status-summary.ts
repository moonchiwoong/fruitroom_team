// 현재 사과 상태 요약 — 외부 AI 없이, 저장된 기록과 기존 계산 엔진(lib/quality-models.ts)만으로 문장을 만듭니다.
// 없는 값은 만들지 않고, 실측·계산·날씨 기반 추정을 구분해 표시합니다. 출하·안전 판정이 아닙니다.
import type {Lot, Observation, Stats} from './lot-types';
import {formFromLot, firmnessToN, type TrackerForm} from './tracker-form';
import {isHongroVariety} from './cultivar';
import {calculateHongroForm} from './hongro-tracker';
import {predictQuality, type QualityInput} from './quality-models';
import {parseOptionalNumber} from './quality-policy';
import {addDays, daysBetween, describeChange, fmtNum, isDate, metricMeta, type MetricId} from './tracker';

export type StatusTone = 'ok' | 'warn' | 'info';
export type StatusItem = {tone: StatusTone; text: string};
export type StatusBlock = {heading: string; items: StatusItem[]};
export type StatusSummary = {title: string; sub: string; blocks: StatusBlock[]; note: string};

const QUALITY: MetricId[] = ['firmness', 'brix', 'acidity'];
const AHEAD = 30;
const STALE_DAYS = 14;
const NOTE = '기록과 시연용 계산식으로 만든 요약입니다. 출하 가능 여부나 안전성을 판정하지 않습니다.';

export const krDate = (s: string) => { const [, m, d] = s.split('-'); return `${Number(m)}월 ${Number(d)}일`; };
const num = (raw: string) => { const p = parseOptionalNumber(raw); return p.status === 'valid' ? p.value : null; };
const val = (m: MetricId, v: number) => `${fmtNum(v, metricMeta[m].digits)} ${metricMeta[m].unit}`;
const label = (m: MetricId) => metricMeta[m].label;

type Point = {value: number; date: string; kind: '실측' | '날씨 기반 추정'};

/** 저장된 물량(또는 입력 중인 양식)과 측정 기록으로 현재 상태 문장을 만듭니다. */
export function summarizeForm(form: TrackerForm, observations: Observation[], today: string, stats?: Stats | null, opts: {example?: boolean} = {}): StatusSummary {
  const hongro = isHongroVariety(form.variety);
  const start = form.sameStart ? form.intake_date : form.storage_start_date;
  const name = form.name.trim() || '이름 없는 물량';
  const variety = form.variety.trim() || '품종 미입력';
  const title = `${name} · ${variety}`;
  if (!isDate(start)) return {title, sub: '저장 시작일 미입력', blocks: [{heading: '지금 상태', items: [{tone: 'warn', text: '저장 시작일(입고일)이 없어 며칠째인지 계산할 수 없어요. 물량 정보에서 입고일을 먼저 넣어 주세요.'}]}], note: NOTE};

  const day = daysBetween(start, today);
  const temperature = num(form.temperature);
  const storage: QualityInput['storage'] = form.storage === '일반 저온' ? 'cold' : form.storage === 'CA' ? 'ca' : 'other';
  const mcp: QualityInput['mcp'] = form.mcp === '처리' ? 'treated' : form.mcp === '미처리' ? 'untreated' : 'unknown';
  const cond = [form.storage || '저장 방식 미입력', temperature !== null ? `${fmtNum(temperature, temperature % 1 ? 1 : 0)}℃` : null, `1-MCP ${form.mcp || '미확인'}`].filter(Boolean).join(' · ');
  const sub = day >= 0 ? `저장 ${day}일째 · ${cond}` : `저장 시작 ${-day}일 전 · ${cond}`;

  // ── 초기값: 실측 입력 또는 날씨 기반 추정. 미측정·빈칸은 비워 둡니다.
  const measuredOn = isDate(form.initial_measured_on) ? form.initial_measured_on : start;
  const initial: Partial<Record<MetricId, Point>> = {};
  if (hongro && form.hongro.source === 'weather') {
    try {
      const r = calculateHongroForm(form.hongro, 0);
      for (const m of QUALITY) { const v = r.initial[m as 'firmness' | 'brix' | 'acidity']; if (typeof v === 'number' && Number.isFinite(v)) initial[m] = {value: v, date: start, kind: '날씨 기반 추정'}; }
    } catch { /* 날씨 항목이 비어 있으면 추정하지 않습니다. */ }
  } else {
    for (const m of QUALITY) {
      if ((m === 'firmness' || m === 'brix') && form.missing[m]) continue;
      const raw = hongro ? form.hongro.initial[m as 'firmness' | 'brix' | 'acidity'] : form[m as 'firmness' | 'brix' | 'acidity'];
      const v = m === 'firmness' ? firmnessToN(raw, form.firmness_unit) : num(raw);
      if (v !== null) initial[m] = {value: v, date: measuredOn, kind: '실측'};
    }
  }

  // ── 측정 기록: 저장 시작일 ~ 오늘 사이만 사용합니다.
  const obs = observations.filter(o => isDate(o.date) && o.date >= start && o.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const latest: Partial<Record<MetricId, Point>> = {};
  for (const m of QUALITY) {
    const o = [...obs].reverse().find(x => typeof x[m as 'firmness' | 'brix' | 'acidity'] === 'number');
    if (o) latest[m] = {value: o[m as 'firmness' | 'brix' | 'acidity'] as number, date: o.date, kind: '실측'};
  }

  const now: StatusItem[] = [], calc: StatusItem[] = [], ahead: StatusItem[] = [], check: StatusItem[] = [];
  const input = (m: MetricId, d: number, anchor: Point | undefined): QualityInput => ({
    cultivar: form.variety, storage, temperature, mcp, metric: m, day: d, allowFujiReference: false,
    anchor: m === 'loss' ? null : anchor ? {day: Math.max(0, daysBetween(start, anchor.date)), value: anchor.value} : null,
  });

  // 1) 지금 상태: 최근 측정(없으면 초기값)과 처음 대비 변화
  for (const m of QUALITY) {
    const first = initial[m], last = latest[m];
    if (last) {
      const change = first && first.date < last.date ? ` — 처음(${krDate(first.date)} ${val(m, first.value)})보다 ${describeChange(m, last.value, first.value).text}` : '';
      now.push({tone: 'ok', text: `${label(m)} ${val(m, last.value)} (${krDate(last.date)} 실측)${change}.`});
    } else if (first) {
      now.push({tone: 'info', text: `${label(m)} ${val(m, first.value)} (${krDate(first.date)} ${first.kind === '실측' ? '초기 실측' : '날씨 기반 추정'}) — 입고 뒤 다시 잰 기록은 없어요.`});
    }
  }
  if (!now.length) now.push({tone: 'warn', text: '경도·당도·산도 값이 아직 하나도 없어요. 초기값이나 오늘 측정값을 기록하면 상태를 알려 드릴 수 있어요.'});

  // 2) 오늘 계산값 / 3) 30일 뒤 계산값 — 가장 최근 값에서 이어서 계산합니다.
  if (day >= 0) {
    const reasons = new Set<string>();
    for (const m of [...QUALITY, 'loss'] as MetricId[]) {
      const anchor = latest[m] ?? initial[m];
      if (m !== 'loss' && !anchor) continue;
      const from = m === 'loss' ? '저장 시작일부터' : `${krDate(anchor!.date)} ${anchor!.kind === '실측' ? '측정값' : '추정값'}에서 이어서`;
      let base: number | null = m === 'loss' ? null : anchor!.value;
      if (m === 'loss' || anchor!.date < today) {
        const r = predictQuality(input(m, day, anchor));
        if (r.ok && r.value !== null) { base = r.value; calc.push({tone: 'ok', text: `${label(m)} ${val(m, r.value)} (${from} 계산)`}); }
        else if (r.reason) reasons.add(r.reason);
      }
      const r2 = predictQuality(input(m, day + AHEAD, anchor));
      if (r2.ok && r2.value !== null) {
        const c = base !== null ? describeChange(m, r2.value, base) : null;
        ahead.push({tone: 'ok', text: `${label(m)} ${val(m, r2.value)}${c ? ` (오늘보다 ${c.diff === 0 ? '변화 없음' : c.short})` : ''}`});
      } else if (r2.reason) reasons.add(r2.reason);
    }
    if (!calc.length && !ahead.length && reasons.size) check.push({tone: 'info', text: `계산은 하지 않았어요: ${[...reasons][0]}`});
    else if (reasons.size && ahead.length < calc.length) check.push({tone: 'info', text: `30일 뒤 일부 값은 계산하지 않았어요: ${[...reasons].at(-1)}`});
  }

  // 4) 챙겨볼 점
  if (!opts.example) {
    const lastObs = obs.at(-1);
    if (!lastObs) { if (day >= STALE_DAYS) check.push({tone: 'warn', text: `입고 후 ${day}일 동안 측정 기록이 없어요. 오늘 측정값을 한 번 기록해 보세요.`}); }
    else {
      const gap = daysBetween(lastObs.date, today);
      if (gap >= STALE_DAYS) check.push({tone: 'warn', text: `마지막 측정이 ${gap}일 전(${krDate(lastObs.date)})이에요. 오늘 측정값을 기록하면 최근 상태에서 다시 계산할 수 있어요.`});
      if (lastObs.defects && !['없음', '미확인'].includes(lastObs.defects)) check.push({tone: 'warn', text: `${krDate(lastObs.date)} 외관 관찰: ${lastObs.defects}. 해당 표본을 한 번 더 살펴보세요.`});
    }
  }
  const notMeasured = (['firmness', 'brix'] as const).filter(m => form.missing[m] && !latest[m]).map(label);
  if (notMeasured.length) check.push({tone: 'info', text: `${notMeasured.join('·')}은(는) 미측정으로 기록돼 계산하지 않았어요.`});
  if (stats) {
    if (!stats.count) check.push({tone: 'info', text: '저장고 온습도 기록이 없어요. 센서 기록을 올리면 보관 환경을 함께 볼 수 있어요.'});
    else {
      const t = stats.meanTemperature !== null ? `평균 ${fmtNum(stats.meanTemperature, 1)}℃` : '';
      const h = stats.meanHumidity !== null ? `습도 ${fmtNum(stats.meanHumidity, 0)}%` : '';
      check.push({tone: stats.outOfRangeHours > 0 ? 'warn' : 'ok', text: `저장고 ${[t, h].filter(Boolean).join(' · ')}${stats.outOfRangeHours > 0 ? `, 참고 범위(−1~1℃·90~95%)를 벗어난 시간 ${fmtNum(stats.outOfRangeHours, 1)}시간` : ', 참고 범위 안에서 기록됨'}. 온습도는 계산에 반영하지 않아요.`});
      if (stats.stale) check.push({tone: 'warn', text: '최근 24시간 안의 센서 기록이 없어요. 센서 연결을 확인해 보세요.'});
    }
  }
  if (!check.length) check.push({tone: 'ok', text: '지금 따로 챙길 기록 문제는 보이지 않아요.'});

  const blocks: StatusBlock[] = [{heading: '지금 상태', items: now}];
  if (calc.length) blocks.push({heading: `오늘(${krDate(today)}) 계산값`, items: calc});
  if (ahead.length) blocks.push({heading: `${AHEAD}일 뒤(${krDate(addDays(today, AHEAD))}) 계산값 · 지금 조건 유지 시`, items: ahead});
  blocks.push({heading: '챙겨볼 점', items: check});
  return {title, sub, blocks, note: opts.example ? `예시 값으로 만든 요약입니다. ${NOTE}` : NOTE};
}

export function summarizeLot(lot: Lot, observations: Observation[], today: string, stats?: Stats | null): StatusSummary {
  return summarizeForm(formFromLot(lot), observations, today, stats);
}

/** 내 전체 사과: 목록에 이미 있는 값(최근 측정)만으로 한 줄씩 요약합니다. */
export function summarizeAll(lots: Lot[], today: string): StatusSummary {
  if (!lots.length) return {title: '내 전체 사과', sub: '등록된 물량 없음', blocks: [{heading: '지금 상태', items: [{tone: 'info', text: '아직 기록한 사과가 없어요. 품질 예측 화면에서 첫 물량을 저장해 보세요.'}]}], note: NOTE};
  const items: StatusItem[] = [], stale: string[] = [];
  for (const l of lots) {
    const start = l.storage_start_date || l.intake_date;
    const day = isDate(start) ? daysBetween(start, today) : null;
    const o = l.latest_observation;
    const lastDate = o?.date ?? null;
    const parts = [day !== null && day >= 0 ? `저장 ${day}일째` : null];
    if (o) {
      const vals = (['firmness', 'brix'] as const).filter(m => typeof o[m] === 'number').map(m => `${label(m)} ${val(m, o[m] as number)}`);
      parts.push(`최근 측정 ${krDate(o.date)}${vals.length ? ` · ${vals.join(', ')}` : ''}`);
    } else parts.push('입고 후 측정 기록 없음');
    const gap = lastDate ? daysBetween(lastDate, today) : day;
    const isStale = gap !== null && gap >= STALE_DAYS;
    if (isStale) stale.push(l.name);
    items.push({tone: isStale ? 'warn' : 'ok', text: `${l.name} (${l.variety || '품종 미입력'}) — ${parts.filter(Boolean).join(' · ')}`});
  }
  const check: StatusItem[] = stale.length
    ? [{tone: 'warn', text: `${stale.length}개 물량은 ${STALE_DAYS}일 넘게 측정 기록이 없어요: ${stale.slice(0, 4).join(', ')}${stale.length > 4 ? ' 외' : ''}.`}]
    : [{tone: 'ok', text: `모든 물량이 최근 ${STALE_DAYS}일 안에 측정됐어요.`}];
  check.push({tone: 'info', text: '물량을 하나 고르면 오늘 계산값과 30일 뒤 계산값까지 알려 드려요.'});
  return {title: '내 전체 사과', sub: `물량 ${lots.length}개`, blocks: [{heading: '물량별 지금 상태', items}, {heading: '챙겨볼 점', items: check}], note: NOTE};
}
