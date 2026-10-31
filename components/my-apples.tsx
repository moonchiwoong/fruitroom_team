'use client';
// ‘내 사과’: 농가용 단순 화면. 목록 → 사과 상세 → 측정 추가만 있습니다.
// 계산은 lib/lot-predict.ts(기존 예측식 그대로)를 쓰고, 그래프·근거는 기존 ‘자세히 보기’(품질 예측 화면)로 보냅니다.
import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, ArrowRight, Loader2, Pencil, Plus} from 'lucide-react';
import type {Lot, Observation} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {LotEditor, MeasurementForm} from '@/components/lot-dialogs';
import {lotPredictor, easyChange, EASY_LABEL, EASY_METRICS, weatherPending, type WeatherValues} from '@/lib/lot-predict';
import {lotReadiness, baselineObservation, storageStart, quantityUnit} from '@/lib/lot-readiness';
import {fmtNum, metricMeta, todayKST, addDays, daysBetween, isDate} from '@/lib/tracker';

const REGION: Record<string, string> = {cheongsong: '청송', jangsu: '장수', yeongju: '영주'};
const SHORT: Record<string, string> = {firmness: '단단함', loss: '무게', brix: '단맛', acidity: '신맛'};
const md = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}`; };
const unit = (m: string, hongro: boolean) => m === 'firmness' ? (hongro ? 'N (Ø11 mm)' : 'N') : metricMeta[m as 'brix'].unit;

export default function MyApples({lots, loadError, reload, openTracker, focus}: {lots: Lot[]; loadError: string; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void; focus?: {id: string | null; n: number} | null}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 다른 화면에서 특정 사과를 열도록 요청하면(새 사과 저장 직후 등) 그 사과 상세를 엽니다.
  useEffect(() => { if (focus) setOpenId(focus.id); }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showDone, setShowDone] = useState(false);
  const all = useMemo(() => [...lots].sort((a, b) => (storageStart(a) || '').localeCompare(storageStart(b) || '')), [lots]);
  const done = all.filter(l => l.details?.archived_on), viewDone = showDone && done.length > 0, sorted = viewDone ? done : all.filter(l => !l.details?.archived_on);
  const lot = lots.find(l => l.id === openId) ?? null;
  if (lot) return <AppleDetail lot={lot} onBack={() => setOpenId(null)} reload={reload} openTracker={openTracker} />;
  return <div className="ma">
    <div className="ma-head"><h1>내 사과</h1><button type="button" className="ma-primary" onClick={() => openTracker('real', 'new')}><Plus size={18} aria-hidden="true" />새 사과</button></div>
    {loadError && <p className="error-box" role="alert">목록을 불러오지 못했어요. {loadError} <button type="button" className="linkbtn" onClick={() => void reload()}>다시 불러오기</button></p>}
    {viewDone && <p className="ma-hint muted">출하 완료로 옮긴 사과예요. 눌러서 다시 목록으로 옮길 수 있어요.</p>}
    {!sorted.length && !loadError && !viewDone && <div className="ma-empty"><p>아직 등록한 사과가 없어요.</p><button type="button" className="ma-primary" onClick={() => openTracker('real', 'new')}><Plus size={18} aria-hidden="true" />첫 사과 등록하기</button></div>}
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
    : since !== null && since >= 21 && !lot.details?.archived_on ? {tone: 'warn', text: lot.latest_observation || lot.initial_measured_on ? `마지막 측정 ${since}일 전 · 한 번 재 주세요` : `저장 ${since}일째 측정 없음 · 한 번 재 주세요`} : null;
  return <button type="button" className="ma-card" onClick={onOpen}>
    <span className="ma-card-top"><b>{lot.name}</b><span>{d !== null && d >= 0 ? `${d}일째` : ''}</span></span>
    <span className="ma-card-sub">{[lot.variety, REGION[lot.details?.fuji_weather?.region ?? ''] ?? (lot.details?.hongro?.source === 'weather' ? '거창' : null), lot.location, lot.storage].filter(Boolean).join(' · ')}</span>
    {parts.length > 0 && <span className="ma-card-line">{parts.join(' · ')}<small> · 눌러서 단단함·단맛 보기</small></span>}
    {hint && <span className={'ma-hint ' + hint.tone}>{hint.text}</span>}
  </button>;
}

function AppleDetail({lot, onBack, reload, openTracker}: {lot: Lot; onBack: () => void; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void}) {
  const [obs, setObs] = useState<Observation[] | null>(null), [err, setErr] = useState(''), [n, setN] = useState(0);
  const [measure, setMeasure] = useState(false), [edit, setEdit] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => {
    let live = true; setErr('');
    requestJson<{observations: Observation[]}>(`/api/lots/${lot.id}/analysis?asOf=${todayKST()}`).then(r => { if (live) setObs(r.observations ?? []); }).catch(e => { if (live) { setObs([]); setErr((e as Error).message); } });
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
      if (!live || !j) return;
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
  const sel = day ?? (p.todayDay !== null && p.todayDay >= 0 ? p.todayDay : 60);
  const ready = lotReadiness(lot);
  const [allRec, setAllRec] = useState(false), [editObs, setEditObs] = useState<Observation | null>(null), [busy, setBusy] = useState(false);
  const sortedObs = [...(obs ?? [])].sort((a, b) => b.date.localeCompare(a.date)), recent = allRec ? sortedObs : sortedObs.slice(0, 3);
  const post = async (action: string, body: unknown) => requestJson(`/api/lots/${lot.id}/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  async function delObs(o: Observation) {
    if (!window.confirm(`${md(o.date)} 측정 기록을 지울까요? 되돌릴 수 없어요.`)) return;
    setBusy(true); try { await post('observation-delete', {observation_id: o.id}); setMsg('측정 기록을 지웠어요.'); setN(x => x + 1); void reload(); } catch (e) { setMsg(''); window.alert((e as Error).message); } finally { setBusy(false); }
  }
  async function archive(on: boolean) {
    setBusy(true); try { await post('update', {details: {archived_on: on ? todayKST() : null}}); setMsg(on ? '출하 완료로 옮겼어요.' : '다시 저장 중 목록으로 옮겼어요.'); await reload(); if (on) onBack(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`‘${lot.name}’을(를) 지울까요? 측정 기록도 모두 지워지고 되돌릴 수 없어요.`)) return;
    if (!window.confirm('정말 지울까요? 다 판 사과라면 ‘출하 완료’로 옮겨 두는 걸 추천해요.')) return;
    setBusy(true); try { await post('delete', {}); await reload(); onBack(); } catch (e) { window.alert((e as Error).message); } finally { setBusy(false); }
  }
  const fromMeasured = EASY_METRICS.some(m => { const r = p.at(m, sel); return r.ok && r.from === 'measured'; });
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2400); return () => clearTimeout(t); }, [msg]);
  return <div className="ma ma-detail">
    <button type="button" className="ma-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />내 사과</button>
    <div className="ma-title"><h1>{lot.name}</h1><p>{[lot.variety, REGION[lot.details?.fuji_weather?.region ?? ''] ?? (lot.details?.hongro?.source === 'weather' ? '거창' : null), lot.location, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null].filter(Boolean).join(' · ')}{p.todayDay !== null && p.todayDay >= 0 ? ` · 저장 ${p.todayDay}일째` : ''}</p></div>
    {(ready.status === 'unsupported' || ready.status === 'conditions') && <p className="ma-hint muted">{ready.title} · {ready.detail}</p>}
    {waitSept && <p className="ma-hint warn">9월 강수량은 9월이 끝나야 집계돼서, 10월 1일부터 날씨로 자동 추정해요. 지금 당도나 단단함을 재서 ‘측정 추가’로 넣으면 바로 예측돼요.</p>}
    {override && <p className="ma-hint">{pend?.year}년 농업기상 자료로 처음 품질을 자동 추정했어요(실측 아님).</p>}
    <div className="ma-days" role="group" aria-label="저장 일수">{days.map(d => <button key={d} type="button" aria-pressed={sel === d} className={sel === d ? 'active' : ''} onClick={() => setDay(d)}>{d === p.todayDay ? '오늘' : `${d}일`}</button>)}</div>
    <p className="ma-date">{p.start ? `${md(addDays(p.start, sel))} 기준 (저장 ${sel}일째)` : ''}</p>
    <div className="ma-rows">{EASY_METRICS.map(m => { const r = p.at(m, sel);
      const boxes = m === 'loss' && r.ok && typeof lot.quantity === 'number' && quantityUnit(lot) === '상자' && lot.quantity > 0 ? ` · ${lot.quantity}상자 기준 약 ${fmtNum(lot.quantity * r.value / 100, 1)}상자 무게만큼` : '';
      return <div key={m + ':' + sel} className="ma-row"><span>{SHORT[m]}</span><div>{r.ok ? <><b>{easyChange(m, r.value, r.first, p.weather)}</b><small>{fmtNum(r.value, metricMeta[m].digits)} {unit(m, hongro)}{boxes}</small></> : <><b className="na">계산 없음</b><small>{r.reason}</small></>}</div></div>; })}</div>
    <div className="ma-actions">
      <button type="button" className="ma-primary big" onClick={() => setMeasure(true)}><Plus size={18} aria-hidden="true" />측정 추가</button>
      <button type="button" className="ma-ghost" onClick={() => openTracker('real', lot.id)}>그래프 · 사과 모양 보기<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    {msg && <div key={msg} className="ma-toast" role="status">✓ {msg}</div>}
    <section className="ma-records" aria-label="최근 측정 기록"><h2>최근 측정</h2>
      {obs === null ? <div aria-label="불러오는 중" style={{display: 'grid', gap: 8}}><span className="ma-sk" style={{height: 18}} /><span className="ma-sk" style={{height: 18, width: '70%'}} /></div> : err ? <p className="error-box">{err}</p>
        : recent.length ? <><ul>{recent.map(o => <li key={o.id} className="ma-rec"><span><b>{md(o.date)}</b> {[o.brix != null ? `단맛 ${o.brix}` : null, o.firmness != null ? `단단함 ${o.firmness} N` : null, o.acidity != null ? `신맛 ${o.acidity}%` : null].filter(Boolean).join(' · ') || '값 없음'}</span>
          <span className="ma-rec-btns"><button type="button" className="linkbtn" disabled={busy} onClick={() => setEditObs(o)}>고치기</button><button type="button" className="linkbtn" disabled={busy} onClick={() => void delObs(o)}>지우기</button></span></li>)}</ul>
          {sortedObs.length > 3 && <button type="button" className="linkbtn" onClick={() => setAllRec(v => !v)}>{allRec ? '최근 3개만 보기' : `전체 ${sortedObs.length}개 보기`}</button>}</>
        : <p>아직 측정 기록이 없어요.</p>}
    </section>
    <p className="ma-foot">{p.weather ? '처음 품질은 날씨로 추정 · ' : ''}{fromMeasured ? '내가 잰 값부터 이어 계산 · ' : ''}시연용 계산 · 출하·안전 판정 아님 <button type="button" className="linkbtn" onClick={() => setEdit(true)}><Pencil size={13} aria-hidden="true" />사과 정보 수정</button></p>
    {measure && <MeasurementForm open lot={lot} isBaseline={false} hasBaseline={!!baselineObservation(lot, obs ?? [])} onClose={() => setMeasure(false)} onSaved={m => { setMeasure(false); setMsg(m); setN(x => x + 1); void reload(); }} />}
    {editObs && <MeasurementForm open lot={lot} observation={editObs} isBaseline={baselineObservation(lot, obs ?? [])?.id === editObs.id} hasBaseline={!!baselineObservation(lot, obs ?? [])} onClose={() => setEditObs(null)} onSaved={m => { setEditObs(null); setMsg(m); setN(x => x + 1); void reload(); }} />}
    <div className="ma-manage"><button type="button" className="ma-ghost" disabled={busy} onClick={() => void archive(!lot.details?.archived_on)}>{lot.details?.archived_on ? '저장 중 목록으로 되돌리기' : '출하 완료로 옮기기'}</button><button type="button" className="linkbtn ma-danger" disabled={busy} onClick={() => void remove()}>이 사과 지우기</button></div>
    {edit && <LotEditor open lot={lot} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); setMsg('사과 정보를 저장했어요.'); void reload(); }} />}
  </div>;
}
