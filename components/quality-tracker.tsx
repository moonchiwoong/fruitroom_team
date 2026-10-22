'use client';
import {Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {AlertTriangle, BookOpen, Check, ChevronDown, Download, FlaskConical, Info, Loader2, Pin, PinOff, RotateCcw, Save, Thermometer, Undo2} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {ObservationForm, requestJson} from '@/components/lot-forms';
import {ChartLegend, HardnessConvert, KindBadge, TrackerChart} from '@/components/tracker-parts';
import {demoAnalysis, demoLots} from '@/lib/demo-lots';
import type {Lot, Observation, Stats} from '@/lib/lot-types';
import {
  addDays, calcNoun, computeSeries, daysBetween, describeChange, fmtDate, fmtNum, isDate, measuredPoints, metricIds, metricMeta, MODEL_RANGE, MODEL_VERSION,
  modelLabel, resolveModel, STORAGE_MODEL_VERIFIED, summarySentence, todayKST, valueAt,
  type Anchor, type DataKind, type MeasuredPoint, type MetricId, type Series, type StorageCondition, type ValueAt,
} from '@/lib/tracker';
import {clearDraft, emptyForm, exampleForm, formFromLot, loadDraft, loadPref, payloadFromForm, saveDraft, savePref, signature, validateForm, type Draft, type TrackerForm} from '@/lib/tracker-form';
import type {StorageId} from '@/lib/initial-quality';

const FruitViewer = dynamic(() => import('@/components/fruit-viewer'), {ssr: false, loading: () => <div className="t3d-empty"><Loader2 className="spin" size={18} />3D 예시를 불러오는 중…</div>});

type Mode = 'real' | 'example';
type Loaded = {lot: Lot | null; observations: Observation[]; stats: Stats | null};
type Baseline = {kind: 'current' | 'fixed'; label: string; conditionLabel: string; sig: string; series: Record<MetricId, Series>; createdAt: string; asOf: string; modelVersion: string; future: StorageId | null};
const MODEL_COND: Record<StorageId, StorageCondition> = {cold: {storage: '일반 저온', mcp: '미처리'}, mcp: {storage: '일반 저온', mcp: '처리'}, ca: {storage: 'CA', mcp: '미처리'}};
const num = (v: string) => v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);

