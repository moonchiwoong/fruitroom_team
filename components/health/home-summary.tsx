'use client';
// 로그인 후 홈 ‘요약’: 보관 중인 사과 → 고른 사과의 오늘 계산값 4가지 → 한 줄 요약.
// 값은 lotPredictor(기존 식)만 씁니다. 작은 선도 그 식으로 계산한 0일~마지막 날 값입니다(예시 모양 없음).
import {useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import type {StorageItem} from '@/components/health/storage-3d';
import {josa} from '@/lib/josa';
import type {Lot, Observation} from '@/lib/lot-types';
import {lotPredictor, easyChange} from '@/lib/lot-predict';
import {isHongroVariety} from '@/lib/cultivar';
import {fmtNum, metricMeta, todayKST, type MetricId} from '@/lib/tracker';
import {storageStart, lotReadiness, weatherInitial} from '@/lib/lot-readiness';
import {daysBetween, isDate} from '@/lib/tracker';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import {applePhoto} from '@/lib/photos';
import {requestJson} from '@/components/lot-forms';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';

// 3D 저장고는 요약 화면에서만 따로 불러옵니다(서버 렌더링 없음).
const Storage3D = dynamic(() => import('@/components/health/storage-3d'), {ssr: false});
/** WebGL이 되고, 움직임 줄이기를 켜지 않은 기기에서만 3D를 보여 줍니다. */
function use3D() {
  const [ok, setOk] = useState(false);
  useEffect(() => { try { const c = document.createElement('canvas'); setOk(!!(c.getContext('webgl2') || c.getContext('webgl')) && !matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { setOk(false); } }, []);
  return ok;
}

const UNIT = (m: MetricId) => m === 'firmness' ? 'N' : metricMeta[m].unit;
const ORDER: MetricId[] = ['firmness', 'brix', 'acidity', 'loss'];
const dateLabel = () => new Date().toLocaleDateString('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long'});

export default function HomeSummary({lots, loaded, error, retry, openLot, newLot, name, openAccount}: {lots: Lot[]; loaded: boolean; error: string; retry: () => void; openLot: (id: string) => void; newLot: () => void; name: string; openAccount?: () => void}) {
  // 계산되는 사과(예측식이 있는 품종)를 앞에, 그다음 최근에 저장을 시작한 순서로 보여 줍니다.
  const active = useMemo(() => {
    const ok = (l: Lot) => { try { return lotPredictor(l, []).at('firmness', 0).ok || lotPredictor(l, []).at('loss', 0).ok ? 1 : 0; } catch { return 0; } };
    return lots.filter(l => !l.details?.archived_on).map(l => ({l, k: ok(l)})).sort((a, b) => b.k - a.k || storageStart(b.l).localeCompare(storageStart(a.l))).map(x => x.l);
  }, [lots]);
  const [selId, setSelId] = useState<string | null>(null);
  // 표와 요약 숫자: 측정 기록을 불러오지 않아도 되는 값만(저장 일수·무게 감소·마지막 측정·상태). 단단함 등은 오른쪽에서 측정 기록까지 반영해 보여 줍니다.
  const infos = useMemo(() => active.map(l => {
    let day: number | null = null, loss: number | null = null;
    try { const p = lotPredictor(l, []); day = p.todayDay; const r = day !== null && day >= 0 ? p.at('loss', day) : null; loss = r && r.ok ? r.value : null; } catch { /* 계산 없음 */ }
    const ready = lotReadiness(l), measured = !!(l.latest_observation || (l.initial_measured_on && !weatherInitial(l)));
    const last = l.latest_observation?.date ?? l.initial_measured_on ?? storageStart(l) ?? null;
    const since = last && isDate(last) ? daysBetween(last, todayKST()) : null;
    const prep = ready.status === 'unsupported' || ready.status === 'conditions';
    const status = prep ? '예측 준비 중' : ready.status === 'needs-initial' ? '처음 값 필요' : since !== null && since >= 21 ? '한 번 재 주세요' : '이상 없음';
    const tone = prep ? 'muted' : status === '이상 없음' ? 'ok' : 'warn';
    const rid = (l.details?.hongro?.source === 'weather' ? l.details.hongro.region ?? 'geochang' : l.details?.fuji_weather?.region ?? l.details?.region ?? '') as keyof typeof WEATHER_STATIONS;
    return {l, day, loss, since, measured, status, tone, region: WEATHER_STATIONS[rid]?.label ?? null};
  }), [active]);
  const lot = active.find(l => l.id === selId) ?? active[0] ?? null;
  const can3d = use3D();
  const items3d = useMemo<StorageItem[]>(() => infos.map(x => ({id: x.l.id, name: x.l.name || x.l.variety, variety: x.l.variety, hongro: isHongroVariety(x.l.variety), day: x.day, tone: x.tone as StorageItem['tone'], status: x.status, temp: x.l.details?.storage_temperature ?? null, qty: x.l.quantity ?? null, unit: x.l.details?.quantity_unit ?? null})), [infos]);
  return <div className="hs">
    <header className="hs-top"><div><p className="hs-date">{dateLabel()}</p><h1>요약</h1></div><button type="button" className="hs-avatar" aria-label="내 정보" onClick={openAccount}>{name.slice(0, 1) || '나'}</button></header>
    <div className="hs-sec"><h2>보관 중인 사과</h2><button type="button" className="hs-link" onClick={newLot}>+ 저장 시작</button></div>
    {!loaded ? <p className="hs-note" role="status">내 사과를 불러오는 중이에요…</p>
      : error ? <p className="hs-note" role="alert">{error} <button type="button" className="hs-link" onClick={retry}>다시 불러오기</button></p>
      : !active.length ? <div className="hs-card hs-empty"><b>아직 보관 중인 사과가 없어요.</b><p>저장을 시작한 사과를 등록하면 오늘 상태를 여기서 볼 수 있어요.</p><button type="button" className="hs-btn" onClick={newLot}>+ 저장 시작</button></div>
      : <>
        <Kpis infos={infos} />
        {can3d && <Storage3D items={items3d} onOpen={openLot} />}
        <div className="hs-dash">
        <section className="hs-table-wrap only-pc" aria-label="보관 중인 사과 한눈에"><table className="hs-table">
          <thead><tr><th>사과</th><th>저장</th><th>무게 감소 (오늘)</th><th>마지막 측정</th><th>상태</th></tr></thead>
          <tbody>{infos.map(x => <tr key={x.l.id} className={lot?.id === x.l.id ? 'on' : ''} onClick={() => setSelId(x.l.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelId(x.l.id); } }} tabIndex={0} aria-selected={lot?.id === x.l.id}>
            <td><b>{x.l.name || x.l.variety}</b><small>{[x.l.variety, x.region].filter(Boolean).join(' · ')}</small></td>
            <td className="hs-num">{x.day !== null && x.day >= 0 ? `${x.day}일` : '—'}</td>
            <td>{x.loss !== null ? <span className="hs-cell-spark"><b className="hs-num">{fmtNum(x.loss, 2)}%</b><LossSpark lot={x.l} day={x.day} /></span> : <small>계산 없음</small>}</td>
            <td>{x.since === null ? '—' : x.measured ? `${x.since}일 전` : '측정 없음'}</td>
            <td><span className={'hs-tag ' + x.tone}>{x.status}</span></td></tr>)}</tbody></table></section>
        <div className="hs-pick only-mobile"><div className="hs-apples" role="list">{active.map(l => <button key={l.id} type="button" role="listitem" className={'hs-apple' + (lot?.id === l.id ? ' on' : '')} aria-pressed={lot?.id === l.id} onClick={() => setSelId(l.id)}>
          <img src={applePhoto(l.id)} alt="" loading="lazy" /><b>{l.name || l.variety}</b><small><DayCount lot={l} /></small></button>)}</div></div>
        <div className="hs-today">{lot && <LotToday key={lot.id} lot={lot} openLot={openLot} />}</div>
        </div>
      </>}
  </div>;
}

function DayCount({lot}: {lot: Lot}) {
  const d = useMemo(() => { try { return lotPredictor(lot, []).todayDay; } catch { return null; } }, [lot]);
  return <>{lot.variety}{d !== null && d >= 0 ? <> · <span className="hs-num">{d}</span>일째</> : ''}</>;
}

function LotToday({lot, openLot}: {lot: Lot; openLot: (id: string) => void}) {
  const [obs, setObs] = useState<Observation[]>([]);
  useEffect(() => { let live = true; requestJson<{observations: Observation[]}>(`/api/lots/${lot.id}/analysis?asOf=${todayKST()}`).then(r => { if (live) setObs(r.observations ?? []); }).catch(() => { if (live) setObs([]); }); return () => { live = false; }; }, [lot.id]);
  const p = useMemo(() => { try { return lotPredictor(lot, obs); } catch { return null; } }, [lot, obs]);
  const maxDay = isHongroVariety(lot.variety || '') ? 120 : 200;
  if (!p) return <p className="hs-note">이 사과는 계산할 수 없어요.</p>;
  const today = p.todayDay !== null && p.todayDay >= 0 ? Math.min(p.todayDay, maxDay) : 0;
  const f = p.at('firmness', today);
  return <>
    <div className="hs-sec"><h2>{lot.name || lot.variety} · {p.todayDay !== null && p.todayDay > maxDay ? `${maxDay}일째(계산 끝)` : '오늘'}</h2><button type="button" className="hs-link" onClick={() => openLot(lot.id)}>자세히</button></div>
    <div className="hs-grid">{ORDER.map(m => <MetricCard key={m} m={m} p={p} day={today} maxDay={maxDay} onOpen={() => openLot(lot.id)} />)}</div>
    {f.ok && <><div className="hs-sec"><h2>한 줄 요약</h2></div>
      <div className="hs-card hs-hl"><span className="hs-lab" style={{color: METRIC_COLOR.firmness}}><MetricIcon m="firmness" />{METRIC_LABEL.firmness}</span>
        <p>{josa(lot.name || lot.variety, '은는')} 저장 {today}일째, {easyChange('firmness', f.value, f.first, p.weather)}.</p>
        {f.first !== null && <div className="hs-bars">
          <Bar label={p.weather ? '수확 때(추정)' : '처음'} v={f.first} max={Math.max(f.first, f.value)} color={METRIC_COLOR.firmness} />
          <Bar label="오늘(계산)" v={f.value} max={Math.max(f.first, f.value)} color="#C7C7CC" />
        </div>}
      </div></>}
    <p className="hs-src">기존 팀 계산식 결과 · 정확도 검증 전 · 출하·안전 판정 아님</p>
  </>;
}

function Bar({label, v, max, color}: {label: string; v: number; max: number; color: string}) {
  return <div className="hs-bar"><span className="hs-num">{fmtNum(v, 1)}</span><div><i style={{width: `${Math.max(4, v / max * 100)}%`, background: color}} /><small>{label}</small></div></div>;
}

function MetricCard({m, p, day, maxDay, onOpen}: {m: MetricId; p: NonNullable<ReturnType<typeof lotPredictor>>; day: number; maxDay: number; onOpen: () => void}) {
  const r = p.at(m, day);
  const pts = useMemo(() => { const a: {d: number; v: number}[] = []; for (let d = 0; d <= maxDay; d += 5) { const x = p.at(m, d); if (x.ok) a.push({d, v: x.value}); } return a; }, [p, m, maxDay]);
  const W = 92, H = 40;
  const lo = Math.min(...pts.map(x => x.v)), hi = Math.max(...pts.map(x => x.v)), span = hi - lo || 1;
  const X = (d: number) => 3 + (W - 6) * d / maxDay, Y = (v: number) => 4 + (H - 8) * (1 - (v - lo) / span);
  const path = pts.map((x, i) => `${i && pts[i - 1].d === x.d - 5 ? 'L' : 'M'}${X(x.d).toFixed(1)},${Y(x.v).toFixed(1)}`).join('');
  return <button type="button" className="hs-card hs-metric" onClick={onOpen}>
    <span className="hs-lab" style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}<em>오늘 ›</em></span>
    <span className={'hs-val' + (r.ok ? '' : ' na')}>{r.ok ? <><b className="hs-num">{fmtNum(r.value, metricMeta[m].digits)}</b><small>{UNIT(m)}</small></> : <><b className="hs-na">계산 없음</b><small title={r.reason}>{r.reason}</small></>}</span>
    {pts.length > 1 && <svg className="hs-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={path} fill="none" stroke={METRIC_COLOR[m]} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />{r.ok && <circle cx={X(day)} cy={Y(r.value)} r="4" fill={METRIC_COLOR[m]} stroke="#fff" strokeWidth="2" />}</svg>}
  </button>;
}

function Kpis({infos}: {infos: {day: number | null; status: string}[]}) {
  const days = infos.map(x => x.day).filter((d): d is number => d !== null && d >= 0);
  const k = [
    {label: '보관 중', value: `${infos.length}`, unit: '건'},
    {label: '평균 저장', value: days.length ? `${Math.round(days.reduce((a, b) => a + b, 0) / days.length)}` : '—', unit: '일'},
    {label: '한 번 재 볼 사과', value: `${infos.filter(x => x.status === '한 번 재 주세요' || x.status === '처음 값 필요').length}`, unit: '건', warn: true},
    {label: '예측 준비 중', value: `${infos.filter(x => x.status === '예측 준비 중').length}`, unit: '건'},
  ];
  return <div className="hs-kpis">{k.map(x => <div key={x.label} className={'hs-kpi' + (x.warn && x.value !== '0' ? ' warn' : '')}><span>{x.label}</span><b className="hs-num">{x.value}<small>{x.unit}</small></b></div>)}</div>;
}

/** 표 안의 작은 무게 감소 선(0일~오늘, 기존 식 계산값). */
function LossSpark({lot, day}: {lot: Lot; day: number | null}) {
  const pts = useMemo(() => { if (day === null || day <= 0) return []; try { const p = lotPredictor(lot, []); const a: [number, number][] = []; for (let d = 0; d <= day; d += Math.max(1, Math.round(day / 20))) { const r = p.at('loss', d); if (r.ok) a.push([d, r.value]); } return a; } catch { return []; } }, [lot, day]);
  if (pts.length < 2) return null;
  const hi = Math.max(...pts.map(x => x[1])) || 1, W = 64, H = 20;
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><path d={pts.map((x, i) => `${i ? 'L' : 'M'}${(x[0] / day! * (W - 2) + 1).toFixed(1)},${(H - 2 - x[1] / hi * (H - 4)).toFixed(1)}`).join('')} fill="none" stroke={METRIC_COLOR.loss} strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
