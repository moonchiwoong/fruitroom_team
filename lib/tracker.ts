// 애플트랙 계산 엔진 — 화면과 분리된 순수 함수만 둡니다.
// 저장 중 변화식·출처·버전은 lib/quality-models.ts의 공통 모델 레지스트리를 사용합니다.
// 수식·계수를 임의로 보정하지 않으며, 검증 자료가 확인되지 않아 모든 계산은 "시연용 계산"으로 표시합니다.
import type {StorageId} from './initial-quality';
import {predictQuality, normalizeQualityCultivar, QUALITY_MODEL_VERSION, type PredictionResult} from './quality-models';
import {isHongroVariety, HONGRO_DEDICATED_NOTICE} from './cultivar';
import {allowModelMetric, isCalendarDate, trackedLoss, parseOptionalNumber} from './quality-policy';

// ─────────────────────────────── 날짜 ───────────────────────────────
// 날짜는 'YYYY-MM-DD' 문자열로만 다룹니다. UTC 자정 기준으로 계산해 시간대·서머타임 때문에 하루가 어긋나지 않습니다.
const DAY = 86400000;
export function isDate(s: unknown): s is string { return isCalendarDate(s); }
export function dayIndex(s: string) { return isDate(s) ? Date.parse(s + 'T00:00:00Z') / DAY : NaN; }
/** b − a (일). 저장 시작일 9/1, 선택 날짜 9/11 → 10 */
export function daysBetween(a: string, b: string) { return dayIndex(b) - dayIndex(a); }
export function addDays(s: string, n: number) { const ms = (dayIndex(s) + n) * DAY; return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ''; }
export function todayKST() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
export function fmtDate(s: string) { const [y, m, d] = s.split('-'); return `${y}.${m}.${d}`; }

// ─────────────────────────────── 지표 ───────────────────────────────
export type MetricId = 'firmness' | 'brix' | 'acidity' | 'loss';
export const metricIds: MetricId[] = ['firmness', 'brix', 'acidity', 'loss'];
export const metricMeta: Record<MetricId, {label: string; unit: string; diffUnit: string; digits: number; topic: string; ro: string; note: string}> = {
  firmness: {label: '경도', unit: 'N', diffUnit: 'N', digits: 1, topic: '는', ro: '으로', note: '동일한 측정 조건에서는 값이 클수록 눌렀을 때 저항이 큰 편입니다.'},
  brix: {label: '당도', unit: '°Brix', diffUnit: '°Brix', digits: 1, topic: '는', ro: '로', note: '과즙의 가용성 고형물 지표(°Brix)입니다. 당 외의 성분도 포함됩니다.'},
  acidity: {label: '산도', unit: '%', diffUnit: '%p', digits: 3, topic: '는', ro: '로', note: '적정산도(%)입니다. 측정·환산 기준(예: 사과산 환산)은 기록의 측정 방법을 따릅니다.'},
  loss: {label: '감모율', unit: '%', diffUnit: '%p', digits: 2, topic: '은', ro: '로', note: '실측 감모율은 같은 추적 표본의 중량 변화, 모델 예측은 저장일수 함수입니다. 두 값을 구분합니다.'},
};

/** 표시 자릿수로 반올림 */
export const roundTo = (v: number, d: number) => { const f = 10 ** d; return Math.round(v * f) / f; };
export const fmtNum = (v: number, d: number) => roundTo(v, d).toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d});

// ─────────────────────────────── 데이터 종류 ───────────────────────────────
export type DataKind = '실측' | '모델 계산' | '예시' | '미측정';
export type Verification = '검증 미확인' | '검증됨';
/** 저장 모델의 검증 상태. 원자료에 검증 기간·성능이 없어 '검증 미확인'입니다. */
export const STORAGE_MODEL_VERIFIED = '검증 미확인' as Verification;
export const calcNoun = (m: MetricId) => `${STORAGE_MODEL_VERIFIED === '검증됨' ? '예상' : '시연용 계산'} ${metricMeta[m].label}`;

