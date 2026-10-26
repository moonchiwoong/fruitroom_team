'use client';
import {Component, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {AlertTriangle, ArrowUpRight, CalendarDays, Check, ChevronDown, Download, FlaskConical, Loader2, MessageCircle, Pin, PinOff, Plus, RotateCcw, Save, Thermometer, Undo2} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {ObservationForm, requestJson} from '@/components/lot-forms';
import {ChartLegend, HardnessConvert, KindBadge, TrackerChart} from '@/components/tracker-parts';
import {demoAnalysis, demoLots} from '@/lib/demo-lots';
import type {Lot, Observation, Stats} from '@/lib/lot-types';
import {
  addDays, computeSeries, daysBetween, describeChange, fmtDate, fmtNum, isDate, measuredPoints, metricIds, metricMeta, MODEL_RANGE, MODEL_VERSION,
  modelLabel, resolveModel, summarySentence, todayKST, valueAt,
  type Anchor, type DataKind, type MeasuredPoint, type MetricId, type Series, type ValueAt,
} from '@/lib/tracker';
import {HANDOFF_KEY, type TrackerHandoff, clearDraft, emptyForm, exampleForm, formFromLot, loadDraft, loadPref, payloadFromForm, saveDraft, savePref, signature, validateForm, type Draft, type TrackerForm} from '@/lib/tracker-form';
import type {StorageId} from '@/lib/initial-quality';
import {measurementCompatibility, observationFingerprint} from '@/lib/ai/context';
import {isHongroVariety} from '@/lib/cultivar';
import {calculateHongroForm, emptyHongroForm, exampleHongroForm} from '@/lib/hongro-tracker';
import {HONGRO_STORAGE_LABELS, HONGRO_UNITS, HONGRO_WEATHER_FIELDS, HONGRO_UNITS_CONFLICT} from '@/lib/hongro';
import {buildQualityExportCsv, type QualityExportInput} from '@/lib/quality-export';
import {predictQuality, getQualitySeries} from '@/lib/quality-models';
type ModelResult = ReturnType<typeof predictQuality>;
type ModelInput = Parameters<typeof predictQuality>[0];

const QualityAppleViewer = dynamic(() => import('@/components/quality-apple-viewer'), {ssr: false, loading: () => <div className="t3d-empty"><Loader2 className="spin" size={18} />3D 예시를 불러오는 중…</div>});

type Mode = 'real' | 'example';
const plainMeaning: Record<MetricId, string> = {firmness: '단단한 정도', brix: '단맛의 정도', acidity: '신맛의 정도', loss: '무게가 줄어든 비율'};
const shortDate = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}월 ${day}일`; };
type Loaded = {scope: string; lot: Lot | null; observations: Observation[]; stats: Stats | null};
type Baseline = {kind: 'current' | 'fixed'; label: string; conditionLabel: string; sig: string; series: Record<MetricId, Series>; createdAt: string; asOf: string; modelVersion: string; future: StorageId | null; form: TrackerForm; useLatest: boolean; observationsFingerprint: string};
const num = (v: string) => v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);

export type TrackerRequest = {mode: Mode; lotId?: string; cultivar?: 'fuji' | 'hongro'; n: number};

export type TrackerAIContext = {mode: Mode; scope: 'prediction'; lotId: string | null; metric: MetricId; selectedDate: string; asOf: string; form: TrackerForm; future: StorageId | 'same'; useLatest: boolean; modelVersion: string; baseline: {label: string; conditionLabel: string; createdAt: string; asOf: string; modelVersion: string; future: StorageId | null; form: TrackerForm; useLatest: boolean; observationsFingerprint: string} | null};
export default function QualityTracker({lots, onLotsChanged, request, openModelInfo, openLot, onAskAI, guest = false, onRequireLogin, onModeChange}: {
  lots: Lot[]; onLotsChanged: () => Promise<Lot[]> | void; request?: TrackerRequest | null; openModelInfo: (context?: {modelId: StorageId | null; metric: MetricId}) => void; openLot: (id: string) => void; onAskAI?: (context: TrackerAIContext) => void;
  /** 비회원 체험: 서버 기록을 읽거나 쓰지 않고, 저장할 때 로그인으로 안내합니다. */
  guest?: boolean; onRequireLogin?: () => void; onModeChange?: (mode: Mode) => void;
}) {
  const session = useTeamSession(); const user = session?.userId ?? 'anon';
  const today = todayKST();
  const [mode, setMode] = useState<Mode>(() => request?.mode ?? loadPref<Mode>(user, 'mode', 'real'));
  const [lotKey, setLotKey] = useState<string>(() => request?.lotId ?? loadPref<string>(user, 'lot', 'new'));
  // 다른 화면에서 ‘실측값 입력’·‘예시로 체험’·‘품질 변화 보기’로 들어온 경우
  useEffect(() => { if (!request) return; setMode(request.mode); if (request.lotId !== undefined) setLotKey(request.lotId); if (request.cultivar) setCultivar(request.cultivar); setBaseline(null); setSelectedDay(null); }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { savePref(user, 'mode', mode); }, [user, mode]);
  useEffect(() => { savePref(user, 'lot', lotKey); }, [user, lotKey]);
  const key = mode === 'example' ? 'example' : lotKey;
  const recordScope = `${user}|${mode}|${key}`;
  const [cultivar, setCultivar] = useState<'fuji' | 'hongro'>(() => isHongroVariety(lots.find(l => l.id === lotKey)?.variety) ? 'hongro' : 'fuji');
  const savedVariety = lots.find(l => l.id === lotKey)?.variety;
  useEffect(() => { if (mode === 'real' && lotKey !== 'new' && savedVariety) setCultivar(isHongroVariety(savedVariety) ? 'hongro' : 'fuji'); }, [mode, lotKey, savedVariety]);
  const hongro = cultivar === 'hongro';
  const scope = `${recordScope}|${cultivar}`;
  const draftKey = `${key}:${cultivar}`;
  const maxDays = hongro ? 120 : MODEL_RANGE.displayDays;
  const visibleMetrics: MetricId[] = metricIds;
  useEffect(() => { if (mode === 'real' && lotKey !== 'new' && lots.length && !lots.some(l => l.id === lotKey)) setLotKey('new'); }, [lots, lotKey, mode]);

  // ── 저장된 기록 불러오기 ──
  const [loaded, setLoaded] = useState<Loaded>({scope: '', lot: null, observations: [], stats: null});
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    const ctl = new AbortController(); setLoadError('');
    if (mode === 'example') {
      const d = demoLots()[0], a = demoAnalysis(d, today);
      setLoaded({scope: recordScope, lot: null, observations: a.observations.map(o => ({...o, acidity: null, tracked_weight: null})), stats: a.stats});
      setLoading(false); return () => ctl.abort();
    }
    if (lotKey === 'new') { setLoaded({scope: recordScope, lot: null, observations: [], stats: null}); setLoading(false); return () => ctl.abort(); }
    const lot = lots.find(l => l.id === lotKey);
    if (!lot) { setLoaded({scope: recordScope, lot: null, observations: [], stats: null}); setLoading(false); setLoadError('선택한 물량을 현재 목록에서 찾을 수 없습니다. 물량을 다시 선택하거나 목록을 새로 불러와 주세요.'); return () => ctl.abort(); }
    setLoading(true);
    requestJson<{lot: Lot; observations: Observation[]; stats: Stats}>(`/api/lots/${lotKey}/analysis?asOf=${today}`, {signal: ctl.signal})
      .then(d => { if (!ctl.signal.aborted) setLoaded({scope: recordScope, lot: d.lot, observations: d.observations, stats: d.stats}); })
      .catch(e => { if (!ctl.signal.aborted) { setLoaded({scope: recordScope, lot: null, observations: [], stats: null}); setLoadError((e as Error).message); } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [recordScope, mode, lotKey, lots, reload, today]);

  const activeLot = loaded.lot && isHongroVariety(loaded.lot.variety) === hongro ? loaded.lot : null;
  const official = useMemo<TrackerForm>(() => {
    if (mode === 'example') return hongro ? {...emptyForm(), variety: '홍로', name: '예시 물량 · 홍로', mcp: '미처리', temperature: '0', intake_date: addDays(today, -28), initial_measured_on: addDays(today, -28), hongro: exampleHongroForm()} : exampleForm();
    return activeLot ? formFromLot(activeLot) : {...emptyForm(), variety: hongro ? '홍로' : '후지', ...(hongro ? {mcp:'미처리' as const, temperature:'0'} : {}), hongro: emptyHongroForm()};
  }, [mode, activeLot, hongro, today]);
  const officialSig = signature(official);

  // ── 입력 양식 + 초안 자동 복구 ──
  const [form, setFormState] = useState<TrackerForm>(official);
  const [draftNote, setDraftNote] = useState<{tone: 'ok' | 'warn' | 'info'; text: string} | null>(null);
  const [conflict, setConflict] = useState<Draft | null>(null);
  const readyKey = useRef('');
  const [readyFormKey, setReadyFormKey] = useState('');
  const officialReady = loaded.scope === recordScope && !loading;
  const expectedFormKey = `${scope}|${officialSig}`;
  const formReady = officialReady && readyFormKey === expectedFormKey;
  useEffect(() => {
    if (!officialReady) return;
    const k = expectedFormKey; if (readyKey.current === k) return; readyKey.current = k; setReadyFormKey(k);
    const storedDraft = loadDraft(user, mode, draftKey) ?? (!hongro ? loadDraft(user, mode, key) : null);
    const d = storedDraft && isHongroVariety(storedDraft.form.variety) === hongro ? storedDraft : null; setConflict(null);
    if (!d) { setFormState(official); setDraftNote(null); return; }
    if (d.baseSig !== officialSig) { setFormState(official); setConflict(d); setDraftNote(null); return; }
    if (signature(d.form) !== officialSig) { setFormState(d.form); setDraftNote({tone: 'info', text: `작성 중인 내용을 복구했습니다 (${new Date(d.savedAt).toLocaleString('ko-KR')} 임시 저장).`}); }
    else { setFormState(official); clearDraft(user, mode, draftKey); setDraftNote(null); }
  }, [officialReady, user, mode, key, draftKey, hongro, officialSig, official, expectedFormKey]);

  const setForm = useCallback((updater: (f: TrackerForm) => TrackerForm) => {
    setFormState(prev => {
      const next = updater(prev);
      if (signature(next) === officialSig) { clearDraft(user, mode, draftKey); setDraftNote(null); }
      else {
        const ok = saveDraft(user, mode, draftKey, {form: next, baseSig: officialSig, savedAt: new Date().toISOString()});
        setDraftNote(ok ? {tone: 'ok', text: `이 기기에 임시 저장됨 · ${new Date().toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})}`} : {tone: 'warn', text: '임시 저장에 실패했습니다. 입력 내용은 화면에 남아 있지만, 새로고침하면 사라질 수 있습니다.'});
      }
      return next;
    });
  }, [officialSig, user, mode, draftKey]);
  const set = <K extends keyof TrackerForm>(k: K, v: TrackerForm[K]) => setForm(f => ({...f, [k]: v}));
  /** 체크하면 입고일과 연결, 해제하면 현재 날짜에서 바로 고칠 수 있게 입고일을 출발값으로 둡니다(오늘 날짜를 임의로 넣지 않음). */
  const toggleSameStart = (checked: boolean) => setForm(f => ({...f, sameStart: checked, storage_start_date: !checked && !f.storage_start_date ? f.intake_date : f.storage_start_date}));
  const setSub = <K extends 'measure' | 'mcpd' | 'ca' | 'tracked'>(k: K, sub: string, v: string) => setForm(f => ({...f, [k]: {...f[k], [sub]: v}}));
  const dirty = signature(form) !== officialSig;
  const errors = validateForm(form, false);
  // 접힌 영역 안에 오류가 생기면 그 영역을 열어 문제 위치가 보이게 합니다.
  const measureRef = useRef<HTMLDetailsElement>(null), optionalRef = useRef<HTMLDetailsElement>(null);
  const measureErr = !!(errors.probe_mm || errors.fruit_temp);
  const optionalErr = !!(errors.acidity || errors.weight || errors.tracked_weight || errors.tracked_count || errors.tracked_sample_id);
  useEffect(() => { if (measureErr && measureRef.current) measureRef.current.open = true; }, [measureErr]);
  useEffect(() => { if (optionalErr && optionalRef.current) optionalRef.current.open = true; }, [optionalErr]);
  function discardDraft() { clearDraft(user, mode, draftKey); setFormState(official); setDraftNote({tone: 'info', text: '초안을 지웠습니다. 저장된 기록은 그대로입니다.'}); }

  function switchCultivar(value: string) {
    const next = value === '홍로' ? 'hongro' : 'fuji';
    if (next === cultivar) return;
    setSelectionDateRaw(isDate(selDate) ? selDate : null); setSelectedDayState(selDay); setCultivar(next); setMetric('firmness'); setBaseline(null); setUseLatest(false); setFutureId('same');
    setShowConditions(false); setShowObsCompare(false); setSaveMsg(null); setSaveErrors({});
    setEditing(true); setShowResults(false);
  }

  // ── 날짜 ──
  const startDate = (form.sameStart ? form.intake_date : form.storage_start_date) || '';
  const startOk = isDate(startDate);
  const [asOfRaw, setAsOf] = useState(today);
  const asOf = startOk && asOfRaw < startDate ? startDate : asOfRaw;
  const asOfDay = startOk ? daysBetween(startDate, asOf) : 0;
  const measuredOn = form.initial_measured_on || startDate;
  const initialMeasuredAfterAsOf = isDate(measuredOn) && isDate(asOf) && measuredOn > asOf;
  const initialDateReason = '초기 측정일이 분석 기준일 이후입니다. 해당 초기값은 이 분석의 계산 시작점으로 사용할 수 없습니다. 분석 기준일을 실제 측정일 이후로 선택해 주세요.';
  const t0 = startOk && isDate(measuredOn) ? daysBetween(startDate, measuredOn) : 0;
  const [selectedDay, setSelectedDayState] = useState<number | null>(null);
  const [selectionDateRaw, setSelectionDateRaw] = useState<string | null>(null);
  const setSelectedDay = (day: number | null) => { setSelectionDateRaw(null); setSelectedDayState(day); };
  const selDay = selectionDateRaw && startOk ? daysBetween(startDate, selectionDateRaw) : selectedDay ?? (hongro ? asOfDay + 30 : Math.min(MODEL_RANGE.displayDays, Math.max(0, asOfDay + 30)));
  const selDate = startOk ? addDays(startDate, selDay) : '';
  const selectedDayLabel = Number.isFinite(selDay) ? `${selDay}일차` : '미입력';
  useEffect(() => { setSelectedDay(null); }, [recordScope]);
  const hongroCalculation = useMemo(() => {
    if (!hongro) return {result: null, error: ''};
    if (!startOk) return {result: null, error: '실제 저장 시작일을 입력해 주세요.'};
    if (errors.storage_start_date || errors.intake_date) return {result: null, error: errors.storage_start_date || errors.intake_date || '저장 시작일을 확인해 주세요.'};
    try { return {result: calculateHongroForm(form.hongro, 0), error: ''}; }
    catch (error) { return {result: null, error: error instanceof Error ? error.message : '홍로의 초기품질 입력을 확인해 주세요.'}; }
  }, [hongro, form.hongro, startOk, selDay, errors.storage_start_date, errors.intake_date]);
  const hongroResult = hongroCalculation.result;
  const sourceLabel = hongro && form.hongro.source === 'weather' ? '기상자료 기반 추정' : '직접 입력';
  const displayUnit = (m: MetricId) => hongro && m !== 'loss' ? HONGRO_UNITS[m] : metricMeta[m].unit;

  // ── 조건과 모델 ──
  const recorded = resolveModel({...form,temperature:num(form.temperature)});
  const [futureId, setFutureId] = useState<StorageId | 'same'>('same');
  const future = isHongroVariety(form.variety) || futureId === 'same' ? recorded : {id: futureId, reason: ''};
  const futureLabel = futureId === 'same' ? `기록 조건 유지${recorded.id ? ` (${modelLabel[recorded.id]})` : ''}` : modelLabel[futureId];
  const [useLatest, setUseLatest] = useState(false);
  const [metric, setMetric] = useState<MetricId>('firmness');
  const [editing, setEditing] = useState(false), [showResults, setShowResults] = useState(false), [showConditions, setShowConditions] = useState(false);
  const [inputNotice, setInputNotice] = useState('');
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const firstInput = mode === 'real' && !activeLot;
    setEditing(firstInput || hongro); setShowResults(!firstInput); setShowConditions(false); setInputNotice('');
    setBaseline(null); setFutureId('same'); setUseLatest(false); setMetric('firmness'); setShowObsCompare(false); setSaveMsg(null); setSaveErrors({});
  }, [scope, mode, key, activeLot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 실측(또는 예시) 기록과 계산 ──
  const exampleMode = mode === 'example';
  const kind: DataKind = exampleMode ? '예시' : '실측';
  const trackedInitial = num(form.tracked.initial_weight);
  const pastObs = useMemo(() => (hongro && mode==='example') || (mode === 'real' && !activeLot) ? [] : loaded.observations.filter(o => o.date <= asOf), [hongro, mode, activeLot, loaded.observations, asOf]);
  const excludedLater = loaded.observations.length - pastObs.length;
  const observationsFingerprint = useMemo(() => observationFingerprint(pastObs), [pastObs]);
  const measured = useMemo(() => Object.fromEntries(metricIds.map(m => [m, startOk ? measuredPoints(m, pastObs, startDate, kind, trackedInitial, {sampleId: form.tracked.sample_id, date: form.initial_measured_on}) : []])) as Record<MetricId, MeasuredPoint[]>, [pastObs, startDate, startOk, kind, trackedInitial, form.tracked.sample_id, form.initial_measured_on]);
  const anchors = useMemo(() => Object.fromEntries(metricIds.map(m => {
    // Stored loss curves begin at storage day zero and need no weight measurement.
    if (m === 'loss') return [m, {day:0, date:startDate, value:0, kind:'모델 계산', source:'initial'} as Anchor];
    if (!startOk || initialMeasuredAfterAsOf || errors.storage_start_date || errors.intake_date || errors.initial_measured_on || (!hongro && errors[m])) return [m, null];
    const latest = useLatest ? [...measured[m]].reverse().find(p => p.day >= t0) : undefined;
    if (latest) return [m, {day: latest.day, date: latest.date, value: latest.value, kind: latest.kind, source: 'latest'} as Anchor];
    const v = hongro ? form.hongro.source === 'weather' ? hongroResult?.initial[m] ?? null : num(form.hongro.initial[m]) : num(form[m]);
    return [m, v === null ? null : {day:t0, date:measuredOn, value:v, kind:hongro && form.hongro.source === 'weather' ? '모델 계산' : kind, source:'initial'} as Anchor];
  })) as Record<MetricId, Anchor | null>, [hongro, hongroResult, startDate, startOk, initialMeasuredAfterAsOf, useLatest, measured, t0, form, measuredOn, kind, errors.storage_start_date, errors.intake_date, errors.initial_measured_on, errors.firmness, errors.brix, errors.acidity]);
  const modelInput = (m:MetricId, day:number, temperature = num(form.temperature)):ModelInput => ({
    cultivar:form.variety, storage:form.storage === '일반 저온' ? 'cold' : form.storage === 'CA' ? 'ca' : 'other',
    temperature, mcp:form.mcp === '처리' ? 'treated' : form.mcp === '미처리' ? 'untreated' : 'unknown',
    metric:m, day, anchor:anchors[m] ? {day:anchors[m]!.day,value:anchors[m]!.value} : null,
    allowFujiReference:hongro && form.loss_reference,
  });
  const series = useMemo(() => Object.fromEntries(metricIds.map(m => {
    if (!startOk) return [m,{ok:false,reason:'실제 저장 시작일을 입력해 주세요.'}];
    if (m !== 'loss' && initialMeasuredAfterAsOf) return [m,{ok:false,reason:initialDateReason}];
    if (hongro) return [m, predictionSeries(modelInput(m, selDay), asOfDay, maxDays)];
    return [m,computeSeries({variety:form.variety,temperature:num(form.temperature),metric:m,anchor:anchors[m],recorded:recorded.id,recordedReason:recorded.reason,future:future.id,futureReason:future.reason,asOfDay})];
  })) as Record<MetricId,Series>, [startOk,hongro,form,anchors,recorded.id,recorded.reason,future.id,future.reason,asOfDay,initialMeasuredAfterAsOf,maxDays]);
  const at = (m:MetricId, d=selDay):ValueAt => {const r=valueAt(series[m],d);return r.status==='out'?{...r,reason:`모델 적용 범위 초과: ${r.reason}`}:r;};
  const modelResults = Object.fromEntries(metricIds.map(m => {
    const input=modelInput(m,selDay);
    if (!hongro && selDay > asOfDay && future.id) { input.storage=future.id==='ca'?'ca':'cold'; input.mcp=future.id==='mcp'?'treated':'untreated'; }
    const selected=predictQuality(input), plotted=at(m), r=plotted.status==='ok' && plotted.result ? plotted.result : selected;
    return [m,{...r,ok:plotted.status==='ok',value:plotted.status==='ok'?plotted.value:null,reason:plotted.status==='ok'?null:plotted.reason,
      warnings:[...r.warnings,...(!hongro && future.id!==recorded.id ? ['조건 변경 시나리오: 저장 방식 전환의 효과는 연구로 검증되지 않았습니다.'] : [])]}];
  })) as Record<MetricId,ModelResult>;
  const comparisonSeries = (temperature:number,m:MetricId) => predictionSeries(modelInput(m,selDay,temperature),asOfDay,maxDays);
  const actualLoss = measured.loss.find(p=>p.day===selDay) ?? null;

  // ── 비교 기준 ──
  const compatSig = JSON.stringify({mode, key, variety: form.variety, temperature: form.temperature, loss_reference: form.loss_reference, modelVersion: MODEL_VERSION, startDate, measuredOn, f: form.firmness, b: form.brix, a: form.acidity, tw: form.tracked.initial_weight, sample: form.tracked.sample_id, measure: form.measure, st: form.storage, mcp: form.mcp, observationsFingerprint, asOf, useLatest});
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const compatible = !!baseline && baseline.sig === compatSig;
  function fixBaseline(kindB: 'current' | 'fixed') {
    const s = kindB === 'current'
      ? Object.fromEntries(metricIds.map(m => [m, m!=='loss' && initialMeasuredAfterAsOf ? {ok: false, reason: initialDateReason} : computeSeries({variety: form.variety, temperature:num(form.temperature), metric: m, anchor: anchors[m], recorded: recorded.id, recordedReason: recorded.reason, future: recorded.id, futureReason: recorded.reason, asOfDay})])) as Record<MetricId, Series>
      : series;
    const condLabel = kindB === 'current' ? `기록 조건 유지${recorded.id ? ` (${modelLabel[recorded.id]})` : ''}` : futureLabel;
    setBaseline({kind: kindB, label: kindB === 'current' ? '현재 조건 유지' : '고정한 기준', conditionLabel: condLabel, sig: compatSig, series: s, createdAt: new Date().toISOString(), asOf, modelVersion: MODEL_VERSION, future: kindB === 'current' ? recorded.id : future.id, form: structuredClone(form), useLatest, observationsFingerprint});
  }
  const changeLabel = baseline?.kind === 'current' ? `비교 조건: ${futureLabel}` : `변경 조건: ${futureLabel}`;
  const baseAt = (m: MetricId): ValueAt | null => baseline && compatible ? valueAt(baseline.series[m], selDay) : null;
  const sameAsBaseline = !!baseline && compatible && baseline.future === future.id;

  // ── 단계 안내 ──
  const anyInitial = hongro ? ['firmness','brix','acidity'].some(m=>!!anchors[m as MetricId]) : ['firmness', 'brix', 'acidity'].some(k => num(form[k as 'firmness']) !== null);
  const step1 = startOk && (anyInitial || modelResults.loss.ok), step2 = hongro ? Object.values(modelResults).some(r=>r.ok) : !!recorded.id || (!!future.id && asOfDay <= t0);
  const step = !step1 ? 1 : !step2 ? 2 : 3;
  const nextHint = hongro ? (!startOk?'실제 저장 시작일을 입력해 주세요.':modelResults[metric].reason || '결과와 그래프에서 저장 시작일부터 0~120일을 확인하세요.') : !startOk ? '저장 시작일(또는 입고일)을 입력하세요.' : !anyInitial && !modelResults.loss.ok ? '초기 경도·당도·산도 중 측정한 값을 입력하세요. 감모율 모델은 중량 없이도 계산합니다.'
    : !step2 ? recorded.reason || '저장 조건을 선택하세요.' : '결과와 그래프에서 날짜를 골라 변화를 확인하세요.';
  const focus = (id: string) => { setEditing(true); requestAnimationFrame(() => { const el = document.getElementById(id); if (!el) return; let parent = el.parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } el.scrollIntoView({behavior: 'smooth', block: 'center'}); (el as HTMLInputElement).focus({preventScroll: true}); }); };

  // ── 정식 기록 저장 (실측 모드) ──
  const [saving, setSaving] = useState(false), [saveMsg, setSaveMsg] = useState<{ok: boolean; text: string} | null>(null), [saveErrors, setSaveErrors] = useState<Partial<Record<string, string>>>({});
  async function saveRecord() {
    if (mode === 'example') { setSaveMsg({ok: false, text: '예시 데이터는 실제 물량 기록으로 저장할 수 없습니다.'}); return; }
    if (guest || !session) { handoffToLogin(); return; }
    if (!formReady || loadError) { setSaveMsg({ok: false, text: '물량 정보를 정상적으로 불러온 뒤 저장해 주세요.'}); return; }
    const e = validateForm(form, true); setSaveErrors(e); setSaveMsg(null);
    if (Object.keys(e).length) { setSaveMsg({ok: false, text: '표시한 항목을 확인해 주세요.'}); focus('tf-' + Object.keys(e)[0].replaceAll('.', '-')); return; }
    if (activeLot && !window.confirm('저장된 물량 기록을 지금 입력한 값으로 바꿉니다. 계속할까요?')) return;
    setSaving(true);
    try {
      const payload = payloadFromForm(form, mode);
      if (activeLot) {
        const {team_shared: _t, ...rest} = payload; void _t;
        await requestJson(`/api/lots/${activeLot.id}/update`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(rest)});
        clearDraft(user, mode, draftKey); readyKey.current = ''; setReload(r => r + 1); await onLotsChanged();
        setSaveMsg({ok: true, text: '정식 기록 저장 완료'});
      } else {
        const r = await requestJson<{lot: Lot}>('/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
        clearDraft(user, mode, draftKey); readyKey.current = ''; await onLotsChanged(); setLotKey(r.lot.id);
        setSaveMsg({ok: true, text: `정식 기록 저장 완료 · ‘${r.lot.name}’`});
      }
    } catch (err) { setSaveMsg({ok: false, text: (err as Error).message}); }
    finally { setSaving(false); }
  }

  /** 로그인 후 같은 입력으로 돌아오도록 현재 입력을 넘기고 로그인 화면으로 이동합니다. 예시 모드 값은 넘기지 않습니다. */
  function handoffToLogin() {
    if (mode !== 'real') return;
    try {
      const handoff: TrackerHandoff = {cultivar, draftKey, draft: {form, baseSig: officialSig, savedAt: new Date().toISOString()}};
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff)); sessionStorage.setItem('appletrack:intent', 'real');
    } catch { setSaveMsg({ok: false, text: '이 브라우저에서 입력 내용을 넘길 수 없습니다. 입력은 화면에 그대로 있으니, 로그인 후 다시 입력해 주세요.'}); return; }
    onRequireLogin?.();
  }
  const changeMode = (m: Mode) => { if (onModeChange) onModeChange(m); else setMode(m); };

  // ── 측정값과 비교 ──
  const [showObsCompare, setShowObsCompare] = useState(false);

  const summary = startOk ? summarySentence({
    metric, day:selDay, date:selDate, at:at(metric), anchor:anchors[metric],
    measuredToday:measured[metric].find(p=>p.day===selDay) ?? null,
    baseline:baseline && compatible && !sameAsBaseline ? {label:`${baseline.label} · ${baseline.conditionLabel}`,at:valueAt(baseline.series[metric],selDay)} : null,
    changeLabel:futureLabel,
  }) : '저장 시작일을 입력하면 날짜별 변화를 요약해 드립니다.';

  const lotName = exampleMode ? `예시 물량 · ${hongro ? '홍로' : '후지'}` : activeLot?.name ?? (form.name || '새 입력(저장 전)');
  const env = activeLot || exampleMode ? loaded.stats : null;
  const selectedValue = at(metric), latestPoint = measured[metric].at(-1);
  const latestConditions = latestPoint ? measurementCompatibility(form.measure, pastObs.find(o => o.id === latestPoint.id)?.details?.measure) : null;
  const latestCalculation = latestPoint && (metric==='loss' ? t0===0 : latestConditions?.comparable) ? valueAt(series[metric], latestPoint.day) : null;
  const firstInput = mode === 'real' && !activeLot;
  const whenLabel = !Number.isFinite(selDay) ? '선택한 날' : selDay === asOfDay ? '오늘' : selDay > asOfDay ? `${selDay - asOfDay}일 후` : `${asOfDay - selDay}일 전`;
  const firstValue = metric === 'loss' ? null : hongro ? (form.hongro.source==='weather'?hongroResult?.initial[metric]??null:num(form.hongro.initial[metric])) : num(form[metric]);
  const latestBrix = hongro ? null : measured.brix.at(-1) ?? null;
  /** 결과값 아래에 나누어 보여 줄 해석 줄 (실제 선택 상태와 계산 결과에서 만듭니다) */
  const resultLines: string[] = (() => {
    const v = selectedValue; if (v.status !== 'ok') return [];
    const meta = metricMeta[metric], unit = displayUnit(metric), out: string[] = [];
    if (modelResults[metric].kind === '실측') return ['같은 추적 표본의 초기 중량과 비교한 값이에요.'];
    if (modelResults[metric].kind === '참고 추정') out.push('홍로 자료가 없어 후지 일반 저온 식으로 낸 참고 추정이에요.');
    if (baseline && compatible && !sameAsBaseline) {
      const b = valueAt(baseline.series[metric], selDay);
      if (b.status === 'ok') { const c = describeChange(metric, v.value, b.value); out.push(c.diff === 0 ? `비교 기준(${baseline.label})과 같습니다.` : `비교 기준(${baseline.label})보다 ${c.text}.`); }
      else out.push('비교 기준의 값이 없어 차이를 계산하지 않았어요.');
    } else {
      const an = anchors[metric];
      if (an) { const c = describeChange(metric, v.value, an.value); const from = an.source === 'latest' ? `계산 시작점(${fmtDate(an.date)} 측정값)` : '초기값'; out.push(c.diff === 0 ? `${from}과 같습니다.` : `${from}보다 ${c.text}.`); }
    }
    const today = measured[metric].find(p => p.day === selDay);
    if (today) out.push(`같은 날 ${exampleMode ? '예시 측정' : '실제 측정'}값은 ${fmtNum(today.value, meta.digits)} ${unit}이에요.`);
    return out;
  })();
  const firstBrix = hongro ? (form.hongro.source==='weather'?hongroResult?.initial.brix??null:num(form.hongro.initial.brix)) : num(form.brix);
  function viewResults() {
    if (hongro) {
      if (!startOk) { setInputNotice('실제 저장 시작일을 입력해 주세요.'); setShowResults(true); return; }
      setInputNotice(''); setShowResults(true); setEditing(false);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'})); return;
    }
    if (!startOk || errors.storage_start_date || errors.intake_date) { setInputNotice('저장 시작일(또는 입고일)을 확인해 주세요.'); focus(form.sameStart ? 'tf-intake_date' : 'tf-storage_start_date'); return; }
    if (!anyInitial && modelResults.loss.ok) setMetric('loss');
    if (metric !== 'loss' && errors[metric]) { setInputNotice(errors[metric]!); focus('tf-' + metric); return; }
    if (initialMeasuredAfterAsOf && !(metric==='loss' || (!anyInitial && modelResults.loss.ok))) { setInputNotice(initialDateReason); document.getElementById('qt-analysis-asof')?.focus(); return; }
    if (errors.initial_measured_on) { setInputNotice(errors.initial_measured_on); focus('tf-initial_measured_on'); return; }
    if (metric !== 'loss' && num(form[metric]) === null) {
      const available = (['firmness', 'brix', 'acidity'] as MetricId[]).find(m => m !== 'loss' && num(form[m]) !== null);
      if (available) setMetric(available);
    }
    setInputNotice(''); setShowResults(true); setEditing(false);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  }
  function askResult() {
    onAskAI?.({mode, scope: 'prediction', lotId: exampleMode ? null : loaded.lot?.id ?? null, metric, selectedDate: selDate, asOf, form, future: futureId, useLatest, modelVersion: MODEL_VERSION,
      baseline: baseline && compatible ? {label: baseline.label, conditionLabel: baseline.conditionLabel, createdAt: baseline.createdAt, asOf: baseline.asOf, modelVersion: baseline.modelVersion, future: baseline.future, form: baseline.form, useLatest: baseline.useLatest, observationsFingerprint: baseline.observationsFingerprint} : null});
  }

  if (!formReady) return <section className="qt-context-loading" role="status" aria-live="polite"><Loader2 className="spin" size={22} /><h2>사과 기록을 불러오는 중이에요</h2><p>저장된 입력값과 측정 기록을 가져오고 있어요.</p></section>;

  return <div className={'qt qt-refresh qt-v2' + (editing ? ' is-editing' : '') + (exampleMode ? ' is-example' : '') + (firstInput && !showResults ? ' is-first-input' : '')}>

    {/* 상단: 확인할 사과 · 저장 경과일 · 입력 정보 수정 */}
    <section className="qt2-bar" aria-label="확인할 사과">
      <div className="qt2-pick">
        <label htmlFor="qt-lot-select">확인할 사과</label>
        {exampleMode ? <span className="qt2-static">예시 사과 · {hongro ? '홍로' : '후지'} <KindBadge kind="예시" /></span>
          : guest ? <span className="qt2-static">새 입력 · 아직 저장 안 함</span>
          : <select id="qt-lot-select" value={lotKey} onChange={e => { setLotKey(e.target.value); setBaseline(null); setSelectedDay(null); }}>
            <option value="new">새 사과 등록 (아직 저장 안 함)</option>
            {lots.map(l => <option key={l.id} value={l.id}>{l.name}{l.name.includes(l.variety) ? '' : ` · ${l.variety}`}{l.team_shared ? ' · 팀 공유' : ''}</option>)}
          </select>}
      </div>
      <span className="qt2-days">{startOk ? `저장 ${asOfDay}일째` : '저장 시작일 미입력'}</span>
      <div className="qt2-bar-actions">
        <button className="ah-textlink" aria-expanded={editing} aria-controls="qt-input-editor" onClick={() => setEditing(v => !v)}>{editing ? '입력 접기' : '입력 정보 수정'}<ArrowUpRight size={16} /></button>
        <button className="ah-textlink qt2-mode" onClick={() => changeMode(exampleMode ? 'real' : 'example')}>{exampleMode ? '내 측정값 입력하기' : '예시로 체험하기'}</button>
      </div>
    </section>
    {exampleMode && <div className="qt-banner ex" role="note"><FlaskConical size={16} /><span><b>예시 데이터 · 실제 측정 기록이 아닙니다</b></span></div>}
    {loadError && <div className="qt-banner warn" role="alert"><AlertTriangle size={16} /><span>사과 기록을 불러오지 못했어요. {loadError}</span><button className="btn btn-ghost" onClick={() => { void onLotsChanged(); setReload(r => r + 1); }}>다시 불러오기</button></div>}

    {initialMeasuredAfterAsOf && <div className="qt-banner warn" role="alert"><AlertTriangle size={16} /><span>{initialDateReason}</span></div>}

    {/* 단계 안내 */}
    {firstInput && <ol className="qt-steps" aria-label="진행 단계">
      {['초기 품질 입력', '저장 조건 선택', '변화 확인'].map((t, i) => <li key={t} className={step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
        <span>{step > i + 1 ? <Check size={14} /> : ['①', '②', '③'][i]}</span>{t}</li>)}
      <li className="qt-next"><b>다음:</b> {nextHint}</li>
    </ol>}

    <div className="qt-grid">
      {/* 왼쪽: 입력 */}
      <aside className="qt-input qt2-editor" aria-label="입력 조건" hidden={!editing}>
        <div className="qt2-editor-head"><h2>입력 정보</h2><p className="qt-help">{dirty ? '수정 중인 초안 · 정식 기록에 아직 반영되지 않음' : exampleMode ? '기능 확인용 예시 입력' : activeLot ? '저장된 기록에서 불러옴' : '측정한 값만 입력해 주세요.'}</p></div>
        <div id="qt-input-editor" className="qt-editor" hidden={!editing}>
        <details className="qt-collapse" open>
          <summary><span className="qt-num">①</span>초기 품질 입력</summary>
          <div className="qt-draftbar">
            {draftNote ? <span className={'draft-' + draftNote.tone}>{draftNote.text}</span> : <span className="draft-info">{dirty ? '입력 중' : exampleMode ? '예시값' : activeLot ? '저장된 기록과 같음' : '새 입력'}</span>}
            {dirty && <button type="button" className="linkbtn" onClick={discardDraft}><Undo2 size={13} />초안 지우기</button>}
          </div>
          {conflict && <div className="qt-banner warn small"><AlertTriangle size={15} /><div>이 물량의 저장된 기록이 초안 작성 이후 바뀌었습니다. 초안은 자동으로 적용하지 않았어요.
            <div className="qt-inline-btns"><button className="btn btn-ghost" onClick={() => { setFormState(conflict.form); saveDraft(user, mode, draftKey, {...conflict, baseSig: officialSig}); setConflict(null); setDraftNote({tone: 'info', text: '이전 초안을 불러왔습니다. 저장된 기록과 다른 부분을 확인하세요.'}); }}>초안 불러오기</button>
              <button className="btn btn-ghost" onClick={() => { clearDraft(user, mode, draftKey); setConflict(null); }}>저장된 기록 유지</button></div></div></div>}

          {!exampleMode && !activeLot && <div className="qt-fields two">
            <F id="name" label="물량 이름" err={saveErrors.name}><input id="tf-name" value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} placeholder="예: 후지 A동 1차" /></F>
            <F id="variety" label="품종" err={saveErrors.variety}><select id="tf-variety" value={hongro ? '홍로' : '후지'} onChange={e => switchCultivar(e.target.value)}><option>후지</option><option>홍로</option></select></F>
            {session?.isTeam && <label className="qt-check span2"><input type="checkbox" checked={form.team_shared} onChange={e => set('team_shared', e.target.checked)} />팀과 공유 (선택하지 않으면 나만 볼 수 있어요)</label>}
          </div>}
          {(exampleMode || activeLot) && <div className="qt-fields two"><F id="variety" label="품종"><select id="tf-variety" value={hongro ? '홍로' : '후지'} onChange={e => switchCultivar(e.target.value)}><option>후지</option><option>홍로</option></select></F><div /></div>}
          <div className="qt-fields two">
            <F id="harvest_date" label="수확일" err={errors.harvest_date}><input id="tf-harvest_date" type="date" max={today} value={form.harvest_date} onChange={e => set('harvest_date', e.target.value)} /></F>
            <F id="intake_date" label="입고일" err={saveErrors.intake_date || errors.intake_date}><input id="tf-intake_date" type="date" max={today} value={form.intake_date} onChange={e => set('intake_date', e.target.value)} /></F>
          </div>
          <div className="qt-fields">
            <F id="storage_start_date" label="저장 시작일" err={errors.storage_start_date}>
              <div className="qt-datepair">
                <input id="tf-storage_start_date" type="date" max={today} value={form.sameStart ? form.intake_date : form.storage_start_date} disabled={form.sameStart} aria-describedby="tf-start-link"
                  onChange={e => set('storage_start_date', e.target.value)} />
                <label className="qt-check qt-check-inline" htmlFor="tf-sameStart"><input id="tf-sameStart" type="checkbox" checked={form.sameStart} onChange={e => toggleSameStart(e.target.checked)} /><span>입고일과 같음</span></label>
              </div>
              <p id="tf-start-link" className={'qt-link-note' + (form.sameStart && !form.intake_date ? ' warn' : '')}>{form.sameStart
                ? form.intake_date ? <>입고일과 연결됨 · 입고일을 바꾸면 함께 바뀝니다. 이 날이 저장 0일차입니다.</> : <>입고일을 먼저 입력해 주세요. 입력하면 저장 시작일도 같은 날짜가 됩니다.</>
                : <>직접 입력한 날짜를 저장 0일차로 계산합니다.</>}</p>
            </F>
          </div>
          {hongro ? <><HongroInputs form={form} setForm={setForm} errors={errors} /><div className="qt-fields two"><F id="initial_measured_on" label="초기 측정일" err={errors.initial_measured_on}><input id="tf-initial_measured_on" type="date" max={today} value={form.initial_measured_on} onChange={e=>set('initial_measured_on',e.target.value)} /></F><F id="tracked_sample_id" label="추적 표본 식별자"><input id="tf-tracked_sample_id" value={form.tracked.sample_id} onChange={e=>setSub('tracked','sample_id',e.target.value)} /></F><F id="tracked_weight" label="추적 표본 초기 중량" unit="g"><input id="tf-tracked_weight" type="number" step="any" value={form.tracked.initial_weight} onChange={e=>setSub('tracked','initial_weight',e.target.value)} /></F></div><p className="qt-help">측정일을 비우면 저장 시작일의 초기값으로 가정합니다. 늦게 측정한 값은 원래 저장 시간축의 변화량으로 연결합니다. 실측 감모율에는 측정일 가정을 적용하지 않습니다.</p></> : <>
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
          <details className="qt-sub" ref={measureRef}>
            <summary>경도 측정 정보 (탐침 직경·껍질·위치·과실 온도){measureErr && <span className="qt-sub-err">확인 필요</span>}</summary>
            <div className="qt-fields two">
              <F id="probe_mm" label="탐침 직경" unit="mm" err={errors.probe_mm}><input id="tf-probe_mm" type="number" inputMode="decimal" step="0.1" value={form.measure.probe_mm} onChange={e => setSub('measure', 'probe_mm', e.target.value)} placeholder="예: 11.1" /></F>
              <F id="peeled" label="껍질 제거 여부"><select id="tf-peeled" value={form.measure.peeled} onChange={e => setSub('measure', 'peeled', e.target.value)}><option value="">미기록</option><option>껍질 제거</option><option>껍질 포함</option></select></F>
              <F id="position" label="측정 위치"><input id="tf-position" value={form.measure.position} onChange={e => setSub('measure', 'position', e.target.value)} maxLength={80} placeholder="예: 적도부 양면" /></F>
              <F id="fruit_temp" label="과실 온도" unit="°C" err={errors.fruit_temp}><input id="tf-fruit_temp" type="number" inputMode="decimal" step="0.1" value={form.measure.fruit_temp} onChange={e => setSub('measure', 'fruit_temp', e.target.value)} /></F>
              <F id="instrument" label="측정 기기"><input id="tf-instrument" value={form.measure.instrument} onChange={e => setSub('measure', 'instrument', e.target.value)} maxLength={80} /></F>
            </div>
            <p className="qt-help">같은 탐침·위치·온도에서 잰 값끼리 비교하세요. 탐침 직경만으로 압력을 환산하지 않습니다. 유효 접촉 면적과 해당 측정법의 환산 타당성이 모두 확인되어야 합니다.</p>
          </details>
          <details className="qt-sub" ref={optionalRef}>
            <summary>선택 입력 (산도·평균 중량·포장·저장고 위치·센서·추적 표본){optionalErr && <span className="qt-sub-err">확인 필요</span>}</summary>
            <div className="qt-fields two">
              <F id="acidity" label="초기 산도" unit="%" err={errors.acidity}><input id="tf-acidity" type="number" inputMode="decimal" step="0.01" value={form.acidity} onChange={e => set('acidity', e.target.value)} placeholder="미측정" /></F>
              <F id="weight" label="평균 중량" unit="g" err={errors.weight}><input id="tf-weight" type="number" inputMode="decimal" step="0.1" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="미측정" /></F>
              <F id="packaging" label="포장 형태"><input id="tf-packaging" value={form.packaging} onChange={e => set('packaging', e.target.value)} maxLength={120} /></F>
              <F id="location" label="저장고 위치"><input id="tf-location" value={form.location} onChange={e => set('location', e.target.value)} maxLength={120} /></F>
              <F id="sensor_id" label="온습도 센서 번호" hint="CSV의 sensor_id와 같게"><input id="tf-sensor_id" value={form.sensor_id} onChange={e => set('sensor_id', e.target.value)} maxLength={60} /></F>
              <F id="tracked_sample_id" label="추적 표본 식별자" hint="후속 중량 기록에도 같은 식별자를 사용하세요." err={errors.tracked_sample_id}><input id="tf-tracked_sample_id" value={form.tracked.sample_id ?? ''} onChange={e => setSub('tracked', 'sample_id', e.target.value)} maxLength={80} placeholder="예: A동-추적표본-01" /></F>
              <F id="tracked_count" label="추적 표본 수" unit="개" err={errors.tracked_count} hint="같은 과실을 계속 무게만 재는 표본"><input id="tf-tracked_count" type="number" inputMode="numeric" value={form.tracked.count} onChange={e => setSub('tracked', 'count', e.target.value)} placeholder="미입력" /></F>
              <F id="tracked_weight" label="추적 표본 초기 평균 중량" unit="g" err={errors.tracked_weight}><input id="tf-tracked_weight" type="number" inputMode="decimal" step="0.1" value={form.tracked.initial_weight} onChange={e => setSub('tracked', 'initial_weight', e.target.value)} placeholder="미입력" /></F>
            </div>
            <p className="qt-help">실측 감모율은 같은 추적 표본의 초기·후속 중량이 모두 있을 때만 계산합니다. 경도처럼 파괴해서 잰 과실의 중량은 쓰지 않습니다.</p>
          </details>
          </>}
        </details>

        <details className="qt-collapse" open>
          <summary><span className="qt-num">②</span>저장 조건 선택</summary>
          {hongro && <div className="qt-fields"><F id="hongro-storage" label="홍로 저온 조건 빠른 선택"><select id="tf-hongro-storage" value={form.hongro.storage} onChange={e=>setForm(f=>({...f,temperature:e.target.value==='cold0'?'0':'4',hongro:{...f.hongro,storage:e.target.value as TrackerForm['hongro']['storage']}}))}><option value="cold0">0℃ 저온저장</option><option value="cold4">4℃ 저온저장</option></select></F></div>}
          <p className="qt-help">기록된 조건은 분석 기준일까지(과거 구간) 계산에 쓰입니다.</p>
          <div className="qt-fields two">
            <F id="storage" label="저장 환경"><select id="tf-storage" value={form.storage} onChange={e => set('storage', e.target.value as TrackerForm['storage'])}><option>일반 저온</option><option>CA</option><option>기타</option></select></F>
            <F id="mcp" label="1-MCP 처리 이력"><select id="tf-mcp" value={form.mcp} onChange={e => set('mcp', e.target.value as TrackerForm['mcp'])}><option>미처리</option><option>처리</option><option>미확인</option></select></F>
          </div>
          <div className="qt-fields"><F id="temperature" label="저장 온도" unit="℃" err={errors.temperature}><input id="tf-temperature" type="number" step="any" value={form.temperature} onChange={e=>setForm(f=>({...f,temperature:e.target.value,hongro:{...f.hongro,storage:e.target.value==='0'?'cold0':e.target.value==='4'?'cold4':f.hongro.storage}}))} placeholder={hongro?'0 또는 4':'자료 온도 미기재'} /></F></div><p className="qt-help">{hongro?'홍로는 일반 저온 · 1-MCP 미처리 · 정확히 0℃ 또는 4℃만 적용합니다. 2℃ 보간, CA, 처리 조건에는 적용 모델이 없습니다.':'후지 원자료에는 저장 온도가 명시되지 않았습니다. 입력 온도별 계수나 센서 이력 보정은 적용하지 않으며 온도 적용성은 미확인입니다.'} 산지 입력만으로 계수는 달라지지 않습니다.</p>
          <div className={'qt-model ' + ((hongro ? modelResults.firmness.modelId : recorded.id) ? 'ok' : 'no')}>{(hongro ? modelResults.firmness.modelId : recorded.id) ? <>적용 모델: <b>{hongro ? modelResults.firmness.modelId : modelLabel[recorded.id!]}</b> <KindBadge kind="모델 계산" verified={false} /></> : <><AlertTriangle size={14} />{hongro ? modelResults.firmness.reason : recorded.reason} 이 조건의 수치 예측은 제한합니다.</>}</div>
          {form.mcp === '처리' && <details className="qt-sub" open={!!(form.mcpd.treated_on || form.mcpd.product)}>
            <summary>1-MCP 처리 이력</summary>
            <div className="qt-fields two">
              <F id="mcp_on" label="처리일"><input type="date" max={today} id="tf-mcp_on" value={form.mcpd.treated_on} onChange={e => setSub('mcpd', 'treated_on', e.target.value)} /></F>
              <F id="mcp_product" label="제품명"><input id="tf-mcp_product" value={form.mcpd.product} onChange={e => setSub('mcpd', 'product', e.target.value)} maxLength={80} /></F>
              <F id="mcp_conc" label="농도"><input id="tf-mcp_conc" value={form.mcpd.concentration} onChange={e => setSub('mcpd', 'concentration', e.target.value)} maxLength={40} placeholder="예: 1 µL/L" /></F>
              <F id="mcp_h" label="처리 시간" unit="h"><input type="number" id="tf-mcp_h" value={form.mcpd.hours} onChange={e => setSub('mcpd', 'hours', e.target.value)} /></F>
              <F id="mcp_t" label="처리 온도" unit="°C"><input type="number" id="tf-mcp_t" value={form.mcpd.temp} onChange={e => setSub('mcpd', 'temp', e.target.value)} /></F>
            </div>
            <p className="qt-help">처리 세부값은 기록용입니다. 처리 여부만으로 경도·점수를 보정하지 않습니다.</p>
          </details>}
          {form.storage === 'CA' && <details className="qt-sub" open={!!(form.ca.from || form.ca.o2)}>
            <summary>CA 저장 환경</summary>
            <div className="qt-fields two">
              <F id="ca_from" label="적용 시작일"><input type="date" id="tf-ca_from" value={form.ca.from} onChange={e => setSub('ca', 'from', e.target.value)} /></F>
              <F id="ca_to" label="적용 종료일"><input type="date" id="tf-ca_to" value={form.ca.to} onChange={e => setSub('ca', 'to', e.target.value)} /></F>
              <F id="ca_o2" label="산소 농도" unit="%"><input type="number" step="0.1" id="tf-ca_o2" value={form.ca.o2} onChange={e => setSub('ca', 'o2', e.target.value)} /></F>
              <F id="ca_co2" label="이산화탄소 농도" unit="%"><input type="number" step="0.1" id="tf-ca_co2" value={form.ca.co2} onChange={e => setSub('ca', 'co2', e.target.value)} /></F>
            </div>
          </details>}
          <div className={'qt-env ' + (env?.count ? '' : 'none')}><Thermometer size={15} />
            {env?.count ? <span>온습도 이력 {env.count.toLocaleString()}건{env.gapCount ? ` · 기록 공백 ${env.gapCount}구간(보간하지 않음)` : ''}. <b>표시만 하고 계산에는 반영하지 않습니다</b> — 현재 저장 모델은 온습도를 입력으로 쓰지 않습니다.</span>
              : <span><b>고정 조건 가정</b> — 온습도 이력이 없습니다. 계산은 선택한 저장 조건이 그대로 유지된다고 가정합니다.</span>}
          </div>
        </details>

        <div className="qt-view-action"><button className="btn btn-primary" onClick={viewResults}>품질 변화 보기</button>{inputNotice && <p role="alert" className="auth-error">{inputNotice}</p>}</div>
        {!exampleMode && guest && <div className="qt-savebox qt-guest-save">
          <p><b>기록으로 저장하려면 로그인이 필요해요.</b> 지금 입력한 내용은 로그인한 뒤 같은 화면에서 이어집니다.</p>
          <button className="btn btn-primary" onClick={handoffToLogin}><Save size={16} />로그인하고 저장하기</button>
          {saveMsg && <p className="auth-error" role="status">{saveMsg.text}</p>}
          <p className="qt-help">저장 전 입력은 이 기기에만 임시 보관됩니다.</p>
        </div>}
        {!exampleMode && !guest && <div className="qt-savebox">
          <button className="btn btn-primary" onClick={saveRecord} disabled={saving || !!loadError || (!dirty && !!activeLot)}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{activeLot ? '변경 내용을 기록에 저장' : '물량 기록으로 저장'}</button>
          {activeLot && <ObservationForm lot={activeLot} onSaved={() => { setReload(r => r + 1); }} disabled={false} />}
          {saveMsg && <p className={saveMsg.ok ? 'qt-ok' : 'auth-error'} role="status">{saveMsg.text}</p>}
          {loaded.lot && !activeLot && <p className="qt-help">품종이 달라 별도의 새 물량으로 저장합니다. 기존 물량 기록은 변경하지 않습니다.</p>}
          <p className="qt-help">임시 저장(초안)은 이 브라우저에만 남습니다. ‘저장’을 눌러야 정식 기록이 됩니다.</p>
        </div>}
        </div>
      </aside>

      {/* 가운데: 요약 · 지표 탭 · 그래프 · 비교 */}
      <section className="qt-main" aria-label="품질 예측 결과" ref={resultsRef} tabIndex={-1} hidden={!showResults || !!loadError}>
        <div className="qt2-when">
          <span className="qt2-when-q">언제의 상태를 볼까요?</span>
          <div className="qt2-chips" role="group" aria-label="볼 날짜">
            {([['오늘', asOfDay], ['30일 후', asOfDay + 30], ['60일 후', asOfDay + 60]] as const).map(([t, d]) => { const ok = startOk && d >= 0 && d <= maxDays;
              return <button key={t} className={selDay === d ? 'active' : ''} aria-pressed={selDay === d} disabled={!ok} onClick={() => setSelectedDay(d)}>{t}</button>; })}
            <label className="qt2-datepick" htmlFor="qt-selected-date"><CalendarDays size={18} /><span>날짜 선택</span>
              <input id="qt-selected-date" type="date" value={selDate} disabled={!startOk} min={startDate} max={startOk ? addDays(startDate, maxDays) : undefined}
                onChange={e => { if (!e.target.value) setSelectedDay(Number.NaN); else if (startOk && isDate(e.target.value)) setSelectedDay(daysBetween(startDate,e.target.value)); }} /></label>
          </div>
        </div>
        {hongro && <><p className="qt-help">홍로 · {form.storage} · {form.temperature || '미입력'}℃ · 1-MCP {form.mcp} · 저장 {selectedDayLabel} · 초기품질 출처: {sourceLabel}{exampleMode ? ' · 예시 데이터' : ''}</p><div className="qt-latest-values">{(['weight', 'diameter'] as const).map(m => <div key={m}><dt>{m === 'weight' ? '중량' : '횡경'} · 초기값만 제공</dt><dd>{hongroResult?.initial[m] === undefined ? '미입력' : `${fmtNum(hongroResult.initial[m]!, 1)} ${HONGRO_UNITS[m]}`}</dd></div>)}</div><p className="qt-help">중량·횡경의 저장 중 변화와 홍로 자체 감모율은 자료 부족입니다. 당도는 S(t)=S0로, 저장 중 변화를 반영하지 않습니다.</p></>}
        <div className="qt2-grid">
          <div className="qt2-chart">
          <div className="qt-chartbox">
          <div className="qt2-chart-head"><h2>{metricMeta[metric].label} 변화</h2>
        <div className="seg qt-tabs" role="tablist" aria-label="지표" onKeyDown={e => {
          const i = visibleMetrics.indexOf(metric); const next = e.key === 'ArrowRight' ? (i + 1) % visibleMetrics.length : e.key === 'ArrowLeft' ? (i + visibleMetrics.length - 1) % visibleMetrics.length : e.key === 'Home' ? 0 : e.key === 'End' ? visibleMetrics.length - 1 : -1;
          if (next >= 0) { e.preventDefault(); setMetric(visibleMetrics[next]); (e.currentTarget.children[next] as HTMLButtonElement).focus(); }
        }}>
          {visibleMetrics.map(m => <button key={m} id={'qt-tab-' + m} role="tab" aria-controls="qt-metric-result" tabIndex={metric === m ? 0 : -1} aria-selected={metric === m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{metricMeta[m].label}</button>)}
        </div></div>
          {startOk ? <TrackerChart maxDays={maxDays} unit={displayUnit(metric)} sourceLabel={hongro ? sourceLabel : undefined} metric={metric} series={series[metric]} baseline={hongro ? showConditions ? {series:comparisonSeries(num(form.temperature)===0?4:0,metric),label:num(form.temperature)===0?'4℃ 저온저장':'0℃ 저온저장'} : null : baseline && compatible && !sameAsBaseline ? {series: baseline.series[metric], label: baseline.label} : null}
            measured={measured[metric]} startDate={startDate} asOfDay={asOfDay} selectedDay={selDay} onSelect={setSelectedDay} exampleMode={exampleMode} />
            : <div className="qt-empty">저장 시작일(또는 입고일)을 입력하면 그래프가 나타납니다. <button className="linkbtn" onClick={() => focus('tf-intake_date')}>입고일 입력하기</button></div>}
          {startOk && !series[metric].ok && <div className="qt-chart-note"><AlertTriangle size={14} />{(series[metric] as {reason: string}).reason}{!anchors[metric] && metric !== 'loss' && <button className="linkbtn" onClick={() => focus('tf-' + metric)}>입력하기</button>}</div>}
          {metric === 'loss' && !exampleMode ? <p className="qt-help">점: 동일 표본 실측 감모율 · 선: 모델 예측 또는 명시적으로 선택한 후지 기반 참고 추정. 실측 중량 사이를 보간한 선이 아닙니다.</p> : <ChartLegend exampleMode={exampleMode} hasMeasured={true} initialSource={hongro ? sourceLabel : undefined} hasBaseline={hongro ? !!hongroResult && showConditions : !!baseline && compatible && !sameAsBaseline} baselineLabel={hongro ? num(form.temperature)===0?'4℃ 저온저장':'0℃ 저온저장' : baseline ? `${baseline.label} (회색 점선)` : ''} />}
          <div className="qt-date-control">
            <div className="qt-range-control"><label htmlFor="qt-selected-day">저장 경과일 <strong>{selectedDayLabel}</strong></label><input id="qt-selected-day" className="qt-slider" type="range" min={0} max={maxDays} value={Number.isFinite(selDay) ? Math.max(0,Math.min(maxDays,selDay)) : 0} disabled={!startOk} onChange={e => setSelectedDay(+e.target.value)} /><div className="qt-range-ends"><span>0일 · 저장 시작</span><span>{maxDays}일</span></div></div>
          </div>
          {hongro && <><label className="qt-field">저장일수 직접 입력<input aria-label="홍로 저장일수" type="number" min={0} max={120} step={1} value={Number.isFinite(selDay) ? selDay : ''} onChange={e => setSelectedDay(e.target.value === '' ? Number.NaN : Number(e.target.value))} /></label>{!modelResults[metric].ok && <p className="auth-error" role="alert">{modelResults[metric].reason}</p>}<p className="qt-help">저장 시작일을 0일로 유지합니다. 분석 기준일·최근 측정일로 계산을 다시 시작하지 않습니다.</p></>}
          <p className="qt-help">분석 기준일 {fmtDate(asOf)}{startOk ? ` · 저장 ${asOfDay}일차` : ''} / 그래프 표시 범위 0~{maxDays}일은 검증된 적용 기간이 아닙니다.</p>
          {startOk && t0 > 0 && <p className="qt-help">초기 측정은 저장 {t0}일차입니다. 계산도 그날부터 시작하며 이전 날짜를 채우지 않습니다.</p>}
          {startOk && !form.initial_measured_on && anyInitial && <p className="qt-help">측정일 미기록: 경도·당도·산도 계산은 저장 시작일 측정을 가정합니다. 감모율에는 이 가정을 적용하지 않습니다.</p>}
          {excludedLater > 0 && <p className="qt-help">분석 기준일 이후 측정 {excludedLater}건은 과거 관측에 넣지 않았습니다.</p>}
        </div>

          </div>
          <aside id="qt-metric-result" role="tabpanel" aria-labelledby={'qt-tab-' + metric} className="qt2-result">
            <p className="qt2-result-when">{whenLabel}{Number.isFinite(selDay) ? ` · 저장 ${selDay}일차` : ''}{isDate(selDate) ? ` · ${fmtDate(selDate)}` : ''}</p>
            <div className="qt2-result-main" aria-live="polite">
              <p className="qt2-result-label">{metricMeta[metric].label} {modelResults[metric].kind === '실측' ? '실측값' : modelResults[metric].kind === '참고 추정' ? '참고 추정값' : '계산값'}<span>{plainMeaning[metric]}</span></p>
              {selectedValue.status === 'ok' ? <>
                <p className="qt2-result-value">{fmtNum(selectedValue.value, metricMeta[metric].digits)}<span>{displayUnit(metric)}</span></p>
                {resultLines.map(t => <p key={t} className="qt2-result-change">{t}</p>)}
              </> : <div className="qt2-result-na"><b>이 날짜의 값을 표시할 수 없어요</b><p>{selectedValue.reason}</p><button className="linkbtn" onClick={() => focus(hongro ? `tf-hongro-initial-${metric}` : 'tf-' + (metric === 'loss' ? 'tracked_sample_id' : metric))}>필요한 입력 확인하기</button></div>}
            </div>
            <p className="qt2-result-note">{exampleMode ? '예시 데이터로 계산한 시연 결과이며, 실제 측정값과 다를 수 있어요.' : modelResults[metric].kind === '실측' ? '같은 추적 표본의 실측 중량으로 계산했어요. 품질 판정이 아닙니다.' : modelResults[metric].kind === '참고 추정' ? '홍로 미검증 · 후지 기반 참고 추정 — 실제 측정값과 다를 수 있으며, 출하·안전 판정이 아닙니다.' : '모델 계산 · 검증 미확인 — 실제 측정값과 다를 수 있으며, 출하·안전 판정이 아닙니다.'}</p>
          </aside>
        </div>
        <dl className="qt2-strip">
          <div><dt>처음 측정</dt><dd>{firstValue !== null ? <>{fmtNum(firstValue, metricMeta[metric].digits)} <small>{displayUnit(metric)}</small></> : '미측정'}</dd></div>
          <div><dt>최근 {exampleMode ? '예시' : '실제'} 측정</dt><dd>{latestPoint ? <>{fmtNum(latestPoint.value, metricMeta[metric].digits)} <small>{metricMeta[metric].unit}</small><span className="qt2-strip-date"> · {shortDate(latestPoint.date)}</span></> : '아직 기록 없음'}</dd></div>
          <div><dt>{latestBrix ? '최근 당도' : '처음 당도'}</dt><dd>{latestBrix ? <>{fmtNum(latestBrix.value, 1)} <small>°Brix</small></> : firstBrix !== null ? <>{fmtNum(firstBrix, 1)} <small>°Brix</small></> : '미측정'}</dd></div>
        </dl>
        <section className="qt-loss-sources" aria-label="감모율 자료 구분">
          <h3>감모율: 실측 · 모델 · 참고 추정</h3>
          <div className="qt-latest-values">
            <div><dt>실측 감모율</dt><dd>{actualLoss ? `${fmtNum(actualLoss.value,2)} %` : '자료 부족'}</dd><small>동일 추적 표본의 중량·실제 측정일 확인 시에만 제공{t0>0?` · 첫 중량 측정: 저장 ${t0}일차 (모델과 누적 기준이 다름)`:''}</small></div>
            <div><dt>{hongro && form.loss_reference ? '후지 기반 참고 추정' : '모델 예측 감모율'}</dt><dd>{modelResults.loss.ok ? `${fmtNum(modelResults.loss.value!,2)} %` : '자료 부족'}</dd><small>{modelResults.loss.ok ? modelResults.loss.kind : modelResults.loss.reason}</small></div>
          </div>
          {hongro && <><label className="qt-check"><input id="qt-fuji-reference" type="checkbox" checked={form.loss_reference} onChange={e=>set('loss_reference',e.target.checked)} />후지 식으로 참고 추정 보기</label><p className="qt-help">{form.loss_reference ? '홍로에 대해 검증되지 않은 후지 기반 참고 추정입니다. ' : '홍로 감모율 자료가 없어 기본 상태에서는 외관 변형을 계산하지 않습니다. '}표시 범위 0~120일 제한은 홍로에서의 모델 타당성을 검증하지 않습니다.</p></>}
          {!hongro && <p className="qt-help">모델 예측 감모율은 저장일수만 사용하므로 초기 중량 없이 계산할 수 있습니다. 실측 감모율과 별도로 표시합니다.</p>}
        </section>
        <div className="qt2-cta">
          <div><h3>직접 측정한 값이 있나요?</h3><p>오늘의 기록을 더하면 실제 변화와 비교할 수 있어요.</p></div>
          {!exampleMode && activeLot && !guest ? <ObservationForm lot={activeLot} label="오늘 측정값 기록" className="btn btn-primary btn-lg" onSaved={() => setReload(r => r + 1)} disabled={false} />
            : guest && !exampleMode ? <button className="btn btn-primary btn-lg" onClick={handoffToLogin}><Save size={16} />로그인하고 저장하기</button>
            : exampleMode ? <button className="btn btn-primary btn-lg" onClick={() => changeMode('real')}>내 측정값 입력하기</button>
            : <button className="btn btn-primary btn-lg" onClick={() => { setEditing(true); requestAnimationFrame(() => document.getElementById('qt-input-editor')?.scrollIntoView({behavior: 'smooth', block: 'start'})); }}>입력 정보 수정</button>}
        </div>
        <div className="qt2-more">
        {<details className="qt2-fold"><summary>측정값과 비교 보기<Plus size={16} /></summary><section className="qt-latest" aria-label="최근 실측 비교"><div className="qt-latest-head"><h3>최근 {exampleMode ? '예시 측정' : '실측'}과 비교</h3>{!exampleMode && activeLot && <ObservationForm lot={activeLot} onSaved={() => setReload(r => r + 1)} disabled={false} />}</div>
          {latestPoint ? <><button className="linkbtn qt-latest-date" disabled={latestPoint.day < 0 || latestPoint.day > MODEL_RANGE.displayDays} onClick={() => setSelectedDay(latestPoint.day)}>최근 측정 날짜 선택</button><p className="qt-help">{fmtDate(latestPoint.date)} · 저장 {latestPoint.day}일차 · 표본 {latestPoint.sampleCount ?? '미기록'}{latestPoint.sampleCount ? '개' : ''}</p>
            <dl className="qt-latest-values"><div><dt>{exampleMode ? '예시 측정' : metric === 'loss' ? '실측 중량 기반 감모율' : '실측'}</dt><dd>{fmtNum(latestPoint.value, metricMeta[metric].digits)} <small>{metricMeta[metric].unit}</small></dd></div><div><dt>같은 날짜 시연용 계산</dt><dd>{latestCalculation?.status === 'ok' ? <>{fmtNum(latestCalculation.value, metricMeta[metric].digits)} <small>{metricMeta[metric].unit}</small></> : '제공 안 함'}</dd></div><div><dt>측정 − 계산</dt><dd>{latestCalculation?.status === 'ok' ? describeChange(metric, latestPoint.value, latestCalculation.value).short : '비교 불가'}</dd></div></dl>
            {latestConditions?.reason && <p className="qt-help qt-measure-compatibility"><strong>{latestConditions.status === 'mismatch' ? '측정 조건 불일치' : '측정 조건 확인 필요'}</strong> · {latestConditions.reason}</p>}
          </> : <p className="qt-help">후속 측정 기록 없음 · {metricMeta[metric].label} {metric === 'loss' ? '계산에 필요한 동일 추적 표본의 중량과 측정일을 기록해 주세요.' : '측정 기록을 추가하면 같은 날짜의 계산값과 비교할 수 있습니다.'}</p>}
          {metric==='loss' && t0>0 && <p className="qt-help">실측은 저장 {t0}일차 첫 중량 이후, 모델은 저장 0일 이후 누적 변화입니다. 기준 기간이 달라 차이를 비교하지 않습니다.</p>}
          <div className="qt-latest-actions"><label className="qt-check"><input type="checkbox" checked={useLatest} disabled={!measured[metric].length || metric === 'loss'} onChange={e => setUseLatest(e.target.checked)} />최근 측정값을 계산 시작점으로 사용</label><button className="btn btn-ghost" aria-expanded={showObsCompare} onClick={() => setShowObsCompare(v => !v)}>측정값과 비교</button></div>
          {useLatest && <p className="qt-help">기존 식을 최근 측정값에서 이어 계산합니다. 모델 재학습이나 정확도 검증이 아닙니다.</p>}
          {showObsCompare && <ObsCompare metric={metric} measured={measured[metric]} series={series[metric]} exampleMode={exampleMode} initialMeasure={form.measure} observations={pastObs} initialDay={t0} />}
        </section></details>}

        <div className="qt-actions qt-result-actions qt2-actions">
          {guest && !exampleMode && <button className="btn btn-primary" onClick={handoffToLogin}><Save size={16} />로그인하고 저장하기</button>}
          {onAskAI && !hongro && <button className="btn btn-outline" data-ai-return onClick={askResult} disabled={!startOk || !!loadError}><MessageCircle size={16} />이 결과 물어보기</button>}
          <button className="btn btn-ghost" onClick={() => exportUnifiedCsv({mode,lotName,form,startDate,selDate,selDay,asOf,asOfDay,futureLabel,futureId,series,modelResults,measured,anchors,baseline:compatible?baseline:null})} disabled={!startOk}><Download size={15} />결과 내보내기</button>
        </div>

        <details className="qt2-fold" open={showConditions} onToggle={e => setShowConditions((e.currentTarget as HTMLDetailsElement).open)}><summary>저장 조건 보기<Plus size={16} /></summary>
        <p className="qt2-cond">{hongro ? `홍로 · ${form.storage} · ${form.temperature || '미입력'}℃ · 1-MCP ${form.mcp}` : `${form.storage} · 1-MCP ${form.mcp}${recorded.id ? ` · 적용 모델: ${modelLabel[recorded.id]}` : ''}`}</p>
        {showConditions && <section id="qt-condition-comparison" className="qt-compare" aria-label="조건 비교">
          {hongro ? <SharedHongroComparison input={modelInput} day={selDay} /> : <>
          <div className="qt-compare-head"><h3>저장 조건 비교 <span className="kind k-example">조건 변경 시나리오</span></h3>
            <p>저장 방식 간 효과를 검증한 모델이 없어, 각 저장 방식 식의 일별 변화를 분석 기준일 값에 이어 붙인 <b>조건 변경 시나리오</b>입니다. 같은 물량·초기값·과거 이력을 공유합니다.</p></div>
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
            {baseline.kind === 'current' && sameAsBaseline && <p className="qt-help">위에서 비교 조건(다른 저장 조건)을 고르면 ‘현재 조건 유지’와 비교합니다.</p>}
            <div className="qt-vs">
              <div className="qt-vs-card base"><span className="qt-vs-tag">현재 조건 · {baseline.label}</span><b>{baseline.conditionLabel}</b><small>고정 {new Date(baseline.createdAt).toLocaleString('ko-KR')} · 분석 기준일 {fmtDate(baseline.asOf)}</small></div>
              <div className="qt-vs-card chg"><span className="qt-vs-tag">비교 조건</span><b>{futureLabel}</b><small>같은 날짜 저장 {selDay}일차({fmtDate(selDate)})에서 비교</small></div>
            </div>
            <div className="qt-table-wrap"><table className="qt-table">
              <thead><tr><th>지표</th><th>기준</th><th>비교 조건</th><th>차이</th></tr></thead>
              <tbody>{metricIds.map(m => { const b = baseAt(m), c = at(m), meta = metricMeta[m];
                return <tr key={m}><td>{meta.label}</td><td>{b?.status === 'ok' ? `${fmtNum(b.value, meta.digits)} ${meta.unit}` : '계산 불가'}</td><td>{c.status === 'ok' ? `${fmtNum(c.value, meta.digits)} ${meta.unit}` : '계산 불가'}</td>
                  <td>{b?.status === 'ok' && c.status === 'ok' ? describeChange(m, c.value, b.value).short : '—'}</td></tr>; })}</tbody>
            </table></div>
          </>}
          </>}
          </section>}
        </details>
        <details className="qt-basis qt2-fold"><summary>계산 근거 보기<Plus size={16} /></summary><div>
          {!hongro && future.id!==recorded.id && <p className="qt-help">조건 변경 시나리오: {asOf} (저장 {asOfDay}일차)까지 {form.storage} · 1-MCP {form.mcp}, 이후 {futureLabel}. 전환 효과는 연구로 검증되지 않았습니다.</p>}
          <ModelBasis result={modelResults[metric]} metric={metric} cultivar={form.variety} storage={!hongro && selDay>asOfDay && future.id ? (future.id==='ca'?'CA':'일반 저온') : form.storage} temperature={form.temperature} mcp={!hongro && selDay>asOfDay && future.id ? (future.id==='mcp'?'처리':'미처리') : form.mcp} />
          {hongro && form.hongro.source==='weather' && <p className="qt-help">{HONGRO_UNITS_CONFLICT}</p>}
          <button className="linkbtn" onClick={()=>openModelInfo({modelId:selDay<=asOfDay?recorded.id:future.id,metric})}>전체 모델 정보 보기</button>
        </div></details>
        </div>
      </section>
    </div>

    <ThreeDExample day={selDay} cultivar={form.variety} metrics={modelResults} />
  </div>;
}

function F({id, label, unit, hint, err, extra, children}: {id: string; label: string; unit?: string; hint?: string; err?: string; extra?: ReactNode; children: ReactNode}) {
  return <div className={'qf' + (err ? ' has-err' : '')} data-field={id}>
    <div className="qf-head"><label htmlFor={'tf-' + id} className="qf-label">{label}{unit && <small> ({unit})</small>}</label>{extra}</div>
    {children}
    {hint && !err && <span className="qf-hint">{hint}</span>}
    {err && <span className="qf-err" role="alert">{err}</span>}
  </div>;
}

function ResultHero({metric, at, anchor, actualLoss, exampleMode, probeMm, onFocusInput, unit, sourceLabel}: {unit?: string; sourceLabel?: string; metric: MetricId; at: ValueAt; anchor: Anchor | null; actualLoss: boolean; exampleMode: boolean; probeMm: number | null; onFocusInput: () => void}) {
  const meta = {...metricMeta[metric], unit: unit ?? metricMeta[metric].unit};
  return <div className="qt-result-hero">
    <div className="qt-result-kind"><b>{meta.label}</b>{sourceLabel && <span className="kind k-model">초기품질: {sourceLabel}</span>}{exampleMode && <KindBadge kind="예시" />}{at.status === 'ok' ? <KindBadge kind={actualLoss ? '실측' : '모델 계산'} verified={actualLoss ? undefined : false} /> : anchor && !actualLoss ? <span className="kind k-missing">계산 불가</span> : <KindBadge kind="미측정" />}</div>
    {at.status === 'ok' ? <><div className="qt-result-number">{fmtNum(at.value, meta.digits)}<span>{meta.unit}</span>{metric === 'firmness' && <HardnessConvert valueN={at.value} probeMm={probeMm} />}</div>
      {actualLoss ? <p className="qt-result-change">동일 추적 표본의 초기 중량 대비 변화 · 실제 측정 날짜</p> : anchor && <p className="qt-result-change">{anchor.source === 'latest' ? '계산 시작점' : '초기값'} {fmtNum(anchor.value, meta.digits)} {meta.unit} 대비 <strong>{describeChange(metric, at.value, anchor.value).short}</strong></p>}
      <p className="qt-result-status">{actualLoss ? '실측 중량 기반 계산 · 품질 판정 아님' : `시연용 계산 · ${at.segment === 'past' ? '과거 구간' : '미래 가정'} · 검증 미확인`}</p>
    </> : <div className="qt-result-unavailable"><strong>결과를 표시할 수 없습니다</strong><p>{at.reason}</p><button className="linkbtn" onClick={onFocusInput}>필요한 입력 확인</button></div>}
  </div>;
}

function ObsCompare({metric, measured, series, exampleMode, initialMeasure, observations, initialDay}: {metric: MetricId; measured: MeasuredPoint[]; series: Series; exampleMode: boolean; initialMeasure: TrackerForm['measure']; observations: Observation[];initialDay:number}) {
  const meta = metricMeta[metric];
  if (!measured.length) return <div className="qt-obs"><p className="qt-help">분석 기준일까지 {meta.label} {exampleMode ? '예시 측정' : '실측'} 기록이 없습니다.</p></div>;
  return <div className="qt-obs qt-table-wrap"><table className="qt-table">
    <caption>측정값과 같은 날짜 계산값 비교 — {meta.label} ({meta.unit})</caption>
    <thead><tr><th>측정일</th><th>경과일</th><th>{exampleMode ? '예시 측정' : '실측'}</th><th>시연용 계산</th><th>측정 − 계산</th></tr></thead>
    <tbody>{measured.map(p => {
      const conditions = measurementCompatibility(initialMeasure, observations.find(o => o.id === p.id)?.details?.measure);
      const comparable=metric==='loss'?initialDay===0:conditions.comparable;
      const v = comparable ? valueAt(series, p.day) : null;
      return <Fragment key={p.id}><tr><td>{fmtDate(p.date)}</td><td>{p.day}일차</td><td>{fmtNum(p.value, meta.digits)}</td>
        <td>{v?.status === 'ok' ? fmtNum(v.value, meta.digits) : !comparable ? '제공 안 함' : v?.status === 'before' ? '계산 시작 전' : '계산 불가'}</td><td>{v?.status === 'ok' ? describeChange(metric, p.value, v.value).short : '비교 불가'}</td></tr>
        {metric==='loss' && initialDay>0 && <tr className="qt-obs-condition"><td colSpan={5}>실측 감모율은 저장 {initialDay}일차의 첫 중량 이후 변화이고 모델은 저장 시작일 대비 누적값이므로 차이를 비교하지 않습니다.</td></tr>}
        {metric!=='loss' && conditions.reason && <tr className="qt-obs-condition"><td colSpan={5}><p className="qt-help qt-measure-compatibility"><strong>{conditions.status === 'mismatch' ? '측정 조건 불일치' : '측정 조건 확인 필요'}</strong> · {conditions.reason}</p></td></tr>}
      </Fragment>;
    })}</tbody>
  </table><p className="qt-help">차이는 검증 지표가 아닙니다. 표본이 다르면(파괴 측정) 같은 과실의 변화가 아닙니다.</p></div>;
}

class Boundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? <div className="t3d-empty">3D 예시를 표시하지 못했습니다. 입력·결과·그래프는 그대로 사용할 수 있습니다.</div> : this.props.children; }
}

function ThreeDExample({day,cultivar,metrics}:{day:number;cultivar:string;metrics:Record<MetricId,ModelResult>}) {
  const [open,setOpen]=useState(false);
  return <details className="qt-3d" onToggle={e=>setOpen((e.target as HTMLDetailsElement).open)}>
    <summary><ChevronDown size={16} />3D 외관 예시 <span className="kind k-example">설명용 외관 시각화</span></summary>
    {open && <div className="qt-3d-body"><Boundary><QualityAppleViewer day={day} cultivar={cultivar} metrics={metrics} /></Boundary></div>}
  </details>;
}

function HongroInputs({form, setForm, errors}: {form: TrackerForm; setForm: (update: (f: TrackerForm) => TrackerForm) => void; errors: Partial<Record<string, string>>}) {
  const h = form.hongro;
  const labels = {firmness: '초기 경도', acidity: '초기 산도', brix: '초기 당도', weight: '초기 중량 (선택)', diameter: '초기 횡경 (선택)'};
  return <>
    <p className="qt-help"><b>자료 출처 지역: 거창</b> · 산지 입력만으로 저장 모델 계수는 달라지지 않습니다. 후지의 입력값과 저장조건은 별도 초안으로 보관합니다.</p>
    <div className="qt-fields"><F id="hongro-source" label="초기품질 입력 방식"><select id="tf-hongro-source" value={h.source} onChange={e => setForm(f => ({...f, hongro: {...f.hongro, source: e.target.value as TrackerForm['hongro']['source']}}))}><option value="measured">직접 입력</option><option value="weather">기상자료 기반 추정</option></select></F></div>
    {h.source === 'weather' ? <div className="qt-fields two">{HONGRO_WEATHER_FIELDS.map(field => <F key={field.key} id={`hongro-weather-${field.key}`} label={field.label} unit={field.unit} err={errors[`hongro.weather.${field.key}`]}><input id={`tf-hongro-weather-${field.key}`} type="number" step="any" value={h.weather[field.key]} placeholder="필수 입력" onChange={e => setForm(f => ({...f, hongro: {...f.hongro, weather: {...f.hongro.weather, [field.key]: e.target.value}}}))} /></F>)}</div>
      : <div className="qt-fields two">{(['firmness', 'acidity', 'brix', 'weight', 'diameter'] as const).map(m => <F key={m} id={`hongro-initial-${m}`} label={labels[m]} unit={HONGRO_UNITS[m]} err={errors[`hongro.initial.${m}`]}><input id={`tf-hongro-initial-${m}`} type="number" min={0} step="any" value={h.initial[m]} placeholder={m === 'weight' || m === 'diameter' ? '선택 입력' : '필수 입력'} onChange={e => setForm(f => ({...f, hongro: {...f.hongro, initial: {...f.hongro.initial, [m]: e.target.value}}}))} /></F>)}</div>}
    <p className="qt-help">직접 입력값은 입력한 초기 측정일의 품질입니다. 저장 시작일 기준 시간축을 유지합니다. 경도 기준은 N (Ø11 mm 탐침)입니다. 입력값이 없으면 계산하지 않습니다. 기상자료 추정값은 실측값이 아닙니다.</p>
    {h.source === 'weather' && <p className="qt-help">{HONGRO_UNITS_CONFLICT}</p>}
  </>;
}

/** Adapter for the existing SVG chart; every point retains the engine result. */
function predictionSeries(input:ModelInput,asOfDay:number,maxDays:number):Series {
  const from=input.metric==='loss'?0:input.anchor?.day ?? 0;
  const first=predictQuality({...input,day:from});
  if(!first.ok)return {ok:false,reason:first.reason || '계산에 필요한 자료가 없습니다.'};
  if(!Number.isInteger(from)||from<0||from>maxDays)return {ok:false,reason:'초기 측정일이 모델 적용 범위 밖입니다.'};
  const values=getQualitySeries(input,{from,to:maxDays,step:1});
  const failed=values.find(r=>!r.ok);
  if(failed)return {ok:false,reason:failed.reason || '적용 모델 없음'};
  return {ok:true,startDay:from,endDay:maxDays,asOfDay,past:'cold',future:'cold',points:values.map(r=>({day:r.day,value:r.value!,segment:r.day<=asOfDay?'past':'future',result:r}))};
}

function ModelBasis({result,metric,cultivar,storage,temperature,mcp}:{result:ModelResult;metric:MetricId;cultivar:string;storage:string;temperature:string;mcp:string}) {
  return <><h3>{cultivar} · {metricMeta[metric].label} · {result.kind}</h3><dl className="mi-dl">
    <div><dt>저장 조건</dt><dd>{storage} · {temperature || '미기록'}℃ · 1-MCP {mcp}</dd></div>
    <div><dt>모델 / 버전</dt><dd>{result.modelId || '적용 모델 없음'} / {result.modelVersion || '없음'}</dd></div>
    <div><dt>수식 / 단위</dt><dd><code>{result.formula || '자료 부족'}</code> · {result.unit}</dd></div>
    <div><dt>출처</dt><dd>{result.source.join(' · ') || '확인된 자료 없음'}</dd></div>
    <div><dt>적용 표시 범위</dt><dd>{result.range ? `${result.range.min}~${result.range.max}일` : '없음'} · 상품성·안전 보관 기간을 보장하지 않습니다.</dd></div>
    <div><dt>검증 상태</dt><dd>{result.validation}</dd></div>
    {!result.ok && <div><dt>계산하지 못한 이유</dt><dd>{result.reason}</dd></div>}
  </dl>{result.warnings.map(w=><p className="qt-help" key={w}>{w}</p>)}<p className="qt-help">t는 저장 시작일부터의 경과일입니다. 늦은 측정값은 변화량 모델 g(t)−g(t0), 비율 모델 g(t)/g(t0)로 연결하며 측정일을 새 0일로 바꾸지 않습니다. 산지는 저장 계수를 바꾸지 않습니다.</p></>;
}

function SharedHongroComparison({input,day}:{input:(m:MetricId,day:number,temperature?:number|null)=>ModelInput;day:number}) {
  return <><h3>홍로 0℃ / 4℃ 조건 비교</h3><p className="qt-help">같은 측정일·측정값과 원래 저장 시간축으로 비교합니다. 실제 저장 중 온도를 전환한 검증 모델이 아닙니다.</p><div className="qt-table-wrap"><table className="qt-table"><thead><tr><th>지표</th><th>0℃</th><th>4℃</th></tr></thead><tbody>{metricIds.map(m=><tr key={m}><td>{metricMeta[m].label}</td>{[0,4].map(temp=>{const r=predictQuality(input(m,day,temp));return <td key={temp}>{r.ok?`${fmtNum(r.value!,metricMeta[m].digits)} ${r.unit}`:r.reason}{r.kind==='참고 추정'&&<small> · 후지 기반 참고 추정</small>}</td>;})}</tr>)}</tbody></table></div></>;
}

function exportUnifiedCsv(o:QualityExportInput) {
  const url=URL.createObjectURL(new Blob([buildQualityExportCsv(o)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`애플트랙_${o.form.variety}_${o.selDate || '결과'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