export type TrackerRequest = {mode: Mode; lotId?: string; n: number};
export default function QualityTracker({lots, onLotsChanged, request, openModelInfo, openLot}: {
  lots: Lot[]; onLotsChanged: () => Promise<Lot[]> | void; request?: TrackerRequest | null; openModelInfo: () => void; openLot: (id: string) => void;
}) {
  const session = useTeamSession(); const user = session?.userId ?? 'anon';
  const today = todayKST();
  const [mode, setMode] = useState<Mode>(() => request?.mode ?? loadPref<Mode>(user, 'mode', 'real'));
  const [lotKey, setLotKey] = useState<string>(() => request?.lotId ?? loadPref<string>(user, 'lot', 'new'));
  // 다른 화면에서 ‘실측값 입력’·‘예시로 체험’·‘품질 변화 보기’로 들어온 경우
  useEffect(() => { if (!request) return; setMode(request.mode); if (request.lotId !== undefined) setLotKey(request.lotId); setBaseline(null); setSelectedDay(null); }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { savePref(user, 'mode', mode); }, [user, mode]);
  useEffect(() => { savePref(user, 'lot', lotKey); }, [user, lotKey]);
  const key = mode === 'example' ? 'example' : lotKey;
  useEffect(() => { if (mode === 'real' && lotKey !== 'new' && lots.length && !lots.some(l => l.id === lotKey)) setLotKey('new'); }, [lots, lotKey, mode]);

  // ── 저장된 기록 불러오기 ──
  const [loaded, setLoaded] = useState<Loaded>({lot: null, observations: [], stats: null});
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    setLoadError('');
    if (mode === 'example') { const d = demoLots()[0], a = demoAnalysis(d, today); setLoaded({lot: null, observations: a.observations.map(o => ({...o, acidity: null, tracked_weight: null})), stats: a.stats}); return; }
    if (lotKey === 'new') { setLoaded({lot: null, observations: [], stats: null}); return; }
    const lot = lots.find(l => l.id === lotKey); if (!lot) return;
    const ctl = new AbortController(); setLoading(true);
    requestJson<{lot: Lot; observations: Observation[]; stats: Stats}>(`/api/lots/${lotKey}/analysis?asOf=${today}`, {signal: ctl.signal})
      .then(d => setLoaded({lot: d.lot, observations: d.observations, stats: d.stats}))
      .catch(e => { if (e.name !== 'AbortError') { setLoaded({lot, observations: [], stats: null}); setLoadError((e as Error).message); } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [mode, lotKey, lots, reload, today]);

  const official = useMemo<TrackerForm>(() => mode === 'example' ? exampleForm() : loaded.lot ? formFromLot(loaded.lot) : emptyForm(), [mode, loaded.lot]);
  const officialSig = signature(official);

  // ── 입력 양식 + 초안 자동 복구 ──
  const [form, setFormState] = useState<TrackerForm>(official);
  const [draftNote, setDraftNote] = useState<{tone: 'ok' | 'warn' | 'info'; text: string} | null>(null);
  const [conflict, setConflict] = useState<Draft | null>(null);
  const readyKey = useRef('');
  const officialReady = mode === 'example' || lotKey === 'new' || (loaded.lot?.id === lotKey);
  useEffect(() => {
    if (!officialReady) return;
    const k = `${user}|${mode}|${key}|${officialSig}`; if (readyKey.current === k) return; readyKey.current = k;
    const d = loadDraft(user, mode, key); setConflict(null);
    if (!d) { setFormState(official); setDraftNote(null); return; }
    if (d.baseSig !== officialSig) { setFormState(official); setConflict(d); setDraftNote(null); return; }
    if (signature(d.form) !== officialSig) { setFormState(d.form); setDraftNote({tone: 'info', text: `작성 중인 내용을 복구했습니다 (${new Date(d.savedAt).toLocaleString('ko-KR')} 임시 저장).`}); }
    else { setFormState(official); clearDraft(user, mode, key); setDraftNote(null); }
  }, [officialReady, user, mode, key, officialSig, official]);

  const setForm = useCallback((updater: (f: TrackerForm) => TrackerForm) => {
    setFormState(prev => {
      const next = updater(prev);
      if (signature(next) === officialSig) { clearDraft(user, mode, key); setDraftNote(null); }
      else {
        const ok = saveDraft(user, mode, key, {form: next, baseSig: officialSig, savedAt: new Date().toISOString()});
        setDraftNote(ok ? {tone: 'ok', text: `입력 내용 임시 저장됨 · ${new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})}`} : {tone: 'warn', text: '임시 저장에 실패했습니다. 입력 내용은 화면에 남아 있지만, 새로고침하면 사라질 수 있습니다.'});
      }
      return next;
    });
  }, [officialSig, user, mode, key]);
  const set = <K extends keyof TrackerForm>(k: K, v: TrackerForm[K]) => setForm(f => ({...f, [k]: v}));
  const setSub = <K extends 'measure' | 'mcpd' | 'ca' | 'tracked'>(k: K, sub: string, v: string) => setForm(f => ({...f, [k]: {...f[k], [sub]: v}}));
  const dirty = signature(form) !== officialSig;
  function discardDraft() { clearDraft(user, mode, key); setFormState(official); setDraftNote({tone: 'info', text: '초안을 지웠습니다. 저장된 기록은 그대로입니다.'}); }

  // ── 날짜 ──
  const startDate = (form.sameStart ? form.intake_date : form.storage_start_date) || '';
  const startOk = isDate(startDate);
  const [asOfRaw, setAsOf] = useState(today);
  const asOf = startOk && asOfRaw < startDate ? startDate : asOfRaw;
  const asOfDay = startOk ? daysBetween(startDate, asOf) : 0;
  const measuredOn = form.initial_measured_on || startDate;
  const t0 = startOk && isDate(measuredOn) ? daysBetween(startDate, measuredOn) : 0;
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const selDay = selectedDay ?? Math.min(MODEL_RANGE.displayDays, Math.max(0, asOfDay + 30));
  const selDate = startOk ? addDays(startDate, selDay) : '';

  // ── 조건과 모델 ──
  const recorded = resolveModel({storage: form.storage, mcp: form.mcp});
  const [futureId, setFutureId] = useState<StorageId | 'same'>('same');
  const future = futureId === 'same' ? recorded : {id: futureId, reason: ''};
  const futureLabel = futureId === 'same' ? `기록 조건 유지${recorded.id ? ` (${modelLabel[recorded.id]})` : ''}` : modelLabel[futureId];
  const [useLatest, setUseLatest] = useState(false);
  const [metric, setMetric] = useState<MetricId>('firmness');
  // 모바일에서는 입력 영역을 접은 상태로 시작합니다(결과·그래프 먼저).
  const [narrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);

  // ── 실측(또는 예시) 기록과 계산 ──
  const exampleMode = mode === 'example';
  const kind: DataKind = exampleMode ? '예시' : '실측';
  const trackedInitial = num(form.tracked.initial_weight);
  const pastObs = useMemo(() => loaded.observations.filter(o => o.date <= asOf), [loaded.observations, asOf]);
  const excludedLater = loaded.observations.length - pastObs.length;
  const measured = useMemo(() => Object.fromEntries(metricIds.map(m => [m, startOk ? measuredPoints(m, pastObs, startDate, kind, trackedInitial) : []])) as Record<MetricId, MeasuredPoint[]>, [pastObs, startDate, startOk, kind, trackedInitial]);
  const anchors = useMemo(() => Object.fromEntries(metricIds.map(m => {
    if (!startOk) return [m, null];
    const latest = useLatest ? [...measured[m]].reverse().find(p => p.day >= t0) : undefined;
    if (latest) return [m, {day: latest.day, date: latest.date, value: latest.value, kind: latest.kind, source: 'latest'} as Anchor];
    const v = m === 'loss' ? 0 : num(form[m]);
    return [m, v === null ? null : {day: t0, date: measuredOn, value: v, kind: m === 'loss' ? '모델 계산' : kind, source: 'initial'} as Anchor];
  })) as Record<MetricId, Anchor | null>, [startOk, useLatest, measured, t0, form, measuredOn, kind]);
  const series = useMemo(() => Object.fromEntries(metricIds.map(m => [m, computeSeries({metric: m, anchor: anchors[m], recorded: recorded.id, recordedReason: recorded.reason, future: future.id, futureReason: future.reason, asOfDay})])) as Record<MetricId, Series>, [anchors, recorded.id, recorded.reason, future.id, future.reason, asOfDay]);
  const at = (m: MetricId, d = selDay): ValueAt => valueAt(series[m], d);

  // ── 비교 기준 ──
  const compatSig = JSON.stringify({mode, key, startDate, measuredOn, f: form.firmness, b: form.brix, a: form.acidity, tw: form.tracked.initial_weight, st: form.storage, mcp: form.mcp, obs: pastObs.map(o => [o.id, o.date, o.firmness, o.brix, o.acidity, o.tracked_weight]), asOf, useLatest});
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const compatible = !!baseline && baseline.sig === compatSig;
  function fixBaseline(kindB: 'current' | 'fixed') {
    const s = kindB === 'current'
      ? Object.fromEntries(metricIds.map(m => [m, computeSeries({metric: m, anchor: anchors[m], recorded: recorded.id, recordedReason: recorded.reason, future: recorded.id, futureReason: recorded.reason, asOfDay})])) as Record<MetricId, Series>
      : series;
    const condLabel = kindB === 'current' ? `기록 조건 유지${recorded.id ? ` (${modelLabel[recorded.id]})` : ''}` : futureLabel;
    setBaseline({kind: kindB, label: kindB === 'current' ? '현재 조건 유지' : '고정한 기준', conditionLabel: condLabel, sig: compatSig, series: s, createdAt: new Date().toISOString(), asOf, modelVersion: MODEL_VERSION, future: kindB === 'current' ? recorded.id : future.id});
  }
  const changeLabel = baseline?.kind === 'current' ? `개선 조건 적용: ${futureLabel}` : `변경 조건: ${futureLabel}`;
  const baseAt = (m: MetricId): ValueAt | null => baseline && compatible ? valueAt(baseline.series[m], selDay) : null;
  const sameAsBaseline = !!baseline && compatible && baseline.future === future.id;

  // ── 단계 안내 ──
  const anyInitial = ['firmness', 'brix', 'acidity'].some(k => num(form[k as 'firmness']) !== null);
  const step1 = startOk && anyInitial, step2 = !!recorded.id || (!!future.id && asOfDay <= t0);
  const step = !step1 ? 1 : !step2 ? 2 : 3;
  const nextHint = !startOk ? '저장 시작일(또는 입고일)을 입력하세요.' : !anyInitial ? '초기 경도·당도·산도 중 측정한 값을 입력하세요. 한 항목만 있어도 됩니다.'
    : !step2 ? recorded.reason || '저장 조건을 선택하세요.' : '그래프와 결과 카드에서 날짜를 골라 변화를 확인하세요.';
  const errors = validateForm(form, false);
  const focus = (id: string) => { const el = document.getElementById(id); if (el) { el.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => (el as HTMLInputElement).focus(), 300); } };

  // ── 정식 기록 저장 (실측 모드) ──
  const [saving, setSaving] = useState(false), [saveMsg, setSaveMsg] = useState<{ok: boolean; text: string} | null>(null), [saveErrors, setSaveErrors] = useState<Partial<Record<string, string>>>({});
  async function saveRecord() {
    const e = validateForm(form, true); setSaveErrors(e); setSaveMsg(null);
    if (Object.keys(e).length) { setSaveMsg({ok: false, text: '표시한 항목을 확인해 주세요.'}); focus('tf-' + Object.keys(e)[0]); return; }
    if (loaded.lot && !window.confirm('저장된 물량 기록을 지금 입력한 값으로 바꿉니다. 계속할까요?')) return;
    setSaving(true);
    try {
      const payload = payloadFromForm(form);
      if (loaded.lot) {
        const {team_shared: _t, ...rest} = payload; void _t;
        await requestJson(`/api/lots/${loaded.lot.id}/update`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(rest)});
        clearDraft(user, mode, key); readyKey.current = ''; setReload(r => r + 1); await onLotsChanged();
        setSaveMsg({ok: true, text: '물량 기록을 저장했습니다.'});
      } else {
        const r = await requestJson<{lot: Lot}>('/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
        clearDraft(user, mode, 'new'); readyKey.current = ''; await onLotsChanged(); setLotKey(r.lot.id);
        setSaveMsg({ok: true, text: `‘${r.lot.name}’ 물량으로 저장했습니다.`});
      }
    } catch (err) { setSaveMsg({ok: false, text: (err as Error).message}); }
    finally { setSaving(false); }
  }

  // ── 측정값과 비교 ──
  const [showObsCompare, setShowObsCompare] = useState(false);

  const summary = startOk ? summarySentence({
    metric, day: selDay, date: selDate, at: at(metric), anchor: anchors[metric],
    measuredToday: measured[metric].find(p => p.day === selDay) ?? null,
    baseline: baseline && compatible && !sameAsBaseline ? {label: `${baseline.label} · ${baseline.conditionLabel}`, at: valueAt(baseline.series[metric], selDay)} : null,
    changeLabel: futureLabel,
  }) : '저장 시작일을 입력하면 날짜별 변화를 요약해 드립니다.';

  const lotName = exampleMode ? '예시 물량 · 후지' : loaded.lot?.name ?? (form.name || '새 입력(저장 전)');
  const env = loaded.stats;

  return <div className={'qt' + (exampleMode ? ' is-example' : '')}>
    {/* 상단: 물량 · 품종 · 분석 기준일 · 모드 */}
    <section className="qt-top" aria-label="물량과 입력 모드">
      <div className="qt-mode seg" role="tablist" aria-label="입력 모드">
        <button role="tab" aria-selected={!exampleMode} className={!exampleMode ? 'active' : ''} onClick={() => setMode('real')}>실측값 사용</button>
        <button role="tab" aria-selected={exampleMode} className={exampleMode ? 'active' : ''} onClick={() => setMode('example')}>예시로 체험</button>
      </div>
      <label className="qt-field">물량
        {exampleMode ? <span className="qt-static">예시 물량 · 후지 <KindBadge kind="예시" /></span>
          : <select value={lotKey} onChange={e => { setLotKey(e.target.value); setBaseline(null); setSelectedDay(null); }}>
            <option value="new">새 입력 (아직 저장 안 함)</option>
            {lots.map(l => <option key={l.id} value={l.id}>{l.name}{l.team_shared ? ' · 팀 공유' : ''}</option>)}
          </select>}
      </label>
      <div className="qt-field"><span>품종</span><span className="qt-static">{form.variety || '미입력'}</span></div>
      <label className="qt-field">분석 기준일
        <input type="date" value={asOf} min={startOk ? startDate : undefined} max={today} onChange={e => { if (e.target.value) setAsOf(e.target.value); }} />
      </label>
      {!exampleMode && loaded.lot && <button className="btn btn-ghost qt-open" onClick={() => openLot(loaded.lot!.id)}>물량 상세</button>}
    </section>
    {exampleMode && <div className="qt-banner ex"><FlaskConical size={16} /><span><b>예시로 체험 중</b> — 화면의 초기값·측정점은 기능 확인용 예시값이며 실제 측정 기록이 아닙니다. 서버에 저장하지 않습니다.</span></div>}
    {loadError && <div className="qt-banner warn"><AlertTriangle size={16} />{loadError}</div>}

    {/* 단계 안내 */}
    <ol className="qt-steps" aria-label="진행 단계">
      {['초기 품질 입력', '저장 조건 선택', '변화 확인'].map((t, i) => <li key={t} className={step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
        <span>{step > i + 1 ? <Check size={14} /> : ['①', '②', '③'][i]}</span>{t}</li>)}
      <li className="qt-next"><b>다음:</b> {nextHint}</li>
    </ol>

    <div className="qt-grid">
      {/* 왼쪽: 입력 */}
      <aside className="qt-input" aria-label="입력">
        <details className="qt-collapse" open={!narrow}>
          <summary><span className="qt-num">①</span>초기 품질 입력</summary>
          <div className="qt-draftbar">
            {draftNote ? <span className={'draft-' + draftNote.tone}>{draftNote.text}</span> : <span className="draft-info">{dirty ? '입력 중' : exampleMode ? '예시값' : loaded.lot ? '저장된 기록과 같음' : '새 입력'}</span>}
            {dirty && <button type="button" className="linkbtn" onClick={discardDraft}><Undo2 size={13} />초안 지우기</button>}
          </div>
          {conflict && <div className="qt-banner warn small"><AlertTriangle size={15} /><div>이 물량의 저장된 기록이 초안 작성 이후 바뀌었습니다. 초안은 자동으로 적용하지 않았어요.
            <div className="qt-inline-btns"><button className="btn btn-ghost" onClick={() => { setFormState(conflict.form); saveDraft(user, mode, key, {...conflict, baseSig: officialSig}); setConflict(null); setDraftNote({tone: 'info', text: '이전 초안을 불러왔습니다. 저장된 기록과 다른 부분을 확인하세요.'}); }}>초안 불러오기</button>
              <button className="btn btn-ghost" onClick={() => { clearDraft(user, mode, key); setConflict(null); }}>저장된 기록 유지</button></div></div></div>}

          {!exampleMode && !loaded.lot && <div className="qt-fields two">
            <F id="name" label="물량 이름" err={saveErrors.name}><input id="tf-name" value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} placeholder="예: 후지 A동 1차" /></F>
            <F id="variety" label="품종" err={saveErrors.variety}><input id="tf-variety" value={form.variety} onChange={e => set('variety', e.target.value)} maxLength={120} /></F>
            {session?.isTeam && <label className="qt-check span2"><input type="checkbox" checked={form.team_shared} onChange={e => set('team_shared', e.target.checked)} />팀과 공유 (선택하지 않으면 나만 볼 수 있어요)</label>}
          </div>}
          {(exampleMode || loaded.lot) && <div className="qt-fields two"><F id="variety" label="품종"><input id="tf-variety" value={form.variety} onChange={e => set('variety', e.target.value)} maxLength={120} /></F><div /></div>}
          <div className="qt-fields two">
            <F id="harvest_date" label="수확일" err={errors.harvest_date}><input id="tf-harvest_date" type="date" max={today} value={form.harvest_date} onChange={e => set('harvest_date', e.target.value)} /></F>
            <F id="intake_date" label="입고일" err={saveErrors.intake_date || errors.intake_date}><input id="tf-intake_date" type="date" max={today} value={form.intake_date} onChange={e => set('intake_date', e.target.value)} /></F>
          </div>
          <div className="qt-fields">
            <F id="storage_start_date" label="저장 시작일" hint="이 날을 저장 0일차로 계산합니다." err={errors.storage_start_date}>
              <label className="qt-check"><input type="checkbox" checked={form.sameStart} onChange={e => set('sameStart', e.target.checked)} />입고일과 같음</label>
              {!form.sameStart && <input id="tf-storage_start_date" type="date" max={today} value={form.storage_start_date} onChange={e => set('storage_start_date', e.target.value)} />}
            </F>
          </div>
          <div className="qt-fields two">
            <F id="initial_measured_on" label="측정일" hint={!form.initial_measured_on && startOk ? '비워 두면 저장 시작일에 측정한 것으로 가정합니다.' : undefined} err={errors.initial_measured_on}><input id="tf-initial_measured_on" type="date" max={today} value={form.initial_measured_on} onChange={e => set('initial_measured_on', e.target.value)} /></F>
            <F id="initial_sample_count" label="표본 수" unit="개" err={errors.initial_sample_count}><input id="tf-initial_sample_count" type="number" inputMode="numeric" min={1} step={1} value={form.initial_sample_count} onChange={e => set('initial_sample_count', e.target.value)} placeholder="미입력" /></F>
          </div>
          <div className="qt-fields two">
            <F id="firmness" label="초기 경도" unit="N" err={errors.firmness} extra={<HardnessConvert valueN={num(form.firmness)} probeMm={num(form.measure.probe_mm)} />}>
              <input id="tf-firmness" type="number" inputMode="decimal" step="0.1" value={form.firmness} onChange={e => set('firmness', e.target.value)} placeholder="미측정" /></F>
            <F id="brix" label="초기 당도" unit="°Brix" err={errors.brix}><input id="tf-brix" type="number" inputMode="decimal" step="0.1" value={form.brix} onChange={e => set('brix', e.target.value)} placeholder="미측정" /></F>
          </div>
          <p className="qt-help">경도는 최대 힘(N)으로 기록합니다. {metricMeta.firmness.note}</p>
          <details className="qt-sub">
            <summary>경도 측정 정보 (탐침 직경·껍질·위치·과실 온도)</summary>
            <div className="qt-fields two">
              <F id="probe_mm" label="탐침 직경" unit="mm" err={errors.probe_mm}><input id="tf-probe_mm" type="number" inputMode="decimal" step="0.1" value={form.measure.probe_mm} onChange={e => setSub('measure', 'probe_mm', e.target.value)} placeholder="예: 11.1" /></F>
              <F id="peeled" label="껍질 제거 여부"><select id="tf-peeled" value={form.measure.peeled} onChange={e => setSub('measure', 'peeled', e.target.value)}><option value="">미기록</option><option>껍질 제거</option><option>껍질 포함</option></select></F>
              <F id="position" label="측정 위치"><input id="tf-position" value={form.measure.position} onChange={e => setSub('measure', 'position', e.target.value)} maxLength={80} placeholder="예: 적도부 양면" /></F>
              <F id="fruit_temp" label="과실 온도" unit="°C" err={errors.fruit_temp}><input id="tf-fruit_temp" type="number" inputMode="decimal" step="0.1" value={form.measure.fruit_temp} onChange={e => setSub('measure', 'fruit_temp', e.target.value)} /></F>
              <F id="instrument" label="측정 기기"><input id="tf-instrument" value={form.measure.instrument} onChange={e => setSub('measure', 'instrument', e.target.value)} maxLength={80} /></F>
            </div>
            <p className="qt-help">같은 탐침·위치·온도에서 잰 값끼리 비교하세요. 탐침 직경이 있어야 kgf/cm² 변환을 보여 드립니다.</p>
          </details>
          <details className="qt-sub">
            <summary>선택 입력 (산도·평균 중량·포장·저장고 위치·센서·추적 표본)</summary>
            <div className="qt-fields two">
              <F id="acidity" label="초기 산도" unit="%" err={errors.acidity}><input id="tf-acidity" type="number" inputMode="decimal" step="0.01" value={form.acidity} onChange={e => set('acidity', e.target.value)} placeholder="미측정" /></F>
              <F id="weight" label="평균 중량" unit="g" err={errors.weight}><input id="tf-weight" type="number" inputMode="decimal" step="0.1" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="미측정" /></F>
              <F id="packaging" label="포장 형태"><input id="tf-packaging" value={form.packaging} onChange={e => set('packaging', e.target.value)} maxLength={120} /></F>
              <F id="location" label="저장고 위치"><input id="tf-location" value={form.location} onChange={e => set('location', e.target.value)} maxLength={120} /></F>
              <F id="sensor_id" label="온습도 센서 번호" hint="CSV의 sensor_id와 같게"><input id="tf-sensor_id" value={form.sensor_id} onChange={e => set('sensor_id', e.target.value)} maxLength={60} /></F>
              <F id="tracked_count" label="추적 표본 수" unit="개" hint="같은 과실을 계속 무게만 재는 표본"><input id="tf-tracked_count" type="number" inputMode="numeric" value={form.tracked.count} onChange={e => setSub('tracked', 'count', e.target.value)} placeholder="미입력" /></F>
              <F id="tracked_weight" label="추적 표본 초기 평균 중량" unit="g" err={errors.tracked_weight}><input id="tf-tracked_weight" type="number" inputMode="decimal" step="0.1" value={form.tracked.initial_weight} onChange={e => setSub('tracked', 'initial_weight', e.target.value)} placeholder="미입력" /></F>
            </div>
            <p className="qt-help">실측 감모율은 같은 추적 표본의 초기·후속 중량이 모두 있을 때만 계산합니다. 경도처럼 파괴해서 잰 과실의 중량은 쓰지 않습니다.</p>
          </details>
        </details>

        <details className="qt-collapse" open={!narrow}>
          <summary><span className="qt-num">②</span>저장 조건 선택</summary>
          <p className="qt-help">기록된 조건은 분석 기준일까지(과거 구간) 계산에 쓰입니다.</p>
          <div className="qt-fields two">
            <F id="storage" label="저장 환경"><select id="tf-storage" value={form.storage} onChange={e => set('storage', e.target.value as TrackerForm['storage'])}><option>일반 저온</option><option>CA</option><option>기타</option></select></F>
            <F id="mcp" label="1-MCP 처리 이력"><select id="tf-mcp" value={form.mcp} onChange={e => set('mcp', e.target.value as TrackerForm['mcp'])}><option>미처리</option><option>처리</option><option>미확인</option></select></F>
          </div>
          <div className={'qt-model ' + (recorded.id ? 'ok' : 'no')}>{recorded.id ? <>적용 모델: <b>{modelLabel[recorded.id]}</b> <KindBadge kind="모델 계산" verified={false} /></> : <><AlertTriangle size={14} />{recorded.reason} 이 조건의 수치 예측은 제한합니다.</>}</div>
          {form.mcp === '처리' && <details className="qt-sub" open={!!(form.mcpd.treated_on || form.mcpd.product)}>
            <summary>1-MCP 처리 이력</summary>
            <div className="qt-fields two">
              <F id="mcp_on" label="처리일"><input type="date" max={today} value={form.mcpd.treated_on} onChange={e => setSub('mcpd', 'treated_on', e.target.value)} /></F>
              <F id="mcp_product" label="제품명"><input value={form.mcpd.product} onChange={e => setSub('mcpd', 'product', e.target.value)} maxLength={80} /></F>
              <F id="mcp_conc" label="농도"><input value={form.mcpd.concentration} onChange={e => setSub('mcpd', 'concentration', e.target.value)} maxLength={40} placeholder="예: 1 µL/L" /></F>
              <F id="mcp_h" label="처리 시간" unit="h"><input type="number" value={form.mcpd.hours} onChange={e => setSub('mcpd', 'hours', e.target.value)} /></F>
              <F id="mcp_t" label="처리 온도" unit="°C"><input type="number" value={form.mcpd.temp} onChange={e => setSub('mcpd', 'temp', e.target.value)} /></F>
            </div>
            <p className="qt-help">처리 세부값은 기록용입니다. 처리 여부만으로 경도·점수를 보정하지 않습니다.</p>
          </details>}
          {form.storage === 'CA' && <details className="qt-sub" open={!!(form.ca.from || form.ca.o2)}>
            <summary>CA 저장 환경</summary>
            <div className="qt-fields two">
              <F id="ca_from" label="적용 시작일"><input type="date" value={form.ca.from} onChange={e => setSub('ca', 'from', e.target.value)} /></F>
              <F id="ca_to" label="적용 종료일"><input type="date" value={form.ca.to} onChange={e => setSub('ca', 'to', e.target.value)} /></F>
              <F id="ca_o2" label="산소 농도" unit="%"><input type="number" step="0.1" value={form.ca.o2} onChange={e => setSub('ca', 'o2', e.target.value)} /></F>
              <F id="ca_co2" label="이산화탄소 농도" unit="%"><input type="number" step="0.1" value={form.ca.co2} onChange={e => setSub('ca', 'co2', e.target.value)} /></F>
            </div>
          </details>}
          <div className={'qt-env ' + (env?.count ? '' : 'none')}><Thermometer size={15} />
            {env?.count ? <span>온습도 이력 {env.count.toLocaleString()}건{env.gapCount ? ` · 기록 공백 ${env.gapCount}구간(보간하지 않음)` : ''}. <b>표시만 하고 계산에는 반영하지 않습니다</b> — 현재 저장 모델은 온습도를 입력으로 쓰지 않습니다.</span>
              : <span><b>고정 조건 가정</b> — 온습도 이력이 없습니다. 계산은 선택한 저장 조건이 그대로 유지된다고 가정합니다.</span>}
          </div>
        </details>

        {!exampleMode && <div className="qt-savebox">
          <button className="btn btn-primary" onClick={saveRecord} disabled={saving || (!dirty && !!loaded.lot)}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{loaded.lot ? '변경 내용을 기록에 저장' : '물량 기록으로 저장'}</button>
          {loaded.lot && <ObservationForm lot={loaded.lot} onSaved={() => { setReload(r => r + 1); }} disabled={false} />}
          {saveMsg && <p className={saveMsg.ok ? 'qt-ok' : 'auth-error'} role="status">{saveMsg.text}</p>}
          <p className="qt-help">임시 저장(초안)은 이 브라우저에만 남습니다. ‘저장’을 눌러야 정식 기록이 됩니다.</p>
        </div>}
      </aside>

      {/* 가운데: 요약 · 지표 탭 · 그래프 · 비교 */}
      <section className="qt-main" aria-label="결과">
        <div className="qt-dates">
          <div><span>저장 시작일</span><b>{startOk ? fmtDate(startDate) : '미입력'}</b></div>
          <div><span>분석 기준일</span><b>{fmtDate(asOf)}{startOk && <small> · {asOfDay}일차</small>}</b></div>
          <div className="qt-seldate"><span>선택 날짜</span>
            <input type="date" aria-label="선택 날짜" value={selDate} disabled={!startOk} min={startDate} max={startOk ? addDays(startDate, MODEL_RANGE.displayDays) : undefined}
              onChange={e => { if (startOk && isDate(e.target.value)) setSelectedDay(Math.max(0, Math.min(MODEL_RANGE.displayDays, daysBetween(startDate, e.target.value)))); }} /></div>
          <div><span>저장 경과일</span><b className="qt-big">{startOk ? `저장 ${selDay}일차` : '—'}</b></div>
        </div>
        <input className="qt-slider" type="range" min={0} max={MODEL_RANGE.displayDays} value={selDay} disabled={!startOk} onChange={e => setSelectedDay(+e.target.value)} aria-label="저장 경과일" />
        {startOk && t0 > 0 && <p className="qt-help">초기 측정일이 저장 {t0}일차라 계산은 그날부터 시작합니다. 그 이전 기간은 채우지 않습니다.</p>}
        {startOk && !form.initial_measured_on && anyInitial && <p className="qt-help"><Info size={13} /> 측정일이 비어 있어 저장 시작일에 측정한 것으로 가정했습니다.</p>}

        <p className="qt-summary" aria-live="polite">{summary}</p>

        <div className="seg qt-tabs" role="tablist" aria-label="지표">
          {metricIds.map(m => <button key={m} role="tab" aria-selected={metric === m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{metricMeta[m].label}</button>)}
        </div>
        <div className="qt-chartbox">
          {startOk ? <TrackerChart metric={metric} series={series[metric]} baseline={baseline && compatible && !sameAsBaseline ? {series: baseline.series[metric], label: baseline.label} : null}
            measured={measured[metric]} startDate={startDate} asOfDay={asOfDay} selectedDay={selDay} onSelect={setSelectedDay} exampleMode={exampleMode} />
            : <div className="qt-empty">저장 시작일(또는 입고일)을 입력하면 그래프가 나타납니다. <button className="linkbtn" onClick={() => focus('tf-intake_date')}>입고일 입력하기</button></div>}
          {startOk && !series[metric].ok && <div className="qt-chart-note"><AlertTriangle size={14} />{(series[metric] as {reason: string}).reason}{!anchors[metric] && metric !== 'loss' && <button className="linkbtn" onClick={() => focus('tf-' + metric)}>입력하기</button>}</div>}
          <ChartLegend exampleMode={exampleMode} hasBaseline={!!baseline && compatible && !sameAsBaseline} baselineLabel={baseline ? `${baseline.label} (회색 점선)` : ''} />
          <p className="qt-meta-line"><KindBadge kind="모델 계산" verified={false} /> 저장 모델 계산은 {STORAGE_MODEL_VERIFIED} 상태의 <b>시연용 계산</b>입니다. 오차 범위 미검증 · 표시 범위 0~{MODEL_RANGE.displayDays}일(적용 기간 미확인). <button className="linkbtn" onClick={openModelInfo}><BookOpen size={13} />모델 정보</button></p>
          {excludedLater > 0 && <p className="qt-help">분석 기준일 이후 측정 {excludedLater}건은 과거 관측에 넣지 않았습니다.</p>}
        </div>

        <div className="qt-actions">
          <label className="qt-check"><input type="checkbox" checked={useLatest} onChange={e => setUseLatest(e.target.checked)} />최근 측정값을 계산 시작점으로 사용</label>
          <span className="qt-help inline">모델을 다시 학습하지 않고, 같은 식을 최근 측정값에서 다시 이어 계산합니다.</span>
          <button className={'btn btn-ghost' + (showObsCompare ? ' on' : '')} onClick={() => setShowObsCompare(v => !v)}>측정값과 비교</button>
          <button className="btn btn-ghost" onClick={() => exportCsv({mode, lotName, form, startDate, asOf, asOfDay, selDay, recorded, futureLabel, series, measured, anchors, baseline: compatible ? baseline : null, changeLabel, useLatest})} disabled={!startOk}><Download size={15} />결과 내보내기</button>
        </div>

        {showObsCompare && <ObsCompare metric={metric} measured={measured[metric]} series={series[metric]} exampleMode={exampleMode} />}

        {/* 조건 비교 */}
        <section className="qt-compare" aria-label="조건 비교">
          <div className="qt-compare-head"><h3>조건 비교 <span className="kind k-example">체험용 비교</span></h3>
            <p>저장 방식 간 효과를 검증한 모델이 없어, 각 저장 방식 식의 일별 변화를 분석 기준일 값에 이어 붙인 <b>체험용 비교</b>입니다. 같은 물량·초기값·과거 이력을 공유합니다.</p></div>
          <div className="qt-future">
            <span>분석 기준일 이후 저장 조건</span>
            <div className="seg" role="radiogroup" aria-label="미래 저장 조건">
              <button role="radio" aria-checked={futureId === 'same'} className={futureId === 'same' ? 'active' : ''} onClick={() => setFutureId('same')}>기록 조건 유지</button>
              {(['cold', 'mcp', 'ca'] as StorageId[]).map(id => <button key={id} role="radio" aria-checked={futureId === id} className={futureId === id ? 'active' : ''} onClick={() => setFutureId(id)}>{modelLabel[id]}</button>)}
            </div>
          </div>
          <div className="qt-compare-btns">
            {!baseline && <><button className="btn btn-outline" onClick={() => { fixBaseline('current'); }} disabled={!startOk}>현재 조건과 비교</button>
              <button className="btn btn-outline" onClick={() => fixBaseline('fixed')} disabled={!startOk}><Pin size={15} />비교 기준으로 고정</button></>}
            {baseline && <><button className="btn btn-outline" onClick={() => fixBaseline('fixed')}><RotateCcw size={15} />기준 다시 설정</button>
              <button className="btn btn-ghost" onClick={() => setBaseline(null)}><PinOff size={15} />비교 해제</button></>}
          </div>
          {baseline && !compatible && <div className="qt-banner warn small"><AlertTriangle size={15} /><span>물량·초기값·과거 이력·분석 기준일이 고정한 기준과 달라 같은 조건 비교가 아닙니다. <b>기준 다시 설정</b>을 눌러 주세요. 고정한 기준은 바뀌지 않았습니다.</span></div>}
          {baseline && compatible && <>
            {baseline.kind === 'current' && sameAsBaseline && <p className="qt-help">위에서 개선 조건(다른 저장 조건)을 고르면 ‘현재 조건 유지’와 비교합니다.</p>}
            <div className="qt-vs">
              <div className="qt-vs-card base"><span className="qt-vs-tag">기준 · {baseline.label}</span><b>{baseline.conditionLabel}</b><small>고정 {new Date(baseline.createdAt).toLocaleString('ko-KR')} · 분석 기준일 {fmtDate(baseline.asOf)}</small></div>
              <div className="qt-vs-card chg"><span className="qt-vs-tag">{baseline.kind === 'current' ? '개선 조건 적용' : '변경 조건'}</span><b>{futureLabel}</b><small>같은 날짜 저장 {selDay}일차({fmtDate(selDate)})에서 비교</small></div>
            </div>
            <div className="qt-table-wrap"><table className="qt-table">
              <thead><tr><th>지표</th><th>기준</th><th>{baseline.kind === 'current' ? '개선 조건' : '변경 조건'}</th><th>차이</th></tr></thead>
              <tbody>{metricIds.map(m => { const b = baseAt(m), c = at(m), meta = metricMeta[m];
                return <tr key={m}><td>{meta.label}</td><td>{b?.status === 'ok' ? `${fmtNum(b.value, meta.digits)} ${meta.unit}` : '계산 불가'}</td><td>{c.status === 'ok' ? `${fmtNum(c.value, meta.digits)} ${meta.unit}` : '계산 불가'}</td>
                  <td>{b?.status === 'ok' && c.status === 'ok' ? describeChange(m, c.value, b.value).short : '—'}</td></tr>; })}</tbody>
            </table></div>
          </>}
        </section>
      </section>

      {/* 오른쪽: 선택 날짜 결과 */}
      <aside className="qt-results" aria-label="선택 날짜 결과">
        <h3>저장 {selDay}일차 결과 <small>{startOk ? fmtDate(selDate) : ''}</small></h3>
        {metricIds.map(m => <ResultCard key={m} metric={m} active={metric === m} onPick={() => setMetric(m)} at={at(m)} anchor={anchors[m]} measured={measured[m]} kind={kind}
          probeMm={num(form.measure.probe_mm)} onFocusInput={() => focus('tf-' + (m === 'loss' ? 'tracked_weight' : m))} selDay={selDay} />)}
      </aside>
    </div>

    <ThreeDExample />
  </div>;
}

function F({id, label, unit, hint, err, extra, children}: {id: string; label: string; unit?: string; hint?: string; err?: string; extra?: ReactNode; children: ReactNode}) {
  return <div className={'qf' + (err ? ' has-err' : '')} data-field={id}>
    <div className="qf-head"><span className="qf-label">{label}{unit && <small> ({unit})</small>}</span>{extra}</div>
    {children}
    {hint && !err && <span className="qf-hint">{hint}</span>}
    {err && <span className="qf-err" role="alert">{err}</span>}
  </div>;
}

function ResultCard({metric, active, onPick, at, anchor, measured, kind, probeMm, onFocusInput, selDay}: {metric: MetricId; active: boolean; onPick: () => void; at: ValueAt; anchor: Anchor | null; measured: MeasuredPoint[]; kind: DataKind; probeMm: number | null; onFocusInput: () => void; selDay: number}) {
  const meta = metricMeta[metric], latest = measured.at(-1), same = measured.find(p => p.day === selDay);
  return <div className={'qt-card' + (active ? ' active' : '')} onClick={onPick} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onPick(); }} aria-pressed={active}>
    <div className="qt-card-head"><b>{meta.label}</b>{at.status === 'ok' ? <KindBadge kind="모델 계산" verified={false} /> : anchor || metric === 'loss' ? <span className="kind k-missing">계산 불가</span> : <KindBadge kind="미측정" />}</div>
    {at.status === 'ok' ? <>
      <div className="qt-card-val">{fmtNum(at.value, meta.digits)}<small>{meta.unit}</small>{metric === 'firmness' && <span onClick={e => e.stopPropagation()}><HardnessConvert valueN={at.value} probeMm={probeMm} /></span>}</div>
      <div className="qt-card-sub">{calcNoun(metric)} · {at.segment === 'past' ? '과거 구간' : '미래 가정'}</div>
      {anchor && <div className="qt-card-sub">{anchor.source === 'latest' ? '계산 시작점' : '초기값'} {metric === 'loss' && anchor.source === 'initial' ? '0.00 % (계산 시작 기준)' : `${fmtNum(anchor.value, meta.digits)} ${meta.unit} · ${anchor.kind}`} → <b>{describeChange(metric, at.value, anchor.value).short}</b></div>}
    </> : <div className="qt-card-na">{metric === 'loss' && !anchor ? '' : ''}{at.reason}
      {!anchor && metric !== 'loss' && <button className="linkbtn" onClick={e => { e.stopPropagation(); onFocusInput(); }}>초기 {meta.label} 입력하기</button>}</div>}
    <div className="qt-card-obs">{same ? <>이 날 {kind === '예시' ? '예시 측정' : '실측'} <b>{fmtNum(same.value, meta.digits)} {meta.unit}</b></>
      : latest ? <>최근 {kind === '예시' ? '예시 측정' : '실측'} {fmtNum(latest.value, meta.digits)} {meta.unit} <small>({fmtDate(latest.date)}{latest.sampleCount ? ` · 표본 ${latest.sampleCount}개` : ''})</small></>
      : <>최근 측정: <span className="kind k-missing">미측정</span>{metric === 'loss' && <small> 같은 추적 표본의 중량 기록이 필요합니다.</small>}</>}</div>
    {(metric === 'brix' || metric === 'loss') && <p className="qt-card-note">{meta.note}</p>}
  </div>;
}

