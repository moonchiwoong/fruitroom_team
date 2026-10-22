// 사과 초기 품질 회귀식과 저장 중 품질 변화식.
// 출처: data/initial-quality-regression.hwpx, data/storage-quality-model.xlsx
// 계수는 data/initial-quality/*.csv 200건을 다시 적합해 동일함을 확인했습니다.
import {initialQualityRows} from './initial-quality-data';

export type RegionId = 'cheongsong' | 'jangsu' | 'yeongju';
export type InputKey = 'rain9' | 'lc56' | 'lc78' | 'min4';
export type MetricKey = 'weight' | 'diameter' | 'firmness' | 'brix' | 'acidity';
export type Inputs = Record<InputKey, number>;

export const inputKeys: InputKey[] = ['rain9', 'lc56', 'lc78', 'min4'];
export const metricKeys: MetricKey[] = ['weight', 'diameter', 'firmness', 'brix', 'acidity'];

// 변수 이름은 이 한 곳에서 바꾸면 화면 전체에 반영됩니다.
export const inputInfo: Record<InputKey, {label: string; short: string; unit: string; code: string; step: number; digits: number; hint: string}> = {
  rain9: {label: '9월 강수량', short: '9월 강수', unit: 'mm', code: '9rain', step: 0.1, digits: 1, hint: '수확 전 9월 한 달 누적 강수량'},
  lc56: {label: '5~6월 적산온도', short: '5~6월 적산', unit: '°C·일', code: 'LC56', step: 0.1, digits: 1, hint: '5~6월 생육기 누적 기온 지표'},
  lc78: {label: '7~8월 적산온도', short: '7~8월 적산', unit: '°C·일', code: 'LC78', step: 0.1, digits: 1, hint: '7~8월 비대기 누적 기온 지표'},
  min4: {label: '4월 최저기온', short: '4월 최저', unit: '°C', code: 'min4', step: 0.1, digits: 1, hint: '개화기 전후 4월 최저기온'},
};

export const metricInfo: Record<MetricKey, {label: string; unit: string; digits: number}> = {
  weight: {label: '중량', unit: 'g', digits: 1},
  diameter: {label: '횡경', unit: 'mm', digits: 1},
  firmness: {label: '경도', unit: 'N/mm', digits: 1},
  brix: {label: '당도', unit: '°Brix', digits: 1},
  acidity: {label: '산도', unit: '%', digits: 3},
};

type Equation = {intercept: number; coef: Inputs; r2: number};

export const regions: Record<RegionId, {name: string; area: string; equations: Record<MetricKey, Equation>}> = {
  cheongsong: {
    name: '청송', area: '경북 청송군',
    equations: {
      weight: {intercept: 327.160462, coef: {rain9: -0.128593, lc56: 0.588968, lc78: -0.442912, min4: 10.138662}, r2: 0.5940},
      diameter: {intercept: 96.106858, coef: {rain9: -0.017758, lc56: 0.083655, lc78: -0.063813, min4: 1.297476}, r2: 0.8585},
      firmness: {intercept: -20.752472, coef: {rain9: 0.006498, lc56: -0.020219, lc78: 0.077792, min4: -1.780266}, r2: 0.6804},
      brix: {intercept: 6.479169, coef: {rain9: 0.002245, lc56: -0.002447, lc78: 0.007892, min4: -0.392374}, r2: 0.5313},
      acidity: {intercept: 0.655302, coef: {rain9: -0.000024, lc56: 0.000262, lc78: -0.000378, min4: -0.007079}, r2: 0.5723},
    },
  },
  jangsu: {
    name: '장수', area: '전북 장수군',
    equations: {
      weight: {intercept: 515.608948, coef: {rain9: -0.286833, lc56: 0.063306, lc78: -0.177878, min4: -8.826326}, r2: 0.5745},
      diameter: {intercept: 112.24507, coef: {rain9: -0.036293, lc56: 0.005103, lc78: -0.016478, min4: -1.274986}, r2: 0.5327},
      firmness: {intercept: 38.944733, coef: {rain9: 0.034077, lc56: -0.001139, lc78: 0.012347, min4: 1.315002}, r2: 0.2890},
      brix: {intercept: 16.420841, coef: {rain9: -0.00414, lc56: 0.001414, lc78: -0.00352, min4: 0.147672}, r2: 0.2761},
      acidity: {intercept: 0.48299, coef: {rain9: 0.000095, lc56: 0.000291, lc78: -0.000329, min4: 0.002546}, r2: 0.1354},
    },
  },
  yeongju: {
    name: '영주', area: '경북 영주시',
    equations: {
      weight: {intercept: 449.439712, coef: {rain9: -0.140457, lc56: -0.306199, lc78: 0.111934, min4: 6.350255}, r2: 0.1361},
      diameter: {intercept: 94.806521, coef: {rain9: -0.023394, lc56: -0.009572, lc78: 0.004943, min4: 0.426354}, r2: 0.3749},
      firmness: {intercept: 9.088239, coef: {rain9: -0.011069, lc56: 0.008447, lc78: 0.032196, min4: 0.148718}, r2: 0.8633},
      brix: {intercept: 14.088312, coef: {rain9: -0.005062, lc56: 0.006085, lc78: -0.005348, min4: 0.15183}, r2: 0.6893},
      acidity: {intercept: 0.378221, coef: {rain9: -0.000221, lc56: 0.000402, lc78: -0.000258, min4: -0.001856}, r2: 0.4437},
    },
  },
};

