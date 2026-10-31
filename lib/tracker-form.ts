// 품질 변화 화면의 입력 양식 ↔ 물량 기록 변환, 초안(임시 저장) 관리.
import type {Lot, LotDetails} from './lot-types';
import {addDays, isDate, todayKST} from './tracker';
import {parseOptionalNumber} from './quality-policy';
import {isHongroVariety} from './cultivar';
import {predictAll} from './initial-quality';
import {HONGRO_MODEL_VERSION, HONGRO_UNITS} from './hongro';
import {emptyHongroForm, validateHongroForm, type HongroTrackerForm} from './hongro-tracker';

export type TrackerForm = {
  name: string; variety: string; harvest_date: string; intake_date: string;
  sameStart: boolean; storage_start_date: string; initialSameStart: boolean; initial_measured_on: string; initial_sample_count: string;
  firmness: string; brix: string; acidity: string; weight: string;
  packaging: string; location: string; sensor_id: string;
  storage: '일반 저온' | 'CA' | '기타'; mcp: '미처리' | '처리' | '미확인'; mcpSelected: boolean;
  temperature: string; loss_reference: boolean;
  measure: {probe_mm: string; peeled: '' | '껍질 제거' | '껍질 포함'; position: string; fruit_temp: string; instrument: string};
  mcpd: {treated_on: string; product: string; concentration: string; hours: string; temp: string};
  ca: {from: string; to: string; o2: string; co2: string};
  tracked: {sample_id: string; count: string; initial_weight: string};
  hongro: HongroTrackerForm;
  /** 후지(청송·장수·영주): 수확한 해 농업기상으로 초기 당도·산도를 추정할 때의 입력. 경도 단위는 N(작성자 확인)이라 경도·당도·산도를 모두 저장 예측의 처음 값으로 씁니다. */
  fuji: FujiWeatherForm;
  /** 이전 홍로 기록에 전용 모델 출처가 없을 때 상위 실측값을 보존합니다. */
  legacyHongro: boolean;
  team_shared: boolean;
  /** 이름을 사용자가 직접 고치기 전까지는 품종·저장 시작일로 자동 제안합니다. */
  name_auto: boolean;
  /** 경도는 기기에서 읽은 숫자와 단위 그대로 입력하고, 계산·저장은 N으로 합니다. */
  firmness_unit: 'N' | 'kgf';
  /** ‘미측정’을 직접 고른 항목. 빈칸(아직 입력 안 함)·미측정·숫자 0을 구분합니다. */
  missing: {firmness: boolean; brix: boolean; acidity: boolean};
};

export type FujiRegion = 'cheongsong' | 'jangsu' | 'yeongju';
export type FujiWeatherForm = {source: 'measured' | 'weather'; region: '' | FujiRegion; year: string; weather: {rain9: string; lc56: string; lc78: string; min4: string}};
export const emptyFujiForm = (): FujiWeatherForm => ({source: 'measured', region: '', year: '', weather: {rain9: '', lc56: '', lc78: '', min4: ''}});
/** 후지 날씨 추정: 지역 식(lib/initial-quality)으로 초기 품질 5개를 계산합니다. 네 값과 지역이 모두 있어야 합니다. */
export function fujiWeatherEstimate(f: FujiWeatherForm) {
  if (f.source !== 'weather' || !f.region) return null;
  const x = {rain9: num(f.weather.rain9), lc56: num(f.weather.lc56), lc78: num(f.weather.lc78), min4: num(f.weather.min4)};
  if (Object.values(x).some(v => v === null)) return null;
  return predictAll(f.region, x as Record<keyof typeof x, number>);
}
export const KGF_TO_N = 9.80665;
/** 입력한 경도를 N으로 바꿉니다. 빈칸·잘못된 값은 null. */
export function firmnessToN(raw: string, unit: 'N' | 'kgf'): number | null {
  const p = parseOptionalNumber(raw); if (p.status !== 'valid') return null;
  return unit === 'kgf' ? p.value * KGF_TO_N : p.value;
}
/** 자동 이름: ‘홍로 · 10월 27일 저장’, 저장 시작일이 없으면 ‘홍로 · 새 물량’. */
export function suggestName(f: Pick<TrackerForm, 'variety' | 'sameStart' | 'intake_date' | 'storage_start_date'>): string {
  const v = isHongroVariety(f.variety) ? '홍로' : (f.variety || '후지'), d = f.sameStart ? f.intake_date : f.storage_start_date;
  if (!isDate(d)) return `${v} · 새 물량`;
  const [, m, day] = d.split('-').map(Number); return `${v} · ${m}월 ${day}일 저장`;
}
export const effectiveName = (f: TrackerForm) => f.name_auto && !f.name.trim() ? suggestName(f) : f.name;