// ─────────────────────────────── 저장 모델 ───────────────────────────────
export const MODEL_VERSION = QUALITY_MODEL_VERSION;
/** 원자료에 관측·검증 기간이 기재되어 있지 않습니다. 확인되면 validatedDays에 넣으세요. 그 전에는 표시 범위만 둡니다. */
export const MODEL_RANGE = {displayDays: 300, validatedDays: null as number | null};
export const modelLabel: Record<StorageId, string> = {cold: '저온저장', mcp: '1-MCP 처리 + 저온저장', ca: 'CA 저장'};

export type StorageCondition = {variety?: string; temperature?: number | string | null; storage: '일반 저온' | 'CA' | '기타'; mcp: '미처리' | '처리' | '미확인'};
/** 기록된 저장 환경(CA 여부)과 처리 이력(1-MCP)을 모델에 대응시킵니다. 모델이 없는 조합은 계산하지 않습니다. */
export function resolveModel(c: StorageCondition): {id: StorageId | null; reason: string} {
  if (isHongroVariety(c.variety)) return {id: null, reason: HONGRO_DEDICATED_NOTICE};
  if (!normalizeQualityCultivar(c.variety ?? '후지')) return {id: null, reason: '적용 모델 없음: 선택한 품종의 저장 예측식이 없습니다.'};
  if (parseOptionalNumber(c.temperature).status === 'invalid') return {id: null, reason: '유효한 저장 온도를 입력해 주세요.'};
  if (c.mcp === '미확인') return {id: null, reason: '1-MCP 처리 여부가 미확인이라 적용할 모델을 고를 수 없습니다.'};
  if (c.storage === '기타') return {id: null, reason: '‘기타’ 저장 조건에 대한 모델이 없습니다.'};
  if (c.storage === 'CA' && c.mcp === '처리') return {id: null, reason: 'CA 저장 + 1-MCP 처리 조합 모델이 없습니다(검증 후 확장 항목).'};
  if (c.storage === 'CA') return {id: 'ca', reason: ''};
  return {id: c.mcp === '처리' ? 'mcp' : 'cold', reason: ''};
}

/** Every transition retains the original storage-start time axis. */
function project(model: StorageId, m: MetricId, fromDay: number, fromValue: number, t: number, variety = '후지', temperature: number | null = null): PredictionResult {
  return predictQuality({cultivar: variety, storage: model === 'ca' ? 'ca' : 'cold', temperature,
    mcp: model === 'mcp' ? 'treated' : 'untreated', metric: m, day: t, anchor: {day: fromDay, value: fromValue}});
}

export type Anchor = {day: number; date: string; value: number; kind: DataKind; source: 'initial' | 'latest'};
export type SeriesPoint = {day: number; value: number; segment: 'past' | 'future'; result?: PredictionResult};
export type Series = {ok: true; startDay: number; endDay: number; points: SeriesPoint[]; asOfDay: number; past: StorageId | null; future: StorageId} | {ok: false; reason: string};

/**
 * 계산 시작점(anchor)부터 표시 범위 끝까지 계산합니다.
 * 분석 기준일 이전(과거)은 기록된 저장 조건의 모델, 이후(미래)는 선택한 조건의 모델을 씁니다.
 * 계산 시작점 이전 날짜는 채우지 않습니다.
 */
