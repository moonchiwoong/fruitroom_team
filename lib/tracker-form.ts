// 품질 변화 화면의 입력 양식 ↔ 물량 기록 변환, 초안(임시 저장) 관리.
import type {Lot, LotDetails} from './lot-types';
import {addDays, isDate, todayKST} from './tracker';
import {parseOptionalNumber} from './quality-policy';
import {isHongroVariety} from './cultivar';
import {HONGRO_MODEL_VERSION, HONGRO_UNITS} from './hongro';
import {emptyHongroForm, validateHongroForm, type HongroTrackerForm} from './hongro-tracker';

export type TrackerForm = {
  name: string; variety: string; harvest_date: string; intake_date: string;
  sameStart: boolean; storage_start_date: string; initial_measured_on: string; initial_sample_count: string;
  firmness: string; brix: string; acidity: string; weight: string;
  packaging: string; location: string; sensor_id: string;
  storage: '일반 저온' | 'CA' | '기타'; mcp: '미처리' | '처리' | '미확인';
  measure: {probe_mm: string; peeled: '' | '껍질 제거' | '껍질 포함'; position: string; fruit_temp: string; instrument: string};
  mcpd: {treated_on: string; product: string; concentration: string; hours: string; temp: string};
  ca: {from: string; to: string; o2: string; co2: string};
  tracked: {sample_id: string; count: string; initial_weight: string};
  hongro: HongroTrackerForm;
  team_shared: boolean;
};

const s = (v: unknown) => v === null || v === undefined ? '' : String(v);