/** Only an explicit checkbox links the measurement date to the storage start. */
export const effectiveInitialMeasuredOn = (f: Pick<TrackerForm, 'initialSameStart' | 'initial_measured_on' | 'sameStart' | 'intake_date' | 'storage_start_date'>) =>
  f.initialSameStart ? (f.sameStart ? f.intake_date : f.storage_start_date) : f.initial_measured_on;

const s = (v: unknown) => v === null || v === undefined ? '' : String(v);

export function emptyForm(): TrackerForm {
  return {
    name: '', variety: '후지', harvest_date: '', intake_date: '', sameStart: true, storage_start_date: '', initialSameStart: false, initial_measured_on: '', initial_sample_count: '',
    firmness: '', brix: '', acidity: '', weight: '', packaging: '', location: '', sensor_id: '', storage: '일반 저온', mcp: '미확인', mcpSelected: false, temperature: '', loss_reference: false,
    measure: {probe_mm: '', peeled: '', position: '', fruit_temp: '', instrument: ''},
    mcpd: {treated_on: '', product: '', concentration: '', hours: '', temp: ''},
    ca: {from: '', to: '', o2: '', co2: ''}, tracked: {sample_id: '', count: '', initial_weight: ''}, hongro: emptyHongroForm(), fuji: emptyFujiForm(), legacyHongro: false, team_shared: false,
    name_auto: true, firmness_unit: 'N', missing: {firmness: false, brix: false, acidity: false},
  };
}

