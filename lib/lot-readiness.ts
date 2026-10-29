// 물량 관리·홈·품질 예측이 같은 규칙으로 ‘예측 준비 상태’와 기준 기록을 해석하도록 모은 함수들.
// 계산식은 lib/quality-models.ts의 선택 규칙을 그대로 쓰며, 여기서 새 예측식이나 보정을 만들지 않습니다.
import type {Lot, Observation} from './lot-types';
import {selectQualityModel, normalizeQualityCultivar} from './quality-models';
import {isDate} from './tracker';

export type Readiness = {status: 'ready' | 'needs-initial' | 'needs-date' | 'conditions' | 'unsupported'; title: string; detail: string};

export const mcpLabel = (v: string) => v === '처리' ? '처리함' : v === '미처리' ? '미처리' : '모름';
export const storageStart = (l: Pick<Lot, 'storage_start_date' | 'intake_date'>) => l.storage_start_date || l.intake_date;
export const quantityUnit = (l: Lot): 'kg' | '상자' => l.details?.quantity_unit === '상자' ? '상자' : 'kg';

/** 물량에 저장된 예측 기준 초기값(경도·당도·산도) 중 하나라도 있는지. 날씨 기반 홍로 추정은 따로 봅니다. */
export const hasInitialValues = (l: Lot) => [l.firmness, l.brix, l.acidity].some(v => v !== null && v !== undefined);
export const weatherInitial = (l: Lot) => l.details?.hongro?.source === 'weather';

/** 예측 기준 기록으로 지정된 측정 기록. 지정하지 않았으면 null이며, 가장 오래된 기록을 대신 쓰지 않습니다. */
export function baselineObservation(l: Lot, observations: Observation[]): Observation | null {
  const id = l.details?.initial_observation_id;
  return id ? observations.find(o => o.id === id) ?? null : null;
}

/** 품질 예측 화면과 같은 규칙: 품종·저장 방식·1-MCP·온도로 예측식을 고르고, 초기값과 측정일이 있어야 계산합니다. */
export function lotReadiness(l: Lot): Readiness {
  const cultivar = normalizeQualityCultivar(l.variety);
  if (!cultivar) return {status: 'unsupported', title: '기록 가능 · 예측 미지원', detail: `${l.variety || '이 품종'}은(는) 저장 예측식이 없어 측정 기록만 관리해요.`};
  const h = l.details?.hongro, t = l.details?.storage_temperature ?? (cultivar === 'hongro' && h ? (h.storage === 'cold0' ? 0 : 4) : null);
  const sel = selectQualityModel({cultivar: l.variety, storage: l.storage === '일반 저온' ? 'cold' : l.storage === 'CA' ? 'ca' : 'other', temperature: typeof t === 'number' ? t : null, mcp: l.mcp === '처리' ? 'treated' : l.mcp === '미처리' ? 'untreated' : 'unknown', metric: 'firmness', day: 0});
  if (!sel.model) return {status: 'conditions', title: '보관 조건 확인 필요', detail: (sel.reason ?? '이 조건에 적용할 예측식이 확인되지 않았어요.').replace(/^적용 모델 없음:\s*/, '') + ' 기록은 계속 남길 수 있어요.'};
  if (!hasInitialValues(l) && !weatherInitial(l)) return {status: 'needs-initial', title: '초기 측정 필요', detail: '예측 기준 초기 측정(경도·당도·산도 중 하나 이상)을 기록해 주세요. 측정 기록을 추가할 때 ‘예측 기준 초기 측정으로 지정’을 선택하면 돼요.'};
  if (!weatherInitial(l) && !isDate(l.initial_measured_on)) return {status: 'needs-date', title: '초기 측정일 필요', detail: '초기 측정값은 있지만 측정일이 기록되지 않아 계산하지 않아요. 측정일을 입력하거나 저장 시작일에 측정했는지 확인해 주세요.'};
  return {status: 'ready', title: '예측 가능', detail: `${sel.model.label} 식으로 계산해요. 검증 전 시연용 계산이에요.`};
}

/** 전체 물량 현황. 검색·필터와 관계없이 조회 가능한 전체 물량 기준이며, 단위가 다른 수량은 따로 합칩니다. */
export function lotSummary(lots: Lot[], isShared: (l: Lot) => boolean) {
  const unique = [...new Map(lots.map(l => [l.id, l])).values()];
  const totals: Record<'상자' | 'kg', number> = {상자: 0, kg: 0};
  let missingQuantity = 0;
  for (const l of unique) { if (typeof l.quantity === 'number' && Number.isFinite(l.quantity)) totals[quantityUnit(l)] += l.quantity; else missingQuantity++; }
  const storages = new Set(unique.map(l => (l.location ?? '').trim()).filter(Boolean));
  return {count: unique.length, shared: unique.filter(isShared).length, totals, missingQuantity, storages: storages.size, noStorage: unique.filter(l => !(l.location ?? '').trim()).length};
}
