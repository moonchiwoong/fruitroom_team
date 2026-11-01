'use client';
// ‘내 사과’ 상세의 그래프와 3D 사과 모양. 값은 lotPredictor(기존 예측식)가 낸 것만 그립니다. 계산 못 한 날은 선을 끊습니다.
import {Component, useMemo, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {Loader2, Plus} from 'lucide-react';
import type {Observation} from '@/lib/lot-types';
import type {lotPredictor} from '@/lib/lot-predict';
import {EASY_METRICS} from '@/lib/lot-predict';
import {fmtNum, metricMeta, daysBetween, isDate, type MetricId} from '@/lib/tracker';

const QualityAppleViewer = dynamic(() => import('@/components/quality-apple-viewer'), {ssr: false, loading: () => <div className="t3d-empty"><Loader2 className="spin" size={18} />3D 모양을 불러오는 중…</div>});
const SHORT: Record<MetricId, string> = {firmness: '단단함', loss: '무게 감소', brix: '단맛', acidity: '신맛'};
const UNIT = (m: MetricId) => m === 'firmness' ? 'N' : metricMeta[m].unit;

class Boundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() { return this.state.failed ? <div className="t3d-empty">3D 모양을 표시하지 못했어요. 숫자와 그래프는 그대로 볼 수 있어요.</div> : this.props.children; }
}

type P = ReturnType<typeof lotPredictor>;
export function AppleGraph({p, obs, sel, maxDay}: {p: P; obs: Observation[]; sel: number; maxDay: number}) {
  const [m, setM] = useState<MetricId>('firmness');
  const W = 340, H = 180, L = 40, R = 10, T = 12, B = 26;
  const data = useMemo(() => {
    const pts: {d: number; v: number | null; seg: string}[] = [];
    for (let d = 0; d <= maxDay; d += 2) { const r = p.at(m, d); pts.push({d, v: r.ok ? r.value : null, seg: r.ok ? r.from : ''}); }
    const meas = m === 'loss' || !p.start ? [] : obs.filter(o => o[m] != null && isDate(o.date)).map(o => ({d: daysBetween(p.start!, o.date), v: o[m] as number})).filter(x => x.d >= 0 && x.d <= maxDay);
    const vals = [...pts.map(x => x.v).filter((v): v is number => v !== null), ...meas.map(x => x.v)];
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { lo -= 1; hi += 1; } const pad = (hi - lo) * .1; lo -= pad; hi += pad;
    return {pts, meas, lo, hi};
  }, [p, m, obs, maxDay]);
  const x = (d: number) => L + (W - L - R) * d / maxDay, y = (v: number) => data ? T + (H - T - B) * (1 - (v - data.lo) / (data.hi - data.lo)) : 0;
  // 계산 출발점(처음 값 → 최근 측정값)이 바뀌는 곳은 선을 잇지 않습니다(이어 그리면 없는 급변처럼 보임).
  const path = data ? data.pts.reduce((s, pt, i) => pt.v === null ? s : s + `${i && data.pts[i - 1].v !== null && data.pts[i - 1].seg === pt.seg ? 'L' : 'M'}${x(pt.d).toFixed(1)},${y(pt.v).toFixed(1)}`, '') : '';
  const selR = p.at(m, sel), today = p.todayDay;
  const ticks = [0, Math.round(maxDay / 4), Math.round(maxDay / 2), Math.round(maxDay * 3 / 4), maxDay];
  return <section className="ag" aria-label="저장 중 변화 그래프"><h2>그래프</h2>
    <div className="ma-days" role="group" aria-label="볼 항목">{EASY_METRICS.map(k => <button key={k} type="button" aria-pressed={m === k} className={m === k ? 'active' : ''} onClick={() => setM(k)}>{SHORT[k].replace(' 감소', '')}</button>)}</div>
    {!data ? <p className="ma-sub">{SHORT[m]}은(는) 계산할 수 없어요. {(() => { const r = p.at(m, sel); return r.ok ? '' : r.reason; })()}</p> : <>
      <svg viewBox={`0 0 ${W} ${H}`} className="ag-svg" role="img" aria-label={`${SHORT[m]} 저장 일수별 계산값`}>
        {[data.lo + (data.hi - data.lo) * .1, (data.lo + data.hi) / 2, data.hi - (data.hi - data.lo) * .1].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ag-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="ag-tick">{fmtNum(v, Math.max(0, Math.min(3, Math.ceil(-Math.log10((data.hi - data.lo) / 4)))))}</text></g>)}
        {ticks.map((d, i) => <text key={d} x={x(d)} y={H - 8} textAnchor={i === ticks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="ag-tick">{d}일</text>)}
        {today !== null && today >= 0 && today <= maxDay && <g><line x1={x(today)} x2={x(today)} y1={T} y2={H - B} className="ag-today" /><text x={x(today) + 3} y={T + 9} className="ag-tick ag-today-t">오늘</text></g>}
        <path d={path} className="ag-line" />
        {data.meas.map((pt, i) => <circle key={i} cx={x(pt.d)} cy={y(pt.v)} r={4} className="ag-meas"><title>{`${pt.d}일 실측 ${fmtNum(pt.v, metricMeta[m].digits)} ${UNIT(m)}`}</title></circle>)}
        {selR.ok && sel <= maxDay && <circle cx={x(sel)} cy={y(selR.value)} r={5} className="ag-sel" />}
      </svg>
      <p className="ag-legend"><span className="ag-k line" />계산값{data.meas.length > 0 && <><span className="ag-k dot" />내가 잰 값</>}<span className="ag-unit">단위 {UNIT(m)}</span></p>
    </>}
  </section>;
}