function ObsCompare({metric, measured, series, exampleMode}: {metric: MetricId; measured: MeasuredPoint[]; series: Series; exampleMode: boolean}) {
  const meta = metricMeta[metric];
  if (!measured.length) return <div className="qt-obs"><p className="qt-help">분석 기준일까지 {meta.label} {exampleMode ? '예시 측정' : '실측'} 기록이 없습니다.</p></div>;
  return <div className="qt-obs qt-table-wrap"><table className="qt-table">
    <caption>측정값과 같은 날짜 계산값 비교 — {meta.label} ({meta.unit})</caption>
    <thead><tr><th>측정일</th><th>경과일</th><th>{exampleMode ? '예시 측정' : '실측'}</th><th>시연용 계산</th><th>측정 − 계산</th></tr></thead>
    <tbody>{measured.map(p => { const v = valueAt(series, p.day); return <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{p.day}일차</td><td>{fmtNum(p.value, meta.digits)}</td>
      <td>{v.status === 'ok' ? fmtNum(v.value, meta.digits) : v.status === 'before' ? '계산 시작 전' : '계산 불가'}</td><td>{v.status === 'ok' ? describeChange(metric, p.value, v.value).short : '—'}</td></tr>; })}</tbody>
  </table><p className="qt-help">차이는 검증 지표가 아닙니다. 표본이 다르면(파괴 측정) 같은 과실의 변화가 아닙니다.</p></div>;
}

class Boundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? <div className="t3d-empty">3D 예시를 표시하지 못했습니다. 입력·결과·그래프는 그대로 사용할 수 있습니다.</div> : this.props.children; }
}

function ThreeDExample() {
  const [open, setOpen] = useState(false);
  return <details className="qt-3d" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary><ChevronDown size={16} />3D 외관 예시 <span className="kind k-example">외관 예시 — 실제 과실의 진단 결과가 아닙니다</span></summary>
    {open && <div className="qt-3d-body">
      <div className="qt-3d-stage"><Boundary><FruitViewer crop="apple" quality={95} /></Boundary></div>
      <ul className="qt-help">
        <li>표준 사과 형태를 보여 주는 설명용 모형입니다. 위의 경도·당도 계산값과 연결되어 있지 않습니다.</li>
        <li>경도가 낮아진다고 주름·갈변·곰팡이가 반드시 생기는 것은 아니므로, 외관 변화를 수치에 맞춰 그리지 않습니다.</li>
        <li>실제 사진은 ‘물량 상세 → 사진’에서 따로 비교하세요. 3D 예시로 출하일·보관 가능일·안전성을 판단하지 마세요.</li>
      </ul>
    </div>}
  </details>;
}

function exportCsv(o: {mode: Mode; lotName: string; form: TrackerForm; startDate: string; asOf: string; asOfDay: number; selDay: number; recorded: {id: StorageId | null; reason: string}; futureLabel: string; series: Record<MetricId, Series>; measured: Record<MetricId, MeasuredPoint[]>; anchors: Record<MetricId, Anchor | null>; baseline: Baseline | null; changeLabel: string; useLatest: boolean}) {
  const rows: (string | number)[][] = [];
  const kindIn = o.mode === 'example' ? '예시' : '실측';
  const v = (x: string) => x.trim() === '' ? '미측정' : x;
  rows.push(['애플트랙 by FarmBridge — 결과 내보내기'], ['내보낸 시각', new Date().toLocaleString('ko-KR')], ['입력 모드', o.mode === 'example' ? '예시로 체험(예시값)' : '실측값 사용'], ['물량', o.lotName], []);
  rows.push(['[입력 조건]', '값', '단위', '데이터 종류']);
  rows.push(['품종', o.form.variety || '미입력', '', kindIn], ['수확일', o.form.harvest_date || '미입력', '', ''], ['입고일', o.form.intake_date || '미입력', '', ''], ['저장 시작일(0일차)', o.startDate, '', o.form.sameStart ? '입고일과 같음' : ''],
    ['측정일', o.form.initial_measured_on || `미입력(저장 시작일로 가정)`, '', ''], ['표본 수', v(o.form.initial_sample_count), '개', kindIn],
    ['초기 경도', v(o.form.firmness), 'N', o.form.firmness ? kindIn : '미측정'], ['초기 당도', v(o.form.brix), '°Brix', o.form.brix ? kindIn : '미측정'], ['초기 산도', v(o.form.acidity), '%', o.form.acidity ? kindIn : '미측정'], ['평균 중량', v(o.form.weight), 'g', o.form.weight ? kindIn : '미측정'],
    ['탐침 직경', v(o.form.measure.probe_mm), 'mm', ''], ['껍질 제거 여부', o.form.measure.peeled || '미기록', '', ''], ['측정 위치', o.form.measure.position || '미기록', '', ''], ['과실 온도', v(o.form.measure.fruit_temp), '°C', ''],
    ['추적 표본 초기 평균 중량', v(o.form.tracked.initial_weight), 'g', ''], ['저장 환경', o.form.storage, '', ''], ['1-MCP 처리 이력', o.form.mcp, '', ''],
    ['과거 구간 모델(기록 조건)', o.recorded.id ? modelLabel[o.recorded.id] : `없음 — ${o.recorded.reason}`, '', ''], ['미래 구간 조건', o.futureLabel, '', ''],
    ['분석 기준일', o.asOf, '', `저장 ${o.asOfDay}일차`], ['계산 시작점', o.useLatest ? '지표별 최근 측정값' : '초기값', '', ''], []);
  rows.push(['[모델 정보]'], ['저장 모델', MODEL_VERSION], ['검증 상태', `${STORAGE_MODEL_VERIFIED} — 시연용 계산`], ['오차 범위', '미검증'], ['적용 범위', `표시 0~${MODEL_RANGE.displayDays}일, 원자료의 관측·검증 기간 미확인`], ['경도 지표', '최대 힘 N (kgf 등 변환값은 표시용, 내보내기에는 원래 단위만 포함)'], []);
  const head = ['저장 경과일', '날짜', '구간'];
  for (const m of metricIds) { head.push(`${metricMeta[m].label}(${metricMeta[m].unit}) 계산`); if (o.baseline) head.push(`${metricMeta[m].label} 기준`); }
  rows.push([o.baseline ? `[계산 결과 — 기준: ${o.baseline.label}(${o.baseline.conditionLabel}) / ${o.changeLabel}]` : '[계산 결과 — 시연용 계산]'], head);
  const days = new Set<number>([0, o.asOfDay, o.selDay]); for (let d = 0; d <= MODEL_RANGE.displayDays; d += 10) days.add(d);
  [...days].filter(d => d >= 0 && d <= MODEL_RANGE.displayDays).sort((a, b) => a - b).forEach(d => {
    const r: (string | number)[] = [d, addDays(o.startDate, d), d <= o.asOfDay ? '과거(기록 조건)' : '미래 가정'];
    for (const m of metricIds) {
      const a = valueAt(o.series[m], d); r.push(a.status === 'ok' ? fmtNum(a.value, metricMeta[m].digits).replace(/,/g, '') : '계산 불가');
      if (o.baseline) { const b = valueAt(o.baseline.series[m], d); r.push(b.status === 'ok' ? fmtNum(b.value, metricMeta[m].digits).replace(/,/g, '') : '계산 불가'); }
    }
    rows.push(r);
  });
  rows.push([], ['[측정 기록]', '날짜', '경과일', '값', '단위', '데이터 종류', '표본 수']);
  for (const m of metricIds) for (const p of o.measured[m]) rows.push([metricMeta[m].label, p.date, p.day, p.value, metricMeta[m].unit, p.kind === '예시' ? '예시 측정' : '실측', p.sampleCount ?? '']);
  const csv = rows.map(r => r.map(c => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `애플트랙_결과_${o.asOf}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

