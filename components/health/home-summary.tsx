'use client';
// 로그인 후 홈 ‘요약’: 보관 중인 사과 → 고른 사과의 오늘 계산값 4가지 → 한 줄 요약.
// 값은 lotPredictor(기존 식)만 씁니다. 작은 선도 그 식으로 계산한 0일~마지막 날 값입니다(예시 모양 없음).
import {useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import type {StorageItem} from '@/components/health/storage-3d';
import {josa} from '@/lib/josa';
import type {Lot, Observation} from '@/lib/lot-types';
import {lotPredictor, easyChange, latestObservation} from '@/lib/lot-predict';
import {isHongroVariety} from '@/lib/cultivar';
import {fmtNum, metricMeta, todayKST, type MetricId} from '@/lib/tracker';
import {storageStart, lotReadiness, weatherInitial} from '@/lib/lot-readiness';
import {daysBetween, isDate} from '@/lib/tracker';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import {applePhoto} from '@/lib/photos';
import {requestJson} from '@/components/lot-forms';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';
import AppleAuctionCard from '@/components/health/apple-auction-card';
import {lotRegionId} from '@/lib/lot-region';

// 3D 저장고는 요약 화면에서만 따로 불러옵니다(서버 렌더링 없음).
const Storage3D = dynamic(() => import('@/components/health/storage-3d'), {ssr: false});
/** WebGL이 되고, 움직임 줄이기를 켜지 않은 기기에서만 3D를 보여 줍니다. */
function use3D() {
  const [ok, setOk] = useState(false);
  useEffect(() => { try { const c = document.createElement('canvas'); setOk(!!(c.getContext('webgl2') || c.getContext('webgl')) && !matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { setOk(false); } }, []);
  return ok;
}

function useWide() {
  const [w, setW] = useState(false);
  useEffect(() => { const m = matchMedia('(min-width: 1001px)'); const f = () => setW(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return w;
}

/** 숫자의 출처: 오늘 잰 값 / 최근 측정값에서 계산 / 날씨 추정에서 계산 / 처음 값에서 계산 */
const srcLabel = (from: string, measuredToday: boolean) => measuredToday && from === 'measured' ? '오늘 실측' : from === 'measured' ? '측정값부터 계산' : from === 'weather' ? '날씨 추정에서 계산' : '계산';

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
    // 상태는 ‘측정 주기’만 봅니다: 마지막 측정(없으면 저장 시작)부터 21일이 지나면 ‘한 번 재 주세요’. 품질의 좋고 나쁨은 판정하지 않습니다.
    const due = since !== null && since >= 21;
    const status = prep ? '예측 준비 중' : ready.status === 'needs-initial' ? '처음 값 필요' : due ? '한 번 재 주세요' : since === null ? '측정 주기 확인 불가' : measured ? `최근 측정 ${since}일 전` : `측정 전 · ${since}일째`;
    const tone = prep ? 'muted' : ready.status === 'needs-initial' || due ? 'warn' : 'ok';
    const rid = (l.details?.hongro?.source === 'weather' ? l.details.hongro.region ?? 'geochang' : l.details?.fuji_weather?.region ?? l.details?.region ?? '') as keyof typeof WEATHER_STATIONS;
    return {l, day, loss, since, measured, status, tone, region: WEATHER_STATIONS[rid]?.label ?? null};
  }), [active]);
  const lot = active.find(l => l.id === selId) ?? active[0] ?? null;
  const can3d = use3D();
  // PC(넓은 화면)는 맨 위에 바로, 휴대폰은 오늘 품질 카드 아래에서 버튼을 눌렀을 때만 3D를 불러옵니다.
  const wide = useWide(), [open3d, setOpen3d] = useState(false);
  const items3d = useMemo<StorageItem[]>(() => infos.map(x => ({id: x.l.id, name: x.l.name || x.l.variety, variety: x.l.variety, hongro: isHongroVariety(x.l.variety), day: x.day, tone: x.tone as StorageItem['tone'], status: x.status, temp: x.l.details?.storage_temperature ?? null, qty: x.l.quantity ?? null, unit: x.l.details?.quantity_unit ?? null})), [infos]);
  return <div className="hs">
    <header className="hs-top"><div><p className="hs-date">{dateLabel()}</p><h1>요약</h1></div><button type="button" className="hs-avatar" aria-label="내 정보" onClick={openAccount}>{name.slice(0, 1) || '나'}</button></header>
    <div className="hs-sec"><h2>보관 중인 사과</h2>{loaded && !error && active.length > 0 && <button type="button" className="hs-link" onClick={newLot}>+ 저장 시작</button>}</div>
    {!loaded ? <p className="hs-note" role="status">내 사과를 불러오는 중이에요…</p>
      : error ? <p className="hs-note" role="alert">{error} <button type="button" className="hs-link" onClick={retry}>다시 불러오기</button></p>
      : !active.length ? <div className="hs-card hs-start">
        <div className="hs-start-head"><b>아직 보관 중인 사과가 없어요</b><p>저장고에 넣은 사과를 등록하면 이 화면에서 오늘 상태를 바로 볼 수 있어요.</p></div>
        <ol className="hs-steps">
          <li><span className="hs-num">1</span><div><b>사과 등록</b><small>품종·산지·저장 시작일</small></div></li>
          <li><span className="hs-num">2</span><div><b>처음 측정</b><small>단단함·단맛·신맛·무게</small></div></li>
          <li><span className="hs-num">3</span><div><b>오늘 상태 확인</b><small>저장 일수별 계산값과 경매가</small></div></li>
        </ol>
        <div className="hs-start-actions"><button type="button" className="hs-btn" onClick={newLot}>+ 저장 시작</button><a className="hs-link" href="/try">예시 사과로 먼저 둘러보기 ›</a></div>
      </div>
      : <>
        <Kpis infos={infos} />
        {can3d && wide && <Storage3D items={items3d} onOpen={openLot} />}
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
    {loaded && <AppleAuctionCard region={lot ? lotRegionId(lot) : null} variety={lot?.variety} />}
    {loaded && !error && active.length > 0 && can3d && !wide && (open3d ? <Storage3D items={items3d} onOpen={openLot} /> : <button type="button" className="s3d-open" onClick={() => setOpen3d(true)}><b>내 저장고 3D로 보기</b><small>보관 중인 사과를 저장고 모습으로 봐요</small></button>)}
  </div>;
}

function DayCount({lot}: {lot: Lot}) {
  const d = useMemo(() => { try { return lotPredictor(lot, []).todayDay; } catch { return null; } }, [lot]);
  return <>{lot.variety}{d !== null && d >= 0 ? <> · <span className="hs-num">{d}</span>일째</> : ''}</>;
}

function LotToday({lot, openLot}: {lot: Lot; openLot: (id: string) => void}) {
  const [obs, setObs] = useState<Observation[] | null>(null), [obsErr, setObsErr] = useState(false);
  useEffect(() => {
    // 사과가 바뀌면 이전 사과의 기록을 지우고, 늦게 도착한 이전 요청은 무시합니다.
    let live = true; setObs(null); setObsErr(false);
    requestJson<{observations: Observation[]}>(`/api/lots/${lot.id}/analysis?asOf=${todayKST()}`).then(r => { if (live) setObs(r.observations ?? []); }).catch(() => { if (live) { setObs([]); setObsErr(true); } });
    return () => { live = false; };
  }, [lot.id, lot.latest_observation?.date, lot.latest_observation?.firmness]);
  const p = useMemo(() => { if (obs === null) return null; try { return lotPredictor(lot, obs); } catch { return null; } }, [lot, obs]);
  
  const maxDay = isHongroVariety(lot.variety || '') ? 120 : 200;
  if (obs === null) return <p className="hs-note" role="status">측정 기록 확인 중…</p>;
  if (!p) return <p className="hs-note">이 사과는 계산할 수 없어요.</p>;
  const today = p.todayDay !== null && p.todayDay >= 0 ? Math.min(p.todayDay, maxDay) : 0;
  // 한 줄 요약: 처음보다 가장 많이 변한 항목(변화율 %, 무게 감소는 줄어든 % 그대로). 같으면 단단함→단맛→신맛→무게 순.
  const change = (m: MetricId) => { const r = p.at(m, today); if (!r.ok) return -1; if (m === 'loss') return Math.abs(r.value); return r.first ? Math.abs((r.value - r.first) / r.first * 100) : -1; };
  const hm = ORDER.reduce<MetricId | null>((best, m) => change(m) < 0 ? best : best === null || change(m) > change(best) ? m : best, null);
  const f = hm ? p.at(hm, today) : p.at('firmness', today);
  return <>
    <div className="hs-sec"><h2>{lot.name || lot.variety} · {p.todayDay !== null && p.todayDay > maxDay ? `${maxDay}일째(계산 끝)` : '오늘'}</h2><button type="button" className="hs-link" onClick={() => openLot(lot.id)}>자세히</button></div>
    {(() => {
      // 계산할 수 없는 항목은 빈 카드 여러 장 대신 한 장으로 모아 보여 줍니다.
      const ready = ORDER.filter(m => p.at(m, today).ok), missing = ORDER.filter(m => !p.at(m, today).ok);
      const reasons = [...new Set(missing.map(m => p.at(m, today)).map(r => (r.ok ? '' : r.reason) || '계산에 필요한 값이 없어요.'))];
      const none = <div className={'hs-card hs-none' + (ready.length ? ' slim' : '')}>
        <b>{ready.length ? `${josa(missing.map(m => METRIC_LABEL[m]).join('·'), '은는')} 아직 계산 없음` : '아직 계산할 수 있는 값이 없어요'}</b>
        <ul>{reasons.map(x => <li key={x}>{x}</li>)}</ul>
        {!ready.length && <button type="button" className="hs-btn" onClick={() => openLot(lot.id)}>측정 기록 넣으러 가기</button>}
      </div>;
      return <>
        {ready.length > 0 && <div className="hs-grid">{ready.map(m => <MetricCard key={m} m={m} p={p} day={today} maxDay={maxDay} measuredToday={m !== 'loss' && today === p.todayDay && !obsErr && !!latestObservation(obs, m, todayKST())} onOpen={() => openLot(lot.id)} />)}</div>}
        {missing.length > 0 && none}
      </>;
    })()}
    {obsErr && <p className="hs-note warn" role="alert">측정 기록을 불러오지 못해 실측을 반영하지 않은 계산값이에요. 잠시 뒤 다시 열어 주세요.</p>}
    {hm && f.ok && <><div className="hs-sec hs-sum-h"><h2>한 줄 요약</h2></div>
      <div className="hs-card hs-hl"><span className="hs-lab" style={{color: METRIC_COLOR[hm]}}><MetricIcon m={hm} />{METRIC_LABEL[hm]}<small className="hs-why">처음보다 가장 많이 변한 항목</small></span>
        <p>{josa(lot.name || lot.variety, '은는')} 저장 {today}일째, {hm === 'loss' ? `무게가 약 ${fmtNum(f.value, 1)}% 줄었어요` : `${METRIC_LABEL[hm]} ${easyChange(hm, f.value, f.first, p.weather)}`}.</p>
        {hm !== 'loss' && f.first !== null && <div className="hs-bars">
          <Bar label={p.weather ? '수확 때(추정)' : '처음'} v={f.first} max={Math.max(f.first, f.value)} color={METRIC_COLOR[hm]} digits={metricMeta[hm].digits} />
          <Bar label={f.from === 'measured' && today === p.todayDay && latestObservation(obs, hm, todayKST()) ? '오늘 실측' : f.from === 'measured' ? '오늘(측정값부터 계산)' : '오늘(계산)'} v={f.value} max={Math.max(f.first, f.value)} color="#C7C7CC" digits={metricMeta[hm].digits} />
        </div>}
      </div></>}
    {ORDER.some(m => p.at(m, today).ok) && <p className="hs-src">기존 팀 계산식 결과 · 정확도 검증 전 · 출하·안전 판정 아님</p>}
  </>;
}

function Bar({label, v, max, color, digits = 1}: {label: string; v: number; max: number; color: string; digits?: number}) {
  return <div className="hs-bar"><span className="hs-num">{fmtNum(v, digits)}</span><div><i style={{width: `${Math.max(4, v / max * 100)}%`, background: color}} /><small>{label}</small></div></div>;
}

function MetricCard({m, p, day, maxDay, measuredToday, onOpen}: {m: MetricId; p: NonNullable<ReturnType<typeof lotPredictor>>; day: number; maxDay: number; measuredToday: boolean; onOpen: () => void}) {
  const r = p.at(m, day);
  const pts = useMemo(() => { const a: {d: number; v: number}[] = []; for (let d = 0; d <= maxDay; d += 5) { const x = p.at(m, d); if (x.ok) a.push({d, v: x.value}); } return a; }, [p, m, maxDay]);
  const W = 92, H = 40;
  const lo = Math.min(...pts.map(x => x.v)), hi = Math.max(...pts.map(x => x.v)), span = hi - lo || 1;
  const X = (d: number) => 3 + (W - 6) * d / maxDay, Y = (v: number) => 4 + (H - 8) * (1 - (v - lo) / span);
  const path = pts.map((x, i) => `${i && pts[i - 1].d === x.d - 5 ? 'L' : 'M'}${X(x.d).toFixed(1)},${Y(x.v).toFixed(1)}`).join('');
  return <button type="button" className="hs-card hs-metric" onClick={onOpen}>
    <span className="hs-lab" style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}<em>오늘 ›</em></span>
    <span className={'hs-val' + (r.ok ? '' : ' na')}>{r.ok ? <><b className="hs-num">{fmtNum(r.value, metricMeta[m].digits)}</b><small>{UNIT(m)}</small><i className="hs-from">{srcLabel(r.from, measuredToday)}</i></> : <><b className="hs-na">계산 없음</b><small title={r.reason}>{r.reason}</small></>}</span>
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