export function computeSeries(o: {variety?: string; temperature?: number | null; metric: MetricId; anchor: Anchor | null; recorded: StorageId | null; recordedReason?: string; future: StorageId | null; futureReason?: string; asOfDay: number; horizon?: number}): Series {
  if (isHongroVariety(o.variety)) return {ok: false, reason: HONGRO_DEDICATED_NOTICE};
  const {metric} = o, horizon = o.horizon ?? MODEL_RANGE.displayDays;
  // Predicted loss is cumulative from storage start, independent of weighing records.
  const anchor: Anchor | null = metric === 'loss' ? {day: 0, date: '', value: 0, kind: '모델 계산', source: 'initial'} : o.anchor;
  if (!anchor) return {ok: false, reason: `초기 ${metricMeta[metric].label}${metric === 'loss' ? ' 계산에 필요한 추적 표본 초기 중량' : ''}이 없습니다.`};
  const policy = allowModelMetric(metric, anchor.kind); if (!policy.ok) return policy;
  if (!Number.isFinite(anchor.value) || anchor.value < 0 || !Number.isInteger(anchor.day) || !Number.isInteger(o.asOfDay) || o.asOfDay < 0 || !Number.isInteger(horizon) || horizon < 0 || horizon > MODEL_RANGE.displayDays) return {ok: false, reason: '계산 입력값·날짜·표시 범위를 확인해 주세요.'};
  if (MODEL_RANGE.validatedDays !== null && horizon > MODEL_RANGE.validatedDays) return {ok: false, reason: '확인된 모델 적용 기간 밖의 수치는 제공하지 않습니다.'};
  if (anchor.day < 0) return {ok: false, reason: '측정일이 저장 시작일보다 빠릅니다. 날짜를 확인해 주세요.'};
  if (anchor.day > horizon) return {ok: false, reason: `계산 시작점(저장 ${anchor.day}일차)이 표시 범위(0~${horizon}일) 밖입니다.`};
  if (!o.future) return {ok: false, reason: o.futureReason || '선택한 저장 조건에 맞는 모델이 없습니다.'};
  const pastEnd = Math.min(Math.max(o.asOfDay, anchor.day), horizon);
  if (pastEnd > anchor.day && !o.recorded) return {ok: false, reason: `과거 구간: ${o.recordedReason || '기록된 저장 조건에 맞는 모델이 없습니다.'}`};
  const points: SeriesPoint[] = [];
  for (let t = anchor.day; t <= pastEnd; t++) {
    const result = project(o.recorded ?? o.future, metric, anchor.day, anchor.value, t, o.variety ?? '후지', o.temperature ?? null);
    if (!result.ok || result.value === null) return {ok: false, reason: result.reason ?? '적용 모델 없음'};
    points.push({day: t, value: result.value, segment: 'past', result});
  }
  const base = points[points.length - 1];
  for (let t = pastEnd + 1; t <= horizon; t++) {
    let result = project(o.future, metric, pastEnd, base.value, t, o.variety ?? '후지', o.temperature ?? null);
    if (!result.ok || result.value === null) return {ok: false, reason: result.reason ?? '적용 모델 없음'};
    if (o.recorded !== o.future) result = {...result, warnings: [...result.warnings, '조건 변경 시나리오: 서로 다른 저장식을 이어 붙인 수학적 비교이며 연구로 검증된 전환 모델이 아닙니다.']};
    points.push({day: t, value: result.value!, segment: 'future', result});
  }
  return {ok: true, startDay: anchor.day, endDay: horizon, points, asOfDay: o.asOfDay, past: o.recorded, future: o.future};
}

export type ValueAt = {status: 'ok'; value: number; segment: 'past' | 'future'; result?: PredictionResult} | {status: 'before' | 'out' | 'unavailable'; reason: string};
export function valueAt(s: Series, day: number): ValueAt {
  if (!s.ok) return {status: 'unavailable', reason: s.reason};
  if (!Number.isInteger(day)) return {status: 'unavailable', reason: '유효한 날짜를 선택해 주세요.'};
  if (day < s.startDay) return {status: 'before', reason: `선택한 날짜는 계산 시작점(저장 ${s.startDay}일차) 이전이라 계산값이 없습니다.`};
  if (day > s.endDay) return {status: 'out', reason: `선택한 날짜(저장 ${day}일차)는 표시 범위(0~${s.endDay}일) 밖입니다.`};
  const p = s.points[day - s.startDay];
  return p && Number.isFinite(p.value) ? {status: 'ok', value: p.value, segment: p.segment, result: p.result} : {status: 'unavailable', reason: '해당 날짜의 유효한 계산값이 없습니다.'};
}

