'use client';
// 물량 관리 안에서 쓰는 입력 창: 새 물량 등록·정보 수정, 측정 기록 추가·수정.
// 서버 검증(lib/lot-server.ts)과 같은 규칙을 쓰며, 빈칸은 미측정·미입력으로 보내고 0이나 예시값으로 바꾸지 않습니다.
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Info, Loader2, Save, Undo2} from 'lucide-react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {requestJson} from '@/components/lot-forms';
import {useTeamSession} from '@/components/team-auth';
import {today, type Lot, type Observation} from '@/lib/lot-types';
import {KGF_TO_N} from '@/lib/tracker-form';
import {lotReadiness, quantityUnit, storageStart, hasInitialValues, weatherInitial} from '@/lib/lot-readiness';
import {isDate} from '@/lib/tracker';

const VARIETIES = ['후지', '홍로', '감홍'] as const;
const str = (v: unknown) => v === null || v === undefined ? '' : String(v);
const store = {
  get(k: string) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { window.localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del(k: string) { try { window.localStorage.removeItem(k); } catch { /* 저장 불가 환경 */ } },
};

function Shell({open, onClose, title, desc, busy, children, footer}: {open: boolean; onClose: () => void; title: string; desc: ReactNode; busy: boolean; children: ReactNode; footer: ReactNode}) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) opener.current = document.activeElement as HTMLElement | null; }, [open]);
  return <Dialog open={open} onOpenChange={v => { if (!v && !busy) onClose(); }}>
    <DialogContent className="ld-dialog" onCloseAutoFocus={e => { e.preventDefault(); opener.current?.focus?.(); }}>
      <div className="ld-head"><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></div>
      <div className="ld-body">{children}</div>
      <div className="ld-foot">{footer}</div>
    </DialogContent>
  </Dialog>;
}
function Field({id, label, hint, children, wide}: {id: string; label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean}) {
  return <div className={'ld-field' + (wide ? ' wide' : '')}><label htmlFor={id}>{label}</label>{children}{hint && <p className="ld-hint">{hint}</p>}</div>;
}

// ───────────────────────── 물량 등록·수정 ─────────────────────────
type LotDraft = {name: string; varietyPick: string; varietyOther: string; location: string; quantity: string; unit: 'kg' | '상자'; start: string; sameIntake: boolean; intake: string; storage: string; mcp: string; temperature: string; team: boolean; harvest: string; packaging: string; sensor: string};
function lotDraft(lot?: Lot | null): LotDraft {
  if (!lot) return {name: '', varietyPick: '후지', varietyOther: '', location: '', quantity: '', unit: '상자', start: today(), sameIntake: true, intake: '', storage: '일반 저온', mcp: '미확인', temperature: '', team: false, harvest: '', packaging: '', sensor: ''};
  const known = (VARIETIES as readonly string[]).includes(lot.variety);
  const start = storageStart(lot);
  return {name: lot.name, varietyPick: known ? lot.variety : '기타', varietyOther: known ? '' : lot.variety, location: str(lot.location), quantity: str(lot.quantity), unit: quantityUnit(lot), start, sameIntake: lot.intake_date === start, intake: lot.intake_date,
    storage: lot.storage, mcp: lot.mcp, temperature: str(lot.details?.storage_temperature), team: !!lot.team_shared, harvest: str(lot.harvest_date), packaging: str(lot.packaging), sensor: str(lot.sensor_id)};
}

