// 품질 변화 화면의 입력 양식 ↔ 물량 기록 변환, 초안(임시 저장) 관리.
import type {Lot, LotDetails} from './lot-types';
import {addDays, todayKST} from './tracker';

export type TrackerForm = {
  name: string; variety: string; harvest_date: string; intake_date: string;
  sameStart: boolean; storage_start_date: string; initial_measured_on: string; initial_sample_count: string;
  firmness: string; brix: string; acidity: string; weight: string;
  packaging: string; location: string; sensor_id: string;
  storage: '일반 저온' | 'CA' | '기타'; mcp: '미처리' | '처리' | '미확인';
  measure: {probe_mm: string; peeled: '' | '껍질 제거' | '껍질 포함'; position: string; fruit_temp: string; instrument: string};
  mcpd: {treated_on: string; product: string; concentration: string; hours: string; temp: string};
  ca: {from: string; to: string; o2: string; co2: string};
  tracked: {count: string; initial_weight: string};
  team_shared: boolean;
};

const s = (v: unknown) => v === null || v === undefined ? '' : String(v);

export function emptyForm(): TrackerForm {
  return {
    name: '', variety: '후지', harvest_date: '', intake_date: '', sameStart: true, storage_start_date: '', initial_measured_on: '', initial_sample_count: '',
    firmness: '', brix: '', acidity: '', weight: '', packaging: '', location: '', sensor_id: '', storage: '일반 저온', mcp: '미확인',
    measure: {probe_mm: '', peeled: '', position: '', fruit_temp: '', instrument: ''},
    mcpd: {treated_on: '', product: '', concentration: '', hours: '', temp: ''},
    ca: {from: '', to: '', o2: '', co2: ''}, tracked: {count: '', initial_weight: ''}, team_shared: false,
  };
}

export function formFromLot(l: Lot): TrackerForm {
  const d: LotDetails = l.details ?? {};
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
    tracked: {count: s(d.tracked?.count), initial_weight: s(d.tracked?.initial_weight)},
    team_shared: !!l.team_shared,
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
    tracked: {count: '10', initial_weight: '285'},
  };
}

/** 같은 물량인지 비교할 때 쓰는 서명(저장된 기록 기준). */
export const signature = (f: TrackerForm) => JSON.stringify(f);

const num = (v: string) => v.trim() === '' ? null : Number(v);
const txt = (v: string) => v.trim() === '' ? null : v.trim();

/** 서버에 보낼 값. 빈칸은 null(미측정)로 보내고 0이나 예시값으로 바꾸지 않습니다. */
export function payloadFromForm(f: TrackerForm) {
  return {
    name: f.name.trim(), variety: f.variety.trim(), intake_date: f.intake_date, harvest_date: f.harvest_date || null,
    storage_start_date: f.sameStart ? (f.intake_date || null) : (f.storage_start_date || null),
    initial_measured_on: f.initial_measured_on || null, initial_sample_count: num(f.initial_sample_count),
    firmness: num(f.firmness), brix: num(f.brix), acidity: num(f.acidity), weight: num(f.weight),
    packaging: txt(f.packaging), location: txt(f.location), sensor_id: txt(f.sensor_id),
    storage: f.storage, mcp: f.mcp, team_shared: f.team_shared,
    details: {
      measure: {probe_mm: num(f.measure.probe_mm), peeled: f.measure.peeled || null, position: txt(f.measure.position), fruit_temp: num(f.measure.fruit_temp), instrument: txt(f.measure.instrument)},
      mcp: {treated_on: f.mcpd.treated_on || null, product: txt(f.mcpd.product), concentration: txt(f.mcpd.concentration), hours: num(f.mcpd.hours), temp: num(f.mcpd.temp)},
      ca: {from: f.ca.from || null, to: f.ca.to || null, o2: num(f.ca.o2), co2: num(f.ca.co2)},
      tracked: {count: num(f.tracked.count), initial_weight: num(f.tracked.initial_weight)},
    },
  };
}

/** 저장 전에 화면에서 알려 줄 문제. 필드별로 돌려줍니다. */
export function validateForm(f: TrackerForm, forSave: boolean): Partial<Record<string, string>> {
  const e: Record<string, string> = {}, today = todayKST();
  const numCheck = (k: string, v: string, min: number, max: number, label: string) => { if (v.trim() === '') return; const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) e[k] = `${label}: ${min}~${max} 범위의 숫자로 입력해 주세요.`; };
  numCheck('firmness', f.firmness, 0, 300, '경도'); numCheck('brix', f.brix, 0, 40, '당도'); numCheck('acidity', f.acidity, 0, 10, '산도'); numCheck('weight', f.weight, 1, 2000, '평균 중량');
  numCheck('initial_sample_count', f.initial_sample_count, 1, 10000, '표본 수');
  if (f.initial_sample_count.trim() && !Number.isInteger(Number(f.initial_sample_count))) e.initial_sample_count = '표본 수는 정수로 입력해 주세요.';
  numCheck('probe_mm', f.measure.probe_mm, 0.5, 50, '탐침 직경'); numCheck('fruit_temp', f.measure.fruit_temp, -5, 40, '과실 온도');
  numCheck('tracked_weight', f.tracked.initial_weight, 1, 2000, '추적 표본 초기 중량');
  const start = f.sameStart ? f.intake_date : f.storage_start_date;
  if (f.harvest_date && f.intake_date && f.harvest_date > f.intake_date) e.harvest_date = '수확일이 입고일보다 늦습니다.';
  for (const [k, v] of [['harvest_date', f.harvest_date], ['intake_date', f.intake_date], ['storage_start_date', start], ['initial_measured_on', f.initial_measured_on]] as const) if (v && v > today && !e[k]) e[k] = '오늘 이후 날짜는 입력할 수 없습니다.';
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
  try { const raw = window.localStorage.getItem(draftKey(user, mode, lot)); if (!raw) return null; const d = JSON.parse(raw); return d && d.form ? {...d, form: {...emptyForm(), ...d.form}} : null; } catch { return null; }
}
export function saveDraft(user: string, mode: string, lot: string, d: Draft): boolean {
  try { window.localStorage.setItem(draftKey(user, mode, lot), JSON.stringify(d)); return window.localStorage.getItem(draftKey(user, mode, lot)) !== null; } catch { return false; }
}
export function clearDraft(user: string, mode: string, lot: string) { try { window.localStorage.removeItem(draftKey(user, mode, lot)); } catch { /* 저장소를 쓸 수 없는 환경 */ } }
export function loadPref<T>(user: string, key: string, fallback: T): T { try { const v = window.localStorage.getItem(`appletrack:pref:${user}:${key}`); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
export function savePref(user: string, key: string, v: unknown) { try { window.localStorage.setItem(`appletrack:pref:${user}:${key}`, JSON.stringify(v)); } catch { /* 무시 */ } }
