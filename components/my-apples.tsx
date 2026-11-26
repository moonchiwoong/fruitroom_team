'use client';
// ‘내 사과’: 농가용 단순 화면. 목록 → 사과 상세 → 측정 추가만 있습니다.
// 계산은 lib/lot-predict.ts(기존 예측식 그대로)를 씁니다. 새 사과 등록·그래프·3D도 이 화면 안에서 엽니다.
import {useEffect, useMemo, useState} from 'react';
import {josa} from '@/lib/josa';
import {MetricIcon, METRIC_COLOR} from '@/components/health/metric-icons';
import dynamic from 'next/dynamic';
import {ArrowLeft, ArrowRight, Loader2, Pencil, Plus} from 'lucide-react';
import type {Lot, Observation} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {LotEditor, MeasurementForm} from '@/components/lot-dialogs';
import {latestObservation, lotPredictor, easyChange, EASY_LABEL, EASY_METRICS, weatherPending, type WeatherValues} from '@/lib/lot-predict';
import {lotReadiness, baselineObservation, storageStart, quantityUnit, weatherInitial} from '@/lib/lot-readiness';
import {fmtNum, metricMeta, todayKST, addDays, daysBetween, isDate} from '@/lib/tracker';
import MiniCharts from '@/components/mini-charts';
import {weatherLabels, WEATHER_STATIONS} from '@/lib/rda-weather';
import {lotRegionLabel} from '@/lib/lot-region';
import {TARGET_PRESETS, checkTargetDate, targetIcs} from '@/lib/target-calendar';
import {CONSUMER_BRIX, compareRow, lossKg, sugarNotes, sugarRef, summaryLine, type CompareRow} from '@/lib/consumer-compare';
import {HARVEST_MONTHS, harvestCultivar, harvestMonthError} from '@/lib/harvest-window';

const NewApple = dynamic(() => import('@/components/new-apple'), {ssr: false, loading: () => <div className="loading-strip">여는 중…</div>});