export function LotEditor({open, lot, onClose, onSaved}: {open: boolean; lot?: Lot | null; onClose: () => void; onSaved: (lot: Lot) => void}) {
  const session = useTeamSession();
  const [f, setF] = useState<LotDraft>(() => lotDraft(lot)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (open) { setF(lotDraft(lot)); setError(''); } }, [open, lot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof LotDraft>(k: K, v: LotDraft[K]) => setF(x => ({...x, [k]: v}));
  const variety = f.varietyPick === '기타' ? f.varietyOther.trim() : f.varietyPick;
  const owner = !lot || !lot.owner_id || lot.owner_id === session?.userId;
  const canShare = !!session?.isTeam && owner;
  const intake = f.sameIntake ? f.start : f.intake;
  // 화면 미리보기용: 입력한 조건으로 예측 가능 여부를 계산 엔진 규칙 그대로 확인합니다.
  const preview = lotReadiness({...(lot ?? {} as Lot), id: lot?.id ?? 'new', name: f.name, variety, storage: f.storage, mcp: f.mcp, intake_date: intake, storage_start_date: f.start,
    firmness: lot?.firmness ?? null, brix: lot?.brix ?? null, acidity: lot?.acidity ?? null, initial_measured_on: lot?.initial_measured_on ?? null,
    details: {...(lot?.details ?? {}), storage_temperature: f.temperature.trim() === '' ? null : Number(f.temperature)}} as Lot);
  async function save() {
    setError('');
    if (!f.name.trim()) return setError('이름을 입력해 주세요.');
    if (!variety) return setError('품종을 입력해 주세요.');
    if (!isDate(f.start)) return setError('저장 시작일을 입력해 주세요.');
    if (!isDate(intake)) return setError('입고일을 입력하거나 ‘저장 시작일과 같은 날 입고’를 선택해 주세요.');
    const body: Record<string, unknown> = {name: f.name.trim(), variety, location: f.location.trim() || null, quantity: f.quantity.trim() || null, storage_start_date: f.start, intake_date: intake,
      storage: f.storage, mcp: f.mcp, harvest_date: f.harvest || null, packaging: f.packaging.trim() || null, sensor_id: f.sensor.trim() || null,
      details: {storage_temperature: f.temperature.trim() === '' ? null : f.temperature, quantity_unit: f.unit}};
    if (owner) body.team_shared = canShare ? f.team : (lot ? !!lot.team_shared : false);
    setBusy(true);
    try {
      const r = lot ? await requestJson<{lot: Lot}>(`/api/lots/${lot.id}/update`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
        : await requestJson<{lot: Lot}>('/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      onSaved(r.lot);
    } catch (e) { setError((e as Error).message); } // 실패해도 입력한 내용은 그대로 둡니다.
    finally { setBusy(false); }
  }
  return <Shell open={open} onClose={onClose} busy={busy} title={lot ? '사과 정보 수정' : '새 사과'} desc={lot ? `${lot.name} · 측정 기록은 그대로 두고 기본 정보만 바꿔요.` : '기본 정보만 입력하면 물량을 관리할 수 있어요. 측정값은 등록한 뒤 추가해요.'}
    footer={<><p className="ld-foot-note">{lot ? '저장하면 목록·상세·예측 준비 상태가 함께 바뀌어요.' : '물량 관리에 바로 추가돼요.'}</p><button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>취소</button><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}{lot ? '저장' : '물량 등록'}</button></>}>
    <div className="ld-grid">
      <Field id="le-name" label="이름" wide><input id="le-name" value={f.name} maxLength={120} placeholder="예: 후지 1차 입고" onChange={e => set('name', e.target.value)} /></Field>
      <Field id="le-variety" label="품종"><select id="le-variety" value={f.varietyPick} onChange={e => set('varietyPick', e.target.value)}>{VARIETIES.map(v => <option key={v}>{v}</option>)}<option value="기타">기타 (직접 입력)</option></select>
        {f.varietyPick === '기타' && <input aria-label="품종 직접 입력" value={f.varietyOther} maxLength={60} placeholder="품종 이름" onChange={e => set('varietyOther', e.target.value)} />}</Field>
      <Field id="le-location" label="저장고"><input id="le-location" value={f.location} maxLength={120} placeholder="예: A저장고" onChange={e => set('location', e.target.value)} /></Field>
      <Field id="le-qty" label="수량" hint="선택 · 무게 감소를 상자 수로도 보여 줘요."><div className="ld-row"><input id="le-qty" type="number" inputMode="decimal" min={0.1} step="any" value={f.quantity} placeholder="예: 120" onChange={e => set('quantity', e.target.value)} />
        {f.unit === 'kg' && <select aria-label="저장 수량 단위" value={f.unit} onChange={e => set('unit', e.target.value as 'kg' | '상자')}><option>상자</option><option>kg</option></select>}{f.unit !== 'kg' && <span className="ld-unit">상자</span>}</div></Field>
      <Field id="le-start" label="저장 시작일" hint="저장고에 넣어 보관을 시작한 날 · 예측의 0일차"><input id="le-start" type="date" max={today()} value={f.start} onChange={e => set('start', e.target.value)} /></Field>
      <Field id="le-storage" label="보관 방식"><select id="le-storage" value={f.storage} onChange={e => set('storage', e.target.value)}><option>일반 저온</option><option value="CA">CA 저장</option><option value="기타">기타 (예측 준비 중)</option></select></Field>
      <Field id="le-mcp" label="1-MCP 처리" hint="모르면 ‘모름’으로 두세요. ‘미처리’로 바꿔 계산하지 않아요."><select id="le-mcp" value={f.mcp} onChange={e => set('mcp', e.target.value)}><option value="미확인">모름</option><option value="처리">처리함</option><option value="미처리">미처리</option></select></Field>
      <Field id="le-temp" label={<>실제 저장고 온도 <small>℃ · 선택</small></>} hint="기록한 온도를 지원 온도로 바꾸지 않아요."><input id="le-temp" type="number" inputMode="decimal" step="any" value={f.temperature} placeholder="예: 0" onChange={e => set('temperature', e.target.value)} /></Field>
      {session?.isTeam && <Field id="le-share" label="공유 범위" hint={!session?.isTeam ? '팀 계정에서만 팀과 공유할 수 있어요.' : !owner ? '공유 범위는 물량을 등록한 사람만 바꿀 수 있어요.' : '팀과 공유하면 팀원이 기록을 보고 추가·수정할 수 있어요.'}>
        <select id="le-share" value={f.team ? 'team' : 'me'} disabled={!canShare} onChange={e => set('team', e.target.value === 'team')}><option value="me">나만 보기</option><option value="team">팀과 공유</option></select></Field>}
    </div>
    <div className={'ld-ready ' + preview.status} role="status"><Info size={16} aria-hidden="true" /><div><b>{preview.status === 'unsupported' ? preview.title : preview.status === 'conditions' ? '기록 가능 · ' + preview.title : '기록 가능 · ' + (preview.status === 'ready' ? '예측 가능' : '이 조건의 예측식 있음')}</b><span>{preview.status === 'ready' || preview.status === 'unsupported' || preview.status === 'conditions' ? preview.detail : '예측하려면 등록 후 예측 기준 초기 측정과 측정일을 기록해 주세요.'}</span></div></div>
    <details className="ld-more" open={!f.sameIntake || !!f.harvest || !!f.packaging || !!f.sensor || undefined}>
      <summary>입고·수확일 <small>선택</small></summary>
      <div className="ld-grid">
        <div className="ld-field wide"><label className="ld-check"><input type="checkbox" checked={f.sameIntake} onChange={e => setF(x => ({...x, sameIntake: e.target.checked, intake: e.target.checked ? x.intake : (x.intake || x.start)}))} />저장 시작일과 같은 날 입고했어요</label></div>
        {!f.sameIntake && <Field id="le-intake" label="입고일"><input id="le-intake" type="date" max={f.start || today()} value={f.intake} onChange={e => set('intake', e.target.value)} /></Field>}
        <Field id="le-harvest" label="수확일"><input id="le-harvest" type="date" max={intake || today()} value={f.harvest} onChange={e => set('harvest', e.target.value)} /></Field>
      </div>
    </details>
    {error && <p className="error-box" role="alert">{error}</p>}
  </Shell>;
}

// ───────────────────────── 측정 기록 추가·수정 ─────────────────────────
type ObsDraft = {date: string; firmness: string; firmUnit: 'N' | 'kgf'; brix: string; acidity: string; count: string; notes: string; setInitial: boolean;
  weight: string; trackedWeight: string; trackedId: string; trackedCount: string; probe: string; peeled: string; position: string; fruitTemp: string; instrument: string; defects: string};
function obsDraft(lot: Lot, o?: Observation | null): ObsDraft {
  const m = o?.details?.measure ?? (o ? null : lot.details?.measure);
  return {date: o?.date ?? today(), firmness: str(o?.firmness), firmUnit: (() => { try { return localStorage.getItem('appletrack:firmunit') === 'kgf' && !o ? 'kgf' as const : 'N' as const; } catch { return 'N' as const; } })(), brix: str(o?.brix), acidity: str(o?.acidity), count: str(o?.sample_count), notes: o?.notes ?? '', setInitial: false,
    weight: str(o?.weight), trackedWeight: str(o?.tracked_weight), trackedId: str(o?.details?.tracked?.sample_id), trackedCount: str(o?.details?.tracked?.count),
    probe: str(m?.probe_mm), peeled: str(m?.peeled), position: str(m?.position), fruitTemp: o ? str(m?.fruit_temp) : '', instrument: str(m?.instrument), defects: o?.defects ?? '미확인'};
}

export function MeasurementForm({open, lot, observation, prefill, isBaseline, hasBaseline, presetInitial = false, onClose, onSaved}: {open: boolean; lot: Lot; observation?: Observation | null; prefill?: Observation | null; isBaseline: boolean; hasBaseline: boolean; presetInitial?: boolean; onClose: () => void; onSaved: (msg: string) => void}) {
  const session = useTeamSession();
  const key = `appletrack:obsdraft:v1:${session?.userId ?? 'anon'}:${lot.id}:${observation?.id ?? (prefill ? 'initial' : 'new')}`;
  const [f, setF] = useState<ObsDraft>(() => obsDraft(lot, observation)), [busy, setBusy] = useState(false), [error, setError] = useState(''), [restored, setRestored] = useState(false);
  const ready = useRef(false);
  useEffect(() => {
    if (!open) { ready.current = false; return; }
    const raw = store.get(key); let d = {...obsDraft(lot, observation ?? prefill), ...(prefill && !observation ? {date: prefill.date} : {}), setInitial: presetInitial || (!observation && !hasBaseline && !hasInitialValues(lot) && !weatherInitial(lot))}, r = false;
    if (raw) { try { d = {...d, ...JSON.parse(raw)}; r = true; } catch { store.del(key); } }
    setF(d); setRestored(r); setError(''); ready.current = true;
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && ready.current) store.set(key, JSON.stringify(f)); }, [f, open, key]);
  const fromInitial = !!prefill && !observation;
  const set = <K extends keyof ObsDraft>(k: K, v: ObsDraft[K]) => setF(x => ({...x, [k]: v}));
  const firmN = () => { if (f.firmness.trim() === '') return null; const v = Number(f.firmness); return Number.isFinite(v) ? (f.firmUnit === 'kgf' ? v * KGF_TO_N : v) : NaN; };
  async function save() {
    setError('');
    if (!isDate(f.date)) return setError('측정일을 입력해 주세요.');
    const fn = firmN(); if (Number.isNaN(fn)) return setError('경도는 숫자로 입력해 주세요.');
    const n = (v: string) => v.trim() === '' ? null : v.trim();
    // 흔히 나오는 범위를 크게 벗어나면 한 번 더 확인만 합니다(값을 바꾸거나 막지 않음).
    const odd: string[] = [];
    const bx = Number(f.brix), ac = Number(f.acidity);
    if (f.brix.trim() && Number.isFinite(bx) && (bx < 5 || bx > 25)) odd.push(`단맛 ${f.brix} °Brix`);
    if (f.acidity.trim() && Number.isFinite(ac) && (ac < 0.05 || ac > 1.5)) odd.push(`신맛 ${f.acidity} %`);
    if (fn !== null && (fn < 10 || fn > 150)) odd.push(`단단함 ${fn.toFixed(1)} N`);
    if (odd.length && !window.confirm(`${odd.join(', ')} — 평소보다 많이 다른 값이에요. 이대로 저장할까요?`)) return;
    const body = {observation_id: observation?.id, date: f.date, sample_count: n(f.count), firmness: fn === null ? null : Number(fn.toFixed(4)), brix: n(f.brix), acidity: n(f.acidity), weight: n(f.weight), tracked_weight: n(f.trackedWeight), defects: f.defects, notes: f.notes,
      set_initial: f.setInitial || undefined,
      details: {tracked: {sample_id: n(f.trackedId), count: n(f.trackedCount)}, measure: {probe_mm: n(f.probe), peeled: f.peeled || null, position: n(f.position), fruit_temp: n(f.fruitTemp), instrument: n(f.instrument)}}};
    setBusy(true);
    try {
      await requestJson(`/api/lots/${lot.id}/${observation ? 'observation-update' : 'observations'}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      store.del(key); onSaved(observation ? '측정 기록을 고쳤습니다.' : f.setInitial ? '측정 기록을 저장하고 예측 기준 초기 측정으로 지정했습니다.' : '측정 기록을 저장했습니다.');
    } catch (e) { setError((e as Error).message); } // 저장 실패 시 입력값과 초안을 그대로 둡니다.
    finally { setBusy(false); }
  }
  const start = storageStart(lot);
  return <Shell open={open} onClose={onClose} busy={busy} title={observation ? '측정 기록 수정' : '측정 기록 추가'} desc={<>{lot.name}{lot.location ? ` · ${lot.location}` : ''}</>}
    footer={<><p className="ld-foot-note">{observation ? '이 기록만 고쳐요. 새 기록을 만들지 않아요.' : '저장하면 목록·그래프·예측에 바로 반영돼요.'}</p><button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>취소</button><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}기록 저장</button></>}>
    {restored && <div className="ld-restored" role="status"><span>작성하던 내용을 불러왔어요.</span><button type="button" className="linkbtn" onClick={() => { store.del(key); setF(obsDraft(lot, observation)); setRestored(false); }}><Undo2 size={13} />처음 값으로</button></div>}
    {fromInitial ? <p className="ld-baseline on"><b>물량 등록 때 입력한 초기 측정을 고쳐요.</b> 저장하면 이 값이 측정 기록으로 남고 예측 기준 초기 측정으로 지정돼요. 고치기 전 값은 ‘이전 예측 기준값 이력’에 남아요.</p>
      : isBaseline ? <p className="ld-baseline on"><b>현재 예측 기준 초기 측정이에요.</b> 고치면 예측에 쓰는 초기값도 함께 바뀌어요.</p>
      : null}
    <div className="ld-guide"><p>측정한 항목만 입력하세요. 빈칸은 미측정으로 남겨둘게요.</p><p>측정한 사과들의 평균값을 입력해 주세요.</p></div>
    <div className="ld-grid">
      <Field id="mf-date" label="측정일" hint={`저장 시작일 ${start} 이후 · 오늘까지`}><input id="mf-date" type="date" min={lot.intake_date} max={today()} value={f.date} onChange={e => set('date', e.target.value)} /><div className="ld-row ld-quickdates">{[['오늘', today()], ['어제', new Date(Date.parse(today() + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10)]].map(([t, d]) => <button key={t} type="button" className={'btn ' + (f.date === d ? 'btn-primary' : 'btn-outline')} onClick={() => set('date', d)}>{t}</button>)}</div></Field>
      <Field id="mf-brix" label={<>단맛(당도) <small>°Brix · 당도계</small></>}><input id="mf-brix" type="number" inputMode="decimal" step="any" min={0} value={f.brix} placeholder="예: 14.2" onChange={e => set('brix', e.target.value)} /></Field>
      <Field id="mf-firm" label="단단함(경도) · 있으면" hint="경도계 화면 숫자를 그대로 넣고, 화면이 kg이면 kg을 골라 주세요(N으로 바꿔 계산해요, 1 kg = 9.8 N). kg/cm²는 다른 단위예요."><div className="ld-row"><input id="mf-firm" type="number" inputMode="decimal" step="any" min={0} value={f.firmness} placeholder="예: 38.5" onChange={e => set('firmness', e.target.value)} />
        <select aria-label="경도 단위" value={f.firmUnit} onChange={e => { const u = e.target.value as 'N' | 'kgf'; set('firmUnit', u); try { localStorage.setItem('appletrack:firmunit', u); } catch { /* 저장 못 해도 동작 */ } }}><option value="N">N</option><option value="kgf">kg (kgf)</option></select></div>
        {f.firmUnit === 'kgf' && f.firmness.trim() !== '' && Number.isFinite(Number(f.firmness)) && <p className="ld-hint">저장 값: {(Number(f.firmness) * KGF_TO_N).toFixed(1)} N (1 kgf = 9.80665 N)</p>}</Field>
      <Field id="mf-acid" label={<>신맛(산도) <small>% · 있으면</small></>}><input id="mf-acid" type="number" inputMode="decimal" step="any" min={0} value={f.acidity} placeholder="예: 0.32" onChange={e => set('acidity', e.target.value)} /></Field>
      <Field id="mf-notes" label={<>메모 <small>선택</small></>} wide><textarea id="mf-notes" rows={2} maxLength={1000} value={f.notes} placeholder="측정 방법, 관찰 내용" onChange={e => set('notes', e.target.value)} /></Field>
    </div>
    {error && <p className="error-box" role="alert">{error} 입력한 내용은 그대로 남아 있어요.</p>}
  </Shell>;
}
