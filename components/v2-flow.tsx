'use client';
// 새 화면 시안: 남한 지도에서 지역 → (확대) 내 저장고 → 사과 하나를 가운데 둔 결과.
// 개인 기록은 로그인한 본인 것만(/api/lots) 보여 줍니다. 계산은 기존 lotPredictor만 씁니다(새 식·보정 없음).
// 지도 도형: svg-maps/south-korea (CC BY 4.0, https://github.com/VictorCazanave/svg-maps)
import './v2-flow.css';
import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent} from 'react';
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
import {compareShipping, type ShipInput} from '@/lib/ship-compare';

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

const NewApple = dynamic(() => import('@/components/new-apple'), {ssr: false, loading: () => <div className="v2-apple-empty">입력 화면을 여는 중…</div>});

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => { const q = window.matchMedia('(min-width: 900px)'); const f = () => setWide(q.matches); f(); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, []);
  return wide;
}

type View = 'list' | 'apple' | 'map' | 'new';
export default function V2Flow() {
  const session = useTeamSession(), wide = useWide();
  const [lots, setLots] = useState<Lot[] | null>(null), [err, setErr] = useState('');
  const [view, setView] = useState<View>('list'), [lotId, setLotId] = useState<string | null>(null), [newRegion, setNewRegion] = useState<ProfileRegion | null>(null);
  const reload = useCallback(async () => {
    try { const d = await requestJson<{lots: Lot[]}>('/api/lots'); const mine = d.lots.filter(l => !l.details?.archived_on && !(l.owner_id && session?.userId && l.owner_id !== session.userId)); setLots(mine); setErr(''); return mine; }
    catch (e) { setErr((e as Error).message); setLots([]); return [] as Lot[]; }
  }, [session?.userId]);
  useEffect(() => { void reload(); }, [reload]);
  // PC에서는 목록 옆에 결과를 늘 보여 주므로, 고른 사과가 없으면 첫 사과를 보여 줍니다.
  const lot = lots?.find(l => l.id === lotId) ?? (wide && view === 'list' ? lots?.[0] ?? null : null);
  const shown: View = view === 'list' && lot && wide ? 'apple' : view;
  const open = (id: string) => { setLotId(id); setView('apple'); window.scrollTo({top: 0}); };
  const start = () => { setNewRegion(null); setView('map'); window.scrollTo({top: 0}); };
  const crumb = shown === 'map' ? '저장 시작 › 지역 고르기' : shown === 'new' ? `저장 시작 › ${newRegion ? nameOf(newRegion) : ''}` : shown === 'apple' && lot ? `내 사과 › ${lot.name || lot.variety}` : '내 사과';
  return <div className="v2" data-view={shown}>
    <header className="v2-top">
      {shown !== 'list' && !wide ? <button type="button" className="v2-back" onClick={() => setView(shown === 'new' ? 'map' : 'list')}>← {shown === 'new' ? '지도' : '내 사과'}</button> : <strong>애플트랙</strong>}
      <span className="v2-crumb">{crumb}</span>
      <a className="v2-old" href="/">기존 화면</a>
    </header>
    <p className="v2-preview">새 화면 미리보기 · {session?.displayName ? `${session.displayName}님 기록만 표시` : '본인 기록만 표시'}</p>
    <div className="v2-body">
      <aside className="v2-side">
        <div className="v2-pad">
          <button type="button" className="v2-btn solid" onClick={start}>+ 저장 시작하기</button>
          <h1>{lots === null ? '불러오는 중…' : `내가 보관 중인 사과 ${lots.length}건`}</h1>
          {err && <p className="v2-err">사과 목록을 불러오지 못했어요: {err}</p>}
          <div className="v2-list">{(lots ?? []).map(l => <LotRow key={l.id} lot={l} active={shown === 'apple' && lot?.id === l.id} onOpen={() => open(l.id)} />)}</div>
          {lots !== null && !lots.length && !err && <p className="v2-empty">아직 보관 중인 사과가 없어요. ‘저장 시작하기’로 첫 사과를 등록하세요.</p>}
          <p className="v2-note">로그인한 본인이 등록한 사과만 보여요. 다른 농가 기록은 보이지 않아요.</p>
        </div>
      </aside>
      <main className="v2-main">
        {shown === 'map' && <section>
          <div className="v2-pad"><p className="v2-k">저장 시작 1/2</p><h1>어느 지역 사과인가요?</h1></div>
          <RegionMap region={newRegion} counts={{}} compact={false} onPick={r => { setNewRegion(r); window.setTimeout(() => setView('new'), 650); }} />
          <div className="v2-pad"><p className="v2-legend"><b className="v2-dot" /> 예측식이 있는 4곳(거창 홍로 · 청송·장수·영주 후지) · 회색 지역은 아직 예측 준비 중</p></div>
        </section>}
        {shown === 'new' && newRegion && <section className="v2-new">
          <div className="v2-pad"><p className="v2-k">저장 시작 2/2 · {nameOf(newRegion)}</p></div>
          <NewApple initialRegion={newRegion} onBack={() => setView('map')} onSaved={async l => { await reload(); open(l.id); }} />
        </section>}
        {shown === 'apple' && lot && <AppleCenter key={lot.id} lot={lot} />}
        {shown === 'list' && wide && <div className="v2-pad"><p className="v2-empty">왼쪽에서 사과를 고르거나 ‘저장 시작하기’를 누르세요.</p></div>}
      </main>
    </div>
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

function LotRow({lot, onOpen, active = false}: {lot: Lot; onOpen: () => void; active?: boolean}) {
  const r = lotRegion(lot);
  const p = useMemo(() => { try { return lotPredictor(lot, []); } catch { return null; } }, [lot]);
  const day = p?.todayDay;
  return <button type="button" className={`v2-row ${active ? 'on' : ''}`} aria-current={active || undefined} onClick={onOpen}>
    <span className="v2-row-main"><b>{lot.name || lot.variety}</b><small>{[r ? nameOf(r) : null, lot.variety, lot.storage, lot.details?.storage_temperature != null ? `${lot.details.storage_temperature}℃` : null, lot.observation_count ? `실측 ${lot.observation_count}회` : '실측 없음'].filter(Boolean).join(' · ')}</small></span>
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
      <ShipCompare lot={lot} p={p} base={base} />
      <p className="v2-note">기존 팀 계산식 결과 · 정확도 검증 전 · 출하·안전 판정 아님. 기록 수정·측정 추가는 <a href="/#lots">기존 화면</a>에서 할 수 있어요.</p>
    </div>
  </section>;
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** 출하 조건 비교: 입력한 물량·가격·저장비로만 계산합니다. 입력값은 저장하지 않습니다. */
function ShipCompare({lot, p, base}: {lot: Lot; p: NonNullable<ReturnType<typeof lotPredictor>>; base: number}) {
  const kgUnit = lot.details?.quantity_unit === 'kg' && lot.quantity ? String(lot.quantity) : '';
  const [v, setV] = useState<ShipInput>({nowKg: kgUnit, nowPrice: '', laterKg: '', cost: '', laterPrice: ''});
  const r = compareShipping(v);
  const set = (k: keyof ShipInput) => (e: ChangeEvent<HTMLInputElement>) => setV(x => ({...x, [k]: e.target.value}));
  const later = base + 30, q = (m: 'firmness' | 'brix') => { const x = p.at(m, later); return x.ok ? `${fmtNum(x.value, metricMeta[m].digits)} ${UNIT(m)}` : '계산 없음'; };
  const field = (k: keyof ShipInput, label: string, unit: string, opt = false) => <label className="v2-field"><span>{label}{opt && <em> (선택)</em>}</span><span className="v2-in"><input inputMode="decimal" value={v[k]} onChange={set(k)} aria-label={label} /><i>{unit}</i></span></label>;
  return <section className="v2-ship" aria-label="출하 조건 비교">
    <h2>출하 조건 비교 · 지금 vs 30일 더 저장</h2>
    <p className="v2-k">{lot.variety} · 저장 시작 {p.start ?? '—'} · 30일 뒤(저장 {later}일째) 계산값: 경도 {q('firmness')}, 당도 {q('brix')}</p>
    <div className="v2-fields">
      {field('nowKg', '지금 팔 수 있는 물량', 'kg')}{field('nowPrice', '지금 가격', '원/kg')}
      {field('laterKg', '30일 뒤 판매 가능 물량', 'kg')}{field('cost', '추가 저장비 (30일 총액)', '원')}
      {field('laterPrice', '30일 뒤 예상 가격', '원/kg', true)}
    </div>
    {!r.ok ? <p className="v2-ship-msg">{r.reason ?? `입력이 필요해요: ${r.missing.join(', ')}`}</p> : <table className="v2-ship-out"><tbody>
      <tr><th>지금 출하 수입</th><td>{won(r.nowRevenue)} 원</td></tr>
      <tr><th>30일 뒤 같은 수입이 되는 가격</th><td><b>{won(r.breakEven)} 원/kg</b></td></tr>
      {r.diff !== null && <tr><th>30일 뒤 출하 − 지금 출하</th><td><b className={r.diff < 0 ? 'neg' : ''}>{r.diff > 0 ? '+' : ''}{won(r.diff)} 원</b></td></tr>}
    </tbody></table>}
    <p className="v2-note">입력값으로만 계산한 결과예요. 시세나 판매 가능 물량을 예측하지 않고, 입력값은 저장하지 않아요. 기준 가격은 원 단위 올림.</p>
  </section>;
}