export function formFromLot(l: Lot): TrackerForm {
  const d: LotDetails = l.details ?? {};
  const h = isHongroVariety(l.variety) ? d.hongro : undefined;
  const hongro: HongroTrackerForm = h ? {
    source: h.source, storage: h.storage,
    initial: {firmness:s(h.initial.firmness),brix:s(h.initial.brix),acidity:s(h.initial.acidity),weight:s(h.initial.weight),diameter:s(h.initial.diameter)},
    weather: {chang_min4:s(h.weather.chang_min4),chang_LC56:s(h.weather.chang_LC56),chang_LC78:s(h.weather.chang_LC78),chang_9rain:s(h.weather.chang_9rain)},
  } : emptyHongroForm();
  const fin = d.firmness_input, nm = d.not_measured ?? [];
  const unit: 'N' | 'kgf' = fin?.unit === 'kgf' ? 'kgf' : 'N';
  if (unit === 'kgf' && fin?.value != null) { if (h) hongro.initial.firmness = s(fin.value); }
  // 전용 모델 정보가 없는 이전 홍로 기록: 물량에 저장된 실측 초기값을 그대로 계산 입력으로 씁니다.
  // (물량 관리에는 보이는데 예측 화면에서는 ‘초기값 없음’으로 나오던 연결 문제) 출처 정보를 새로 만들지는 않습니다.
  if (isHongroVariety(l.variety) && !h) {
    hongro.initial = {firmness: unit === 'kgf' && fin?.value != null ? s(fin.value) : s(l.firmness), brix: s(l.brix), acidity: s(l.acidity), weight: s(l.weight), diameter: ''};
    const t = d.storage_temperature; if (t === 4) hongro.storage = 'cold4';
  }
  return {
    name: l.name ?? '', variety: l.variety ?? '', harvest_date: s(l.harvest_date), intake_date: s(l.intake_date),
    sameStart: !l.storage_start_date || l.storage_start_date === l.intake_date, storage_start_date: s(l.storage_start_date),
    initialSameStart: d.initial_same_start === true && !!l.initial_measured_on && l.initial_measured_on === (l.storage_start_date || l.intake_date),
    initial_measured_on: s(l.initial_measured_on), initial_sample_count: s(l.initial_sample_count),
    firmness: unit === 'kgf' && fin?.value != null && !h ? s(fin.value) : s(l.firmness), brix: s(l.brix), acidity: s(l.acidity), weight: s(l.weight),
    packaging: s(l.packaging), location: s(l.location), sensor_id: s(l.sensor_id),
    storage: (['일반 저온', 'CA', '기타'].includes(l.storage) ? l.storage : '기타') as TrackerForm['storage'],
    mcp: (['미처리', '처리', '미확인'].includes(l.mcp) ? l.mcp : '미확인') as TrackerForm['mcp'],
    mcpSelected: ['미처리', '처리', '미확인'].includes(l.mcp),
    measure: {probe_mm: s(d.measure?.probe_mm), peeled: (d.measure?.peeled ?? '') as TrackerForm['measure']['peeled'], position: s(d.measure?.position), fruit_temp: s(d.measure?.fruit_temp), instrument: s(d.measure?.instrument)},
    mcpd: {treated_on: s(d.mcp?.treated_on), product: s(d.mcp?.product), concentration: s(d.mcp?.concentration), hours: s(d.mcp?.hours), temp: s(d.mcp?.temp)},
    ca: {from: s(d.ca?.from), to: s(d.ca?.to), o2: s(d.ca?.o2), co2: s(d.ca?.co2)},
    tracked: {sample_id: s(d.tracked?.sample_id), count: s(d.tracked?.count), initial_weight: s(d.tracked?.initial_weight)},
    temperature: s(d.storage_temperature ?? (h ? h.storage === 'cold0' ? 0 : 4 : null)), loss_reference: d.loss_reference === true,
    hongro, legacyHongro: isHongroVariety(l.variety) && !h, team_shared: !!l.team_shared,
    fuji: d.fuji_weather ? {source: 'weather', region: d.fuji_weather.region, year: s(d.fuji_weather.year), weather: {rain9: s(d.fuji_weather.inputs.rain9), lc56: s(d.fuji_weather.inputs.lc56), lc78: s(d.fuji_weather.inputs.lc78), min4: s(d.fuji_weather.inputs.min4)}} : emptyFujiForm(),
    name_auto: false, firmness_unit: unit, missing: {firmness: nm.includes('firmness'), brix: nm.includes('brix'), acidity: nm.includes('acidity')},
  };
}

/** 예시 모드 값. 기능 확인용 가상 값이며 실제 측정 기록이 아닙니다. */
export function exampleForm(): TrackerForm {
  const t = todayKST(), start = addDays(t, -28);
  return {
    ...emptyForm(), name: '예시 물량 · 후지', variety: '후지', harvest_date: addDays(t, -29), intake_date: start, sameStart: true,
    initialSameStart: true, initial_measured_on: start, initial_sample_count: '10', firmness: '72.0', brix: '14.2', acidity: '0.38', weight: '285',
    packaging: '통기성 상자', location: '1호 저장고', storage: '일반 저온', mcp: '미처리', mcpSelected: true,
    measure: {probe_mm: '11.1', peeled: '껍질 제거', position: '적도부 양면', fruit_temp: '1', instrument: '예시 경도계'},
    tracked: {sample_id: 'example-tracked-1', count: '10', initial_weight: '285'},
  };
}

/** 같은 물량인지 비교할 때 쓰는 서명(저장된 기록 기준). */
export const signature = (f: TrackerForm) => JSON.stringify(f);

const num = (v: string) => { const parsed = parseOptionalNumber(v); if (parsed.status === 'invalid') throw new Error(parsed.reason); return parsed.status === 'missing' ? null : parsed.value; };
const txt = (v: string) => v.trim() === '' ? null : v.trim();