type M = {ok: boolean; value: number | null; unit: string; kind?: string; reason?: string};
const metricsAt = (p: P, day: number) => Object.fromEntries((['firmness', 'brix', 'acidity', 'loss'] as const).map(k => { const r = p.at(k, day); return [k, r.ok ? {ok: true, value: r.value, unit: UNIT(k), kind: '모델 계산'} : {ok: false, value: null, unit: UNIT(k), reason: r.reason}]; })) as Record<'firmness' | 'brix' | 'acidity' | 'loss', M>;

/** 수확 때(0일)와 고른 날을 나란히 놓아 무게 감소에 따른 모양 차이를 비교합니다. 모양은 계산된 무게 감소율로만 바뀝니다(과장하지 않음). */
export function Apple3D({p, sel, cultivar}: {p: P; sel: number; cultivar: string}) {
  const [open, setOpen] = useState(false);
  const day = Math.max(0, sel);
  const now = useMemo(() => metricsAt(p, day), [p, day]);
  const start = useMemo(() => ({...metricsAt(p, 0), loss: {ok: true, value: 0, unit: '%', kind: '수확 때'}}), [p]);
  const loss = now.loss.ok && now.loss.value !== null ? now.loss.value : null;
  const caption = loss === null ? '무게 감소를 계산할 수 없어 모양을 바꾸지 않았어요.'
    : loss < 0.05 ? '아직 무게가 거의 줄지 않아 모양 차이가 없어요.'
    : `저장 ${day}일째에는 무게가 약 ${fmtNum(loss, 1)}% 줄어, 그만큼 크기가 작아지고 겉에 잔주름이 생기는 모습으로 그렸어요.${loss < 2 ? ' 변화가 작아서 눈으로는 미세해요.' : ''}`;
  return <details className="qt2-fold ag-3d" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary>사과 모양 비교 (3D · 수확 때 ↔ 저장 {day}일째)<Plus size={16} aria-hidden="true" /></summary>
    {open && <div className="ag-cmp-wrap">
      <div className="ag-cmp">
        <figure><figcaption><b>수확 때</b><span>무게 감소 0%</span></figcaption><Boundary><QualityAppleViewer bare day={0} cultivar={cultivar} metrics={start} /></Boundary></figure>
        <figure><figcaption><b>저장 {day}일째</b><span>{loss === null ? '계산 없음' : `무게 약 ${fmtNum(loss, 1)}% 감소`}</span></figcaption><Boundary><QualityAppleViewer bare day={day} cultivar={cultivar} metrics={now} /></Boundary></figure>
      </div>
      <p className="ag-cmp-cap">{caption}</p>
      <p className="qt-help">위쪽 날짜 버튼을 바꾸면 오른쪽 사과가 바뀌어요. 손가락으로 돌려 볼 수 있어요. 무게 감소 계산값으로 그린 설명용 모델이고, 실제 사진으로 검증하지 않았어요. 단단함·단맛·신맛은 모양에 반영하지 않아요.</p>
    </div>}
  </details>;
}