export function emptyForm(): TrackerForm {
  return {
    name: '', variety: '후지', harvest_date: '', intake_date: '', sameStart: true, storage_start_date: '', initial_measured_on: '', initial_sample_count: '',
    firmness: '', brix: '', acidity: '', weight: '', packaging: '', location: '', sensor_id: '', storage: '일반 저온', mcp: '미확인',
    measure: {probe_mm: '', peeled: '', position: '', fruit_temp: '', instrument: ''},
    mcpd: {treated_on: '', product: '', concentration: '', hours: '', temp: ''},
    ca: {from: '', to: '', o2: '', co2: ''}, tracked: {sample_id: '', count: '', initial_weight: ''}, hongro: emptyHongroForm(), team_shared: false,
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
  return {
    name: l.name ?? '', variety: l.variety ?? '', harvest_date: s(l.harvest_date), intake_date: s(l.intake_date),
    sameStart: !l.storage_start_date || l.storage_start_date === l.intake_date, storage_start_date: s(l.storage_start_date),
    initial_measured_on: s(l.initial_measured_on), initial_sample_count: s(l.initial_sample_count),
    firmness: s(l.firmness), brix: s(l.brix), acidity: s(l.acidity), weight: s(l.weight),
    packaging: s(l.packaging), location: s(l.location), sensor_id: s(l.sensor_id),
    storage: (['일반 저온', 'CA', '기타'].includes(l.storage) ? l.storage : '기타') as TrackerForm['storage'],
    mcp: (['미처리', '처리', '미확인'].includes(l.mcp) ? l.mcp : '미확인') as TrackerForm['mcp'],
    measure: {probe_mm: s(d.measure?.probe_mm), peeled: (d.measure?.peeled ?? '') as TrackerForm['measure']['peeled'], position: s(d.measure?.position), fruit_temp: s(d.measure?.fruit_temp), instrument: s(d.measure?.instrument)},
    mcpd: {treated_on: s(d.mcp?.treated_on), product: s(d.mcp?.product), concentration: s(d.mcp?.concentration), hours: s(d.mcp?.hours), temp: s(d.mcp?.temp)},
    ca: {from: s(d.ca?.from), to: s(d.ca?.to), o2: s(d.ca?.o2), co2: s(d.ca?.co2)},
    tracked: {sample_id: s(d.tracked?.sample_id), count: s(d.tracked?.count), initial_weight: s(d.tracked?.initial_weight)},
    hongro, team_shared: !!l.team_shared,
  };
}

/** 예시 모드 값. 기능 확인용 가상 값이며 실제 측정 기록이 아닙니다. */
export function exampleForm(): TrackerForm {
  const t = todayKST(), start = addDays(t, -28);
  return {
    ...emptyForm(), name: '예시 물량 · 후지', variety: '후지', harvest_date: addDays(t, -29), intake_date: start, sameStart: true,
    initial_measured_on: start, initial_sample_count: '10', firmness: '72.0', brix: '14.2', acidity: '0.38', weight: '285',
    packaging: '통기성 상자', location: '1호 저장고', storage: '일반 저온', mcp: '미처리',
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
  // 비활성 출처의 유효한 값은 보존하되, 잘못된 입력이 현재 출처의 저장을 막지 않게 합니다. 초안은 변경하지 않습니다.
  const hongroNum=(value:string,source:HongroTrackerForm['source'])=>{
    if(h.source===source)return num(value);
    const p=parseOptionalNumber(value);
    return p.status==='valid'&&(source==='weather'||p.value>=0)?p.value:null;
  };
  const quality=isHongro ? (h.source==='measured' ? h.initial : {firmness:'',brix:'',acidity:'',weight:''}) : f;
  return {
    record_mode: mode,
    name: f.name.trim(), variety: f.variety.trim(), intake_date: f.intake_date, harvest_date: f.harvest_date || null,
    storage_start_date: f.sameStart ? (f.intake_date || null) : (f.storage_start_date || null),
    initial_measured_on: f.initial_measured_on || null, initial_sample_count: num(f.initial_sample_count),
    firmness: num(quality.firmness), brix: num(quality.brix), acidity: num(quality.acidity), weight: num(quality.weight),
    packaging: txt(f.packaging), location: txt(f.location), sensor_id: txt(f.sensor_id),
    storage: isHongro ? '일반 저온' : f.storage, mcp: isHongro ? '미처리' : f.mcp, team_shared: f.team_shared,
    details: {
      measure: {probe_mm: num(f.measure.probe_mm), peeled: f.measure.peeled || null, position: txt(f.measure.position), fruit_temp: num(f.measure.fruit_temp), instrument: txt(f.measure.instrument)},
      mcp: {treated_on:isHongro?null:(f.mcpd.treated_on||null),product:isHongro?null:txt(f.mcpd.product),concentration:isHongro?null:txt(f.mcpd.concentration),hours:isHongro?null:num(f.mcpd.hours),temp:isHongro?null:num(f.mcpd.temp)},
      ca: {from:isHongro?null:(f.ca.from||null),to:isHongro?null:(f.ca.to||null),o2:isHongro?null:num(f.ca.o2),co2:isHongro?null:num(f.ca.co2)},
      tracked: {sample_id:isHongro?null:txt(f.tracked.sample_id),count:isHongro?null:num(f.tracked.count),initial_weight:isHongro?null:num(f.tracked.initial_weight)},
      ...(isHongro ? {hongro: {
        schemaVersion: 1, modelVersion: HONGRO_MODEL_VERSION, cultivar:'hongro', region:'geochang', mode:'real', source:h.source, storage:h.storage,
        initial: {firmness:hongroNum(h.initial.firmness,'measured'),brix:hongroNum(h.initial.brix,'measured'),acidity:hongroNum(h.initial.acidity,'measured'),weight:hongroNum(h.initial.weight,'measured'),diameter:hongroNum(h.initial.diameter,'measured')},
        weather: {chang_min4:hongroNum(h.weather.chang_min4,'weather'),chang_LC56:hongroNum(h.weather.chang_LC56,'weather'),chang_LC78:hongroNum(h.weather.chang_LC78,'weather'),chang_9rain:hongroNum(h.weather.chang_9rain,'weather')},
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
  if(isHongro)Object.assign(e,validateHongroForm(f.hongro));
  else {numCheck('firmness', f.firmness, 0, 300, '경도'); numCheck('brix', f.brix, 0, 40, '당도'); numCheck('acidity', f.acidity, 0, 10, '산도'); numCheck('weight', f.weight, 1, 2000, '평균 중량');}
  numCheck('initial_sample_count', f.initial_sample_count, 1, 10000, '표본 수');
  if (f.initial_sample_count.trim() && !Number.isInteger(Number(f.initial_sample_count))) e.initial_sample_count = '표본 수는 정수로 입력해 주세요.';
  numCheck('probe_mm', f.measure.probe_mm, 0.5, 50, '탐침 직경'); numCheck('fruit_temp', f.measure.fruit_temp, -5, 40, '과실 온도');
  if(!isHongro){
  numCheck('tracked_weight', f.tracked.initial_weight, 1, 2000, '추적 표본 초기 중량');
  numCheck('tracked_count', f.tracked.count, 1, 10000, '추적 표본 수');
  if (f.tracked.count.trim() && !Number.isInteger(Number(f.tracked.count))) e.tracked_count = '추적 표본 수는 정수로 입력해 주세요.';
  if (f.tracked.sample_id.length > 80) e.tracked_sample_id = '추적 표본 ID는 80자 이내로 입력해 주세요.';
  }
  const start = f.sameStart ? f.intake_date : f.storage_start_date;
  if(isHongro&&!start)e.storage_start_date='홍로 계산에 사용할 실제 저장 시작일을 입력해 주세요.';
  if (f.harvest_date && f.intake_date && f.harvest_date > f.intake_date) e.harvest_date = '수확일이 입고일보다 늦습니다.';
  for (const [k, v] of [['harvest_date', f.harvest_date], ['intake_date', f.intake_date], ['storage_start_date', start], ['initial_measured_on', f.initial_measured_on]] as const) if (v) { if (!isDate(v)) e[k] = '유효한 날짜를 입력해 주세요.'; else if (v > today && !e[k]) e[k] = '오늘 이후 날짜는 입력할 수 없습니다.'; }
  if (start && f.initial_measured_on && f.initial_measured_on < start) e.initial_measured_on = '측정일이 저장 시작일보다 빠릅니다.';
  if (forSave) {
    if (!f.name.trim()) e.name = '물량 이름을 입력해 주세요.';
    if (!f.variety.trim()) e.variety = '품종을 입력해 주세요.';
    if (!f.intake_date) e.intake_date = '입고일을 입력해 주세요.';
  }
  return e;
}

// ─────────────────────────── 초안 ───────────────────────────
// 사용자·입력 모드·물량별로 나눠 이 브라우저에만 보관합니다. 서버의 정식 기록과 별개입니다.
export type Draft = {form: TrackerForm; baseSig: string; savedAt: string};
const draftKey = (user: string, mode: string, lot: string) => `appletrack:draft:v1:${user}:${mode}:${lot}`;
export function loadDraft(user: string, mode: string, lot: string): Draft | null {
  try { const raw = window.localStorage.getItem(draftKey(user, mode, lot)); if (!raw) return null; const d = JSON.parse(raw), empty = emptyForm(); return d && d.form ? {...d, form: {...empty, ...d.form, measure: {...empty.measure, ...d.form.measure}, mcpd: {...empty.mcpd, ...d.form.mcpd}, ca: {...empty.ca, ...d.form.ca}, tracked: {...empty.tracked, ...d.form.tracked}, hongro:{...empty.hongro,...d.form.hongro,initial:{...empty.hongro.initial,...d.form.hongro?.initial},weather:{...empty.hongro.weather,...d.form.hongro?.weather}}}} : null; } catch { return null; }
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