/** 서버에 보낼 값. 빈칸은 null(미측정)로 보내고 0이나 예시값으로 바꾸지 않습니다. */
export function payloadFromForm(f: TrackerForm, mode: 'real' | 'example' = 'real') {
  if(mode==='example')throw new Error('예시 데이터는 실제 물량 기록으로 저장할 수 없습니다.');
  const isHongro=isHongroVariety(f.variety);
  const h=f.hongro;
  const legacyHongro=isHongro && f.legacyHongro;
  const quality=legacyHongro ? {firmness:h.initial.firmness.trim()||f.firmness,brix:h.initial.brix.trim()||f.brix,acidity:h.initial.acidity.trim()||f.acidity,weight:h.initial.weight.trim()||f.weight} : isHongro ? (h.source==='measured' ? h.initial : {firmness:'',brix:'',acidity:'',weight:''}) : f;
  const fujiEst = !isHongro ? fujiWeatherEstimate(f.fuji ?? emptyFujiForm()) : null;
  const fujiWeather = !isHongro && f.fuji?.source === 'weather';
  const measuredInput = (!isHongro && !fujiWeather) || legacyHongro || (isHongro && h.source === 'measured');
  const firmN = measuredInput && !f.missing.firmness ? firmnessToN(quality.firmness, f.firmness_unit) : null;
  if (measuredInput && !f.missing.firmness && quality.firmness.trim() && firmN === null) num(quality.firmness);
  return {
    record_mode: mode,
    name: effectiveName(f).trim(), variety: f.variety.trim(), intake_date: f.intake_date, harvest_date: f.harvest_date || null,
    storage_start_date: f.sameStart ? (f.intake_date || null) : (f.storage_start_date || null),
    initial_measured_on: effectiveInitialMeasuredOn(f) || null, initial_sample_count: num(f.initial_sample_count),
    firmness: fujiEst ? Math.round(fujiEst.firmness * 10) / 10 : firmN, brix: fujiEst ? Math.round(fujiEst.brix * 100) / 100 : measuredInput && !f.missing.brix ? num(quality.brix) : null, acidity: fujiEst ? Math.round(fujiEst.acidity * 1000) / 1000 : measuredInput && !f.missing.acidity ? num(quality.acidity) : null, weight: num(quality.weight),
    packaging: txt(f.packaging), location: txt(f.location), sensor_id: txt(f.sensor_id),
    storage: f.storage, mcp: f.mcp, team_shared: f.team_shared,
    details: {
      storage_temperature: num(f.temperature), loss_reference: f.loss_reference === true,
      initial_same_start: f.initialSameStart === true,
      initial_source: (isHongro && !legacyHongro && h.source === 'weather') || fujiWeather ? '날씨 기반 추정' : '실측',
      fuji_weather: fujiWeather && f.fuji.region ? {region: f.fuji.region, year: num(f.fuji.year), inputs: {rain9: num(f.fuji.weather.rain9), lc56: num(f.fuji.weather.lc56), lc78: num(f.fuji.weather.lc78), min4: num(f.fuji.weather.min4)}, estimate: fujiEst ? {firmness_nmm: fujiEst.firmness, brix: fujiEst.brix, acidity: fujiEst.acidity, weight: fujiEst.weight, diameter: fujiEst.diameter} : null} : null,
      firmness_input: (() => { const raw = quality.firmness; return measuredInput && !f.missing.firmness && firmnessToN(raw, f.firmness_unit) !== null ? {value: num(raw), unit: f.firmness_unit} : null; })(),
      not_measured: (['firmness', 'brix', 'acidity'] as const).filter(k => f.missing[k]),
      measure: {probe_mm: num(f.measure.probe_mm), peeled: f.measure.peeled || null, position: txt(f.measure.position), fruit_temp: num(f.measure.fruit_temp), instrument: txt(f.measure.instrument)},
      mcp: {treated_on:f.mcpd.treated_on||null,product:txt(f.mcpd.product),concentration:txt(f.mcpd.concentration),hours:num(f.mcpd.hours),temp:num(f.mcpd.temp)},
      ca: {from:f.ca.from||null,to:f.ca.to||null,o2:num(f.ca.o2),co2:num(f.ca.co2)},
      tracked: {sample_id:txt(f.tracked.sample_id),count:num(f.tracked.count),initial_weight:num(f.tracked.initial_weight)},
      ...(isHongro && !legacyHongro ? {hongro: {
        schemaVersion: 1, modelVersion: HONGRO_MODEL_VERSION, cultivar:'hongro', region:'geochang', mode:'real', source:h.source, storage:h.storage,
        initial: {firmness:f.missing.firmness?null:firmnessToN(h.initial.firmness,f.firmness_unit),brix:f.missing.brix?null:num(h.initial.brix),acidity:f.missing.acidity?null:num(h.initial.acidity),weight:num(h.initial.weight),diameter:num(h.initial.diameter)},
        weather: {chang_min4:num(h.weather.chang_min4),chang_LC56:num(h.weather.chang_LC56),chang_LC78:num(h.weather.chang_LC78),chang_9rain:num(h.weather.chang_9rain)},
        units: {...HONGRO_UNITS},
      }} : {}),
    },
  };
}

