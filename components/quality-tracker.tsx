'use client';
import {Component, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {AlertTriangle, ArrowLeft, ArrowRight, Info, Warehouse, ArrowUpRight, CalendarDays, Check, ChevronDown, Download, FlaskConical, Loader2, Pin, PinOff, Plus, RotateCcw, Save, Thermometer, Undo2} from 'lucide-react';
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
import {HANDOFF_KEY, firmnessToN, fujiWeatherEstimate, emptyFujiForm, type FujiRegion, suggestName, effectiveInitialMeasuredOn, type TrackerHandoff, clearDraft, emptyForm, exampleForm, formFromLot, loadDraft, loadPref, payloadFromForm, saveDraft, savePref, signature, validateForm, type Draft, type TrackerForm} from '@/lib/tracker-form';
import type {StorageId} from '@/lib/initial-quality';
import type {ModelInfoContext} from '@/components/model-info';
import {measurementCompatibility, observationFingerprint} from '@/lib/ai/context';
import {isHongroVariety} from '@/lib/cultivar';
import {calculateHongroForm, emptyHongroForm, exampleHongroForm} from '@/lib/hongro-tracker';
import {EASY_LABEL, easyChange} from '@/lib/lot-predict';
import {HONGRO_STORAGE_LABELS, HONGRO_UNITS, HONGRO_WEATHER_FIELDS, HONGRO_UNITS_CONFLICT} from '@/lib/hongro';
import {buildQualityExportCsv, type QualityExportInput} from '@/lib/quality-export';
import {predictQuality, getQualitySeries, selectQualityModel, HONGRO_LOSS_RATE} from '@/lib/quality-models';
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
export default function QualityTracker({lots, onLotsChanged, request, openModelInfo, openLot, guest = false, onRequireLogin, onModeChange}: {
  lots: Lot[]; onLotsChanged: () => Promise<Lot[]> | void; request?: TrackerRequest | null; openModelInfo: (context?: ModelInfoContext) => void; openLot: (id: string) => void; onAskAI?: (context: TrackerAIContext) => void;
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
    if (mode === 'example') return hongro ? {...emptyForm(), variety: '홍로', name: '예시 사과 · 홍로', sameStart: true, initialSameStart: true, mcpSelected: true, mcp: '미처리', temperature: '0', intake_date: addDays(today, -28), initial_measured_on: addDays(today, -28), hongro: exampleHongroForm()} : exampleForm();
    return activeLot ? formFromLot(activeLot) : {...emptyForm(), variety: hongro ? '홍로' : '후지', hongro: emptyHongroForm()};
  }, [mode, activeLot, hongro, today]);
  const officialSig = signature(official);

  // ── 입력 양식 + 초안 자동 복구 ──
  const [form, setFormState] = useState<TrackerForm>(official);
  const [draftNote, setDraftNote] = useState<{tone: 'ok' | 'warn' | 'info'; text: string} | null>(null);
  const [conflict, setConflict] = useState<Draft | null>(null);
  const readyKey = useRef('');
  const carryRef = useRef<Partial<TrackerForm> | null>(null);
  const [readyFormKey, setReadyFormKey] = useState('');
  const officialReady = loaded.scope === recordScope && !loading;
  const expectedFormKey = `${scope}|${officialSig}`;
  const formReady = officialReady && readyFormKey === expectedFormKey;
  useEffect(() => {
    if (!officialReady) return;
    const k = expectedFormKey; if (readyKey.current === k) return; readyKey.current = k; setReadyFormKey(k);
    const storedDraft = loadDraft(user, mode, draftKey) ?? (!hongro ? loadDraft(user, mode, key) : null);
    const d = storedDraft && isHongroVariety(storedDraft.form.variety) === hongro ? storedDraft : null; setConflict(null);
    if (!d) { const carry = carryRef.current; carryRef.current = null; setFormState(carry && !activeLot ? {...official, ...carry} : official); setDraftNote(null); return; }
    if (d.baseSig !== officialSig) { setFormState(official); setConflict(d); setDraftNote(null); return; }
    if (signature(d.form) !== officialSig) { const carry = carryRef.current; carryRef.current = null; setFormState(carry && !activeLot ? {...d.form, ...carry} : d.form); setDraftNote({tone: 'info', text: carry ? '품종을 바꿨어요. 보관 조건과 날짜는 이어서 쓰고, 품종별 측정값은 따로 보관해요.' : `작성 중인 내용을 복구했습니다 (${new Date(d.savedAt).toLocaleString('ko-KR')} 임시 저장).`}); }
    else { setFormState(official); clearDraft(user, mode, draftKey); setDraftNote(null); }
  }, [officialReady, user, mode, key, draftKey, hongro, officialSig, official, expectedFormKey]);

  const setForm = useCallback((updater: (f: TrackerForm) => TrackerForm) => {
    setSaveErrors({});
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
  const measureRef = useRef<HTMLDetailsElement>(null), optionalRef = useRef<HTMLDetailsElement>(null), trackedRef = useRef<HTMLDetailsElement>(null);
  const measureErr = !!(errors.probe_mm || errors.fruit_temp);
  const optionalErr = !!(errors.weight || errors.harvest_date || errors['hongro.initial.weight'] || errors['hongro.initial.diameter'] || (!(mode === 'real' && !activeLot) && (errors.acidity || errors['hongro.initial.acidity'])));
  const trackedErr = !!(errors.tracked_weight || errors.tracked_count || errors.tracked_sample_id);
  useEffect(() => { if (measureErr && measureRef.current) measureRef.current.open = true; }, [measureErr]);
  useEffect(() => { if (optionalErr && optionalRef.current) optionalRef.current.open = true; }, [optionalErr]);
  useEffect(() => { if (trackedErr && trackedRef.current) trackedRef.current.open = true; }, [trackedErr]);
  function discardDraft() { clearDraft(user, mode, draftKey); setFormState(official); setDraftNote({tone: 'info', text: '초안을 지웠습니다. 저장된 기록은 그대로입니다.'}); }

  function switchCultivar(value: string) {
    const next = value === '홍로' ? 'hongro' : 'fuji';
    if (next === cultivar) return;
    // 품종과 무관한 보관 기록은 새 품종 입력으로 이어 갑니다(측정값·날씨 선택은 품종별로 따로 보관).
    const {name, name_auto, storage, mcp, mcpSelected, temperature, intake_date, storage_start_date, sameStart, harvest_date, location, packaging, sensor_id, mcpd, ca, team_shared} = form;
    carryRef.current = {name, name_auto, storage, mcp, mcpSelected, temperature, intake_date, storage_start_date, sameStart, harvest_date, location, packaging, sensor_id, mcpd, ca, team_shared,
      // 홍로 예측식은 일반 저온·1-MCP 미처리만 있어요. 다른 조건을 그대로 넘기면 ‘준비 중’ 조건이 선택된 채로 남습니다.
      ...(next === 'hongro' ? {storage: '일반 저온' as const, mcp: '미처리' as const, mcpSelected: true} : {})};
    setSelectionDateRaw(null); setSelectedDayState(null); setCultivar(next); setMetric('firmness'); setBaseline(null); setUseLatest(true); setFutureId('same');
    setShowConditions(false); setShowObsCompare(false); setSaveMsg(null); setSaveErrors({});
    setEditing(true); setShowResults(false);
  }

  // ── 날짜 ──
  const startDate = (form.sameStart ? form.intake_date : form.storage_start_date) || '';
  const startOk = isDate(startDate);
  const [asOfRaw, setAsOf] = useState(today);
  const asOf = startOk && asOfRaw < startDate ? startDate : asOfRaw;
  const asOfDay = startOk ? daysBetween(startDate, asOf) : 0;
  const measuredOn = effectiveInitialMeasuredOn(form);
  const initialMeasuredAfterAsOf = isDate(measuredOn) && isDate(asOf) && measuredOn > asOf;
  const initialDateReason = '초기 측정일이 분석 기준일 이후입니다. 해당 초기값은 이 분석의 계산 시작점으로 사용할 수 없습니다. 분석 기준일을 실제 측정일 이후로 선택해 주세요.';
  const t0 = startOk && isDate(measuredOn) ? daysBetween(startDate, measuredOn) : 0;
  const [selectedDay, setSelectedDayState] = useState<number | null>(null);
  const [selectionDateRaw, setSelectionDateRaw] = useState<string | null>(null);
  const setSelectedDay = (day: number | null) => { setSelectionDateRaw(null); setSelectedDayState(day); };
  // 처음에는 ‘오늘’을 보여 줍니다(저장을 막 시작했으면 30일 뒤).
  const selDay = selectionDateRaw && startOk ? daysBetween(startDate, selectionDateRaw) : selectedDay ?? (asOfDay > 0 ? Math.min(maxDays, asOfDay) : Math.min(maxDays, 30));
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
  const sourceLabel = hongro && form.hongro.source === 'weather' ? (mode === 'example' ? '예시 날씨 기반 추정' : '날씨 기반 추정') : mode === 'example' ? '예시 초기값' : '실측';
  const displayUnit = (m: MetricId) => hongro && m !== 'loss' ? HONGRO_UNITS[m] : metricMeta[m].unit;

  // ── 조건과 모델 ──
  const recorded = resolveModel({...form,temperature:num(form.temperature)});
  const [futureId, setFutureId] = useState<StorageId | 'same'>('same');
  const future = isHongroVariety(form.variety) || futureId === 'same' ? recorded : {id: futureId, reason: ''};
  const futureLabel = futureId === 'same' ? `기록 조건 유지${recorded.id ? ` (${modelLabel[recorded.id]})` : ''}` : modelLabel[futureId];
  const [useLatest, setUseLatest] = useState(true);
  const [metric, setMetric] = useState<MetricId>('firmness');
  const [editing, setEditing] = useState(false), [showResults, setShowResults] = useState(false), [showConditions, setShowConditions] = useState(false);
  const [inputNotice, setInputNotice] = useState('');
  const [noticeSig, setNoticeSig] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const firstInput = mode === 'real' && !activeLot;
    setEditing(firstInput || hongro); setShowResults(!firstInput); setShowConditions(false); setInputNotice('');
    setBaseline(null); setFutureId('same'); setUseLatest(true); setMetric('firmness'); setShowObsCompare(false); setSaveMsg(null); setSaveErrors({});
  }, [scope, mode, key, activeLot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 실측(또는 예시) 기록과 계산 ──
  const exampleMode = mode === 'example';
  const kind: DataKind = exampleMode ? '예시' : '실측';
  const trackedInitial = num(form.tracked.initial_weight);
  const pastObs = useMemo(() => (hongro && mode==='example') || (mode === 'real' && !activeLot) ? [] : loaded.observations.filter(o => o.date <= asOf), [hongro, mode, activeLot, loaded.observations, asOf]);
  const excludedLater = loaded.observations.length - pastObs.length;
  const observationsFingerprint = useMemo(() => observationFingerprint(pastObs), [pastObs]);
  const measured = useMemo(() => Object.fromEntries(metricIds.map(m => [m, startOk ? measuredPoints(m, pastObs, startDate, kind, trackedInitial, {sampleId: form.tracked.sample_id, date: measuredOn, count: num(form.tracked.count)}) : []])) as Record<MetricId, MeasuredPoint[]>, [pastObs, startDate, startOk, kind, trackedInitial, form.tracked.sample_id, form.tracked.count, measuredOn]);
  const weatherMode = hongro && form.hongro.source === 'weather';
  // 후지(청송·장수·영주) 날씨 추정: 경도(N, 작성자 확인)·당도·산도를 저장 예측의 처음 값으로 이어 씁니다.
  const fujiWeather = !hongro && form.fuji?.source === 'weather';
  const fujiEst = useMemo(() => hongro ? null : fujiWeatherEstimate(form.fuji ?? emptyFujiForm()), [hongro, form.fuji]);
  const estMode = weatherMode || fujiWeather;
  /** 계산에 쓰는 초기값: 날씨 추정은 추정값, 직접 입력은 입력값(경도는 N으로 환산). 미측정·빈칸은 null. */
  const initialValue = (m: MetricId): number | null => {
    if (m === 'loss') return null;
    if (weatherMode) return hongroResult?.initial[m] ?? null;
    if (fujiWeather) return fujiEst ? fujiEst[m] : null;
    if (form.missing[m]) return null;
    const raw = hongro ? form.hongro.initial[m] : form[m];
    return m === 'firmness' ? firmnessToN(raw, form.firmness_unit) : num(raw);
  };
  const anchors = useMemo(() => Object.fromEntries(metricIds.map(m => {
    // Stored loss curves begin at storage day zero and need no weight measurement.
    if (m === 'loss') return [m, {day:0, date:startDate, value:0, kind:'모델 계산', source:'initial'} as Anchor];
    if (!startOk || initialMeasuredAfterAsOf || errors.storage_start_date || errors.intake_date || errors.initial_measured_on || (!hongro && errors[m])) return [m, null];
    const latest = useLatest ? [...measured[m]].reverse().find(p => p.day >= t0) : undefined;
    if (latest) return [m, {day: latest.day, date: latest.date, value: latest.value, kind: latest.kind, source: 'latest'} as Anchor];
    if (!isDate(measuredOn)) return [m, null];
    const v = initialValue(m);
    return [m, v === null ? null : {day:t0, date:measuredOn, value:v, kind:estMode ? '모델 계산' : kind, source:'initial'} as Anchor];
  })) as Record<MetricId, Anchor | null>, [hongro, hongroResult, startDate, startOk, initialMeasuredAfterAsOf, useLatest, measured, t0, form, measuredOn, kind, errors.storage_start_date, errors.intake_date, errors.initial_measured_on, errors.firmness, errors.brix, errors.acidity]);
  const modelInput = (m:MetricId, day:number, temperature = num(form.temperature)):ModelInput => ({
    cultivar:form.variety, storage:form.storage === '일반 저온' ? 'cold' : form.storage === 'CA' ? 'ca' : 'other',
    temperature, mcp:form.mcp === '처리' ? 'treated' : form.mcp === '미처리' ? 'untreated' : 'unknown',
    metric:m, day, anchor:anchors[m] ? {day:anchors[m]!.day,value:anchors[m]!.value} : null,
    allowFujiReference:false,
  });
  const series = useMemo(() => Object.fromEntries(metricIds.map(m => {
    if (!startOk) return [m,{ok:false,reason:'실제 저장 시작일을 입력해 주세요.'}];
    if (m !== 'loss' && initialMeasuredAfterAsOf) return [m,{ok:false,reason:initialDateReason}];
    if (hongro) return [m, predictionSeries(modelInput(m, selDay), asOfDay, maxDays)];
    return [m,computeSeries({variety:form.variety,temperature:num(form.temperature),metric:m,anchor:anchors[m],recorded:recorded.id,recordedReason:recorded.reason,future:future.id,futureReason:future.reason,asOfDay})];
  })) as Record<MetricId,Series>, [startOk,hongro,form,anchors,recorded.id,recorded.reason,future.id,future.reason,asOfDay,initialMeasuredAfterAsOf,maxDays]);
  // 최근 측정값에서 이어 계산할 때, 그 측정일보다 앞선 날은 처음 값(입고 때 측정·날씨 추정)에서 계산한 같은 식으로 보여 줍니다.
  const initialAnchors = useMemo(() => Object.fromEntries(metricIds.map(m => {
    if (m === 'loss' || anchors[m]?.source !== 'latest' || !isDate(measuredOn)) return [m, null];
    const v = initialValue(m);
    return [m, v === null ? null : {day:t0, date:measuredOn, value:v, kind:estMode ? '모델 계산' : kind, source:'initial'} as Anchor];
  })) as Record<MetricId, Anchor | null>, [anchors, measuredOn, t0, form, kind, hongroResult]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialSeries = useMemo(() => Object.fromEntries(metricIds.map(m => {
    const ia = initialAnchors[m]; if (!ia) return [m, null];
    if (hongro) return [m, predictionSeries({...modelInput(m, selDay), anchor: {day: ia.day, value: ia.value}}, asOfDay, maxDays)];
    return [m, computeSeries({variety:form.variety,temperature:num(form.temperature),metric:m,anchor:ia,recorded:recorded.id,recordedReason:recorded.reason,future:future.id,futureReason:future.reason,asOfDay})];
  })) as Record<MetricId, Series | null>, [initialAnchors, hongro, form, recorded.id, recorded.reason, future.id, future.reason, asOfDay, maxDays]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 고른 날의 비교 기준: 최근 측정일보다 앞선 날은 처음 값과 비교합니다. */
  const shownAnchor = (m:MetricId, d=selDay):Anchor|null => { const a=anchors[m]; return a?.source==='latest' && d<a.day && initialAnchors[m] ? initialAnchors[m] : a; };
  const at = (m:MetricId, d=selDay):ValueAt => {
    let r=valueAt(series[m],d);
    const a=anchors[m], s0=initialSeries[m];
    if (r.status!=='ok' && a?.source==='latest' && d<a.day && s0) { const r0=valueAt(s0,d); if (r0.status==='ok') r=r0; }
    return r.status==='out'?{...r,reason:`모델 적용 범위 초과: ${r.reason}`}:r;};
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
  const compatSig = JSON.stringify({mode, key, variety: form.variety, temperature: form.temperature, modelVersion: MODEL_VERSION, startDate, measuredOn, f: form.firmness, fu: form.firmness_unit, miss: form.missing, h: form.hongro, b: form.brix, a: form.acidity, tw: form.tracked.initial_weight, sample: form.tracked.sample_id, measure: form.measure, st: form.storage, mcp: form.mcp, observationsFingerprint, asOf, useLatest});
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
  const anyInitial = (['firmness', 'brix', 'acidity'] as MetricId[]).some(m => initialValue(m) !== null);
  const step1 = startOk && (anyInitial || modelResults.loss.ok), step2 = hongro ? Object.values(modelResults).some(r=>r.ok) : !!recorded.id || (!!future.id && asOfDay <= t0);
  const step = !step1 ? 1 : !step2 ? 2 : 3;
  const nextHint = hongro ? (!startOk?'실제 저장 시작일을 입력해 주세요.':modelResults[metric].reason || '결과와 그래프에서 저장 시작일부터 0~120일을 확인하세요.') : !startOk ? '저장 시작일(또는 입고일)을 입력하세요.' : !anyInitial && !modelResults.loss.ok ? '초기 경도·당도·산도 중 측정한 값을 입력하세요. 감모율 모델은 중량 없이도 계산합니다.'
    : !step2 ? recorded.reason || '저장 조건을 선택하세요.' : '결과와 그래프에서 날짜를 골라 변화를 확인하세요.';
  const focus = (id: string) => { setEditing(true); requestAnimationFrame(() => { const el = document.getElementById(id); if (!el) return; let parent = el.parentElement; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; } (el instanceof HTMLInputElement && el.type === 'radio' ? el.closest('fieldset') || el : el).scrollIntoView({behavior: 'smooth', block: 'center'}); (el as HTMLInputElement).focus({preventScroll: true}); }); };

  // ── 정식 기록 저장 (실측 모드) ──
  const [saving, setSaving] = useState(false), [saveMsg, setSaveMsg] = useState<{ok: boolean; text: string} | null>(null), [saveErrors, setSaveErrors] = useState<Partial<Record<string, string>>>({});
  async function saveRecord() {
    if (mode === 'example') { setSaveMsg({ok: false, text: '예시 데이터는 실제 물량 기록으로 저장할 수 없습니다.'}); return; }
    if (guest || !session) { handoffToLogin(); return; }
    if (!formReady || loadError) { setSaveMsg({ok: false, text: '물량 정보를 정상적으로 불러온 뒤 저장해 주세요.'}); return; }
    const e = validateForm(form, true);
    if (mode === 'real' && !activeLot && form.sameStart && !startOk && e.intake_date) { delete e.intake_date; e.storage_start_date = '저장 시작일을 입력해 주세요.'; }
    setSaveErrors(e); setSaveMsg(null);
    if (Object.keys(e).length) { setSaveMsg({ok: false, text: '표시한 항목을 확인해 주세요.'}); const key = Object.keys(e)[0]; focus(key === 'intake_date' && form.sameStart ? 'tf-storage_start_date' : key === 'initial_measured_on' && form.initialSameStart ? 'tf-initialSameStart' : 'tf-' + key.replaceAll('.', '-')); return; }
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
        openLot(r.lot.id);
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
    metric, day:selDay, date:selDate, at:at(metric), anchor:shownAnchor(metric),
    measuredToday:measured[metric].find(p=>p.day===selDay) ?? null,
    baseline:baseline && compatible && !sameAsBaseline ? {label:`${baseline.label} · ${baseline.conditionLabel}`,at:valueAt(baseline.series[metric],selDay)} : null,
    changeLabel:futureLabel,
  }) : '저장 시작일을 입력하면 날짜별 변화를 요약해 드립니다.';

  const lotName = exampleMode ? `예시 사과 · ${hongro ? '홍로' : '후지'}` : activeLot?.name ?? (form.name || '새 입력(저장 전)');
  const env = activeLot || exampleMode ? loaded.stats : null;
  const selectedValue = at(metric), latestPoint = measured[metric].at(-1);
  const latestConditions = latestPoint ? measurementCompatibility(form.measure, pastObs.find(o => o.id === latestPoint.id)?.details?.measure) : null;
  const latestCalculation = latestPoint && (metric==='loss' ? t0===0 : latestConditions?.comparable) ? valueAt(series[metric], latestPoint.day) : null;
  const firstInput = mode === 'real' && !activeLot;
  const whenLabel = !Number.isFinite(selDay) ? '선택한 날' : selDay === asOfDay ? '오늘' : selDay > asOfDay ? `${selDay - asOfDay}일 후` : `${asOfDay - selDay}일 전`;
  const firstValue = initialValue(metric);
  const initialComparison = (() => {
    if (selectedValue.status !== 'ok') return '';
    const value = selectedValue.value, isMeasured = modelResults[metric].kind === '실측';
    if (metric === 'loss') {
      const basis = isMeasured ? '첫 중량 측정 대비' : '저장 시작일 기준 계산상';
      if (value === 0) return `${basis} 무게 변화가 없어요.`;
      return `${basis} 무게가 ${fmtNum(Math.abs(value), metricMeta.loss.digits)}% ${value > 0 ? '줄었어요' : '늘었어요'}.`;
    }
    if (firstValue === null || !Number.isFinite(firstValue) || initialMeasuredAfterAsOf || selDay < t0) return '처음 값이 없어 변화를 비교할 수 없어요.';
    const change = describeChange(metric, value, firstValue);
    const initialLabel = weatherMode ? '처음 추정값' : '처음 입력값';
    if (change.diff === 0) return `${initialLabel} ${fmtNum(firstValue, metricMeta[metric].digits)} ${displayUnit(metric)}과 같아요.`;
    const relative = firstValue !== 0 ? Math.abs(change.diff / firstValue * 100) : null;
    const relativeText = relative === null ? '' : relative < 0.1 ? ' (약 0.1% 미만)' : ` (약 ${fmtNum(relative, 1)}%)`;
    return `${initialLabel} ${fmtNum(firstValue, metricMeta[metric].digits)} ${displayUnit(metric)}보다 ${change.text}${relativeText}`;
  })();
  const hasDisplayedChange = selectedValue.status === 'ok' && (metric === 'loss'
    ? describeChange('loss', selectedValue.value, 0).diff !== 0
    : firstValue !== null && Number.isFinite(firstValue) && !initialMeasuredAfterAsOf && selDay >= t0 && describeChange(metric, selectedValue.value, firstValue).diff !== 0);
  const futureResult = !hongro && selDay > asOfDay && !!future.id;
  const currentStorage = futureResult ? (future.id === 'ca' ? 'CA' : '일반 저온') : form.storage;
  const currentMcp = futureResult ? (future.id === 'mcp' ? '처리' : '미처리') : form.mcp;
  // 최근 측정을 계산 시작점으로 선택해도 ‘처음 대비’ 비교에는 날씨 추정 초기값이 남아 있습니다.
  const usesWeatherInitial = weatherMode && metric !== 'loss' && firstValue !== null;
  const weatherUnitWarning = false; // 초기 경도 회귀식 단위는 N (작성자 확인, 2026-10-31)
  const changedScenario = futureResult && future.id !== recorded.id && modelResults[metric].ok;
  const priorResult = changedScenario ? predictQuality(modelInput(metric, asOfDay)) : undefined;
  const recordedConditions = `${form.storage} · ${form.temperature ? `${form.temperature}℃` : '온도 미기록'} · 1-MCP ${form.mcp}`;
  const futureConditions = `${currentStorage} · ${form.temperature ? `${form.temperature}℃` : '온도 미기록'} · 1-MCP ${currentMcp}`;
  const weatherInitialInfo = usesWeatherInitial ? `거창 날씨 값: ${HONGRO_WEATHER_FIELDS.map(field => `${field.label} ${form.hongro.weather[field.key]} ${field.unit}`).join(' · ')}. 수확한 해의 농업기상(거창읍) 일자료로 계산하거나 직접 입력한 값으로 초기 품질을 추정합니다.` : undefined;
  const basisContext: ModelInfoContext = {
    modelId: selDay <= asOfDay ? recorded.id : future.id,
    metric, cultivar: form.variety, storage: currentStorage, temperature: form.temperature, mcp: currentMcp,
    initialSource: metric === 'loss' ? '저장 경과일' : anchors[metric]?.source === 'latest' ? (usesWeatherInitial ? '선택한 최근 측정값 (처음 대비 비교에는 날씨 추정값 사용)' : '선택한 최근 측정값') : usesWeatherInitial ? (exampleMode ? '예시 날씨 기반 추정' : '날씨 기반 추정') : exampleMode ? '예시 초기값' : '입력한 초기 측정값',
    result: modelResults[metric],
    priorResult, weatherInitialInfo, weatherUnitWarning,
    contextNote: changedScenario ? `조건 변경 시나리오: 분석 기준일(${fmtDate(asOf)})까지 ${recordedConditions}, 이후 ${futureConditions}. 두 구간의 식을 이어 붙였으며 실제 저장 방식 전환 효과는 검증되지 않았습니다.` : undefined,
    technicalNote: weatherUnitWarning ? HONGRO_UNITS_CONFLICT : undefined,
  };
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
      const an = shownAnchor(metric);
      if (an?.source === 'latest') { const c = describeChange(metric, v.value, an.value); const from = `계산 시작점(${fmtDate(an.date)} 측정값)`; out.push(c.diff === 0 ? `${from}과 같습니다.` : `${from}보다 ${c.text}.`); }
    }
    const today = measured[metric].find(p => p.day === selDay);
    if (today) out.push(`같은 날 ${exampleMode ? '예시 측정' : '실제 측정'}값은 ${fmtNum(today.value, meta.digits)} ${unit}이에요.`);
    return out;
  })();
  const firstBrix = initialValue('brix');
  /** 홍로 식의 어느 구간인지 (계산식 정의에서 그대로 읽은 설명) */
  const hongroSegment = (m: MetricId) => m === 'firmness' ? (selDay <= 60 ? '0~60일 구간 식' : '60일 이후 구간 식')
    : m === 'brix' ? '식에 저장 중 변화 없음' : m === 'acidity' ? (selDay <= 60 ? '60일까지 처음 값 유지' : '60일 이후 감소 구간')
    : num(form.temperature) === 0 || num(form.temperature) === 4 ? `L = ${HONGRO_LOSS_RATE[num(form.temperature) as 0 | 4]} × t` : '';
  const lastObsDate = pastObs.length ? pastObs.reduce((a, o) => o.date > a ? o.date : a, pastObs[0].date) : null;
  const staleDays: number | null = !exampleMode && !!activeLot && !!lastObsDate && isDate(asOf) ? daysBetween(lastObsDate, asOf) : null;

  // ── 입력 화면: 물량 전환 · 저장고 조건 불러오기 · 조건 판별 · 입력·예측 조건 확인 ──
  const [storeOpen, setStoreOpen] = useState(false), [storeFrom, setStoreFrom] = useState('');
  // 새 홍로 물량: ‘수확 당일 바로 입고’를 고르면 저장 시작일을 수확일과 같게 둡니다. 체크하지 않으면 날짜를 따로 받습니다.
  const [harvestSame, setHarvestSame] = useState(true);
  // 바로 보기: 저장을 이미 시작했으면 ‘오늘’부터 보여 주고, 아니면 60일을 먼저 보여 줍니다.
  const [quickPick, setQuickDay] = useState<number | null>(null);
  const quickToday = startOk && asOfDay > 0 && asOfDay <= (hongro ? 120 : 300) ? asOfDay : null;
  const quickDays = [...new Set([...(quickToday !== null ? [quickToday] : []), 30, 60, 90, 120, ...(hongro ? [] : [150, 200])])].sort((a, b) => a - b);
  const quickDay = quickPick !== null && quickDays.includes(quickPick) ? quickPick : quickToday ?? 60;
  useEffect(() => { const r = session?.profile.region; if (firstInput && !hongro && form.fuji && !form.fuji.region && (r === 'cheongsong' || r === 'jangsu' || r === 'yeongju')) setForm(f => ({...f, fuji: {...(f.fuji ?? emptyFujiForm()), region: r}})); }, [firstInput, hongro, form.fuji, session?.profile.region, setForm]);
  useEffect(() => { if (firstInput && fujiWeather && !form.initialSameStart) setForm(f => ({...f, initialSameStart: true})); }, [firstInput, fujiWeather, form.initialSameStart, setForm]);
  // 새 물량 화면은 예측식이 있는 조합만 고르게 합니다. 홍로는 일반 저온·1-MCP 미처리 한 가지라 그 조건으로 둡니다.
  useEffect(() => {
    if (firstInput && hongro && (form.storage !== '일반 저온' || form.mcp !== '미처리' || !form.mcpSelected)) setForm(f => ({...f, storage: '일반 저온', mcp: '미처리', mcpSelected: true}));
  }, [firstInput, hongro, form.storage, form.mcp, form.mcpSelected, setForm]);
  // 새 홍로 물량: 수확일을 넣고 측정값이 없으면 한 번만 ‘날씨로 추정’으로 바꿔 수확일·온도만으로 결과가 나오게 합니다. 다시 바꾸면 그대로 둡니다.
  const autoWeatherRef = useRef(false);
  useEffect(() => {
    if (!firstInput || !hongro || autoWeatherRef.current || form.hongro.source !== 'measured' || !isDate(form.harvest_date)) return;
    if ((['firmness', 'brix', 'acidity'] as const).some(m => String(form.hongro.initial[m] ?? '').trim() !== '')) return;
    autoWeatherRef.current = true; setForm(f => ({...f, hongro: {...f.hongro, source: 'weather'}}));
  }, [firstInput, hongro, form.hongro.source, form.harvest_date, form.hongro.initial, setForm]);
  // 날씨 추정값은 수확 시점 품질입니다. 사용자가 ‘수확 당일 바로 입고’를 고른 경우에만 그 추정 기준일을 저장 시작일로 둡니다.
  useEffect(() => { if (firstInput && weatherMode && harvestSame && !form.initialSameStart) setForm(f => ({...f, initialSameStart: true})); }, [firstInput, weatherMode, harvestSame, form.initialSameStart]);
  const [checkShown, setCheckShown] = useState(false), [checkedSig, setCheckedSig] = useState<string | null>(null);
  const checkRef = useRef<HTMLElement>(null);
  useEffect(() => { setStoreOpen(false); setStoreFrom(''); setCheckShown(false); setCheckedSig(null); }, [scope]);
  function startNewLot() { if (exampleMode) changeMode('real'); setLotKey('new'); setBaseline(null); setSelectedDay(null); }
  /** 다른 물량의 저장고 조건(저장 방식·온도·위치)만 가져옵니다. 1-MCP·측정값은 물량마다 달라 가져오지 않습니다. */
  function importStore(id: string) {
    const src = lots.find(l => l.id === id); if (!src) return;
    const storage = (['일반 저온', 'CA', '기타'].includes(src.storage) ? src.storage : '기타') as TrackerForm['storage'];
    const t = src.details?.storage_temperature;
    setForm(f => ({...f, storage, location: src.location ?? f.location, ...(t != null ? {temperature: String(t), hongro: {...f.hongro, storage: t === 0 ? 'cold0' : t === 4 ? 'cold4' : f.hongro.storage}} : {})}));
    setStoreFrom(`${src.name}${src.location ? ` · ${src.location}` : ''}`); setStoreOpen(false);
  }
  /** 품종·저장 방식·처리 여부·온도 조합으로 적용식을 판별합니다(경도 식 기준, 항목별 결과는 확인 패널에 따로 표시). */
  const condition = (() => {
    const tRaw = form.temperature.trim(), t = num(form.temperature);
    if (hongro && tRaw === '') return {ok: false, title: '실제 저장고 온도를 입력하면 적용할 식을 찾아요.', detail: '홍로 식은 일반 저온·1-MCP 처리 안 함·정확히 0℃ 또는 4℃에만 있어요.'};
    if (form.mcp !== '처리' && form.mcp !== '미처리') return {ok: false, title: '1-MCP 처리 여부를 고르면 적용할 식을 찾아요.', detail: '처리 여부를 모르면 예측식을 적용하지 않아요. 기록은 저장할 수 있어요.'};
    const sel = selectQualityModel({cultivar: form.variety, storage: form.storage === '일반 저온' ? 'cold' : form.storage === 'CA' ? 'ca' : 'other', temperature: t, mcp: form.mcp === '처리' ? 'treated' : form.mcp === '미처리' ? 'untreated' : 'unknown', metric: 'firmness', day: 0});
    if (!sel.model) return {ok: false, preparing: true, title: '이 보관 조건의 예측은 서비스 준비 중이에요.', detail: `${(sel.reason ?? '').replace(/^적용 모델 없음:\s*/, '')} 기록은 지금도 저장할 수 있어요.`};
    return {ok: true, title: `적용 예측식: ${sel.model.label}`, detail: hongro ? '입력한 온도에 해당하는 식으로만 계산해요.' : '후지 원자료에 저장 온도가 없어 온도와 관계없이 같은 식을 써요. 해당 온도에서의 적용 타당성은 확인되지 않았어요.'};
  })();
  const measuredLossRows = measured.loss.map(p => ({date: p.date, day: p.day, value: p.value}));
  const lossPlan = modelResults.loss.ok ? `${hongro ? `홍로 ${num(form.temperature)}℃ 감모율 식` : '후지 감모율 식'}으로 저장일수에 따라 계산해요(검증 전). 실측 감모율과는 따로 표시해요.` : (modelResults.loss.reason ?? '적용식·조건 확인 필요').replace(/^적용 모델 없음:\s*/, '이 조건에 적용할 감모율 식이 확인되지 않았어요. ');
  const missingWeather = HONGRO_WEATHER_FIELDS.filter(f => String(form.hongro.weather[f.key] ?? '').trim() === '').map(f => f.label);
  const supportRows: {key: string; label: string; ok: boolean; text: string}[] = (() => {
    const rows: {key: string; label: string; ok: boolean; text: string}[] = [];
    if (weatherMode) rows.push(missingWeather.length ? {key: 'weather', label: '날씨 기반 초기 품질 추정', ok: false, text: `아직 값이 없는 항목: ${missingWeather.join(', ')}. 네 값이 모두 있어야 추정해요. 기록은 남길 수 있어요.`}
      : hongroResult ? {key: 'weather', label: '날씨 기반 초기 품질 추정', ok: true, text: `경도 ${fmtNum(hongroResult.initial.firmness, 1)} N · 당도 ${fmtNum(hongroResult.initial.brix, 1)} °Brix · 산도 ${fmtNum(hongroResult.initial.acidity, 2)} % (날씨 기반 추정, 실측 아님)`}
      : {key: 'weather', label: '날씨 기반 초기 품질 추정', ok: false, text: hongroCalculation.error || '저장 시작일과 날씨 선택을 확인해 주세요.'});
    for (const m of visibleMetrics) {
      if (m === 'loss') continue;
      const r = predictQuality({...modelInput(m, Math.max(asOfDay, t0)), anchor: anchors[m] ? {day: anchors[m]!.day, value: anchors[m]!.value} : null});
      const iv = initialValue(m), label = `${metricMeta[m].label} 변화 예측`;
      if (!startOk) rows.push({key: m, label, ok: false, text: '저장을 시작한 날을 입력해 주세요.'});
      else if (iv === null && !r.ok) rows.push({key: m, label, ok: false, text: weatherMode ? '날씨 추정값이 생기면 계산할 수 있어요.' : form.missing[m] ? '미측정으로 기록했어요. 이 항목은 예측하지 않아요.' : `처음 측정한 ${metricMeta[m].label} 값을 넣으면 계산할 수 있어요.`});
      else rows.push({key: m, label, ok: r.ok, text: r.ok ? '계산 가능' : (r.reason ?? '적용식 확인 필요').replace(/^적용 모델 없음:\s*/, '이 조건에 적용할 예측식이 확인되지 않았어요. ')});
    }
    rows.push({key: 'loss', label: '앞으로의 감모율 예측', ok: modelResults.loss.ok, text: lossPlan});
    rows.push({key: 'measured-loss', label: '실측 감모율', ok: measuredLossRows.length > 0, text: measuredLossRows.length ? `${measuredLossRows.length}건 계산됨 (같은 표본·같은 개수 기록)` : '같은 표본의 초기·후속 중량이 쌓이면 계산해요.'});
    const saveErr = exampleMode ? ['예시는 저장되지 않아요.'] : Object.values(validateForm(form, true)).filter(Boolean) as string[];
    rows.push({key: 'save', label: '기록 저장', ok: saveErr.length === 0, text: saveErr.length ? saveErr[0] : guest ? '로그인하면 이 입력 그대로 저장할 수 있어요.' : '지금 입력한 보관 조건과 초기 품질을 저장할 수 있어요.'});
    return rows;
  })();
  const stale = checkShown && checkedSig !== null && checkedSig !== signature(form);
  function checkConditions() {
    setCheckShown(true); setCheckedSig(signature(form));
    const firstOk = visibleMetrics.find(m => supportRows.find(r => r.key === m)?.ok);
    if (firstOk) { setMetric(firstOk); setInputNotice(''); setShowResults(true); requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'})); }
    else requestAnimationFrame(() => checkRef.current?.focus());
  }
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
    if (metric !== 'loss' && initialValue(metric) === null) {
      const available = (['firmness', 'brix', 'acidity'] as MetricId[]).find(m => initialValue(m) !== null);
      if (available) setMetric(available);
    }
    setInputNotice(''); setShowResults(true); setEditing(false);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  }

  if (!formReady) return <section className="qt-context-loading" role="status" aria-live="polite"><Loader2 className="spin" size={22} /><h2>사과 기록을 불러오는 중이에요</h2><p>저장된 입력값과 측정 기록을 가져오고 있어요.</p></section>;

  // New real entries use a single continuous form. Existing records and example results
  // retain the established editor and calculation views below.
  if (firstInput && editing) {
    const mcpChosen = form.mcpSelected && form.mcp !== '미확인';
    const shownErrors: Partial<Record<string, string>> = {...errors, ...saveErrors};
    if (form.sameStart && shownErrors.intake_date) { shownErrors.storage_start_date = shownErrors.storage_start_date || shownErrors.intake_date; delete shownErrors.intake_date; }
    if (checkShown && !startOk) shownErrors.storage_start_date = '저장 시작일을 입력해 주세요.';
    if (checkShown && !mcpChosen) shownErrors.mcp = '1-MCP 처리 여부를 선택해 주세요.';
    if (checkShown && anyInitial && !isDate(measuredOn)) shownErrors.initial_measured_on = '측정일을 입력하거나 저장 시작일과 같음을 선택해 주세요.';
    const uniqueErrors = Object.entries(shownErrors).filter(([, v]) => !!v) as [string, string][];
    const statusFields = new Set(Object.keys(errors).map(k => form.sameStart && k === 'intake_date' ? 'storage_start_date' : k));
    if (!startOk) statusFields.add('storage_start_date');
    if (!mcpChosen) statusFields.add('mcp');
    if (anyInitial && !isDate(measuredOn)) statusFields.add('initial_measured_on');
    const missingRequired = statusFields.size;
    const valueNames = (['firmness', 'brix', 'acidity'] as const).filter(m => initialValue(m) !== null).map(m => metricMeta[m].label);
    // ‘준비 완료’ 대신 지금 입력으로 실제 계산되는 항목을 그대로 보여 줍니다(예측식·계산 규칙은 바꾸지 않음).
    const predictable = visibleMetrics.filter(m => supportRows.find(r => r.key === m)?.ok);
    const lossOnlyNew = predictable.length === 1 && predictable[0] === 'loss';
    const statusTitle = missingRequired ? `확인할 항목 ${missingRequired}개`
      : !predictable.length ? '아직 예측할 수 있는 항목이 없어요'
      : lossOnlyNew ? '감모율만 계산할 수 있어요'
      : `계산 가능: ${predictable.map(m => metricMeta[m].label).join(' · ')}`;
    const statusDetail = missingRequired ? (valueNames.length ? `${valueNames.join(' · ')} 입력됨` : '측정한 항목을 입력할 수 있어요.')
      : !predictable.length ? (condition.ok ? (weatherMode ? (supportRows.find(r => !r.ok && r.key !== 'save' && r.key !== 'measured-loss')?.text ?? '날씨 값과 수확일을 확인해 주세요.') : '처음 측정한 경도·당도·산도 중 하나 이상을 넣으면 계산할 수 있어요. 기록은 저장할 수 있어요.') : [condition.title, condition.detail].filter(Boolean).join(' '))
      : lossOnlyNew ? (anyInitial ? (supportRows.find(r => r.key !== 'loss' && r.key !== 'weather' && visibleMetrics.includes(r.key as MetricId) && !r.ok)?.text ?? '경도·당도·산도는 계산하지 않아요.') : '경도·당도·산도는 처음 측정한 값이 있어야 계산돼요. 감모율은 저장일수로 계산해요.')
      : estMode ? '초기 품질은 날씨로 추정한 값이에요(실측 아님).' : valueNames.length ? `${valueNames.join(' · ')} 입력됨` : '';
    const temperatureField = <F id="temperature" label={hongro ? '저장고 온도' : '실제 저장고 온도'} unit="℃" err={shownErrors.temperature} hint={hongro?'홍로 예측식은 0℃ 또는 4℃에만 있어요. 다른 온도는 기록만 하고 계산하지 않아요.':'후지의 온도는 기록용이며 예측식을 보정하지 않아요.'}><input id="tf-temperature" type="number" step="any" value={form.temperature} onChange={e=>setForm(f=>({...f,temperature:e.target.value,hongro:{...f.hongro,storage:e.target.value==='0'?'cold0':e.target.value==='4'?'cold4':f.hongro.storage}}))} /></F>;
    const setStart = (value: string) => setForm(f => ({...f, storage_start_date: value, ...(f.sameStart ? {intake_date: value} : {})}));
    const setInitialSame = (checked: boolean) => setForm(f => ({...f, initialSameStart: checked, ...(!checked ? {initial_measured_on: effectiveInitialMeasuredOn(f)} : {})}));
    const checkNew = () => {
      setCheckShown(true); setSaveErrors({}); setInputNotice(''); setNoticeSig(null);
      // Keep the list beside the button visible; selecting an item moves to its field.
      if (!startOk || !mcpChosen || Object.keys(errors).length || (anyInitial && !isDate(measuredOn))) return;
      const available = visibleMetrics.find(m => supportRows.find(row => row.key === m)?.ok);
      if (!available) { setNoticeSig(signature(form)); setInputNotice(condition.ok ? '입력한 측정값으로 예측할 수 있는 지표가 없어요. 측정값과 적용 조건을 확인해 주세요. 기록은 저장할 수 있어요.' : (condition.detail || condition.title)); return; }
      setCheckedSig(signature(form)); setMetric(available); setShowResults(true); setEditing(false);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}));
    };
    const metricInput = (m: 'firmness' | 'brix' | 'acidity') => {
      const label = {firmness: '평균 경도', brix: '평균 당도', acidity: '평균 산도'}[m];
      const value = hongro ? form.hongro.initial[m] : form[m];
      const id = hongro ? `tf-hongro-initial-${m}` : `tf-${m}`;
      return <MeasureInput key={m} id={id} label={label} value={value} missing={!!form.missing[m]}
        onValue={v => hongro ? setForm(f => ({...f, hongro: {...f.hongro, initial: {...f.hongro.initial, [m]: v}}})) : set(m, v)}
        onMissing={missing => setForm(f => ({...f, missing: {...f.missing, [m]: missing}, ...(missing ? hongro ? {hongro: {...f.hongro, initial: {...f.hongro.initial, [m]: ''}}} : {[m]: ''} : {})}))}
        unit={m === 'firmness' ? <select aria-label="경도 단위" className="qt3-unit-select" value={form.firmness_unit} onChange={e => set('firmness_unit', e.target.value as TrackerForm['firmness_unit'])}><option value="N">N</option><option value="kgf">kg (kgf)</option></select> : <span className="qt3-unit">{m === 'brix' ? '°Brix' : '%'}</span>}
        err={shownErrors[hongro ? `hongro.initial.${m}` : m]}
        help={m === 'firmness' && form.firmness_unit === 'kgf' && initialValue(m) !== null ? `계산·저장은 N으로 해요 · ${fmtNum(initialValue(m)!, 1)} N (1 kgf = 9.80665 N)` : undefined} />;
    };
    return <div className="new-lot qt qt-refresh qt-v2">
      <div className="new-heading"><div><h1>새 사과</h1></div>{guest && <span>저장 전까지 로그인 없이</span>}</div>
      {loadError && <div className="qt-banner warn" role="alert"><AlertTriangle size={16} /><span>사과 기록을 불러오지 못했어요. {loadError}</span><button className="btn btn-ghost" onClick={() => {void onLotsChanged(); setReload(r => r + 1);}}>다시 불러오기</button></div>}
      {dirty && <div className="qt-draftbar"><button type="button" className="linkbtn" onClick={discardDraft}>초안 지우기</button></div>}
      {conflict && <div className="qt-banner warn"><span>저장된 기록이 초안 작성 이후 바뀌었습니다.</span><button type="button" onClick={() => {setFormState(conflict.form); saveDraft(user, mode, draftKey, {...conflict, baseSig: officialSig}); setConflict(null);}}>초안 불러오기</button><button type="button" onClick={() => {clearDraft(user, mode, draftKey); setConflict(null);}}>저장된 기록 유지</button></div>}
      {(checkShown || Object.keys(saveErrors).length > 0) && uniqueErrors.length > 0 && <div className="new-errors"><b>확인할 항목 {uniqueErrors.length}개</b><ul>{uniqueErrors.map(([id, text]) => <li key={id}><button type="button" onClick={() => focus(id === 'intake_date' && form.sameStart ? 'tf-storage_start_date' : id === 'initial_measured_on' && form.initialSameStart ? 'tf-initialSameStart' : 'tf-' + id.replaceAll('.', '-'))}>{text}</button></li>)}</ul></div>}
      <section id="qt-input-editor" className="new-card" aria-labelledby="new-condition"><div className="new-card-head"><h2 id="new-condition"><span>1</span>사과와 보관 조건</h2></div>
        <div className="new-grid2">
          <Seg id="tf-variety" legend="품종" value={hongro ? '홍로' : '후지'} options={[{value:'후지',label:'후지'},{value:'홍로',label:'홍로'}]} onChange={switchCultivar} err={shownErrors.variety} />
          {hongro ? <div className="qt3-q"><div className="qt3-q-head"><span>보관 조건</span></div><p className="new-fixed-cond">일반 저온 · 1-MCP 미처리</p><p className="qt3-help">홍로는 거창 자료로 만든 식으로 계산해요. 다른 조건은 준비 중이에요.</p></div>
          : <><Seg id="tf-storage" legend="보관 방식" value={form.storage} options={[{value:'일반 저온',label:'일반 저온'},{value:'CA',label:'CA'},...(form.storage === '기타' ? [{value:'기타' as const,label:'기타',disabled:true,tag:'준비 중'}] : [])]} onChange={v => setForm(f => ({...f, storage: v, ...(v === 'CA' && f.mcp === '처리' ? {mcp: '미확인', mcpSelected: false} : {})}))} />
          <div><Seg id="tf-mcp" legend="1-MCP 처리 여부" value={mcpChosen ? form.mcp : ''} options={[{value:'처리',label:'처리함',disabled:form.storage === 'CA',tag:form.storage === 'CA' ? '준비 중' : undefined},{value:'미처리',label:'미처리'}]} onChange={v => setForm(f => ({...f,mcp:v,mcpSelected:true}))} err={shownErrors.mcp} />{form.storage === 'CA' && <p className="qt3-help">CA + 1-MCP 처리 예측은 준비 중이에요. 기록은 물량 관리에서 남길 수 있어요.</p>}</div></>}
          {<div className="qt3-q"><div className="qt3-q-head"><label htmlFor="tf-harvest_date">수확일</label></div><input id="tf-harvest_date" className="qt3-input" type="date" max={today} value={form.harvest_date} onChange={e => { const v = e.target.value; setForm(f => ({...f, harvest_date: v, ...(harvestSame ? {storage_start_date: v, ...(f.sameStart ? {intake_date: v} : {})} : {})})); }} aria-invalid={!!shownErrors.harvest_date} />{shownErrors.harvest_date && <span className="qf-err">{shownErrors.harvest_date}</span>}
            <label className="new-date-check"><input id="tf-harvestSame" type="checkbox" checked={harvestSame} onChange={e => { const c = e.target.checked; setHarvestSame(c); if (c && form.harvest_date) setStart(form.harvest_date); }} /><span>수확 당일 바로 저장고에 넣었어요</span></label></div>}
          <div className="qt3-q"><div className="qt3-q-head"><label htmlFor="tf-storage_start_date">저장 시작일</label></div><input id="tf-storage_start_date" className="qt3-input" type="date" max={today} value={startDate} disabled={harvestSame} onChange={e => setStart(e.target.value)} aria-invalid={!!shownErrors.storage_start_date} />{shownErrors.storage_start_date ? <span className="qf-err">{shownErrors.storage_start_date}</span> : (harvestSame ? <p className="qt3-help">수확일과 같아요.</p> : null)}</div>
          {hongro && <Seg id="tf-temperature" legend="저장고 온도" value={form.temperature === '0' || form.temperature === '4' ? form.temperature as '0' | '4' : ''} options={[{value:'0',label:'0℃'},{value:'4',label:'4℃'}]} onChange={v => setForm(f => ({...f, temperature: v, hongro: {...f.hongro, storage: v === '0' ? 'cold0' : 'cold4'}}))} err={shownErrors.temperature} />}
        </div>
        {form.mcpSelected && form.mcp === '미확인' && <p className="new-condition-note">처리 여부가 미확인이면 예측식은 적용하지 않으며 기록은 저장할 수 있어요.</p>}
        {'preparing' in condition && condition.preparing && <p className="new-condition-note new-preparing" role="status"><b>서비스 준비 중</b> {condition.detail}</p>}
      </section>
      <section className="new-card" aria-labelledby="new-quality"><div className="new-card-head"><h2 id="new-quality"><span>2</span>{hongro || estMode ? '초기 품질' : '처음 측정한 품질'}</h2><small>{estMode ? '날씨로 추정 · 실측 아님' : '측정한 항목만 입력'}</small></div><p className="new-description">{estMode ? '수확 시점 품질을 재배기 날씨로 추정해요. 실제로 쟀다면 ‘직접 측정값 입력’을 골라 주세요.' : '측정한 사과의 평균값을 입력해 주세요.'}</p>
        {!hongro && <fieldset className="qt3-q"><legend className="qt3-q-head">초기 품질 입력 방식</legend><div className="qt3-seg">{([['measured','직접 측정값 입력'],['weather','수확한 해 날씨로 추정']] as const).map(([v,t]) => <label key={v} className={(form.fuji?.source ?? 'measured')===v?'active':''}><input type="radio" name="tf-fuji-source" checked={(form.fuji?.source ?? 'measured')===v} onChange={() => setForm(f=>({...f,fuji:{...(f.fuji ?? emptyFujiForm()),source:v}}))} /><span>{t}</span></label>)}</div></fieldset>}
        {hongro && <fieldset className="qt3-q"><legend className="qt3-q-head">초기 품질 입력 방식</legend><div className="qt3-seg">{([['measured','직접 측정값 입력'],['weather','올해 날씨로 추정']] as const).map(([v,t]) => <label key={v} className={form.hongro.source===v?'active':''}><input type="radio" name="tf-hongro-source" checked={form.hongro.source===v} onChange={() => setForm(f=>({...f,hongro:{...f.hongro,source:v}}))} /><span>{t}</span></label>)}</div></fieldset>}
        <div className="new-grid2">
          {!(estMode && form.initialSameStart) && <div className="qt3-q"><div className="qt3-q-head"><label htmlFor="tf-initial_measured_on">{estMode ? '추정 기준일' : '측정일'}</label></div><label className="new-date-check"><input id="tf-initialSameStart" type="checkbox" checked={!!form.initialSameStart} onChange={e => setInitialSame(e.target.checked)} /><span>저장 시작일과 같음</span><span>{form.initialSameStart && startOk ? fmtDate(startDate) : ''}</span></label>{!form.initialSameStart && <input id="tf-initial_measured_on" className="qt3-input" type="date" max={today} value={form.initial_measured_on} onChange={e => set('initial_measured_on',e.target.value)} aria-invalid={!!shownErrors.initial_measured_on} />}{shownErrors.initial_measured_on && <span className="qf-err">{shownErrors.initial_measured_on}</span>}</div>}
        </div>
        {weatherMode ? <WeatherChoices form={form} setForm={setForm} errors={errors} estimate={hongroResult ? hongroResult.initial : null} harvestDate={form.harvest_date} onHarvest={v => setForm(f => ({...f, harvest_date: v, ...(harvestSame ? {storage_start_date: v, ...(f.sameStart ? {intake_date: v} : {})} : {})}))} /> : fujiWeather ? <FujiWeather form={form} setForm={setForm} estimate={fujiEst} /> : <div className="new-grid3">{(['firmness','brix','acidity'] as const).map(metricInput)}</div>}
      </section>
      <details className="new-card new-extra" ref={optionalRef}><summary><strong>추가 기록</strong><span>선택 &nbsp; {hongro ? '이름 · 저장고' : '이름 · 저장고 · 온도'}</span><Plus size={20} /></summary><div className="new-extra-body">
        <div className="new-grid2">
          <F id="name" label="이름" err={shownErrors.name}><input id="tf-name" value={form.name_auto && !form.name.trim() ? suggestName(form) : form.name} onChange={e=>setForm(f=>({...f,name:e.target.value,name_auto:false}))} maxLength={120} /><p className="qt3-help">품종과 저장 시작일로 자동 생성되며 직접 수정할 수 있어요.</p></F>
          {!hongro && temperatureField}
          <F id="location" label="저장고 이름·위치"><input id="tf-location" value={form.location} onChange={e=>set('location',e.target.value)} maxLength={120} /></F>
        </div>
        {session?.isTeam && <label className="qt-check"><input type="checkbox" checked={form.team_shared} onChange={e=>set('team_shared',e.target.checked)} />팀과 공유</label>}
      </div></details>
      {!missingRequired && startOk && predictable.length > 0 && <section className="new-card new-quick" aria-labelledby="new-quick-h">
        <div className="new-card-head"><h2 id="new-quick-h">바로 보기 · 저장 {quickDay}일째 <small>{fmtDate(addDays(startDate, quickDay))}</small></h2>
          <div className="new-quick-days" role="group" aria-label="저장 일수">{quickDays.map(d => <button key={d} type="button" aria-pressed={quickDay === d} className={quickDay === d ? 'active' : ''} onClick={() => setQuickDay(d)}>{d === quickToday ? '오늘' : `${d}일`}</button>)}</div></div>
        <div className="new-quick-grid">{predictable.map(m => { const v = valueAt(series[m], quickDay), a = m === 'loss' ? null : anchors[m];
          return <div key={m} className="new-quick-tile"><span>{EASY_LABEL[m]}</span>{v.status === 'ok' ? <b>{easyChange(m, v.value, a?.value ?? null, estMode)}</b> : <b className="na">계산 없음</b>}
            <small>{v.status !== 'ok' ? v.reason : `${fmtNum(v.value, metricMeta[m].digits)} ${displayUnit(m)}${m === 'loss' ? ' · 저장일수로 계산' : estMode ? ' · 처음 값은 날씨 추정' : ''}`}</small></div>; })}</div>
        <p className="new-quick-note">{estMode ? '초기 품질은 날씨로 추정한 값이에요(실측 아님). ' : ''}시연용 계산이며 출하·안전 판정이 아니에요. 그래프와 자세한 근거는 ‘자세히 보기’에서 볼 수 있어요.</p>
      </section>}
      <div className="new-actions"><div className="new-status"><b>{statusTitle}</b>{statusDetail && <p>{statusDetail}</p>}{checkShown && uniqueErrors.length > 0 && <div className="new-action-errors" role="alert"><p>다음 항목을 확인해 주세요.</p><ul>{uniqueErrors.map(([id, text]) => <li key={id}><button type="button" onClick={() => focus(id === 'intake_date' && form.sameStart ? 'tf-storage_start_date' : id === 'initial_measured_on' && form.initialSameStart ? 'tf-initialSameStart' : 'tf-' + id.replaceAll('.', '-'))}>{text}</button></li>)}</ul></div>}{inputNotice && noticeSig === signature(form) && <div className="new-condition-note" role="status">{inputNotice}{hongro && form.temperature !== '0' && form.temperature !== '4' && <button type="button" className="linkbtn new-temperature-link" onClick={() => focus('tf-temperature')}>온도 입력하기</button>}</div>}</div><div className="new-actions-right"><button type="button" className="new-primary" onClick={checkNew}>{!missingRequired && predictable.length ? '자세히 보기' : '예측 가능 여부 확인'} <ArrowRight size={18} /></button><p>{guest && '기록 저장에는 로그인이 필요해요'} <button type="button" className="new-save" onClick={saveRecord} disabled={saving || !!loadError}>{saving ? '저장 중…' : '기록만 저장'}</button></p></div></div>
      {saveMsg && <p className={saveMsg.ok?'qt-ok':'auth-error'} role="status">{saveMsg.text}</p>}
      <style jsx>{`
        :global(.site-main:has(.page-body > div:not([hidden]) .new-lot)) {background:#f2f6f3}
        :global(.site-main:has(.page-body > div:not([hidden]) .new-lot) .app-head), :global(.site-main:has(.page-body > div:not([hidden]) .new-lot) .page-hero) {display:none}
        :global(.site-main:has(.page-body > div:not([hidden]) .new-lot) .page-body) {max-width:none;padding:0}
        .new-lot :global(.qt3-seg input:focus + span) {outline:3px solid #429466;outline-offset:2px}
        .new-lot {max-width:1160px; margin:0 auto; padding:32px 20px 72px; color:#17352a}
        .new-crumb {color:#70847a; font-size:15px; margin:0 0 24px}.new-crumb span {padding:0 12px}
        .new-heading {display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:36px}.new-heading h1 {font-size:24px; font-weight:700; line-height:1.2; margin:0}.new-heading p,.new-description {color:#70847a; line-height:1.6; margin:0}.new-heading>span {background:#e9f3eb; color:#216044; border-radius:12px; padding:9px 14px; white-space:nowrap}
        .new-card {background:white; border:0; border-radius:16px; padding:24px; box-shadow:0 1px 2px rgba(23,36,27,.06); margin-bottom:16px}.new-card-head {display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:28px}.new-card-head h2 {margin:0; font-size:18px; font-weight:700; display:flex; align-items:center; gap:12px}.new-card-head h2 span {width:38px; height:38px; display:grid; place-items:center; border-radius:50%; background:#eaf4ec; color:#225d40; font-size:17px}.new-card-head small {color:#75887d; font-size:14px}.new-grid2,.new-grid3 {display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px 28px}.new-grid3 {grid-template-columns:repeat(3,minmax(0,1fr)); margin-top:30px}.new-description {margin:0 0 22px}.new-date-check {min-height:52px; border-radius:10px; padding:10px 12px; display:flex; align-items:center; gap:10px; background:#f1f5f2; margin-bottom:8px}.new-date-check span:last-child {margin-left:auto; color:#71837a}.new-date-check input {width:20px;height:20px;accent-color:#225c41}.new-explain summary {cursor:pointer;color:#225c41;padding-top:12px}.new-explain p,.new-condition-note {color:#5b7064;font-size:14px;line-height:1.6}.new-condition-note {padding:12px 0;margin:0}
        .new-extra {padding:0}.new-extra>summary {cursor:pointer;display:flex;align-items:center;gap:18px;padding:27px 34px;list-style:none}.new-extra>summary strong {font-size:20px}.new-extra>summary span {color:#778a80;font-size:14px}.new-extra>summary svg {margin-left:auto}.new-extra-body {border-top:1px solid #e5eee8;padding:28px 34px}.new-extra-body .qt3-more {margin-top:18px}.new-existing {display:flex;gap:12px;align-items:center;margin-bottom:18px}.new-existing select {max-width:280px;min-height:44px}
        .new-actions {display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin:32px 0}.new-status b {color:#225c41;font-size:18px}.new-status p,.new-actions-right p {color:#75887d;font-size:14px}.new-actions-right {text-align:right}.new-primary {background:#225c41;color:#fff;border:0;border-radius:12px;min-height:56px;padding:0 24px;font-weight:700;display:inline-flex;align-items:center;gap:18px;cursor:pointer}.new-save {border:0;border-bottom:1px solid currentColor;background:none;color:#536b5e;cursor:pointer;padding:3px}.new-disclaimer {text-align:center;color:#84958b;font-size:14px;margin-top:65px}.new-errors,.new-action-errors {background:#fff4ed;border:1px solid #e6c8b9;border-radius:12px;padding:18px;margin-bottom:20px}.new-action-errors {margin:12px 0 0}.new-action-errors p {color:#8d3c25;margin:0}.new-errors ul,.new-action-errors ul {margin:8px 0 0;padding-left:20px}.new-errors button,.new-action-errors button {border:0;background:none;color:#8d3c25;text-align:left;text-decoration:underline;cursor:pointer;padding:3px 0}
        .new-grid3 :global(.qt3-q) {display:flex;flex-direction:column}.new-grid3 :global(.qt3-q-head) {display:contents}.new-grid3 :global(.qt3-q-head > label:first-child) {order:0}.new-grid3 :global(.qt3-unit-input) {order:1}.new-grid3 :global(.qt3-missing) {order:2;margin-top:10px}.new-grid3 :global(.qf-err),.new-grid3 :global(.qt3-help) {order:3}
        .new-lot :global(.qt3-q-head),.new-lot :global(.qf-label) {font-size:16px;font-weight:700;color:#17352a}.new-lot :global(input:not([type=checkbox]):not([type=radio])),.new-lot :global(select) {font-size:16px;min-height:50px}.new-lot :global(.qt3-seg label) {min-height:54px}.new-lot :global(.qt3-missing) {font-size:14px}.new-lot :global(.qf) {min-width:0}.new-lot :global(input:focus-visible),.new-lot :global(button:focus-visible),.new-lot :global(select:focus-visible),.new-lot :global(summary:focus-visible) {outline:3px solid #429466;outline-offset:2px}
        @media(max-width:700px) {.new-lot{padding:24px 16px 56px}.new-heading{display:block;margin-bottom:25px}.new-heading>span{display:inline-block;margin-top:14px}.new-card{padding:22px 18px;border-radius:16px}.new-card-head{align-items:flex-start}.new-card-head h2{font-size:20px}.new-card-head small{font-size:12px}.new-grid2,.new-grid3{grid-template-columns:1fr;gap:20px}.new-extra{padding:0}.new-extra>summary{padding:22px 18px;gap:9px}.new-extra-body{padding:22px 18px}.new-actions{display:block}.new-actions-right{text-align:left;margin-top:20px}.new-primary{width:100%;justify-content:center}.new-disclaimer{margin-top:40px}.new-existing{display:block}}
      `}</style>
    </div>;
  }

  return <div className={'qt qt-refresh qt-v2' + (editing ? ' is-editing' : '') + (exampleMode ? ' is-example' : '') + (firstInput && !showResults ? ' is-first-input' : '')}>

    {!guest && !exampleMode && activeLot && <div className="qt-backbar"><button type="button" className="qt3-minibtn" onClick={() => openLot(activeLot.id)}><ArrowLeft size={15} aria-hidden="true" />‘{activeLot.name}’ 물량 상세로 돌아가기</button><span>예측 기준: {activeLot.initial_measured_on ? `${activeLot.initial_measured_on} 초기 측정` : activeLot.details?.hongro?.source === 'weather' ? '날씨 기반 추정 초기값' : '초기 측정일 미기록'} · 측정 기록 {activeLot.observation_count ?? 0}건</span></div>}
    {/* ── 상단: 물량 선택 · 이름 ── */}
    <section className="qt3-card qt3-lotbar" aria-label="물량 선택" hidden={!guest}>
      <div className="qt3-lotbar-top">
        <div className="qt3-lotbtns" role="group" aria-label="물량 고르기">
          <button type="button" className={'qt3-pill' + (!exampleMode && lotKey === 'new' ? ' active' : '')} aria-pressed={!exampleMode && lotKey === 'new'} onClick={startNewLot}><Plus size={16} />새 사과</button>
          {guest ? null
            : <label className={'qt3-pill qt3-pill-select' + (!exampleMode && lotKey !== 'new' ? ' active' : '')}>
              <span>{!exampleMode && activeLot ? activeLot.name : '저장한 사과 불러오기'}</span><ChevronDown size={16} />
              <select id="qt-lot-select" aria-label="저장한 사과 불러오기" value={!exampleMode && lotKey !== 'new' ? lotKey : ''} disabled={!lots.length}
                onChange={e => { if (!e.target.value) return; if (exampleMode) changeMode('real'); setLotKey(e.target.value); setBaseline(null); setSelectedDay(null); }}>
                <option value="">{lots.length ? '저장한 물량 고르기' : '저장한 물량이 없어요'}</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.name}{l.name.includes(l.variety) ? '' : ` · ${l.variety}`}{l.team_shared ? ' · 팀 공유' : ''}</option>)}
              </select></label>}
        </div>
        <button type="button" className="qt3-minibtn qt3-example" onClick={() => changeMode(exampleMode ? 'real' : 'example')}><FlaskConical size={15} aria-hidden="true" />{exampleMode ? '내 측정값 입력하기' : '예시로 채워보기'}</button>
      </div>
      {exampleMode ? <p className="qt3-example-note"><FlaskConical size={16} /><b>예시 데이터 · 실제 측정 기록이 아니며 저장되지 않아요</b></p> : <>
        <div className="qt3-namehead"><label htmlFor="tf-name">물량 이름</label></div>
        <input id="tf-name" className="qt3-input" value={form.name_auto && !form.name.trim() ? suggestName(form) : form.name} maxLength={120}
          onChange={e => setForm(f => ({...f, name: e.target.value, name_auto: e.target.value.trim() === ''}))} aria-describedby="tf-name-help" />
        {saveErrors.name ? <span className="qf-err" role="alert">{saveErrors.name}</span> : <p id="tf-name-help" className="qt3-help">{form.name_auto && !activeLot ? '품종과 저장 시작일로 자동으로 지은 이름이에요. 바꿔도 좋아요.' : '쉽게 구분할 수 있도록 이름은 바꿔도 좋아요.'}</p>}
        {session?.isTeam && !activeLot && <label className="qt-check"><input type="checkbox" checked={form.team_shared} onChange={e => set('team_shared', e.target.checked)} />팀과 공유 (선택하지 않으면 나만 볼 수 있어요)</label>}
      </>}
      {loadError && <div className="qt-banner warn" role="alert"><AlertTriangle size={16} /><span>사과 기록을 불러오지 못했어요. {loadError}</span><button className="btn btn-ghost" onClick={() => { void onLotsChanged(); setReload(r => r + 1); }}>다시 불러오기</button></div>}
      {(draftNote || dirty) && !exampleMode && <div className="qt-draftbar">
        {draftNote ? <span className={'draft-' + draftNote.tone}>{draftNote.text}</span> : <span className="draft-info">입력 중</span>}
        {dirty && <button type="button" className="linkbtn" onClick={discardDraft}><Undo2 size={13} />초안 지우기</button>}
      </div>}
      {conflict && <div className="qt-banner warn small"><AlertTriangle size={15} /><div>이 물량의 저장된 기록이 초안 작성 이후 바뀌었습니다. 초안은 자동으로 적용하지 않았어요.
        <div className="qt-inline-btns"><button className="btn btn-ghost" onClick={() => { setFormState(conflict.form); saveDraft(user, mode, draftKey, {...conflict, baseSig: officialSig}); setConflict(null); setDraftNote({tone: 'info', text: '이전 초안을 불러왔습니다. 저장된 기록과 다른 부분을 확인하세요.'}); }}>초안 불러오기</button>
          <button className="btn btn-ghost" onClick={() => { clearDraft(user, mode, draftKey); setConflict(null); }}>저장된 기록 유지</button></div></div></div>}
      {!editing && <button type="button" className="btn btn-outline qt3-open" aria-expanded={false} aria-controls="qt-input-editor" onClick={() => setEditing(true)}>입력 내용 펼치기 · 수정<ChevronDown size={16} /></button>}
    </section>
    {initialMeasuredAfterAsOf && <div className="qt-banner warn" role="alert"><AlertTriangle size={16} /><span>{initialDateReason}</span></div>}

    <div className="qt-grid">
      <aside className="qt-input qt3-editor" aria-label="입력 조건" hidden={!editing}>
        <div id="qt-input-editor" className="qt3-card qt3-sections">
        {/* ① 사과와 실제 보관 조건 */}
        <section className="qt3-sec" aria-labelledby="qt3-s1">
          <div className="qt3-sec-head"><h2 id="qt3-s1"><span className="qt3-num">1</span>사과와 실제 보관 조건</h2>
          </div>
          <div className="qt3-grid2">
            <Seg id="tf-variety" legend="어떤 품종인가요?" value={hongro ? '홍로' : '후지'} options={[{value: '후지', label: '후지'}, {value: '홍로', label: '홍로'}]} onChange={v => switchCultivar(v)} err={saveErrors.variety} />
            {/* 예측식이 없는 조합은 처음부터 ‘준비 중’으로 막아 둡니다(PC·모바일 같음). 홍로: 일반 저온·미처리만, 후지: CA+1-MCP 처리 준비 중. */}
            <Seg id="tf-storage" legend="어떻게 보관하나요?" value={form.storage} options={[{value: '일반 저온', label: '일반 저온'}, {value: 'CA', label: 'CA', disabled: hongro, tag: hongro ? '준비 중' : undefined}, {value: '기타', label: '기타', disabled: true, tag: '준비 중'}]}
              onChange={v => setForm(f => ({...f, storage: v, ...(v === 'CA' && f.mcp === '처리' ? {mcp: '미처리', mcpSelected: true} : {})}))} />
            <Seg id="tf-mcp" legend={<>1-MCP 처리를 했나요?<span className="qt3-hint" title="1-MCP는 사과의 숙성을 늦추는 처리예요. 처리 기록(처리일·제품)을 확인해 주세요.">무엇인가요?</span></>} value={form.mcpSelected ? form.mcp : ''}
              options={[{value: '처리', label: '처리함', disabled: hongro || form.storage === 'CA', tag: hongro || form.storage === 'CA' ? '준비 중' : undefined}, {value: '미처리', label: '미처리'}]} onChange={v => setForm(f => ({...f, mcp: v, mcpSelected: true}))} />
            {hongro ? <Seg id="tf-temperature" legend="저장고 온도" value={form.temperature === '0' || form.temperature === '4' ? form.temperature as '0' | '4' : ''} options={[{value: '0', label: '0℃'}, {value: '4', label: '4℃'}]}
              onChange={v => setForm(f => ({...f, temperature: v, hongro: {...f.hongro, storage: v === '0' ? 'cold0' : 'cold4'}}))} err={errors.temperature} />
            : <div className="qt3-q">
              <div className="qt3-q-head"><label htmlFor="tf-temperature">실제 저장고 온도</label></div>
              <div className="qt3-unit-input"><input id="tf-temperature" className="qt3-input" type="number" step="any" inputMode="decimal" placeholder="실제로 보관한 온도" value={form.temperature}
                onChange={e => setForm(f => ({...f, temperature: e.target.value, hongro: {...f.hongro, storage: e.target.value === '0' ? 'cold0' : e.target.value === '4' ? 'cold4' : f.hongro.storage}}))} /><span>℃</span></div>
              {errors.temperature ? <span className="qf-err" role="alert">{errors.temperature}</span> : <p className="qt3-help">{hongro ? '기록한 온도를 0℃·4℃에 맞춰 바꾸지 않아요. 홍로 식은 정확히 0℃·4℃에만 있어요.' : '후지 식에는 저장 온도가 정해져 있지 않아, 온도는 기록으로만 남아요.'}</p>}
            </div>}
            <div className="qt3-q">
              <div className="qt3-q-head"><label htmlFor="tf-intake_date">입고일</label></div>
              <input id="tf-intake_date" className="qt3-input" type="date" max={today} value={form.intake_date} onChange={e => set('intake_date', e.target.value)} />
              {(saveErrors.intake_date || errors.intake_date) && <span className="qf-err" role="alert">{saveErrors.intake_date || errors.intake_date}</span>}
              <label className="qt-check" htmlFor="tf-sameStart"><input id="tf-sameStart" type="checkbox" checked={form.sameStart} onChange={e => toggleSameStart(e.target.checked)} /><span>입고일을 저장 시작일로 사용</span></label>
            </div>
            <div className="qt3-q">
              <div className="qt3-q-head"><label htmlFor="tf-storage_start_date">저장을 시작한 날</label></div>
              <input id="tf-storage_start_date" className="qt3-input" type="date" max={today} value={form.sameStart ? form.intake_date : form.storage_start_date} disabled={form.sameStart} onChange={e => set('storage_start_date', e.target.value)} />
              {errors.storage_start_date || saveErrors.storage_start_date ? <span className="qf-err" role="alert">{errors.storage_start_date || saveErrors.storage_start_date}</span>
                : <p className={'qt3-help' + (form.sameStart && !form.intake_date ? ' warn' : '')}>{form.sameStart ? form.intake_date ? '입고일과 같은 날로 계산해요. 이 날이 저장 0일차예요.' : '입고일을 먼저 입력해 주세요. 입력하면 저장 시작일도 같은 날이 돼요.' : '실제로 저장고에 넣어 보관을 시작한 날짜예요.'}</p>}
            </div>
          </div>
          {form.mcp === '미확인' ? <div className="qt3-note info" role="note"><Info size={16} /><div><b>1-MCP 처리 여부 미확인</b><span>처리 여부가 미확인이면 예측하지 않으며, 기록은 저장할 수 있어요.</span></div></div>
            : <div className={'qt3-note ' + (condition.ok ? 'ok' : 'warn')} role="status">{condition.ok ? <Check size={16} /> : <AlertTriangle size={16} />}<div><b>{condition.title}</b>{condition.detail && <span>{condition.detail}</span>}</div></div>}
        </section>

        {/* ② 초기 품질 입력 */}
        <section className="qt3-sec" aria-labelledby="qt3-s2">
          <div className="qt3-sec-head"><h2 id="qt3-s2"><span className="qt3-num">2</span>초기 품질 입력</h2><span className={'qt3-tag' + (weatherMode ? '' : ' muted')}>{weatherMode ? '날씨 기반 추정' : '실측'}</span></div>
          {hongro && <fieldset className="qt3-q qt3-source-pick"><legend>초기 품질을 어떻게 입력할까요?</legend>
            <div className="qt3-cards">
              {([['measured', '직접 측정값 입력', '경도계·당도계로 측정했어요'], ['weather', '올해 날씨로 추정', '홍로 · 계절별 날씨를 선택해요']] as const).map(([v, t, d]) =>
                <label key={v} className={'qt3-choice' + (form.hongro.source === v ? ' active' : '')}><input type="radio" name="tf-hongro-source" id={v === 'measured' ? 'tf-hongro-source' : undefined} checked={form.hongro.source === v}
                  onChange={() => setForm(f => ({...f, hongro: {...f.hongro, source: v}}))} /><b>{form.hongro.source === v && <Check size={15} />}{t}</b><span>{d}</span></label>)}
            </div></fieldset>}
          {weatherMode ? <WeatherChoices form={form} setForm={setForm} errors={errors} estimate={hongroResult ? hongroResult.initial : null} harvestDate={form.harvest_date} />
          : <>
            <div className="qt3-grid2">
              <div className="qt3-q">
                <div className="qt3-q-head"><label htmlFor="tf-initial_measured_on">이 값을 측정한 날</label></div>
                <div className="qt3-row"><input id="tf-initial_measured_on" className="qt3-input" type="date" max={today} value={measuredOn} onChange={e => setForm(f => ({...f, initialSameStart: false, initial_measured_on: e.target.value}))} />
                  <button type="button" className="btn btn-outline qt3-today" onClick={() => setForm(f => ({...f, initialSameStart: false, initial_measured_on: today}))}>오늘</button></div>
                {errors.initial_measured_on ? <span className="qf-err" role="alert">{errors.initial_measured_on}</span> : <p className="qt3-help">측정일을 입력해 주세요. 빈 날짜는 자동으로 가정하지 않아요.</p>}
              </div>
              <MeasureInput id={hongro ? 'tf-hongro-initial-firmness' : 'tf-firmness'} label="처음 측정한 경도" value={hongro ? form.hongro.initial.firmness : form.firmness}
                onValue={v => hongro ? setForm(f => ({...f, hongro: {...f.hongro, initial: {...f.hongro.initial, firmness: v}}})) : set('firmness', v)}
                missing={form.missing.firmness} onMissing={m => setForm(f => ({...f, missing: {...f.missing, firmness: m}, ...(m ? hongro ? {hongro: {...f.hongro, initial: {...f.hongro.initial, firmness: ''}}} : {firmness: ''} : {})}))}
                unit={<select aria-label="경도 단위" className="qt3-unit-select" value={form.firmness_unit} onChange={e => set('firmness_unit', e.target.value as TrackerForm['firmness_unit'])}><option value="N">N</option><option value="kgf">kg (kgf)</option></select>}
                err={errors[hongro ? 'hongro.initial.firmness' : 'firmness'] || saveErrors[hongro ? 'hongro.initial.firmness' : 'firmness']}
                help={form.firmness_unit === 'kgf' && initialValue('firmness') !== null ? `계산·저장은 N으로 해요 · ${fmtNum(initialValue('firmness')!, 1)} N (1 kgf = 9.80665 N)` : '기기에 표시된 숫자와 단위를 그대로 넣어 주세요. kgf/cm² 같은 압력 단위는 N·kgf와 같지 않아요.'} />
              <MeasureInput id={hongro ? 'tf-hongro-initial-brix' : 'tf-brix'} label="처음 측정한 당도" value={hongro ? form.hongro.initial.brix : form.brix}
                onValue={v => hongro ? setForm(f => ({...f, hongro: {...f.hongro, initial: {...f.hongro.initial, brix: v}}})) : set('brix', v)}
                missing={form.missing.brix} onMissing={m => setForm(f => ({...f, missing: {...f.missing, brix: m}, ...(m ? hongro ? {hongro: {...f.hongro, initial: {...f.hongro.initial, brix: ''}}} : {brix: ''} : {})}))}
                unit={<span className="qt3-unit">°Brix</span>} err={errors[hongro ? 'hongro.initial.brix' : 'brix'] || saveErrors[hongro ? 'hongro.initial.brix' : 'brix']} />
            </div>
          </>}
        </section>

        {/* ③ 추가 기록 */}
        <section className="qt3-sec" aria-labelledby="qt3-s3">
          <div className="qt3-sec-head"><h2 id="qt3-s3"><span className="qt3-num">3</span>추가 기록</h2><span className="qt3-help">필요한 항목만 펼치세요</span></div>
          <details className="qt3-more" ref={optionalRef}>
            <summary>추가 품질값 · 수확 · 포장 정보{optionalErr && <span className="qt-sub-err">확인 필요</span>}</summary>
            <div className="qt3-grid2">
              {!weatherMode && <F id={hongro ? 'hongro-initial-acidity' : 'acidity'} label="처음 측정한 산도" unit="%" err={errors[hongro ? 'hongro.initial.acidity' : 'acidity']}><input id={hongro ? 'tf-hongro-initial-acidity' : 'tf-acidity'} type="number" inputMode="decimal" step="0.01" placeholder="미측정" value={hongro ? form.hongro.initial.acidity : form.acidity} onChange={e => hongro ? setForm(f => ({...f, hongro: {...f.hongro, initial: {...f.hongro.initial, acidity: e.target.value}}})) : set('acidity', e.target.value)} /></F>}
              <F id="harvest_date" label="수확일" err={errors.harvest_date}><input id="tf-harvest_date" type="date" max={today} value={form.harvest_date} onChange={e => set('harvest_date', e.target.value)} /></F>
              <F id="location" label="저장고 위치"><input id="tf-location" value={form.location} onChange={e => set('location', e.target.value)} maxLength={120} /></F>
            </div>
          </details>
        </section>

        <div className="qt3-actions">
          <button type="button" className="btn btn-primary btn-lg qt3-check-btn" onClick={checkConditions}>입력·예측 조건 확인<ArrowRight size={18} /></button>
          {exampleMode ? <button type="button" className="btn btn-outline btn-lg" disabled title="예시는 저장되지 않아요">기록 저장</button>
            : guest ? <button type="button" className="btn btn-outline btn-lg" onClick={handoffToLogin}><Save size={16} />로그인하고 저장</button>
            : <button type="button" className="btn btn-outline btn-lg" onClick={saveRecord} disabled={saving || !!loadError || (!dirty && !!activeLot)}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{activeLot ? '변경 내용 저장' : '기록 저장'}</button>}
        </div>
        <p className="qt3-help qt3-actions-note">예측식을 확인하기 전에도 실제 보관 조건과 입력 내용을 기록할 수 있어요.{activeLot ? ' 새 측정은 결과 아래 ‘오늘 측정값 기록’으로 더해 주세요.' : ''}</p>
        {saveMsg && <p className={saveMsg.ok ? 'qt-ok' : 'auth-error'} role="status">{saveMsg.text}</p>}
        {loaded.lot && !activeLot && <p className="qt3-help">품종이 달라 별도의 새 물량으로 저장해요. 기존 물량 기록은 바꾸지 않아요.</p>}
        {checkShown && <section className="qt3-checkpanel" aria-label="입력·예측 조건 확인 결과" aria-live="polite" tabIndex={-1} ref={checkRef}>
          <h3>입력·예측 조건 확인{stale && <span className="qt3-tag warn">입력이 바뀌었어요 · 다시 확인해 주세요</span>}</h3>
          <ul>{supportRows.map(r => <li key={r.key} className={r.ok ? 'ok' : 'no'}>{r.ok ? <Check size={16} /> : <AlertTriangle size={16} />}<div><b>{r.label}</b><span>{r.text}</span></div></li>)}</ul>
        </section>}
        </div>
      </aside>

      {/* 가운데: 요약 · 지표 탭 · 그래프 · 비교 */}
      <section className={'qt-main' + (stale ? ' qt3-stale' : '')} aria-label="품질 예측 결과" ref={resultsRef} tabIndex={-1} hidden={!showResults || !!loadError}>
        {stale && <div className="qt-banner warn qt3-stale-banner" role="status"><AlertTriangle size={16} /><span>입력이 바뀌었어요. 아래 결과는 바뀐 입력으로 다시 계산 중이니, <b>입력·예측 조건 확인</b>을 눌러 지원 여부를 다시 확인해 주세요.</span><button className="btn btn-ghost" onClick={checkConditions}>다시 확인</button></div>}
        <div className="qt3-note info" role="note"><Info size={16} /><div>시연용 계산이에요 · 정확도 미검증 · 출하·안전 판정 아님</div></div>
        <div className="qt5-dash">
          <div className="qt5-head"><h2>{hongro ? '거창 홍로' : (form.variety || '사과')} 저장 품질 예측</h2><span>{lotName}</span></div>
          {weatherMode && (['firmness', 'brix', 'acidity'] as MetricId[]).some(m => series[m].ok) && <p className="qt5-lossonly qt5-estimated" role="note"><Info size={15} aria-hidden="true" />초기 품질은 날씨로 추정한 값이에요(실측 아님). 경도·당도·산도는 그 추정값에서 이어 계산해요. 실제로 한 번 재면 측정값으로 바꿀 수 있어요.</p>}
          {series.loss.ok && (['firmness', 'brix', 'acidity'] as MetricId[]).every(m => !series[m].ok) && <p className="qt5-lossonly" role="note"><Info size={15} aria-hidden="true" />{anyInitial ? '경도·당도·산도는 이 조건에서 계산하지 않아 감모율만 보여줘요.' : '경도·당도·산도는 처음 측정한 값이 있어야 계산돼요. 지금은 저장일수로 계산하는 감모율만 보여줘요.'}</p>}
          <div className="qt5-row qt2-when">
            <span className="qt5-row-label">저장 일수</span>
          <div className="qt2-chips"><button type="button" className={selDay === asOfDay ? 'active' : ''} aria-pressed={selDay === asOfDay} disabled={!startOk || asOfDay < 0 || asOfDay > maxDays} onClick={() => setSelectedDay(asOfDay)}>오늘</button></div>
          <div className="qt-range-control" style={{flex: '1 1 300px', minWidth: 0}}>
            <label htmlFor="qt-selected-day">저장 기간 <strong>{selectedDayLabel}</strong></label>
            <input id="qt-selected-day" className="qt-slider" type="range" min={0} max={maxDays} value={Number.isFinite(selDay) ? Math.max(0, Math.min(maxDays, selDay)) : 0} disabled={!startOk} aria-valuetext={Number.isFinite(selDay) && isDate(selDate) ? `저장 ${selDay}일차, ${fmtDate(selDate)}` : '날짜를 선택해 주세요'} onChange={e => setSelectedDay(+e.target.value)} />
            <div className="qt-range-ends"><span>저장 시작 · 0일</span><span>{maxDays}일</span></div>
          </div>
          <label className="qt2-datepick" htmlFor="qt-selected-date"><CalendarDays size={18} /><span>날짜 선택</span>
            <input id="qt-selected-date" type="date" value={selDate} disabled={!startOk} min={startDate} max={startOk ? addDays(startDate, maxDays) : undefined}
              onChange={e => { if (!e.target.value) setSelectedDay(Number.NaN); else if (startOk && isDate(e.target.value)) setSelectedDay(daysBetween(startDate,e.target.value)); }} /></label>
          </div>
          <div className="qt4-tiles" role="group" aria-label="지표 요약 · 누르면 그래프가 바뀌어요">
            {visibleMetrics.map(m => { const r = modelResults[m], an = shownAnchor(m), ok = r.ok && r.value !== null;
              return <button key={m} type="button" className={'qt4-tile' + (metric === m ? ' active' : '')} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                <span className="qt4-tile-label">{EASY_LABEL[m]}</span>
                <span className="qt4-tile-value">{ok ? <>{fmtNum(r.value!, metricMeta[m].digits)}<small>{displayUnit(m)}</small></> : '계산 없음'}</span>
                {hongro && ok && <span className="qt5-tile-seg">{hongroSegment(m)}</span>}
                <span className="qt4-tile-note">{!ok ? (r.reason ?? '자료 부족').replace(/^적용 모델 없음:\s*/, '') : m === 'loss' ? (actualLoss ? `실측 ${fmtNum(actualLoss.value, 2)} %` : '저장일수로 계산') : an ? `${an.source === 'latest' ? '최근 측정' : estMode ? '수확 때(추정)' : '첫 측정'}보다 ${describeChange(m, r.value!, an.value).short}` : r.kind}</span>
              </button>; })}
          </div>
          <div className="qt5-main qt5-main-full">
          <div className="qt2-chart qt4-chart">
          <div className="qt-chartbox">
          <div className="qt2-chart-head"><h2>{({firmness: '단단함', brix: '단맛(당도)', acidity: '신맛(산도)', loss: '무게 감소'} as Record<MetricId, string>)[metric]} 변화</h2>
        <div className="seg qt-tabs" role="tablist" aria-label="지표" onKeyDown={e => {
          const i = visibleMetrics.indexOf(metric); const next = e.key === 'ArrowRight' ? (i + 1) % visibleMetrics.length : e.key === 'ArrowLeft' ? (i + visibleMetrics.length - 1) % visibleMetrics.length : e.key === 'Home' ? 0 : e.key === 'End' ? visibleMetrics.length - 1 : -1;
          if (next >= 0) { e.preventDefault(); setMetric(visibleMetrics[next]); (e.currentTarget.children[next] as HTMLButtonElement).focus(); }
        }}>
          {visibleMetrics.map(m => <button key={m} id={'qt-tab-' + m} role="tab" aria-controls="qt-metric-result" tabIndex={metric === m ? 0 : -1} aria-selected={metric === m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{({firmness: '단단함', brix: '단맛', acidity: '신맛', loss: '무게 감소'} as Record<MetricId, string>)[m]}</button>)}
        </div></div>
          {startOk ? <TrackerChart maxDays={maxDays} unit={displayUnit(metric)} sourceLabel={hongro ? sourceLabel : undefined} metric={metric} series={series[metric]} baseline={hongro ? showConditions ? {series:comparisonSeries(num(form.temperature)===0?4:0,metric),label:num(form.temperature)===0?'4℃ 저온저장':'0℃ 저온저장'} : null : baseline && compatible && !sameAsBaseline ? {series: baseline.series[metric], label: baseline.label} : null}
            measured={measured[metric]} startDate={startDate} asOfDay={asOfDay} selectedDay={selDay} onSelect={setSelectedDay} exampleMode={exampleMode} />
            : <div className="qt-empty">저장 시작일(또는 입고일)을 입력하면 그래프가 나타납니다. <button className="linkbtn" onClick={() => focus('tf-intake_date')}>입고일 입력하기</button></div>}
          {startOk && !series[metric].ok && <div className="qt-chart-note"><AlertTriangle size={14} />{(series[metric] as {reason: string}).reason}{!anchors[metric] && metric !== 'loss' && <button className="linkbtn" onClick={() => focus('tf-' + metric)}>입력하기</button>}</div>}
          {metric === 'loss' && !exampleMode ? null : <ChartLegend exampleMode={exampleMode} hasMeasured={true} initialSource={hongro ? sourceLabel : undefined} hasBaseline={hongro ? !!hongroResult && showConditions : !!baseline && compatible && !sameAsBaseline} baselineLabel={hongro ? num(form.temperature)===0?'4℃ 저온저장':'0℃ 저온저장' : baseline ? `${baseline.label} (회색 점선)` : ''} />}
          {hongro && !modelResults[metric].ok && <p className="auth-error" role="alert">{modelResults[metric].reason}</p>}
          <details className="qt2-fold"><summary>그래프 읽는 법<Plus size={16} /></summary>
            {metric === 'loss' && !exampleMode && <p className="qt-help">점: 동일 표본 실측 감모율 · 선: 품종·온도별 감모율 식으로 계산한 예측. 실측 중량 사이를 보간한 선이 아니에요.</p>}
            <p className="qt-help">저장 시작일이 0일이에요. 분석 기준일 {fmtDate(asOf)}{startOk ? ` · 저장 ${asOfDay}일차` : ''} / 그래프 표시 범위 0~{maxDays}일은 검증된 적용 기간이 아니에요.</p>
          </details>
          {startOk && t0 > 0 && <p className="qt-help">초기 측정은 저장 {t0}일차입니다. 계산도 그날부터 시작하며 이전 날짜를 채우지 않습니다.</p>}
          {startOk && !measuredOn && anyInitial && <p className="qt-help">측정일을 입력해야 초기 품질값으로 변화를 계산할 수 있습니다.</p>}
          {excludedLater > 0 && <p className="qt-help">분석 기준일 이후 측정 {excludedLater}건은 과거 관측에 넣지 않았습니다.</p>}
        </div>

          </div>
          </div>
          <section id="qt-metric-result" role="tabpanel" aria-labelledby={'qt-tab-' + metric} className="qt5-guide">
            <div className="qt5-guide-main">
              <p className="qt5-guide-title"><Info size={17} aria-hidden="true" />안내</p>
            <p className="qt2-result-when">{whenLabel}{Number.isFinite(selDay) ? ` · 저장 ${selDay}일차` : ''}{isDate(selDate) ? ` · ${fmtDate(selDate)}` : ''}</p>
            <div className="qt2-result-main" aria-live="polite">
              <p className="qt2-result-label">{EASY_LABEL[metric]} {modelResults[metric].kind === '실측' ? '실측값' : modelResults[metric].kind === '참고 추정' ? '참고 추정값' : '예상값'}<span>{plainMeaning[metric]}</span></p>
              {selectedValue.status === 'ok' ? <>
                <p className="qt2-result-value">{fmtNum(selectedValue.value, metricMeta[metric].digits)}<span>{displayUnit(metric)}</span></p>
                <p className="qt2-result-change" style={hasDisplayedChange ? {background: '#edf6ef', color: '#205e3b', borderLeft: '3px solid #3f8a5e', borderRadius: 8, padding: '10px 12px', fontWeight: 600} : undefined}>{initialComparison}</p>
                <details className="qt2-fold">
                  <summary>이 수치 자세히 보기<Plus size={16} /></summary>
                  <p className="qt-help">{metric === 'firmness' ? '경도는 측정기로 과육을 누를 때 필요한 힘이에요. 처음 입력값과 계산값의 차이로, 식감을 직접 판정하지 않아요.'
                    : metric === 'brix' ? '당도는 당을 포함한 가용성 고형분의 지표예요. 처음 값 대비 변화가 실제 단맛의 변화와 같다는 뜻은 아니에요.'
                    : metric === 'acidity' ? '산도는 산 성분의 지표예요. %p는 산도 수치의 차이이고, 괄호 안 %는 처음 값에 대한 상대 변화예요.'
                    : '실측 감모율은 같은 표본의 첫 중량 측정을 기준으로 하며, 모델 감모율은 저장 시작일을 기준으로 해요.'}</p>
                  <p className="qt-help">계산값은 모델에 따른 결과예요. 비슷한 사과의 평균과 비교한 값이나 출하·안전 판정은 아니에요.</p>
                </details>
                {resultLines.map(t => <p key={t} className="qt2-result-change">{t}</p>)}
              </> : <div className="qt2-result-na"><b>이 날짜의 값을 표시할 수 없어요</b><p>{selectedValue.reason}</p><button className="linkbtn" onClick={() => focus(hongro ? `tf-hongro-initial-${metric}` : 'tf-' + (metric === 'loss' ? 'tracked_sample_id' : metric))}>필요한 입력 확인하기</button></div>}
            </div>
            {latestPoint && latestPoint.day !== selDay && <p className="qt4-line">최근 {exampleMode ? '예시 측정' : '실측'}({shortDate(latestPoint.date)}) {fmtNum(latestPoint.value, metricMeta[metric].digits)} {displayUnit(metric)}{firstValue !== null && latestPoint.day > t0 ? ` — 처음보다 ${describeChange(metric, latestPoint.value, firstValue).text}` : ''}</p>}
            {staleDays !== null && staleDays >= 14 && <p className="qt4-line warn">마지막 측정이 {staleDays}일 전이에요. 오늘 측정값을 기록하면 최근 상태로 다시 계산할 수 있어요.</p>}
              {hongro && metric === 'firmness' && modelResults.firmness.ok && <p className="qt4-line">홍로 경도 식은 저장 60일 이후 하루 감소 폭이 조금 커지는 형태예요.</p>}
              {hongro && metric === 'acidity' && modelResults.acidity.ok && <p className="qt4-line">홍로 산도 식은 60일까지 처음 값을 유지하고, 그 뒤 줄어드는 형태예요.</p>}
            <div className="qt4-summary-actions">
          {!exampleMode && activeLot && !guest ? <ObservationForm lot={activeLot} label="오늘 측정값 기록" className="btn btn-primary" onSaved={() => { setReload(r => r + 1); void onLotsChanged(); }} disabled={false} />
            : guest && !exampleMode ? <button className="btn btn-primary" onClick={handoffToLogin}><Save size={16} />로그인하고 저장하기</button>
            : exampleMode ? <button className="btn btn-primary" onClick={() => changeMode('real')}>내 측정값 입력하기</button>
            : activeLot && !guest ? <button className="btn btn-primary" onClick={() => openLot(activeLot.id)}>사과 정보 수정</button>
            : <button className="btn btn-primary" onClick={() => { setEditing(true); requestAnimationFrame(() => document.getElementById('qt-input-editor')?.scrollIntoView({behavior: 'smooth', block: 'start'})); }}>입력 고치기</button>}

            </div>
            </div>
            <details className="qt2-fold qt-basis-fold"><summary>계산 근거<Plus size={16} /></summary>
            <div className="qt-result-basis-summary" aria-label="이 결과의 적용 조건과 검증 수준">
              <p><b>이 결과에 사용한 조건</b> · {basisContext.cultivar} · {basisContext.storage} · {basisContext.temperature ? `${basisContext.temperature}℃` : '온도 미기록'} · 1-MCP {basisContext.mcp}</p>
              <p>{!modelResults[metric].ok ? `계산할 수 없음 · ${modelResults[metric].reason || '입력과 조건을 확인해 주세요.'}` : modelResults[metric].kind === '실측' ? '같은 표본의 중량 기록에서 계산한 실측 감모율입니다.' : '모델 계산값 · 예측 정확도와 오차 범위는 검증되지 않았습니다.'}</p>
              {!hongro && modelResults[metric].modelId && form.temperature.trim() !== '' && <p>후지 자료에 저장 온도가 없어 입력한 온도에서의 적용 타당성은 확인되지 않았습니다.</p>}
              {(modelResults[metric].modelId === 'fuji-mcp-firmness' || priorResult?.modelId === 'fuji-mcp-firmness') && <p>후지 1-MCP 경도 자료의 수식과 설명이 서로 달라 정확성은 확인되지 않았습니다.</p>}
              {hongro && metric === 'brix' && modelResults[metric].modelId && <p>홍로 당도 자료의 수식과 감소 설명이 서로 달라 실제 변화를 확인할 수 없습니다.</p>}
              {basisContext.contextNote && <p>{basisContext.contextNote}</p>}
                            {hongro && <div className="qt-basis-hongro"><p className="qt-help">홍로 · {form.storage} · {form.temperature || '미입력'}℃ · 1-MCP {form.mcp} · 저장 {selectedDayLabel} · 초기품질 출처: {sourceLabel}{exampleMode ? ' · 예시 데이터' : ''}</p><div className="qt-latest-values">{(['weight', 'diameter'] as const).map(m => <div key={m}><dt>{m === 'weight' ? '중량' : '횡경'} · 초기값만 제공</dt><dd>{hongroResult?.initial[m] === undefined ? '미입력' : `${fmtNum(hongroResult.initial[m]!, 1)} ${HONGRO_UNITS[m]}`}</dd></div>)}</div><p className="qt-help">중량·횡경의 저장 중 변화 자료는 없습니다. 홍로 감모율은 일반 저온 0℃·4℃, 1-MCP 미처리 조건에서 계산하며 검증은 미완료입니다. 당도는 제공된 식에 따라 처음 값을 유지합니다.</p></div>}
              <button type="button" className="linkbtn" onClick={() => openModelInfo(basisContext)}>자세한 모델 정보 <ArrowRight size={15} /></button>
            </div>
            </details>
          </section>
        </div>
        <div className="qt2-more"><Apple3DFold day={selDay} cultivar={form.variety} metrics={modelResults} /></div>
        {guest && !exampleMode && <div className="qt-actions qt-result-actions qt2-actions"><button className="btn btn-primary" onClick={handoffToLogin}><Save size={16} />로그인하고 저장하기</button></div>}
      </section>
    </div>

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



/** 3D 외관은 기본 화면에서 빼고, 펼칠 때만 불러옵니다(모델 파일 약 3MB). */
function Apple3DFold({day, cultivar, metrics}: {day: number; cultivar: string; metrics: Record<MetricId, ModelResult>}) {
  const [open, setOpen] = useState(false);
  // 수확 때(무게 감소 0%)와 고른 날을 나란히 놓아 비교합니다. 모양은 계산된 무게 감소율만 반영합니다.
  const start = {...metrics, loss: {...metrics.loss, ok: true, value: 0}} as Record<MetricId, ModelResult>;
  const lossV = metrics.loss.ok && metrics.loss.value !== null ? metrics.loss.value : null;
  const caption = lossV === null ? '무게 감소를 계산할 수 없어 모양을 바꾸지 않았어요.' : lossV < 0.05 ? '아직 무게가 거의 줄지 않아 모양 차이가 없어요.' : `저장 ${day}일째에는 무게가 약 ${fmtNum(lossV, 1)}% 줄어, 그만큼 크기가 작아지고 겉에 잔주름이 생기는 모습으로 그렸어요.${lossV < 2 ? ' 변화가 작아서 눈으로는 미세해요.' : ''}`;
  return <details className="qt2-fold ag-3d" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary>사과 모양 비교 (3D · 수확 때 ↔ 저장 {day}일째)<Plus size={16} /></summary>
    {open && <div className="ag-cmp-wrap">
      <div className="ag-cmp">
        <figure><figcaption><b>수확 때</b><span>무게 감소 0%</span></figcaption><Boundary><QualityAppleViewer bare day={0} cultivar={cultivar} metrics={start} /></Boundary></figure>
        <figure><figcaption><b>저장 {day}일째</b><span>{lossV === null ? '계산 없음' : `무게 약 ${fmtNum(lossV, 1)}% 감소`}</span></figcaption><Boundary><QualityAppleViewer bare day={day} cultivar={cultivar} metrics={metrics} /></Boundary></figure>
      </div>
      <p className="ag-cmp-cap">{caption}</p>
      <p className="qt-help">날짜를 바꾸면 오른쪽 사과가 바뀌어요. 실제 사과 사진을 바탕으로 만든 3D 모델이에요. 크기·주름 변화는 무게 감소 계산값으로 그린 것이고, 저장 중 사과를 찍어 비교한 건 아니에요.</p>
    </div>}
  </details>;
}

/** 한눈에 고르는 선택 버튼 묶음. 실제 라디오 입력이라 화살표 키로도 바꿀 수 있습니다. */
function Seg<T extends string>({id, legend, value, options, onChange, err}: {id: string; legend: ReactNode; value: T | ''; options: {value: T; label: string; disabled?: boolean; tag?: string}[]; onChange: (v: T) => void; err?: string}) {
  return <fieldset className={'qt3-q' + (err ? ' has-err' : '')}>
    <legend className="qt3-q-head">{legend}</legend>
    <div className="qt3-seg">{options.map((o, i) => <label key={o.value} className={(value === o.value ? 'active' : '') + (o.disabled ? ' disabled' : '')}>
      <input type="radio" name={id} id={i === 0 ? id : undefined} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
      <span>{value === o.value && <Check size={15} aria-hidden="true" />}{o.label}{o.tag && <small className="seg-tag">{o.tag}</small>}</span></label>)}</div>
    {err && <span className="qf-err" role="alert">{err}</span>}
  </fieldset>;
}

/** 측정값 입력: 숫자 + 단위 + ‘미측정’. 빈칸(아직 입력 안 함), 미측정, 숫자 0을 구분합니다. */
function MeasureInput({id, label, value, onValue, missing, onMissing, unit, err, help}: {id: string; label: string; value: string; onValue: (v: string) => void; missing: boolean; onMissing: (m: boolean) => void; unit: ReactNode; err?: string; help?: string}) {
  return <div className={'qt3-q' + (err ? ' has-err' : '')}>
    <div className="qt3-q-head"><label htmlFor={id}>{label}</label><label className="qt-check qt3-missing"><input type="checkbox" checked={missing} onChange={e => onMissing(e.target.checked)} />미측정</label></div>
    <div className="qt3-unit-input"><input id={id} className="qt3-input" type="number" inputMode="decimal" step="any" min={0} value={value} disabled={missing} placeholder={missing ? '미측정으로 기록' : '측정한 숫자'} onChange={e => onValue(e.target.value)} aria-invalid={!!err} />{unit}</div>
    {err ? <span className="qf-err" role="alert">{err}</span> : help && <p className="qt3-help">{help}</p>}
  </div>;
}

const FUJI_REGIONS: {id: FujiRegion; label: string; station: string}[] = [{id: 'cheongsong', label: '청송', station: '청송군 청송읍'}, {id: 'jangsu', label: '장수', station: '장수군 장수읍'}, {id: 'yeongju', label: '영주', station: '영주시 봉현면'}];
/** 후지 날씨 추정: 생산지와 수확일을 고르면 그 해 농업기상 일자료로 네 값을 계산해 지역 식으로 초기 품질을 추정합니다. */
function FujiWeather({form, setForm, estimate}: {form: TrackerForm; setForm: (update: (f: TrackerForm) => TrackerForm) => void; estimate: Record<'weight' | 'diameter' | 'firmness' | 'brix' | 'acidity', number> | null}) {
  const fj = form.fuji ?? emptyFujiForm();
  const year = isDate(form.harvest_date) ? +form.harvest_date.slice(0, 4) : null;
  const [st, setSt] = useState<{state: 'idle' | 'loading' | 'ok' | 'error'; msg?: string; key?: string}>({state: 'idle'});
  const key = fj.region && year ? `${fj.region}:${year}` : '';
  useEffect(() => {
    if (!key || st.key === key) return;
    let live = true; setSt({state: 'loading', key});
    fetch(`/api/weather/hongro?year=${year}&region=${fj.region}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok) { setSt({state: 'error', key, msg: `${j.error || '날씨 자료를 불러오지 못했어요.'} 지금은 예측할 수 없어요. 잠시 뒤 다시 시도해 주세요.`}); return; }
      if (!Array.isArray(j.variables)) { setSt({state: 'error', key, msg: '날씨 자료를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'}); return; }
      const v = Object.fromEntries((j.variables as {key: string; value: number | null}[]).map(x => [x.key, x.value]));
      const reasons = (j.variables as {reason: string | null}[]).map(x => x.reason).filter(Boolean);
      setForm(f => ({...f, fuji: {...(f.fuji ?? emptyFujiForm()), year: String(year), weather: {rain9: v.chang_9rain == null ? '' : String(v.chang_9rain), lc56: v.chang_LC56 == null ? '' : String(v.chang_LC56), lc78: v.chang_LC78 == null ? '' : String(v.chang_LC78), min4: v.chang_min4 == null ? '' : String(v.chang_min4)}}}));
      setSt({state: reasons.length ? 'error' : 'ok', key, msg: reasons.length ? (year && todayKST() < `${year}-10-01` ? '9월 강수량은 9월이 끝나야 집계돼서, 10월 1일부터 날씨로 추정할 수 있어요. 지금 당도나 단단함을 재서 넣으면 바로 예측돼요. 그대로 저장해 두면 10월부터 자동으로 추정해요.' : `${reasons[0]} 지금은 예측할 수 없어요.`) : undefined});
    }).catch(() => { if (live) setSt({state: 'error', key, msg: '날씨 자료를 불러오지 못해 지금은 예측할 수 없어요. 잠시 뒤 다시 시도해 주세요.'}); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const region = FUJI_REGIONS.find(r => r.id === fj.region);
  return <div className="qt-weather qt3-weather">
    <fieldset className="qt3-q"><legend className="qt3-q-head">생산지</legend><div className="qt3-seg">{FUJI_REGIONS.map(r => <label key={r.id} className={fj.region === r.id ? 'active' : ''}><input type="radio" name="tf-fuji-region" checked={fj.region === r.id} onChange={() => setForm(f => ({...f, fuji: {...(f.fuji ?? emptyFujiForm()), region: r.id, weather: {rain9: '', lc56: '', lc78: '', min4: ''}}}))} /><span>{r.label}</span></label>)}</div></fieldset>

    {key && <div className={'qt-weather-auto' + (st.state === 'error' ? ' err' : '')} role="status" aria-live="polite">
      {st.state === 'loading' ? <p><Loader2 className="spin" size={15} aria-hidden="true" />{year}년 4~9월 {region?.station} 날씨를 모으는 중이에요(몇 초 걸려요)…</p>
        : st.state === 'error' ? <><p>{st.msg}</p><div className="ld-row"><button type="button" className="qt3-minibtn" onClick={() => setForm(f => ({...f, fuji: {...(f.fuji ?? emptyFujiForm()), source: 'measured'}}))}>측정값 입력으로 바꾸기</button><button type="button" className="qt3-minibtn" onClick={() => setSt({state: 'idle'})}>다시 불러오기</button></div></>
        : estimate ? <><p><b>{year}년 · 농업기상 {region?.station} 관측</b> 자료로 추정했어요 (실측 아님).</p>
          <ul><li><span>단맛(당도)</span><b>{fmtNum(estimate.brix, 1)} °Brix</b></li><li><span>신맛(산도)</span><b>{fmtNum(estimate.acidity, 2)} %</b></li><li><span>중량</span><b>{fmtNum(estimate.weight, 0)} g</b></li><li><span>횡경</span><b>{fmtNum(estimate.diameter, 1)} mm</b></li><li><span>단단함</span><b>{fmtNum(estimate.firmness, 1)} N</b></li></ul></> : null}
    </div>}
    {!key && <p className="qt3-help">생산지와 수확일을 고르면 그 해 날씨로 처음 품질을 추정해요.</p>}
  </div>;
}

/** 홍로 날씨 값: 수확한 해의 농업기상(거창읍) 일자료로 자동 계산해 채우고, 확인·직접 입력할 수 있습니다. */
function WeatherChoices({form, setForm, errors, estimate, harvestDate, onHarvest}: {form: TrackerForm; setForm: (update: (f: TrackerForm) => TrackerForm) => void; errors: Partial<Record<string, string>>; estimate: Record<'firmness' | 'brix' | 'acidity', number> | null; harvestDate?: string; onHarvest?: (v: string) => void}) {
  const harvest = harvestDate && isDate(harvestDate) ? {y: +harvestDate.slice(0, 4), m: +harvestDate.slice(5, 7), d: +harvestDate.slice(8, 10)} : null;
  // 수확한 해의 거창읍 농업기상 일자료로 네 값을 계산해 채웁니다(서버 경로 /api/weather/hongro). 비어 있는 값은 채우지 않습니다.
  type Fetched = {year: number; station: {code: string; name: string}; source: string; variables: {key: string; value: number | null; period: [string, string]; reason: string | null}[]};
  const [auto, setAuto] = useState<{state: 'idle' | 'loading' | 'ok' | 'error'; data?: Fetched; error?: string; year?: number}>({state: 'idle'});
  const allEmpty = HONGRO_WEATHER_FIELDS.every(f => String(form.hongro.weather[f.key] ?? '').trim() === '');
  const load = useCallback(async (year: number) => {
    setAuto({state: 'loading', year});
    try {
      const r = await fetch(`/api/weather/hongro?year=${year}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAuto({state: 'error', year, error: `${j.error || '날씨 자료를 불러오지 못했어요.'} 지금은 예측할 수 없어요. 잠시 뒤 다시 시도해 주세요.`}); return; }
      const data = j as Fetched;
      if (!Array.isArray(data?.variables)) { setAuto({state: 'error', year, error: '날씨 자료를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'}); return; }
      setAuto({state: 'ok', year, data});
      setForm(f => ({...f, hongro: {...f.hongro, weather: {...f.hongro.weather, ...Object.fromEntries(data.variables.filter(v => v.value !== null).map(v => [v.key, String(v.value)]))}}}));
    } catch { setAuto({state: 'error', year, error: '날씨 자료를 불러오지 못해 지금은 예측할 수 없어요. 잠시 뒤 다시 시도해 주세요.'}); }
  }, [setForm]);
  const anyEmpty = HONGRO_WEATHER_FIELDS.some(f => String(form.hongro.weather[f.key] ?? '').trim() === '');
  useEffect(() => { if (harvest && anyEmpty && auto.year !== harvest.y && auto.state !== 'loading') void load(harvest.y); }, [harvest?.y, anyEmpty]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromApi = auto.state === 'ok' && !!auto.data && auto.data.variables.every(v => v.value === null || String(form.hongro.weather[v.key as keyof typeof form.hongro.weather] ?? '') === String(v.value));
  const h = form.hongro;
  const setW = (key: string, v: string) => setForm(f => ({...f, hongro: {...f.hongro, weather: {...f.hongro.weather, [key]: v}}}));
  const picked = HONGRO_WEATHER_FIELDS.filter(f => String(h.weather[f.key] ?? '').trim() !== '').length;
  return <div className="qt-weather qt3-weather">
    <div className="qt3-q-head"><p className="qt-weather-lead">{harvest ? `${harvest.y}년(수확한 해) 거창 재배기 날씨로 초기 품질을 추정해요.` : '수확일을 넣으면 그 해 거창 농업기상 자료로 날씨 값을 채워요.'}</p><span className="qt3-count" aria-live="polite">입력 {picked} / {HONGRO_WEATHER_FIELDS.length}</span></div>
    {!harvest && <div className="qt3-q qt-weather-harvest">
      <div className="qt3-q-head"><label htmlFor="tf-weather-harvest">수확일</label></div>
      <input id="tf-weather-harvest" className="qt3-input" type="date" max={todayKST()} value={form.harvest_date} onChange={e => { const v = e.target.value; if (onHarvest) onHarvest(v); else setForm(f => ({...f, harvest_date: v})); }} />
      {!onHarvest && isDate(form.sameStart ? form.intake_date : form.storage_start_date) && <button type="button" className="qt3-minibtn" onClick={() => { const d = form.sameStart ? form.intake_date : form.storage_start_date; setForm(f => ({...f, harvest_date: d})); }}>저장 시작일과 같은 날 수확했어요</button>}
      <p className="qt3-help">날씨로 추정하려면 수확한 해를 알아야 해요. 수확일을 넣으면 바로 그 해 날씨를 불러와요.</p>
    </div>}
    {harvest && <div className={'qt-weather-auto' + (auto.state === 'error' ? ' err' : '')} role="status" aria-live="polite">
      {auto.state === 'loading' ? <p><Loader2 className="spin" size={15} aria-hidden="true" />{harvest.y}년 4~9월 거창읍 날씨를 모으는 중이에요(몇 초 걸려요)…</p>
        : auto.state === 'error' ? <p>{auto.error}</p>
        : auto.state === 'ok' && auto.data ? <>
          <p><b>{auto.data.year}년 · 농업기상 {auto.data.station.name} 관측</b>{fromApi ? ' 자료로 계산해 채웠어요.' : ' 자료와 다른 값이 들어 있어요(직접 고친 값).'}</p>
          {auto.data.variables.some(v => v.value === null) && <div className="qt3-note warn" role="note"><AlertTriangle size={16} aria-hidden="true" /><div><span>9월 강수량은 9월이 끝나야 집계돼서, 10월 1일부터 날씨로 추정할 수 있어요. 지금 당도나 단단함을 재서 넣으면 바로 예측돼요. 그대로 저장해 두면 10월부터 자동으로 추정해요.</span> <button type="button" className="qt3-minibtn" onClick={() => setForm(f => ({...f, hongro: {...f.hongro, source: 'measured'}}))}>측정값 입력으로 바꾸기</button></div></div>}
          <details className="qt-weather-vals"><summary>값 보기</summary><ul>{auto.data.variables.map(v => { const f = HONGRO_WEATHER_FIELDS.find(x => x.key === v.key); return <li key={v.key}><span>{f?.label ?? v.key}</span><b>{v.value === null ? '계산 안 함' : `${v.value.toLocaleString('ko-KR', {maximumFractionDigits: 1})} ${f?.unit ?? ''}`}</b>{v.reason && <small>{v.reason}</small>}</li>; })}</ul></details>
        </> : null}
      <button type="button" className="qt3-minibtn" disabled={auto.state === 'loading'} onClick={() => void load(harvest.y)}>{auto.state === 'ok' ? '농업기상 값으로 다시 채우기' : `${harvest.y}년 농업기상 자료 불러오기`}</button>
    </div>}
    {estimate ? <><p className="qt3-estimate"><span className="qt3-tag">날씨 기반 추정</span>경도 {fmtNum(estimate.firmness, 1)} N · 당도 {fmtNum(estimate.brix, 1)} °Brix · 산도 {fmtNum(estimate.acidity, 2)} %</p></>
      : picked === HONGRO_WEATHER_FIELDS.length ? null : <p className="qt3-help">{HONGRO_WEATHER_FIELDS.length - picked}개 값이 더 있어야 초기 품질을 추정해요.</p>}
    <details className="qt3-more"><summary>계산 근거</summary>
    {harvest && harvest.m === 9 && <p className="qt3-note warn qt-weather-sept" role="note"><AlertTriangle size={16} aria-hidden="true" /><span>식의 ‘9월 강수량’은 9월 1~30일 전체 합계예요. 수확일(9월 {harvest.d}일) 뒤에 온 비도 들어가며, 9월이 끝나야 자동으로 계산돼요. 그래서 수확 당일 예측이 아니라, 지난 관측자료로 계산한 참고 추정이에요.</span></p>}
    {harvest && harvest.m < 9 && <p className="qt3-note warn qt-weather-sept" role="note"><AlertTriangle size={16} aria-hidden="true" /><span>9월 전에 수확했어요. 식에는 9월 강수량이 들어가지만 이 사과의 재배 기간에는 9월이 없어요. 추정값 해석에 주의해 주세요.</span></p>}
    <div className="qt3-note info"><Info size={16} /><div><span>{fromApi ? '날씨 값은 농촌진흥청 농업기상 관측(거창읍) 일자료로 계산했어요: 4월 일최저기온 평균, 5~6월·7~8월 (일평균기온 − 5℃) 합계, 9월 강수량 합계. 초기 품질은 이 값으로 추정한 값이며 실측이 아니에요.' : '날씨 값은 초기 품질을 추정하기 위한 입력이에요. 직접 입력한 값은 실측 기상자료와 구분해 기록해요.'}</span></div></div>
    </details>
  </div>;
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

function SharedHongroComparison({input,day}:{input:(m:MetricId,day:number,temperature?:number|null)=>ModelInput;day:number}) {
  return <><h3>홍로 0℃ / 4℃ 조건 비교</h3><p className="qt-help">같은 측정일·측정값과 원래 저장 시간축으로 비교합니다. 실제 저장 중 온도를 전환한 검증 모델이 아닙니다.</p><div className="qt-table-wrap"><table className="qt-table"><thead><tr><th>지표</th><th>0℃</th><th>4℃</th></tr></thead><tbody>{metricIds.map(m=><tr key={m}><td>{metricMeta[m].label}</td>{[0,4].map(temp=>{const r=predictQuality(input(m,day,temp));return <td key={temp}>{r.ok?`${fmtNum(r.value!,metricMeta[m].digits)} ${r.unit}`:r.reason}{r.kind==='참고 추정'&&<small> · 후지 기반 참고 추정</small>}</td>;})}</tr>)}</tbody></table></div></>;
}

function exportUnifiedCsv(o:QualityExportInput) {
  const url=URL.createObjectURL(new Blob([buildQualityExportCsv(o)],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`애플트랙_${o.form.variety}_${o.selDate || '결과'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
