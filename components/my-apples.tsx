'use client';
// ‘내 사과’: 농가용 단순 화면. 목록 → 사과 상세 → 측정 추가만 있습니다.
// 계산은 lib/lot-predict.ts(기존 예측식 그대로)를 쓰고, 그래프·근거는 기존 ‘자세히 보기’(품질 예측 화면)로 보냅니다.
import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, ArrowRight, Loader2, Pencil, Plus} from 'lucide-react';
import type {Lot, Observation} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {LotEditor, MeasurementForm} from '@/components/lot-dialogs';
import {lotPredictor, easyChange, EASY_LABEL, EASY_METRICS} from '@/lib/lot-predict';
import {lotReadiness, baselineObservation, storageStart} from '@/lib/lot-readiness';
import {fmtNum, metricMeta, todayKST, addDays} from '@/lib/tracker';

const md = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}`; };
const unit = (m: string, hongro: boolean) => m === 'firmness' ? (hongro ? 'N (Ø11 mm)' : 'N') : metricMeta[m as 'brix'].unit;

export default function MyApples({lots, loadError, reload, openTracker}: {lots: Lot[]; loadError: string; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(() => [...lots].sort((a, b) => (storageStart(a) || '').localeCompare(storageStart(b) || '')), [lots]);
  const lot = lots.find(l => l.id === openId) ?? null;
  if (lot) return <AppleDetail lot={lot} onBack={() => setOpenId(null)} reload={reload} openTracker={openTracker} />;
  return <div className="ma">
    <div className="ma-head"><h1>내 사과</h1><button type="button" className="ma-primary" onClick={() => openTracker('real', 'new')}><Plus size={18} aria-hidden="true" />새 사과</button></div>
    {loadError && <p className="error-box" role="alert">목록을 불러오지 못했어요. {loadError} <button type="button" className="linkbtn" onClick={() => void reload()}>다시 불러오기</button></p>}
    {!sorted.length && !loadError && <div className="ma-empty"><p>아직 등록한 사과가 없어요.</p><button type="button" className="ma-primary" onClick={() => openTracker('real', 'new')}><Plus size={18} aria-hidden="true" />첫 사과 등록하기</button></div>}
    <ul className="ma-list">{sorted.map(l => <li key={l.id}><AppleCard lot={l} onOpen={() => setOpenId(l.id)} /></li>)}</ul>
  </div>;
}

function AppleCard({lot, onOpen}: {lot: Lot; onOpen: () => void}) {
  const p = useMemo(() => lotPredictor(lot), [lot]);
  const ready = lotReadiness(lot);
  const d = p.todayDay;
  const firm = d !== null ? p.at('firmness', d) : null, loss = d !== null ? p.at('loss', d) : null;
  // 목록에서는 측정 기록을 불러오지 않으므로, 측정값에 따라 달라지는 단단함은 상세 화면에서만 보여 줍니다.
  const parts = [loss?.ok ? `무게 ${easyChange('loss', loss.value, 0)}` : null].filter(Boolean);
  const hint = ready.status === 'unsupported' || ready.status === 'conditions' ? {tone: 'muted', text: '기록만 · 예측은 준비 중이에요'}
    : !firm?.ok && loss?.ok ? {tone: 'warn', text: '당도나 단단함을 한 번 재 주세요'} : null;
  return <button type="button" className="ma-card" onClick={onOpen}>
    <span className="ma-card-top"><b>{lot.name}</b><span>{d !== null && d >= 0 ? `${d}일째` : ''}</span></span>
    <span className="ma-card-sub">{[lot.variety, lot.location, lot.storage].filter(Boolean).join(' · ')}</span>
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
  const p = useMemo(() => lotPredictor(lot, obs ?? []), [lot, obs]);
  const hongro = /홍로/.test(lot.variety || '');
  const days = [...new Set([...(p.todayDay !== null && p.todayDay >= 0 ? [p.todayDay] : []), 30, 60, 90, 120])].sort((a, b) => a - b);
  const [day, setDay] = useState<number | null>(null);
  const sel = day ?? (p.todayDay !== null && p.todayDay >= 0 ? p.todayDay : 60);
  const ready = lotReadiness(lot);
  const recent = [...(obs ?? [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const fromMeasured = EASY_METRICS.some(m => { const r = p.at(m, sel); return r.ok && r.from === 'measured'; });
  return <div className="ma">
    <button type="button" className="ma-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />내 사과</button>
    <div className="ma-title"><h1>{lot.name}</h1><p>{[lot.variety, lot.location, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null].filter(Boolean).join(' · ')}{p.todayDay !== null && p.todayDay >= 0 ? ` · 저장 ${p.todayDay}일째` : ''}</p></div>
    {(ready.status === 'unsupported' || ready.status === 'conditions') && <p className="ma-hint muted">{ready.title} · {ready.detail}</p>}
    <div className="ma-days" role="group" aria-label="저장 일수">{days.map(d => <button key={d} type="button" aria-pressed={sel === d} className={sel === d ? 'active' : ''} onClick={() => setDay(d)}>{d === p.todayDay ? '오늘' : `${d}일`}</button>)}</div>
    <p className="ma-date">{p.start ? `${md(addDays(p.start, sel))} 기준 (저장 ${sel}일째)` : ''}</p>
    <div className="ma-tiles">{EASY_METRICS.map(m => { const r = p.at(m, sel);
      return <div key={m} className="ma-tile"><span>{EASY_LABEL[m]}</span>{r.ok ? <><b>{easyChange(m, r.value, r.first)}</b><small>{fmtNum(r.value, metricMeta[m].digits)} {unit(m, hongro)}</small></> : <><b className="na">계산 없음</b><small>{r.reason}</small></>}</div>; })}</div>
    <div className="ma-actions">
      <button type="button" className="ma-primary big" onClick={() => setMeasure(true)}><Plus size={18} aria-hidden="true" />측정 추가</button>
      <button type="button" className="ma-ghost" onClick={() => openTracker('real', lot.id)}>그래프·자세히 보기<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    {msg && <p className="ma-ok" role="status">{msg}</p>}
    <section className="ma-records" aria-label="최근 측정 기록"><h2>최근 측정</h2>
      {obs === null ? <p><Loader2 className="spin" size={15} aria-hidden="true" />불러오는 중…</p> : err ? <p className="error-box">{err}</p>
        : recent.length ? <ul>{recent.map(o => <li key={o.id}><b>{md(o.date)}</b> {[o.brix != null ? `단맛 ${o.brix}` : null, o.firmness != null ? `단단함 ${o.firmness} N` : null, o.acidity != null ? `신맛 ${o.acidity}%` : null].filter(Boolean).join(' · ') || '값 없음'}</li>)}</ul>
        : <p>아직 측정 기록이 없어요.</p>}
    </section>
    <p className="ma-foot">{p.weather ? '처음 품질은 날씨로 추정 · ' : ''}{fromMeasured ? '내가 잰 값부터 이어 계산 · ' : ''}시연용 계산 · 출하·안전 판정 아님 <button type="button" className="linkbtn" onClick={() => setEdit(true)}><Pencil size={13} aria-hidden="true" />사과 정보 수정</button></p>
    {measure && <MeasurementForm open lot={lot} isBaseline={false} hasBaseline={!!baselineObservation(lot, obs ?? [])} onClose={() => setMeasure(false)} onSaved={m => { setMeasure(false); setMsg(m); setN(x => x + 1); void reload(); }} />}
    {edit && <LotEditor open lot={lot} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); setMsg('사과 정보를 저장했어요.'); void reload(); }} />}
  </div>;
}