const SHORT: Record<string, string> = {firmness: '단단함', loss: '무게', brix: '단맛', acidity: '신맛'};
const md = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}`; };
const unit = (m: string, hongro: boolean) => m === 'firmness' ? (hongro ? 'N (Ø11 mm)' : 'N') : metricMeta[m as 'brix'].unit;

export default function MyApples({lots, loadError, reload, openTracker, focus, openModel}: {lots: Lot[]; loadError: string; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void; focus?: {id: string | null; n: number; create?: boolean} | null; openModel?: () => void}) {
  const [openId, setOpenId] = useState<string | null>(null), [creating, setCreating] = useState(false), [created, setCreated] = useState('');
  // 다른 화면에서 특정 사과(또는 새 사과 등록)를 열도록 요청하면 그 화면을 엽니다.
  useEffect(() => { if (focus) { setOpenId(focus.id); setCreating(!!focus.create && !focus.id); } }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showDone, setShowDone] = useState(false);
  // 휴대폰 속도: 목록을 보는 동안 ‘새 사과’ 화면 코드를 미리 받아 두어, 눌렀을 때 바로 열리게 합니다.
  useEffect(() => {
    const load = () => { void import('@/components/new-apple'); };
    const w = window as Window & {requestIdleCallback?: (cb: () => void) => number};
    if (w.requestIdleCallback) w.requestIdleCallback(load); else setTimeout(load, 1500);
  }, []);
  const all = useMemo(() => [...lots].sort((a, b) => (storageStart(a) || '').localeCompare(storageStart(b) || '')), [lots]);
  const done = all.filter(l => l.details?.archived_on), viewDone = showDone && done.length > 0, sorted = viewDone ? done : all.filter(l => !l.details?.archived_on);
  const lot = lots.find(l => l.id === openId) ?? null;
  // 상세를 열면 주소를 #lot/<id>로(뒤로 가기로 목록), 목록이면 #lots로 맞춥니다.
  useEffect(() => {
    const want = lot ? `#lot/${encodeURIComponent(lot.id)}` : '#lots';
    if (window.location.hash === want || creating) return;
    if (lot && window.location.hash !== want) history.pushState(null, '', '/' + want);
    else if (!lot && !openId && window.location.hash.startsWith('#lot/')) history.replaceState(null, '', '/#lots');
  }, [lot, openId, creating]);
  // 주소의 기록이 내 목록에 없으면(없는 기록이거나 열 권한이 없음) 목록에서 알려 줍니다. 목록은 서버 권한 검사(본인 기록만)를 거친 결과입니다.
  const missing = !!openId && !lot && !creating && !loadError;
  if (creating) return <NewApple onBack={() => setCreating(false)} onSaved={async l => { await reload(); setCreating(false); setCreated(l.id); setOpenId(l.id); }} />;
  if (lot) return <AppleDetail key={lot.id} lot={lot} firstMsg={created === lot.id ? `‘${josa(lot.name, '을를').replace(lot.name, lot.name + '’')} 등록했어요.` : ''} onBack={() => { setOpenId(null); setCreated(''); history.replaceState(null, '', '/#lots'); }} reload={reload} openTracker={openTracker} openModel={openModel} />;
  return <div className="ma">
    {missing && <p className="ma-hint warn" role="alert">주소의 사과 기록을 찾을 수 없어요. 지워졌거나 이 계정으로 열 수 없는 기록이에요.</p>}
    <div className="ma-head"><h1>내 사과</h1>{all.length > 0 && <button type="button" className="ma-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />새 사과</button>}</div>
    {loadError && <p className="error-box" role="alert">목록을 불러오지 못했어요. {loadError} <button type="button" className="linkbtn" onClick={() => void reload()}>다시 불러오기</button></p>}
    {viewDone && <p className="ma-hint muted">출하 완료로 옮긴 사과예요. 눌러서 다시 목록으로 옮길 수 있어요.</p>}
    {!sorted.length && !loadError && !viewDone && <div className="ma-empty"><p><b>아직 등록한 사과가 없어요.</b></p><ol className="ma-howto"><li>새 사과: 품종·생산지·수확일·저장고 온도만 넣어요</li><li>사과를 누르면 저장 중 변화를 보여줘요</li><li>당도·단단함을 재면 ‘측정 추가’로 넣어요</li></ol><button type="button" className="ma-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />첫 사과 등록하기</button></div>}
    <ul className="ma-list">{sorted.map(l => <li key={l.id}><AppleCard lot={l} onOpen={() => setOpenId(l.id)} /></li>)}</ul>
    {done.length > 0 && <button type="button" className="ma-ghost" onClick={() => setShowDone(v => !v)}>{viewDone ? '저장 중인 사과 보기' : `출하 완료 ${done.length}개 보기`}</button>}
  </div>;
}

function AppleCard({lot, onOpen}: {lot: Lot; onOpen: () => void}) {
  const p = useMemo(() => lotPredictor(lot), [lot]);
  const ready = lotReadiness(lot);
  const d = p.todayDay;
  const firm = d !== null ? p.at('firmness', d) : null, loss = d !== null ? p.at('loss', d) : null;
  // 목록에서는 측정 기록을 불러오지 않으므로, 측정값에 따라 달라지는 단단함은 상세 화면에서만 보여 줍니다.
  const parts = [loss?.ok ? `무게 ${easyChange('loss', loss.value, 0)}` : null].filter(Boolean);
  const pend = weatherPending(lot), waitSept = !!pend && todayKST() < `${pend.year}-10-01`;
  // 측정을 3주 넘게 안 했으면 알려 줍니다(마지막 측정, 없으면 처음 측정일·저장 시작일 기준).
  const lastDate = lot.latest_observation?.date ?? lot.initial_measured_on ?? storageStart(lot) ?? null;
  const since = lastDate && isDate(lastDate) ? daysBetween(lastDate, todayKST()) : null;
  const hint = ready.status === 'unsupported' || ready.status === 'conditions' ? {tone: 'muted', text: '기록만 · 예측은 준비 중이에요'}
    : waitSept ? {tone: 'warn', text: '10월부터 날씨로 자동 추정 · 당도나 단단함을 재면 바로 예측돼요'}
    : !firm?.ok && loss?.ok ? {tone: 'warn', text: '당도나 단단함을 한 번 재 주세요'}
    : since !== null && since >= 21 && !lot.details?.archived_on ? {tone: 'warn', text: lot.latest_observation || (lot.initial_measured_on && !weatherInitial(lot)) ? `마지막 측정 ${since}일 전 · 한 번 재 주세요` : `아직 직접 측정한 기록이 없어요 · 저장 ${since}일째`} : null;
  return <button type="button" className="ma-card" onClick={onOpen}>
    <span className="ma-card-top"><b>{lot.name}</b><span>{d !== null && d >= 0 ? `${d}일째` : ''}</span></span>
    <span className="ma-card-sub">{[lot.variety, lotRegionLabel(lot), lot.location, lot.storage].filter(Boolean).join(' · ')}</span>
    {parts.length > 0 && <span className="ma-card-line">{parts.join(' · ')}<small> · 눌러서 단단함·단맛 보기</small></span>}
    {hint && <span className={'ma-hint ' + hint.tone}>{hint.text}</span>}
  </button>;
}

function AppleDetail({lot, firstMsg = '', onBack, reload, openTracker, openModel}: {lot: Lot; firstMsg?: string; onBack: () => void; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void; openModel?: () => void}) {
  const [obs, setObs] = useState<Observation[] | null>(null), [err, setErr] = useState(''), [n, setN] = useState(0);
  const [measure, setMeasure] = useState(false), [edit, setEdit] = useState(false), [msg, setMsg] = useState(firstMsg);
  useEffect(() => {
    // 다시 불러오는 동안에는 이전 기록으로 계산한 값을 보여 주지 않습니다(측정 추가·수정·삭제 뒤 포함). 늦게 온 이전 요청은 무시합니다.
    let live = true; setErr(''); setObs(null);
    requestJson<{observations: Observation[]}>(`/api/lots/${lot.id}/analysis?asOf=${todayKST()}`).then(r => { if (live) setObs(r.observations ?? []); }).catch(e => { if (live) { setObs([]); setErr((e as Error).message || '측정 기록을 불러오지 못했어요.'); } });
    return () => { live = false; };
  }, [lot.id, n]);
  // 날씨 값이 비어 있던 물량(9월 수확 직후 저장 등): 9월이 끝났으면 그 해 자료를 받아 화면에서 추정합니다. 끝나기 전에는 측정을 안내합니다.
  const pend = useMemo(() => weatherPending(lot), [lot]);
  const waitSept = !!pend && todayKST() < `${pend.year}-10-01`;
  const [override, setOverride] = useState<WeatherValues | null>(null);
  useEffect(() => {
    if (!pend || waitSept) return;
    let live = true;
    fetch(`/api/weather/hongro?year=${pend.year}&region=${pend.region}`).then(r => r.ok ? r.json() : null).then(j => {
      if (!live || !j || !Array.isArray(j.variables)) return;
      const v = Object.fromEntries((j.variables as {key: string; value: number | null}[]).map(x => [x.key, x.value])) as WeatherValues;
      if (Object.values(v).every(x => x !== null)) setOverride(v);
    }).catch(() => {});
    return () => { live = false; };
  }, [pend?.region, pend?.year, waitSept]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => lotPredictor(lot, obs ?? [], override), [lot, obs, override]);
  const hongro = /홍로/.test(lot.variety || '');
  // 홍로 식은 120일까지, 후지는 장기 저장이 많아 150·200일도 보여 줍니다(식 표시 범위 안).
  const days = [...new Set([...(p.todayDay !== null && p.todayDay >= 0 ? [p.todayDay] : []), 30, 60, 90, 120, ...(hongro ? [] : [150, 200])])].sort((a, b) => a - b);
  const [day, setDay] = useState<number | null>(null);
  const limit = hongro ? 120 : 300, over = p.todayDay !== null && p.todayDay > limit;
  const sel = day ?? (over ? Math.max(...days.filter(d => d <= limit)) : p.todayDay !== null && p.todayDay >= 0 ? p.todayDay : 60);
  const ready = lotReadiness(lot);
  const [allRec, setAllRec] = useState(false), [editObs, setEditObs] = useState<Observation | null>(null), [busy, setBusy] = useState(false);
  const sortedObs = [...(obs ?? [])].sort((a, b) => b.date.localeCompare(a.date)), recent = allRec ? sortedObs : sortedObs.slice(0, 3);
  // 측정한 날 그 이전 기록만으로 계산했던 예상값과 실제 측정값을 비교합니다(예측이 얼마나 맞았는지).
  function compareAt(o: Observation) {
    if (!p.start) return null;
    const m = o.firmness != null ? 'firmness' as const : o.brix != null ? 'brix' as const : o.acidity != null ? 'acidity' as const : null;
    if (!m) return null;
    const prior = lotPredictor(lot, (obs ?? []).filter(x => x.date < o.date), override).at(m, daysBetween(p.start, o.date));
    if (!prior.ok) return null;
    const d = metricMeta[m].digits, actual = o[m] as number, diff = actual - prior.value;
    return {pred: `${SHORT[m]} ${fmtNum(prior.value, d)}`, actual: fmtNum(actual, d), diff: `${diff >= 0 ? '+' : ''}${fmtNum(diff, d)}`};
  }
  // 내 기준: 농가가 정한 단단함(N)에 계산상 언제쯤 닿는지 보여 줍니다(판정이 아니라 계산).
  // 단단함을 kg(kgf) 기계로 재는 농가: 측정 입력에서 고른 단위를 기억해 두었다가 kg 환산을 함께 보여 줍니다(계산은 N 그대로).
  const [kgUser, setKgUser] = useState(false);
  useEffect(() => { try { setKgUser(window.localStorage.getItem('appletrack:firmunit') === 'kgf'); } catch { /* 무시 */ } }, []);
  const asKg = (n: number) => `약 ${fmtNum(n / 9.80665, 1)} kg`;
  const [target, setTarget] = useState(lot.details?.firmness_target != null ? String(lot.details.firmness_target) : '');
  const maxDay = hongro ? 120 : 300;
  const reach = (() => {
    const t = Number(target); if (!target.trim() || !Number.isFinite(t) || t <= 0 || p.todayDay === null) return null;
    const from = Math.max(0, p.todayDay), now = p.at('firmness', from);
    if (!now.ok) return {text: '단단함을 계산할 수 있어야 볼 수 있어요. 처음 값이나 측정값을 넣어 주세요.'};
    if (now.value <= t) return {text: '계산상 이미 기준보다 낮아요.'};
    for (let d = from + 1; d <= maxDay; d++) { const r = p.at('firmness', d); if (r.ok && r.value <= t) { const dt = addDays(p.start!, d), day = +dt.slice(8, 10); return {text: `계산상 ${+dt.slice(5, 7)}월 ${day <= 10 ? '초순' : day <= 20 ? '중순' : '하순'}쯤 (저장 ${d}일째)`}; } }
    return {text: `계산 범위(${maxDay}일) 안에서는 기준까지 내려가지 않아요.`};
  })();
  async function saveTarget() {
    const t = target.trim() === '' ? null : Number(target);
    if (t !== null && (!Number.isFinite(t) || t < 1 || t > 300)) { window.alert('단단함 기준은 1~300 N 사이로 넣어 주세요.'); return; }
    setBusy(true); try { await post('update', {details: {firmness_target: t}}); setMsg('내 기준을 저장했어요.'); void reload(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  }
  const post = async (action: string, body: unknown) => requestJson(`/api/lots/${lot.id}/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  async function delObs(o: Observation) {
    if (!window.confirm(`${md(o.date)} 측정 기록을 지울까요? 되돌릴 수 없어요.`)) return;
    setBusy(true); try { await post('observation-delete', {observation_id: o.id}); setMsg('측정 기록을 지웠어요.'); setN(x => x + 1); void reload(); } catch (e) { setMsg(''); window.alert((e as Error).message); } finally { setBusy(false); }
  }
  async function archive(on: boolean) {
    setBusy(true); try { await post('update', {details: {archived_on: on ? todayKST() : null}}); setMsg(on ? '출하 완료로 옮겼어요.' : '다시 저장 중 목록으로 옮겼어요.'); await reload(); if (on) onBack(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  }
  // 보관용 내려받기: 사과 정보, 측정 기록, 기간별 예상 품질(엑셀에서 한글이 깨지지 않게 BOM 포함).
  function exportCsv() {
    const q = (v: unknown) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const rows: unknown[][] = [['사과', lot.name], ['품종', lot.variety], ['보관', [lot.storage, lot.mcp ? `1-MCP ${lot.mcp}` : '', lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : ''].filter(Boolean).join(' · ')], ['저장 시작일', p.start ?? ''], ['내려받은 날', todayKST()], [],
      ['측정 기록'], ['날짜', '단맛(°Brix)', '단단함(N)', '신맛(%)', '메모'], ...sortedObs.map(o => [o.date, o.brix, o.firmness, o.acidity, o.notes]), [],
      ['예상 품질 (시연용 계산 · 출하 판정 아님)'], ['저장 일수', '날짜', '단단함(N)', '무게 감소(%)', '단맛(°Brix)', '신맛(%)'],
      ...days.map(d => { const v = (m: 'firmness' | 'loss' | 'brix' | 'acidity') => { const r = p.at(m, d); return r.ok ? Number(r.value.toFixed(metricMeta[m].digits)) : ''; }; return [d, p.start ? addDays(p.start, d) : '', v('firmness'), v('loss'), v('brix'), v('acidity')]; })];
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${lot.name.replace(/[\\/:*?"<>|]/g, '_')}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function remove() {
    if (!window.confirm(`‘${josa(lot.name, '을를').replace(lot.name, lot.name + '’')} 지울까요? 측정 기록도 모두 지워지고 되돌릴 수 없어요.`)) return;
    if (!window.confirm('정말 지울까요? 다 판 사과라면 ‘출하 완료’로 옮겨 두는 걸 추천해요.')) return;
    setBusy(true); try { await post('delete', {}); await reload(); onBack(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  }
  // 숫자 옆 출처: 고른 날 잰 값 / 측정값에서 계산 / 날씨 추정에서 계산 / 계산
  const selDate = p.start ? addDays(p.start, sel) : null;
  const rowSrc = (m: string, from: string) => { const o = selDate && m !== 'loss' && from === 'measured' && !err ? latestObservation(obs ?? [], m as 'firmness', selDate) : null; return o ? '이날 실측' : from === 'measured' ? '측정값부터 계산' : from === 'weather' ? '날씨 추정에서 계산' : '계산'; };
  const fromMeasured = EASY_METRICS.some(m => { const r = p.at(m, sel); return r.ok && r.from === 'measured'; });
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2400); return () => clearTimeout(t); }, [msg]);
  return <div className="ma ma-detail ma-dash">
    <div className="dash-head">
      <button type="button" className="ma-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />내 사과</button>
      <div className="dash-title-row">
        <div className="ma-title"><h1>{lot.name}</h1><p>{[lot.variety, lotRegionLabel(lot), lot.location, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null].filter(Boolean).join(' · ')}{p.todayDay !== null && p.todayDay >= 0 ? ` · 저장 ${p.todayDay}일째` : ''}</p></div>
        <div className="dash-head-actions">
          <button type="button" className="ma-primary" onClick={() => setMeasure(true)}><Plus size={18} aria-hidden="true" />측정 추가</button>
          <button type="button" className="ma-ghost" onClick={() => setEdit(true)}><Pencil size={15} aria-hidden="true" />사과 정보 수정</button>
        </div>
      </div>
      {(ready.status === 'unsupported' || ready.status === 'conditions') && <p className="ma-hint muted">{ready.title} · {ready.detail}</p>}
      {harvestMonthError(lot.variety, lot.harvest_date) && (() => { const c = harvestCultivar(lot.variety)!, [a, b] = HARVEST_MONTHS[c], h = lot.harvest_date!;
        return <p className="ma-hint warn" role="alert">수확일 {+h.slice(5, 7)}월 {+h.slice(8, 10)}일이 {c === 'hongro' ? '홍로' : '후지'} 수확 달({a}~{b}월) 밖이라 계산값을 보여 주지 않아요. 기록은 그대로 두었으니 ‘사과 정보 수정’에서 수확일을 확인해 주세요.</p>; })()}
      {waitSept && <p className="ma-hint warn">9월 강수량은 9월이 끝나야 집계돼서, 10월 1일부터 날씨로 자동 추정해요. 지금 당도나 단단함을 재서 ‘측정 추가’로 넣으면 바로 예측돼요.</p>}
      {override && <p className="ma-hint">{pend?.year}년 농업기상 자료로 처음 품질을 자동 추정했어요(실측 아님).</p>}
      {over && <p className="ma-hint warn">오늘은 저장 {p.todayDay}일째라 계산 범위({limit}일)를 넘었어요. 아래 날짜 버튼은 범위 안 날짜의 계산값이에요. 지금 상태는 직접 측정해 확인해 주세요.</p>}
    </div>
    <div className="dash-days"><div className="ma-days" role="group" aria-label="저장 일수">{days.map(d => <button key={d} type="button" aria-pressed={sel === d} className={sel === d ? 'active' : ''} onClick={() => setDay(d)}>{d === p.todayDay ? '오늘' : `${d}일`}</button>)}</div>
    <p className="ma-date">{p.start ? `${md(addDays(p.start, sel))} 기준 (저장 ${sel}일째)` : ''}</p>{p.start && <p className="ma-sub ma-daybasis">버튼의 일수는 저장 시작일({md(p.start)})부터 센 날이에요.</p>}</div>
    <div className="dash-tiles">
    {obs === null ? <div className="ma-rows" aria-label="측정 기록을 불러와 계산하는 중" role="status"><p className="ma-sub">측정 기록 확인 중…</p><span className="ma-sk" style={{height: 18}} /><span className="ma-sk" style={{height: 18, width: '80%'}} /><span className="ma-sk" style={{height: 18, width: '60%'}} /></div> : <div className="ma-rows">{EASY_METRICS.map(m => { const r = p.at(m, sel);
      const boxes = m === 'loss' && r.ok && typeof lot.quantity === 'number' && quantityUnit(lot) === '상자' && lot.quantity > 0 ? ` · ${lot.quantity}상자 기준 약 ${fmtNum(lot.quantity * r.value / 100, 1)}상자 무게만큼` : '';
      return <div key={m + ':' + sel} className="ma-row"><span className="ma-row-lab" style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{SHORT[m]}</span><div>{r.ok ? <><b>{easyChange(m, r.value, r.first, p.weather)}</b><small>{fmtNum(r.value, metricMeta[m].digits)} {unit(m, hongro)}{m === 'firmness' && kgUser ? ` (${asKg(r.value)})` : ''}{boxes}</small><i className="ma-from">{rowSrc(m, r.from)}</i></> : <><b className="na">계산 없음</b><small>{r.reason}</small></>}</div></div>; })}</div>}
    {err && <p className="ma-hint warn" role="alert">측정 기록을 불러오지 못해 실측을 반영하지 않은 계산값이에요({err}). 새로고침해 주세요.</p>}
    {obs !== null && p.start && <SameDay lot={lot} obs={obs} p={p} sel={sel} hongro={hongro} />}
    </div>
    {obs === null ? <p className="dash-chart ma-loading" role="status">측정 기록 확인 중…</p> : <>
      <section className="dash-chart" aria-label="저장 일수별 변화"><h2>저장 일수별 변화 <small>선: 계산값 · 동그라미: 내가 잰 값 · 세로선: 고른 날</small></h2><MiniCharts p={p} obs={obs} sel={sel} maxDay={hongro ? 120 : 200} target={lot.details?.firmness_target ?? null} /></section>
    </>}
    <div className="dash-measurements">
      <section className="ma-records dash-rec" aria-label="최근 측정 기록"><h2>최근 측정</h2>
        {obs === null ? <div aria-label="불러오는 중" style={{display: 'grid', gap: 8}}><span className="ma-sk" style={{height: 18}} /><span className="ma-sk" style={{height: 18, width: '70%'}} /></div> : err ? <p className="error-box">{err}</p>
          : recent.length ? <><ul>{recent.map(o => <li key={o.id} className="ma-rec"><span><b>{md(o.date)}</b> {[o.brix != null ? `단맛 ${o.brix}` : null, o.firmness != null ? `단단함 ${o.firmness} N` : null, o.acidity != null ? `신맛 ${o.acidity}%` : null].filter(Boolean).join(' · ') || '값 없음'}</span>
            {(() => { const c = compareAt(o); return c ? <small className="ma-cmp">예측 {c.pred} · 실제 {c.actual} ({c.diff})</small> : null; })()}
            <span className="ma-rec-btns"><button type="button" className="linkbtn" disabled={busy} onClick={() => setEditObs(o)}>고치기</button><button type="button" className="linkbtn" disabled={busy} onClick={() => void delObs(o)}>지우기</button></span></li>)}</ul>
            {sortedObs.length > 3 && <button type="button" className="linkbtn" onClick={() => setAllRec(v => !v)}>{allRec ? '최근 3개만 보기' : `전체 ${sortedObs.length}개 보기`}</button>}</>
          : <p>아직 측정 기록이 없어요.</p>}
      </section>
      {!lot.details?.archived_on && obs !== null && <ConsumerCompare lot={lot} p={p} onMeasure={() => setMeasure(true)} />}
      <div className="dash-side">
      {!lot.details?.archived_on && obs !== null && <TargetStorage lot={lot} p={p} maxDay={hongro ? 120 : 300} />}
      <section className="ma-target dash-card" aria-label="내 단단함 기준"><h2>내 기준</h2>
      <div className="ma-target-row"><label htmlFor="ma-target">단단함</label><input id="ma-target" type="number" inputMode="decimal" min={1} max={300} step="any" placeholder="예: 50" value={target} onChange={e => setTarget(e.target.value)} /><span>N</span>
        <button type="button" className="ma-ghost" disabled={busy || target === (lot.details?.firmness_target != null ? String(lot.details.firmness_target) : '')} onClick={() => void saveTarget()}>저장</button></div>
      {Number(target) > 0 && <p className="ma-sub">{target} N은 {asKg(Number(target))}이에요. (kg 기계 숫자 × 9.8 = N)</p>}
      {obs === null ? <p className="ma-sub">측정 기록을 불러오는 중이에요…</p> : reach ? <p>{reach.text}</p> : <p className="ma-sub">내가 정한 단단함에 계산상 언제쯤 닿는지 보여 줘요. 출하 판정이 아니라 계산이에요.</p>}
    </section>
        <section className="dash-card dash-info" aria-label="저장 조건과 날씨"><h2>저장 조건</h2>
          <p>{[lot.storage, lot.mcp ? `1-MCP ${lot.mcp}` : null, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null, lot.location, typeof lot.quantity === 'number' ? `${lot.quantity}${quantityUnit(lot)}` : null].filter(Boolean).join(' · ') || '기록 없음'}</p>
          {(() => { const h = lot.details?.hongro, f = lot.details?.fuji_weather;
            const reg = (h?.source === 'weather' ? h.region ?? 'geochang' : f?.region) as keyof typeof WEATHER_STATIONS | undefined;
            if (!reg || !WEATHER_STATIONS[reg]) return <p className="ma-sub">처음 품질은 직접 잰 값으로 시작했어요.</p>;
            const lab = weatherLabels(reg), w = h?.source === 'weather' ? h.weather : f ? {chang_min4: f.inputs.min4, chang_LC56: f.inputs.lc56, chang_LC78: f.inputs.lc78, chang_9rain: f.inputs.rain9} : null;
            return <><h2>수확한 해 날씨 <small>{WEATHER_STATIONS[reg].name}</small></h2><dl className="dash-wx">{(['chang_min4', 'chang_LC56', 'chang_LC78', 'chang_9rain'] as const).map(k => <div key={k}><dt>{lab[k]}</dt><dd>{w && w[k] != null ? fmtNum(Number(w[k]), k === 'chang_min4' ? 1 : 0) : '—'}{k === 'chang_min4' ? '℃' : k === 'chang_9rain' ? 'mm' : ''}</dd></div>)}</dl></>; })()}
        </section>
      </div>
    </div>
    <p className="ma-foot">{p.weather ? '처음 품질은 날씨로 추정 · ' : ''}{fromMeasured ? '내가 잰 값부터 이어 계산 · ' : ''}시연용 계산 · 출하·안전 판정 아님 {openModel && <button type="button" className="linkbtn" onClick={openModel}>계산 근거</button>}</p>
    {measure && <MeasurementForm open lot={lot} isBaseline={false} hasBaseline={!!baselineObservation(lot, obs ?? [])} onClose={() => setMeasure(false)} onSaved={m => { setMeasure(false); setMsg(m); setN(x => x + 1); void reload(); }} />}
    {editObs && <MeasurementForm open lot={lot} observation={editObs} isBaseline={baselineObservation(lot, obs ?? [])?.id === editObs.id} hasBaseline={!!baselineObservation(lot, obs ?? [])} onClose={() => setEditObs(null)} onSaved={m => { setEditObs(null); setMsg(m); setN(x => x + 1); void reload(); }} />}
    <div className="ma-manage"><button type="button" className="ma-ghost" disabled={busy} onClick={() => void archive(!lot.details?.archived_on)}>{lot.details?.archived_on ? '저장 중 목록으로 되돌리기' : '출하 완료로 옮기기'}</button><button type="button" className="ma-ghost" onClick={exportCsv}>기록 내려받기 (CSV · 엑셀에서 열림)</button><button type="button" className="linkbtn ma-danger" disabled={busy} onClick={() => void remove()}>이 사과 지우기</button></div>
    {msg && <div key={msg} className="ma-toast" role="status">✓ {msg}</div>}
    {edit && <LotEditor open lot={lot} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); setMsg('사과 정보를 저장했어요.'); void reload(); }} />}
  </div>;
}

/** 고른 날의 실측 비교. 같은 날 잰 값이 있을 때만 계산값과의 차이를 보여 주고, 없으면 차이를 만들지 않습니다. */
function SameDay({lot, obs, p, sel, hongro}: {lot: Lot; obs: Observation[]; p: ReturnType<typeof lotPredictor>; sel: number; hongro: boolean}) {
  if (!p.start) return null;
  const date = addDays(p.start, sel), today = todayKST();
  const past = obs.filter(o => o.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const last = past.at(-1) ?? null, same = obs.filter(o => o.date === date).at(-1) ?? null;
  const md2 = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  if (same) {
    // 비교할 계산값은 그날 잰 값을 넣기 전(그 전날까지의 기록) 계산입니다. 그날 값을 넣은 계산은 잰 값과 같아져 비교가 되지 않습니다.
    let before: ReturnType<typeof lotPredictor> | null = null; try { before = lotPredictor(lot, obs.filter(o => o.date < date)); } catch { before = null; }
    const rows = (['firmness', 'brix', 'acidity'] as const).flatMap(m => { const v = same[m]; const r = before?.at(m, sel); if (typeof v !== 'number' || !r || !r.ok) return [];
      const dg = metricMeta[m].digits, diff = Number((v - r.value).toFixed(dg)), u = unit(m, hongro);
      return [<li key={m}><b style={{color: METRIC_COLOR[m]}}>{SHORT[m]}</b> 이날 잰 값 {fmtNum(v, dg)} {u} · 그 전까지 기록으로 계산 {fmtNum(r.value, dg)} {u} · {diff === 0 ? '같음' : `잰 값이 ${fmtNum(Math.abs(diff), dg)} ${u} ${diff > 0 ? '높음' : '낮음'}`}</li>]; });
    return <div className="ma-sameday" role="note"><p><b>{md2(date)}에 잰 값이 있어요</b></p>{rows.length ? <ul>{rows}</ul> : <p>이날 기록에 단단함·단맛·신맛 값은 없어요.</p>}</div>;
  }
  if (date > today) return <p className="ma-sameday" role="note">{md2(date)}은 앞으로의 계산값이에요{last ? ` · 기준 측정일 ${md2(last.date)}` : ' · 아직 직접 잰 기록이 없어요'}</p>;
  return <p className="ma-sameday" role="note">{md2(date)}에는 잰 값이 없어 차이를 표시하지 않아요{last ? ` · 최근 측정 ${md2(last.date)}` : ''}</p>;
}

/** 농가가 고른 목표 저장일의 계산값을 보여 주고 캘린더 일정(.ics)으로 내려 줍니다. 고른 날은 이 기기에만 기억합니다. */
export function TargetStorage({lot, p, maxDay, link}: {lot: Lot; p: ReturnType<typeof lotPredictor>; maxDay: number; link?: string}) {
  const key = `appletrack:target-date:${lot.id}`;
  const start = storageStart(lot) ?? null, today = todayKST();
  const [date, setDate] = useState('');
  useEffect(() => { try { const v = localStorage.getItem(key); setDate(v && isDate(v) ? v : ''); } catch { setDate(''); } }, [key]);
  const pick = (d: string) => { setDate(d); try { if (d) localStorage.setItem(key, d); else localStorage.removeItem(key); } catch { /* 이번만 */ } };
  if (!start || !isDate(start)) return null;
  const md2 = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  const chk = date ? checkTargetDate(start, date, today, maxDay) : null;
  const q = chk?.ok ? (['firmness', 'brix'] as const).map(m => { const r = p.at(m, chk.day); return r.ok ? `${SHORT[m]} ${fmtNum(r.value, metricMeta[m].digits)} ${metricMeta[m].unit}` : null; }).filter((x): x is string => !!x) : [];
  const save = () => {
    if (!chk?.ok) return;
    const ics = targetIcs({lotId: lot.id, lotName: lot.name || '내 사과', date, day: chk.day, quality: q.join(' · ') || undefined, url: link ?? `${location.origin}/#lot/${lot.id}`});
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], {type: 'text/calendar;charset=utf-8'}));
    a.download = `appletrack-target-${date}.ics`; document.body.appendChild(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 1000);
  };
  return <section className="ma-remind dash-card" aria-label="목표 저장일">
    <h2>목표 저장일</h2>
    <p>언제까지 저장할지 고르면 그날 계산값을 보여 주고, 캘린더에 일정으로 넣을 수 있어요. 일수는 저장 시작일({md2(start)})부터 센 날이에요.</p>
    <div className="ma-remind-gaps" role="radiogroup" aria-label="저장 일수로 고르기">{TARGET_PRESETS.filter(d => d <= maxDay).map(d => { const v = addDays(start, d); return <button key={d} type="button" role="radio" aria-checked={date === v} className={date === v ? 'on' : ''} onClick={() => pick(v)}>{d}일</button>; })}</div>
    <label className="ma-target-date">날짜로 고르기 <input type="date" min={addDays(today, 1)} max={addDays(start, maxDay)} value={date} aria-invalid={chk ? !chk.ok : undefined} onChange={e => pick(e.target.value)} /></label>
    {chk && !chk.ok && <p className="ld-err" role="alert">{chk.reason}</p>}
    {chk?.ok && <>
      <p className="ma-remind-date"><b>{md2(date)}</b> · 저장 {chk.day}일째 · 오늘부터 {daysBetween(today, date)}일 뒤</p>
      <p>{q.length ? `이날 계산값: ${q.join(' · ')}` : '이날은 계산 범위 밖이라 품질 값은 표시하지 않아요.'}</p>
      {(() => { const b = p.at('brix', chk.day); if (!b.ok) return null; const n = sugarNotes(b.value, lot.variety); return <p className="cc-note">단맛: {n.range}{n.ref ? ` · ${n.ref}` : ''}</p>; })()}
      <button type="button" className="ma-target-save" onClick={save}>캘린더에 일정 등록</button>
      <p className="ma-target-note">휴대폰에서는 내려받은 파일을 열면 캘린더 앱에 추가돼요. 그날 오전 9시에 알림이 울려요.</p>
    </>}
  </section>;
}

