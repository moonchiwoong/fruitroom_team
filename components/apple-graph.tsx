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
    const pts: {d: number; v: number | null}[] = [];
    for (let d = 0; d <= maxDay; d += 2) { const r = p.at(m, d); pts.push({d, v: r.ok ? r.value : null}); }
    const meas = m === 'loss' || !p.start ? [] : obs.filter(o => o[m] != null && isDate(o.date)).map(o => ({d: daysBetween(p.start!, o.date), v: o[m] as number})).filter(x => x.d >= 0 && x.d <= maxDay);
    const vals = [...pts.map(x => x.v).filter((v): v is number => v !== null), ...meas.map(x => x.v)];
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { lo -= 1; hi += 1; } const pad = (hi - lo) * .1; lo -= pad; hi += pad;
    return {pts, meas, lo, hi};
  }, [p, m, obs, maxDay]);
  const x = (d: number) => L + (W - L - R) * d / maxDay, y = (v: number) => data ? T + (H - T - B) * (1 - (v - data.lo) / (data.hi - data.lo)) : 0;
  const path = data ? data.pts.reduce((s, pt, i) => pt.v === null ? s : s + `${i && data.pts[i - 1].v !== null ? 'L' : 'M'}${x(pt.d).toFixed(1)},${y(pt.v).toFixed(1)}`, '') : '';
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

export function Apple3D({p, sel, cultivar}: {p: P; sel: number; cultivar: string}) {
  const [open, setOpen] = useState(false);
  const metrics = useMemo(() => Object.fromEntries((['firmness', 'brix', 'acidity', 'loss'] as const).map(k => { const r = p.at(k, sel); return [k, r.ok ? {ok: true, value: r.value, unit: UNIT(k), kind: '모델 계산'} : {ok: false, value: null, unit: UNIT(k), reason: r.reason}]; })) as Record<'firmness' | 'brix' | 'acidity' | 'loss', {ok: boolean; value: number | null; unit: string; kind?: string; reason?: string}>, [p, sel]);
  return <details className="qt2-fold ag-3d" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
    <summary>사과 모양 보기 (3D · 저장 {sel}일째)<Plus size={16} aria-hidden="true" /></summary>
    {open && <div className="qt5-apple-fold"><p className="qt-help">무게 감소에 따라 주름을 표현한 설명용 모델이에요. 실제 사진으로 검증하지 않았어요.</p><Boundary><QualityAppleViewer compact day={sel} cultivar={cultivar} metrics={metrics} /></Boundary></div>}
  </details>;
}
