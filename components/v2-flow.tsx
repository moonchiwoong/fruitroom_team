'use client';
// 새 화면 시안: 남한 지도에서 지역 → (확대) 내 저장고 → 사과 하나를 가운데 둔 결과.
// 개인 기록은 로그인한 본인 것만(/api/lots) 보여 줍니다. 계산은 기존 lotPredictor만 씁니다(새 식·보정 없음).
// 지도 도형: svg-maps/south-korea (CC BY 4.0, https://github.com/VictorCazanave/svg-maps)
import './v2-flow.css';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import southKoreaRaw from '@svg-maps/south-korea';
import type {Lot, Observation} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {lotPredictor} from '@/lib/lot-predict';
import {isHongroVariety} from '@/lib/cultivar';
import {fmtNum, metricMeta, addDays, todayKST} from '@/lib/tracker';
import {PROFILE_REGIONS, type ProfileRegion} from '@/lib/profile-regions';
import {AppleGraph} from '@/components/apple-graph';
import {useTeamSession} from '@/components/team-auth';

const southKorea = southKoreaRaw as unknown as {viewBox: string; locations: {id: string; name: string; path: string}[]};
const QualityAppleViewer = dynamic(() => import('@/components/quality-apple-viewer'), {ssr: false, loading: () => <div className="v2-apple-empty">3D 사과를 불러오는 중…</div>});

// 예측식이 있는 4곳. 좌표는 지도(viewBox 0 0 524 631) 위 대략적인 군청 위치입니다.
const PINS: Record<ProfileRegion, {x: number; y: number; province: string; left?: boolean}> = {
  geochang: {x: 239, y: 337, province: 'south-gyeongsang'},
  jangsu: {x: 202, y: 344, province: 'north-jeolla', left: true},
  cheongsong: {x: 346, y: 254, province: 'north-gyeongsang'},
  yeongju: {x: 305, y: 212, province: 'north-gyeongsang'},
};
const FULL = [0, 0, 524, 631] as const;
const zoomBox = (r: ProfileRegion) => { const p = PINS[r]; return [p.x - 95, p.y - 70, 190, 140] as const; };
const nameOf = (r: ProfileRegion) => PROFILE_REGIONS.find(x => x.id === r)?.name ?? r;

/** 물량이 어느 지역 것인지: 홍로 식 → 거창, 후지 날씨 추정 → 그 지역, 아니면 저장된 지역 이름으로 찾습니다. */
function lotRegion(l: Lot): ProfileRegion | null {
  const d = l.details ?? {};
  if (d.hongro?.region === 'geochang') return 'geochang';
  if (d.fuji_weather?.region) return d.fuji_weather.region;
  const s = (d.region ?? '').trim();
  return PROFILE_REGIONS.find(r => r.id === s || r.name === s)?.id ?? null;
}

const UNIT = (m: string) => m === 'firmness' ? 'N' : metricMeta[m as 'brix'].unit;
const LABEL: Record<string, string> = {firmness: '경도', brix: '당도', acidity: '산도', loss: '감모율'};

