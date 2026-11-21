'use client';
// 로그인 후 홈 ‘요약’: 보관 중인 사과 → 고른 사과의 오늘 계산값 4가지 → 한 줄 요약.
// 값은 lotPredictor(기존 식)만 씁니다. 작은 선도 그 식으로 계산한 0일~마지막 날 값입니다(예시 모양 없음).
import {useEffect, useMemo, useState} from 'react';
import {josa} from '@/lib/josa';
import type {Lot, Observation} from '@/lib/lot-types';
import {lotPredictor, easyChange} from '@/lib/lot-predict';
import {isHongroVariety} from '@/lib/cultivar';
import {fmtNum, metricMeta, todayKST, type MetricId} from '@/lib/tracker';
import {storageStart} from '@/lib/lot-readiness';
import {applePhoto} from '@/lib/photos';
import {requestJson} from '@/components/lot-forms';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';

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
  const lot = active.find(l => l.id === selId) ?? active[0] ?? null;
  return <div className="hs">
    <header className="hs-top"><div><p className="hs-date">{dateLabel()}</p><h1>요약</h1></div><button type="button" className="hs-avatar" aria-label="내 정보" onClick={openAccount}>{name.slice(0, 1) || '나'}</button></header>
    <div className="hs-sec"><h2>보관 중인 사과</h2><button type="button" className="hs-link" onClick={newLot}>+ 저장 시작</button></div>
    {!loaded ? <p className="hs-note" role="status">내 사과를 불러오는 중이에요…</p>
      : error ? <p className="hs-note" role="alert">{error} <button type="button" className="hs-link" onClick={retry}>다시 불러오기</button></p>
      : !active.length ? <div className="hs-card hs-empty"><b>아직 보관 중인 사과가 없어요.</b><p>저장을 시작한 사과를 등록하면 오늘 상태를 여기서 볼 수 있어요.</p><button type="button" className="hs-btn" onClick={newLot}>+ 저장 시작</button></div>
      : <>
        <div className="hs-apples" role="list">{active.map(l => <button key={l.id} type="button" role="listitem" className={'hs-apple' + (lot?.id === l.id ? ' on' : '')} aria-pressed={lot?.id === l.id} onClick={() => setSelId(l.id)}>
          <img src={applePhoto(l.id)} alt="" loading="lazy" /><b>{l.name || l.variety}</b><small><DayCount lot={l} /></small></button>)}</div>
        {lot && <LotToday key={lot.id} lot={lot} openLot={openLot} />}
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
      <div className="hs-card hs-hl"><span className="hs-lab" style={{color: METRIC_COLOR.firmness}}><MetricIcon m="firmness" />경도</span>
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