export const regionIds = Object.keys(regions) as RegionId[];

export type Sample = {year: number; inputs: Inputs; actual: Record<MetricKey, number>};

export function samples(region: RegionId): Sample[] {
  return initialQualityRows[region].map(r => ({
    year: r[0],
    inputs: {rain9: r[1], lc56: r[2], lc78: r[3], min4: r[4]},
    actual: {weight: r[5], diameter: r[6], firmness: r[7], brix: r[8], acidity: r[9]},
  }));
}

export function predictMetric(region: RegionId, metric: MetricKey, x: Inputs) {
  const eq = regions[region].equations[metric];
  return eq.intercept + inputKeys.reduce((s, k) => s + eq.coef[k] * x[k], 0);
}

export function predictAll(region: RegionId, x: Inputs): Record<MetricKey, number> {
  return Object.fromEntries(metricKeys.map(m => [m, predictMetric(region, m, x)])) as Record<MetricKey, number>;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

export type RegionSummary = {
  count: number; years: number[];
  inputRange: Record<InputKey, {min: number; max: number; mean: number}>;
  actualMean: Record<MetricKey, number>;
  actualRange: Record<MetricKey, {min: number; max: number}>;
  rmse: Record<MetricKey, number>;
  yearMeans: {year: number; inputs: Inputs}[];
};

const cache = new Map<RegionId, RegionSummary>();
export function regionSummary(region: RegionId): RegionSummary {
  const hit = cache.get(region); if (hit) return hit;
  const s = samples(region);
  const years = [...new Set(s.map(r => r.year))].sort();
  const pick = <K extends string>(keys: K[], f: (k: K) => unknown) => Object.fromEntries(keys.map(k => [k, f(k)]));
  const summary: RegionSummary = {
    count: s.length, years,
    inputRange: pick(inputKeys, k => {const v = s.map(r => r.inputs[k]); return {min: Math.min(...v), max: Math.max(...v), mean: mean(v)};}) as RegionSummary['inputRange'],
    actualMean: pick(metricKeys, m => mean(s.map(r => r.actual[m]))) as RegionSummary['actualMean'],
    actualRange: pick(metricKeys, m => {const v = s.map(r => r.actual[m]); return {min: Math.min(...v), max: Math.max(...v)};}) as RegionSummary['actualRange'],
    rmse: pick(metricKeys, m => Math.sqrt(mean(s.map(r => (r.actual[m] - predictMetric(region, m, r.inputs)) ** 2)))) as RegionSummary['rmse'],
    yearMeans: years.map(y => {const rows = s.filter(r => r.year === y); return {year: y, inputs: pick(inputKeys, k => mean(rows.map(r => r.inputs[k]))) as Inputs};}),
  };
  cache.set(region, summary); return summary;
}

export function defaultInputs(region: RegionId): Inputs {
  const r = regionSummary(region).inputRange;
  return Object.fromEntries(inputKeys.map(k => [k, Math.round(r[k].mean * 10) / 10])) as Inputs;
}

/** 설명력(R²)을 사용자가 읽기 쉬운 단계로 바꿉니다. */
export function reliability(r2: number) {
  if (r2 >= 0.6) return {level: 'high' as const, label: '학습 적합도 높음'};
  if (r2 >= 0.4) return {level: 'mid' as const, label: '학습 적합도 보통'};
  return {level: 'low' as const, label: '학습 적합도 낮음'};
}

/** 각 변수가 데이터 평균 대비 예측값을 얼마나 올리거나 내렸는지 */
export function contributions(region: RegionId, metric: MetricKey, x: Inputs) {
  const eq = regions[region].equations[metric], r = regionSummary(region).inputRange;
  return inputKeys.map(k => ({key: k, value: eq.coef[k] * (x[k] - r[k].mean)}));
}

// ── 저장 중 품질 변화 (초기값 고정 동적 예측식) ──────────────────────────────
export type StorageId = 'cold' | 'mcp' | 'ca';
export const storageInfo: Record<StorageId, {label: string; short: string; color: string}> = {
  cold: {label: '저온저장', short: '저온', color: '#2f6f9f'},
  mcp: {label: '1-MCP + 저온저장', short: '1-MCP', color: '#c2410c'},
  ca: {label: 'CA 저장', short: 'CA', color: '#15803d'},
};
export const storageIds = Object.keys(storageInfo) as StorageId[];
export const MAX_STORAGE_DAYS = 300;

export type StorageMetric = 'loss' | 'firmness' | 'brix' | 'acidity';
export const storageMetricInfo: Record<StorageMetric, {label: string; unit: string; digits: number; note: string}> = {
  loss: {label: '감모율', unit: '%', digits: 2, note: '저장 시작 시 0%에서 출발'},
  firmness: {label: '경도', unit: 'N', digits: 1, note: '초기 경도에서 감소 (원자료 단위 N)'},
  brix: {label: '당도', unit: '°Brix', digits: 1, note: '100·200일 구간선형'},
  acidity: {label: '산도', unit: '%', digits: 3, note: '지수감소 / 100일 후 유지'},
};

const pos = (v: number) => Math.max(v, 0);
export type Initial = {firmness: number; brix: number; acidity: number};

export function storageValue(method: StorageId, metric: StorageMetric, t: number, init: Initial): number {
  switch (metric) {
    case 'loss':
      return method === 'cold' ? 0.007807 * t + 0.0000475 * t * t : method === 'mcp' ? 0.017524 * t : 0.012591 * t;
    case 'firmness':
      return method === 'cold' ? init.firmness - 0.013733 * t
        : method === 'mcp' ? init.firmness - 0.002288 * t + 0.00002365 * t * t
        : init.firmness - 0.004178 * t;
    case 'brix':
      return method === 'cold' ? init.brix - 0.001 * t + 0.001 * pos(t - 100) - 0.006 * pos(t - 200)
        : method === 'mcp' ? init.brix + 0.002 * t + 0.004 * pos(t - 100) - 0.022 * pos(t - 200)
        : init.brix - 0.003 * t + 0.013 * pos(t - 100) - 0.016 * pos(t - 200);
    case 'acidity':
      return method === 'cold' ? init.acidity * Math.exp(-0.004377 * t) : init.acidity * (1 - (1 / 3) * Math.min(t / 100, 1));
  }
}

export const storageFormula: Record<StorageMetric, Record<StorageId, string>> = {
  loss: {cold: 'y = 0.007807t + 0.0000475t²', mcp: 'y = 0.017524t', ca: 'y = 0.012591t'},
  firmness: {cold: 'y = y₀ − 0.013733t', mcp: 'y = y₀ − 0.002288t + 0.00002365t²', ca: 'y = y₀ − 0.004178t'},
  brix: {
    cold: 'S = S₀ − 0.001t + 0.001·max(t−100,0) − 0.006·max(t−200,0)',
    mcp: 'S = S₀ + 0.002t + 0.004·max(t−100,0) − 0.022·max(t−200,0)',
    ca: 'S = S₀ − 0.003t + 0.013·max(t−100,0) − 0.016·max(t−200,0)',
  },
  acidity: {cold: 'y = y₀·e^(−0.004377t)', mcp: 'y = y₀·(1 − ⅓·min(t/100, 1))', ca: 'y = y₀·(1 − ⅓·min(t/100, 1))'},
};