// ─────────────────────────────── 실측 기록 ───────────────────────────────
export type MeasuredPoint = {date: string; day: number; value: number; sampleCount: number | null; kind: DataKind; id: string};
type ObsLike = {id: string; date: string; firmness: number | null; brix: number | null; acidity?: number | null; tracked_weight?: number | null; sample_count: number | null; details?: {tracked?: {sample_id?: string | null}} | null};
/** 지표별 측정점. 감모율은 같은 추적 표본의 초기·후속 중량이 모두 있을 때만 계산합니다. */
export function measuredPoints(m: MetricId, observations: ObsLike[], startDate: string, kind: DataKind, trackedInitial: number | null, initialEvidence?: {sampleId?: string | null; date?: string | null; count?: number | null}): MeasuredPoint[] {
  if (!isDate(startDate)) return [];
  return observations.flatMap(o => {
    if (!isDate(o.date) || o.date < startDate) return [];
    let v: number | null | undefined;
    if (m === 'loss') { const laterCount = (o.details?.tracked as {count?: number | null} | undefined)?.count ?? null; const sameCount = initialEvidence?.count == null || laterCount == null || laterCount === initialEvidence.count; const loss = trackedLoss({sampleId: initialEvidence?.sampleId, date: initialEvidence?.date, weight: trackedInitial}, {sampleId: o.details?.tracked?.sample_id, date: o.date, weight: o.tracked_weight}); v = loss.ok && sameCount ? loss.value : null; }
    else v = o[m] as number | null | undefined;
    return v === null || v === undefined || !Number.isFinite(v) ? [] : [{date: o.date, day: daysBetween(startDate, o.date), value: v, sampleCount: o.sample_count, kind, id: o.id}];
  }).sort((a, b) => a.day - b.day);
}

// ─────────────────────────────── 경도 단위 ───────────────────────────────
export const N_PER_KGF = 9.80665;
export const nToKgf = (n: number) => n / N_PER_KGF;
export const kgfToN = (k: number) => k * N_PER_KGF;
/** 원형 탐침 직경(mm) → 접촉 면적(cm²). 원형 단면 가정. */
export const probeAreaCm2 = (dMm: number) => Math.PI * (dMm / 2) ** 2 / 100;

// ─────────────────────────────── 요약 문장 ───────────────────────────────
/** 화면에 표시하는 반올림 값으로 차이를 계산해, 문장과 숫자가 어긋나지 않게 합니다. */
export function describeChange(m: MetricId, value: number, ref: number) {
  const {digits, diffUnit} = metricMeta[m];
  const d = roundTo(roundTo(value, digits) - roundTo(ref, digits), digits);
  if (d === 0) return {diff: 0, text: '같습니다', short: '변화 없음'};
  return {diff: d, text: `${fmtNum(Math.abs(d), digits)} ${diffUnit} ${d < 0 ? '낮습니다' : '높습니다'}`, short: `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d), digits)} ${diffUnit}`};
}

export function summarySentence(o: {metric: MetricId; day: number; date: string; at: ValueAt; anchor: Anchor | null; measuredToday?: MeasuredPoint | null; baseline?: {label: string; at: ValueAt} | null; changeLabel?: string}): string {
  const meta = metricMeta[o.metric];
  const when = `저장 ${o.day}일차(${fmtDate(o.date)})`;
  if (o.at.status !== 'ok') return `${o.at.reason} 수치 요약을 제공하지 않습니다.`;
  const v = fmtNum(o.at.value, meta.digits);
  if (o.baseline) {
    if (o.baseline.at.status !== 'ok') return `${when} 기준 결과가 없어 비교 요약을 만들 수 없습니다. ${o.baseline.at.reason}`;
    const c = describeChange(o.metric, o.at.value, o.baseline.at.value);
    return `${when}에 변경 조건(${o.changeLabel})의 ${calcNoun(o.metric)}${meta.topic} ${v} ${meta.unit}${meta.ro}, 기준(${o.baseline.label})${c.diff === 0 ? '과 같습니다' : `보다 ${c.text}`}.`;
  }
  if (!o.anchor) return `초기 ${meta.label} 값이 없어 변화량을 계산할 수 없습니다.`;
  const startWord = o.anchor.source === 'latest' ? `계산 시작점(${fmtDate(o.anchor.date)} 측정값)` : '초기값';
  const c = describeChange(o.metric, o.at.value, o.anchor.value);
  const measured = o.measuredToday ? ` 같은 날 측정값은 ${fmtNum(o.measuredToday.value, meta.digits)} ${meta.unit}입니다.` : '';
  return `${when}의 ${calcNoun(o.metric)}${meta.topic} ${v} ${meta.unit}${meta.ro}, ${startWord}${c.diff === 0 ? '과 같습니다' : `보다 ${c.text}`}.${measured}`;
}