export default function V2Flow() {
  const session = useTeamSession();
  const [lots, setLots] = useState<Lot[] | null>(null), [err, setErr] = useState('');
  const [region, setRegion] = useState<ProfileRegion | null>(null), [lotId, setLotId] = useState<string | null>(null);
  useEffect(() => { requestJson<{lots: Lot[]}>('/api/lots').then(d => setLots(d.lots.filter(l => !l.details?.archived_on && !(l.owner_id && session?.userId && l.owner_id !== session.userId)))).catch(e => { setErr((e as Error).message); setLots([]); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const counts = useMemo(() => { const c: Partial<Record<ProfileRegion, number>> = {}; for (const l of lots ?? []) { const r = lotRegion(l); if (r) c[r] = (c[r] ?? 0) + 1; } return c; }, [lots]);
  const unassigned = useMemo(() => (lots ?? []).filter(l => !lotRegion(l)), [lots]);
  const lot = lots?.find(l => l.id === lotId) ?? null;
  const step = lot ? 3 : region ? 2 : 1;
  const back = () => { if (lot) setLotId(null); else setRegion(null); };
  return <div className="v2">
    <header className="v2-top">
      {step > 1 ? <button type="button" className="v2-back" onClick={back}>← {step === 3 ? '내 저장고' : '지도'}</button> : <strong>애플트랙</strong>}
      <span className="v2-crumb">{[region ? nameOf(region) : '지역 선택', region && '내 저장고', lot?.name].filter(Boolean).join(' › ')}</span>
      <a className="v2-old" href="/">기존 화면</a>
    </header>
    <p className="v2-preview">새 화면 미리보기 · {session?.displayName ? `${session.displayName}님 기록만 표시` : '본인 기록만 표시'}</p>
    <RegionMap region={step === 3 ? region : region} counts={counts} onPick={r => { setRegion(r); setLotId(null); }} compact={step === 3} />
    {step === 1 && <section className="v2-pad">
      <h1>저장고가 있는 지역을 누르세요</h1>
      <p className="v2-legend"><b className="v2-dot" /> 예측식이 있는 4곳 · 회색 지역은 아직 예측 준비 중</p>
      {err && <p className="v2-err">사과 목록을 불러오지 못했어요: {err}</p>}
      {unassigned.length > 0 && <div className="v2-list"><p className="v2-k">지역이 정해지지 않은 사과 {unassigned.length}건</p>{unassigned.map(l => <LotRow key={l.id} lot={l} onOpen={() => { setRegion(null); setLotId(l.id); }} />)}</div>}
    </section>}
    {step === 2 && region && <section className="v2-pad">
      <p className="v2-k">내 저장고 · {nameOf(region)}</p>
      <h1>{lots === null ? '불러오는 중…' : `저장 중인 사과 ${counts[region] ?? 0}건`}</h1>
      <div className="v2-list">{(lots ?? []).filter(l => lotRegion(l) === region).map(l => <LotRow key={l.id} lot={l} onOpen={() => setLotId(l.id)} />)}</div>
      {lots !== null && !counts[region] && <p className="v2-empty">이 지역에 등록한 사과가 없어요.</p>}
      <a className="v2-btn" href="/#lots">+ 사과 등록 (기존 화면에서)</a>
      <p className="v2-note">로그인한 본인이 등록한 사과만 보여요. 다른 농가 기록은 보이지 않아요.</p>
    </section>}
    {step === 3 && lot && <AppleCenter lot={lot} />}
    <p className="v2-credit">지도: svg-maps (CC BY 4.0)</p>
  </div>;
}

function RegionMap({region, counts, onPick, compact}: {region: ProfileRegion | null; counts: Partial<Record<ProfileRegion, number>>; onPick: (r: ProfileRegion) => void; compact: boolean}) {
  const target = region ? zoomBox(region) : FULL;
  const [box, setBox] = useState<readonly number[]>(target);
  const cur = useRef<readonly number[]>(target);
  useEffect(() => {
    const from = cur.current, to = target;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { cur.current = to; setBox(to); return; }
    let raf = 0; const t0 = performance.now(), dur = 500;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); const b = from.map((v, i) => v + (to[i] - v) * e); cur.current = b; setBox(b); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);
  const scale = box[2] / 524; // 확대될수록 핀·글자를 작게 그려 화면 크기를 유지
  const active = new Set(Object.values(PINS).map(p => p.province));
  return <div className={`v2-map ${region ? 'zoomed' : ''} ${compact ? 'compact' : ''}`}>
    <svg viewBox={box.map(v => v.toFixed(2)).join(' ')} preserveAspectRatio="xMidYMid meet" role="img" aria-label="남한 지도">
      {southKorea.locations.map(l => <path key={l.id} d={l.path} className={active.has(l.id) ? 'prov on' : 'prov'} />)}
      {(Object.keys(PINS) as ProfileRegion[]).map(r => { const p = PINS[r]; const sel = region === r;
        return <g key={r} className={`pin ${sel ? 'sel' : ''}`} role="button" tabIndex={0} aria-label={`${nameOf(r)} 저장고 보기`} onClick={() => onPick(r)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r); } }}>
          <circle cx={p.x} cy={p.y} r={34 * scale} className="hit" />
          <circle cx={p.x} cy={p.y} r={(sel ? 13 : 11) * scale} strokeWidth={4 * scale} />
          <text x={p.left ? p.x - 17 * scale : p.x + 17 * scale} y={p.y + 8 * scale} fontSize={24 * scale} textAnchor={p.left ? 'end' : 'start'}>{nameOf(r)}{counts[r] ? ` ${counts[r]}` : ''}</text>
        </g>; })}
    </svg>
  </div>;
}

function LotRow({lot, onOpen}: {lot: Lot; onOpen: () => void}) {
  const p = useMemo(() => { try { return lotPredictor(lot, []); } catch { return null; } }, [lot]);
  const day = p?.todayDay;
  return <button type="button" className="v2-row" onClick={onOpen}>
    <span className="v2-row-main"><b>{lot.name || lot.variety}</b><small>{[lot.variety, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null, lot.observation_count ? `실측 ${lot.observation_count}회` : '실측 없음'].filter(Boolean).join(' · ')}</small></span>
    <span className="v2-row-day">{day !== null && day !== undefined && day >= 0 ? `${day}일째` : '—'}</span><span aria-hidden="true">›</span>
  </button>;
}

function AppleCenter({lot}: {lot: Lot}) {
  const [obs, setObs] = useState<Observation[]>([]);
  useEffect(() => { let live = true; requestJson<{observations: Observation[]}>(`/api/lots/${lot.id}/analysis?asOf=${todayKST()}`).then(r => { if (live) setObs(r.observations ?? []); }).catch(() => { if (live) setObs([]); }); return () => { live = false; }; }, [lot.id]);
  const p = useMemo(() => { try { return lotPredictor(lot, obs); } catch { return null; } }, [lot, obs]);
  const p0 = useMemo(() => { if (!obs.length) return null; try { return lotPredictor(lot, []); } catch { return null; } }, [lot, obs]);
  const hongro = isHongroVariety(lot.variety || ''), maxDay = hongro ? 120 : 200;
  const today = p?.todayDay ?? null, base = today !== null && today >= 0 && today <= maxDay ? today : 0;
  const [add, setAdd] = useState(0);
  const sel = Math.min(maxDay, base + add);
  const metrics = useCallback((day: number) => Object.fromEntries((['firmness', 'brix', 'acidity', 'loss'] as const).map(k => { const r = p!.at(k, day); return [k, r.ok ? {ok: true, value: r.value, unit: UNIT(k), kind: '모델 계산'} : {ok: false, value: null, unit: UNIT(k), reason: r.reason}]; })) as Record<'firmness' | 'brix' | 'acidity' | 'loss', {ok: boolean; value: number | null; unit: string; kind?: string; reason?: string}>, [p]);
  if (!p) return <section className="v2-pad"><p className="v2-err">이 사과는 계산할 수 없어요.</p></section>;
  const m = metrics(sel);
  const steps = [0, 30, 60].filter(a => base + a <= maxDay);
  return <section className="v2-center">
    <div className="v2-pad"><p className="v2-k">{[lot.variety, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null].filter(Boolean).join(' · ')}</p>
      <h1>{lot.name || lot.variety} · 저장 {sel}일째</h1>
      {p.start && <p className="v2-date">{addDays(p.start, sel)} 기준 계산값</p>}</div>
    <div className="v2-stage">
      <div className="v2-apple"><QualityAppleViewer bare day={sel} cultivar={lot.variety || ''} metrics={m} /></div>
      {(['firmness', 'brix', 'acidity', 'loss'] as const).map((k, i) => <div key={k} className={`v2-metric c${i}`}><span>{LABEL[k]}</span>{m[k].ok && m[k].value !== null ? <b>{fmtNum(m[k].value!, metricMeta[k].digits)}<small> {m[k].unit}</small></b> : <b className="na" title={m[k].reason}>계산 없음</b>}</div>)}
    </div>
    <div className="v2-pad">
      <div className="v2-seg" role="group" aria-label="날짜">{steps.map(a => <button key={a} type="button" aria-pressed={add === a} className={add === a ? 'on' : ''} onClick={() => setAdd(a)}>{a === 0 ? (base === today ? '오늘' : `${base}일`) : `+${a}일`}</button>)}</div>
      <AppleGraph p={p} p0={p0} obs={obs} sel={sel} maxDay={maxDay} />
      <p className="v2-note">기존 팀 계산식 결과 · 정확도 검증 전 · 출하·안전 판정 아님. 기록 수정·측정 추가는 <a href="/#lots">기존 화면</a>에서 할 수 있어요.</p>
    </div>
  </section>;
}
