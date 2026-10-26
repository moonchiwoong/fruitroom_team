/** 화면·서버 도구·내보내기에서 공유하는 입력/출력 정책. 모델 식과 계수는 변경하지 않습니다. */
export const QUALITY_POLICY_VERSION = 'quality-policy@2026-10-26';
export const TRACKED_LOSS_REASON = '실측 감모율은 동일한 추적 표본 ID의 초기·후속 중량과 측정일이 확인된 날짜에만 제공합니다. 모델 예측 감모율과 구분하며 기록이 없으면 실측값을 만들지 않습니다.';
export const PRESSURE_REASON = '탐침 직경만으로 압력으로 환산하지 않습니다. 유효 접촉 면적과 해당 측정법의 환산 타당성·확인 근거가 필요합니다.';

export type ParsedNumber = {status: 'missing'} | {status: 'invalid'; reason: string} | {status: 'valid'; value: number};
/** 빈칸과 실제 0을 구분합니다. 16진수·쉼표·무한대·객체를 숫자로 강제 변환하지 않습니다. */
export function parseOptionalNumber(value: unknown): ParsedNumber {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return {status: 'missing'};
  if (typeof value !== 'number' && typeof value !== 'string') return {status: 'invalid', reason: '숫자 형식을 확인해 주세요.'};
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return {status: 'invalid', reason: '단위·쉼표를 제외한 숫자와 소수점을 확인해 주세요.'};
  const n = Number(value);
  return Number.isFinite(n) ? {status: 'valid', value: n} : {status: 'invalid', reason: '유한한 숫자로 입력해 주세요.'};
}

/** 잘못된 월·일은 false. Invalid Date.toISOString() 예외를 만들지 않습니다. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export type TrackedWeight = {sampleId?: string | null; weight?: number | null; date?: string | null};
export type AllowedValue = {ok: true; value: number} | {ok: false; reason: string};
/** 추적 표본의 실측 중량 변화. 다른 표본이나 미확인 기록은 보간·예시값으로 메우지 않습니다. */
export function trackedLoss(initial: TrackedWeight, later: TrackedWeight): AllowedValue {
  const firstId = initial.sampleId?.trim(), laterId = later.sampleId?.trim();
  if (!firstId || !laterId || firstId !== laterId) return {ok: false, reason: TRACKED_LOSS_REASON};
  if (!isCalendarDate(initial.date) || !isCalendarDate(later.date) || later.date < initial.date) return {ok: false, reason: '추적 표본의 초기·후속 측정일과 날짜 순서를 확인해 주세요.'};
  if (typeof initial.weight !== 'number' || !Number.isFinite(initial.weight) || initial.weight <= 0 || typeof later.weight !== 'number' || !Number.isFinite(later.weight) || later.weight < 0) return {ok: false, reason: '추적 표본의 초기 중량(0보다 큼)과 후속 중량이 필요합니다.'};
  return {ok: true, value: (initial.weight - later.weight) / initial.weight * 100};
}

/** Model loss depends on time, not on an initial weighing. Model selection owns availability. */
export function allowModelMetric(_metric: string, _dataKind: string): {ok: true} | {ok: false; reason: string} {
  return {ok: true};
}

export type PressureEvidence = {diameterMm?: number | null; effectiveAreaCm2?: number | null; methodConfirmed?: boolean; assumption?: string | null; evidence?: string | null};
/** 면적은 확인된 유효 접촉 면적이어야 하며 직경에서 자동 추정하지 않습니다. 현재 UI에는 확인 경로가 없어 차단됩니다. */
export function pressureConversion(forceN: number | null, proof?: PressureEvidence): AllowedValue {
  if (forceN === null || !Number.isFinite(forceN) || forceN < 0) return {ok: false, reason: '유효한 힘(N) 측정값이 필요합니다.'};
  if (!proof?.methodConfirmed || !proof.evidence?.trim() || !proof.assumption?.trim() || !Number.isFinite(proof.diameterMm) || (proof.diameterMm ?? 0) <= 0 || !Number.isFinite(proof.effectiveAreaCm2) || (proof.effectiveAreaCm2 ?? 0) <= 0) return {ok: false, reason: PRESSURE_REASON};
  return {ok: true, value: forceN / 9.80665 / proof.effectiveAreaCm2!};
}

/** 과거 연결 확인용 예측 API/저장 결과의 실제 물량 감모율도 공통 규칙으로 차단합니다. */
export function restrictLegacyLoss<T extends {weightLoss?: number | null; limitations?: string[]}>(prediction: T): T {
  return {...prediction, weightLoss: null, limitations: [...new Set([...(prediction.limitations ?? []), TRACKED_LOSS_REASON])]};
}