const DIR_TXT = {up: '▲ 높아짐', down: '▼ 낮아짐', same: '= 같음'} as const;
const CC_LABEL: Record<CompareRow['metric'], string> = {brix: '당도', acidity: '산도', loss: '무게 감소'};

/** 소비자 선호 당도와 지금 품질 대조 + ‘오늘부터 30일 뒤 → 60일 뒤’ 비교(기존 계산식 그대로, 판정·점수 없음). */
export function ConsumerCompare({lot, p, onMeasure}: {lot: Lot; p: ReturnType<typeof lotPredictor>; onMeasure?: () => void}) {
  const t = p.todayDay;
  if (t === null || t < 0) return null;
  const today = todayKST();
  const md2 = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  const now = p.at('brix', t);
  const rows = (['brix', 'acidity', 'loss'] as const).map(m => compareRow(m, p.at(m, t + 30), p.at(m, t + 60)));
  const startKg = lot.details?.quantity_unit === 'kg' && typeof lot.quantity === 'number' && lot.quantity > 0 ? lot.quantity : null;
  const summary = summaryLine(rows, startKg);
  const ref = sugarRef(lot.variety);
  const notes = now.ok ? sugarNotes(now.value, lot.variety) : null;
  const unitOf = (m: CompareRow['metric']) => m === 'brix' ? ' °Brix' : '%';
  return <section className="ma-remind dash-card cc" aria-label="소비자 선호와 비교">
    <h2>소비자 선호와 비교</h2>
    <div className="cc-now">
      <p className="cc-now-val">오늘 단맛 {now.ok ? <><b>{fmtNum(now.value, metricMeta.brix.digits)}</b> °Brix</> : <span>계산 없음</span>}</p>
      {notes ? <><p className="cc-note">{notes.range}</p>{notes.ref && <p className="cc-note">{notes.ref}</p>}</> : !now.ok && <p className="cc-note">{now.reason}</p>}
      <div className="cc-band" aria-hidden="true">{now.ok && <i style={{left: `${Math.min(100, Math.max(0, (now.value - 10) / 8 * 100))}%`}} />}<span style={{left: `${(CONSUMER_BRIX.min - 10) / 8 * 100}%`, width: `${(CONSUMER_BRIX.max - CONSUMER_BRIX.min) / 8 * 100}%`}} /></div>
      <p className="cc-scale" aria-hidden="true"><span>10</span><span>선호 {CONSUMER_BRIX.min}~{CONSUMER_BRIX.max}</span><span>18 °Brix</span></p>
    </div>
    <h3 className="cc-h">30일 더 보관하면</h3>
    <p className="cc-when">오늘부터 30일 뒤({md2(addDays(today, 30))} · 저장 {t + 30}일째) → 60일 뒤({md2(addDays(today, 60))} · 저장 {t + 60}일째)</p>
    {summary ? <p className="cc-summary">{summary}</p> : <p className="cc-note">비교할 값이 없어요.</p>}
    <ul className="cc-rows">{rows.map(r => {
      const k = r.metric === 'loss' ? lossKg(r, startKg) : null;
      return <li key={r.metric}><span className="cc-lab">{CC_LABEL[r.metric]}</span>
        {r.dir === null ? <span className="cc-na">비교할 값이 없어요</span> : <>
          <span className="cc-val">{r.metric === 'loss' && k ? <>처음 100kg당 {fmtNum(k.per100.a, metricMeta.loss.digits)} → {fmtNum(k.per100.b, metricMeta.loss.digits)}kg{k.mine && <small>등록 물량 {fmtNum(startKg!, 0)}kg: {fmtNum(k.mine.a, metricMeta.loss.digits)} → {fmtNum(k.mine.b, metricMeta.loss.digits)}kg</small>}</>
            : <>{fmtNum(r.a!, metricMeta[r.metric].digits)} → {fmtNum(r.b!, metricMeta[r.metric].digits)}{unitOf(r.metric)}</>}</span>
          <span className={'cc-dir ' + r.dir}>{r.metric === 'loss' && r.dir === 'up' ? '▲ 더 줄어듦' : DIR_TXT[r.dir]}{r.metric === 'loss' && k ? (r.dir === 'up' ? ` · 추가 ${fmtNum(k.mine ? k.mine.extra : k.per100.extra, metricMeta.loss.digits)}kg` : '') : r.dir !== 'same' ? ` · ${r.diffText}` : ''}</span>
        </>}</li>;
    })}</ul>
    {onMeasure && <button type="button" className="ma-target-save cc-measure" onClick={onMeasure}>오늘 잰 당도 기록하기</button>}
    <details className="cc-src"><summary>근거·참고</summary><p className="ma-target-note">선호 범위: <a href={CONSUMER_BRIX.url} target="_blank" rel="noreferrer">{CONSUMER_BRIX.source}</a>{ref && <> · 품종 기준: <a href={ref.url} target="_blank" rel="noreferrer">{ref.source}</a></>}. 무게 감소는 저장 시작 무게 대비 누적 감소율이에요. 기존 팀 계산식 결과이며 정확도 검증 전이고, 출하·품질 판정이 아니에요.</p></details>
  </section>;
}