/** 저장 전에 화면에서 알려 줄 문제. 필드별로 돌려줍니다. */
export function validateForm(f: TrackerForm, forSave: boolean): Partial<Record<string, string>> {
  const e: Record<string, string> = {}, today = todayKST();
  const isHongro=isHongroVariety(f.variety);
  const numCheck = (k: string, v: string, min: number, max: number, label: string) => { const p = parseOptionalNumber(v); if (p.status === 'missing') return; if (p.status === 'invalid') { e[k] = `${label}: ${p.reason}`; return; } if (p.value < min || p.value > max) e[k] = `${label}: 단위와 소수점을 확인해 주세요. 기존 시스템의 저장 허용 범위는 ${min}~${max}이며, 정상 품질이나 모델 적용 범위를 뜻하지 않습니다.`; };
  if (isHongro) {
    const hongroErrors = validateHongroForm(f.hongro);
    // A measured metric may be blank or explicitly unmeasured; each forecast
    // is assessed independently instead of requiring all three metrics.
    if (f.hongro.source === 'measured') {
      for (const k of ['firmness', 'brix', 'acidity'] as const) {
        if (f.missing[k] || !f.hongro.initial[k].trim()) delete hongroErrors[`hongro.initial.${k}`];
      }
    }
    Object.assign(e, hongroErrors);
  }
  const measuredInput = !isHongro || f.hongro.source === 'measured';
  if (measuredInput) {
    const q = isHongro ? f.hongro.initial : f, pre = isHongro ? 'hongro.initial.' : '';
    if (!f.missing.firmness) { numCheck(pre + 'firmness', q.firmness, 0, f.firmness_unit === 'kgf' ? 30.6 : 300, '경도'); }
  }
  if (!isHongro) {if (!f.missing.brix) numCheck('brix', f.brix, 0, 40, '당도'); if (!f.missing.acidity) numCheck('acidity', f.acidity, 0, 10, '산도'); numCheck('weight', f.weight, 1, 2000, '평균 중량');}
  numCheck('initial_sample_count', f.initial_sample_count, 1, 10000, '표본 수');
  if (f.initial_sample_count.trim() && !Number.isInteger(Number(f.initial_sample_count))) e.initial_sample_count = '표본 수는 정수로 입력해 주세요.';
  numCheck('probe_mm', f.measure.probe_mm, 0.5, 50, '탐침 직경'); numCheck('fruit_temp', f.measure.fruit_temp, -5, 40, '과실 온도');
  numCheck('temperature', f.temperature, -50, 50, '저장 온도');
  {
  numCheck('tracked_weight', f.tracked.initial_weight, 1, 2000, '추적 표본 초기 중량');
  numCheck('tracked_count', f.tracked.count, 1, 10000, '추적 표본 수');
  if (f.tracked.count.trim() && !Number.isInteger(Number(f.tracked.count))) e.tracked_count = '추적 표본 수는 정수로 입력해 주세요.';
  if (f.tracked.sample_id.length > 80) e.tracked_sample_id = '추적 표본 ID는 80자 이내로 입력해 주세요.';
  }
  const start = f.sameStart ? f.intake_date : f.storage_start_date;
  const measuredOn = effectiveInitialMeasuredOn(f);
  if(isHongro&&!start&&forSave)e.storage_start_date='홍로 계산에 사용할 실제 저장 시작일을 입력해 주세요.';
  if (f.harvest_date && f.intake_date && f.harvest_date > f.intake_date) e.harvest_date = '수확일이 입고일보다 늦습니다.';
  for (const [k, v] of [['harvest_date', f.harvest_date], ['intake_date', f.intake_date], ['storage_start_date', start], ['initial_measured_on', measuredOn]] as const) if (v) { if (!isDate(v)) e[k] = '유효한 날짜를 입력해 주세요.'; else if (v > today && !e[k]) e[k] = '오늘 이후 날짜는 입력할 수 없습니다.'; }
  if (start && measuredOn && measuredOn < start) e.initial_measured_on = '측정일이 저장 시작일보다 빠릅니다.';
  if (forSave) {
    if (!effectiveName(f).trim()) e.name = '물량 이름을 입력해 주세요.';
    if (!f.variety.trim()) e.variety = '품종을 입력해 주세요.';
    if (!f.intake_date) e.intake_date = '기록을 저장하려면 입고일이 필요해요.';
    if (!f.sameStart && !f.storage_start_date) e.storage_start_date = '저장을 시작한 날을 입력해 주세요.';
  }
  return e;
}

// ─────────────────────────── 초안 ───────────────────────────
// 사용자·입력 모드·물량별로 나눠 이 브라우저에만 보관합니다. 서버의 정식 기록과 별개입니다.
export type Draft = {form: TrackerForm; baseSig: string; savedAt: string};
const draftKey = (user: string, mode: string, lot: string) => `appletrack:draft:v1:${user}:${mode}:${lot}`;
export function loadDraft(user: string, mode: string, lot: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(user, mode, lot)); if (!raw) return null;
    const d = JSON.parse(raw), empty = emptyForm(); if (!d?.form) return null;
    const mcpSelected = typeof d.form.mcpSelected === 'boolean' ? d.form.mcpSelected : ['처리', '미처리'].includes(d.form.mcp);
    return {...d, form: {...empty, ...d.form, mcpSelected, measure: {...empty.measure, ...d.form.measure}, mcpd: {...empty.mcpd, ...d.form.mcpd}, ca: {...empty.ca, ...d.form.ca}, tracked: {...empty.tracked, ...d.form.tracked}, missing: {...empty.missing, ...d.form.missing}, hongro:{...empty.hongro,...d.form.hongro,initial:{...empty.hongro.initial,...d.form.hongro?.initial},weather:{...empty.hongro.weather,...d.form.hongro?.weather}}, fuji:{...empty.fuji,...d.form.fuji,weather:{...empty.fuji.weather,...d.form.fuji?.weather}}}};
  } catch { return null; }
}
export function saveDraft(user: string, mode: string, lot: string, d: Draft): boolean {
  try { window.localStorage.setItem(draftKey(user, mode, lot), JSON.stringify(d)); return window.localStorage.getItem(draftKey(user, mode, lot)) !== null; } catch { return false; }
}
export function clearDraft(user: string, mode: string, lot: string) { try { window.localStorage.removeItem(draftKey(user, mode, lot)); } catch { /* 저장소를 쓸 수 없는 환경 */ } }
export function loadPref<T>(user: string, key: string, fallback: T): T { try { const v = window.localStorage.getItem(`appletrack:pref:${user}:${key}`); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
export function savePref(user: string, key: string, v: unknown) { try { window.localStorage.setItem(`appletrack:pref:${user}:${key}`, JSON.stringify(v)); } catch { /* 무시 */ } }

/** 비회원이 입력하던 내용을 로그인 후 그대로 이어 가기 위한 인계 정보(이 브라우저의 sessionStorage에만 보관). */
export type TrackerHandoff = {cultivar: 'fuji' | 'hongro'; draftKey: string; draft: Draft};
export const HANDOFF_KEY = 'appletrack:handoff';
