'use client';
// ‘내 사과’ 상세의 그래프와 3D 사과 모양. 값은 lotPredictor(기존 예측식)가 낸 것만 그립니다. 계산 못 한 날은 선을 끊습니다.
import {firmnessReach, metricReach, prefReachText, reachText} from '@/lib/target-reach';
import {CONSUMER_BRIX} from '@/lib/consumer-compare';
import {useMemo, useState} from 'react';
import {josa} from '@/lib/josa';
import type {Observation} from '@/lib/lot-types';
import type {lotPredictor} from '@/lib/lot-predict';
import {EASY_METRICS} from '@/lib/lot-predict';
import {fmtNum, metricMeta, daysBetween, isDate, type MetricId} from '@/lib/tracker';

const SHORT: Record<MetricId, string> = {firmness: '단단함', loss: '무게 감소', brix: '단맛', acidity: '신맛'};
const UNIT = (m: MetricId) => m === 'firmness' ? 'N' : metricMeta[m].unit;


type P = ReturnType<typeof lotPredictor>;
/** p0: 측정 기록 없이 처음 값으로만 계산한 예측(있으면 연한 회색 ‘처음 예측’ 선으로 비교). */
export function AppleGraph({p, p0, obs, sel, maxDay, measLabel = '내가 잰 값', target = null}: {p: P; p0?: P | null; obs: Observation[]; sel: number; maxDay: number; measLabel?: string; target?: number | null}) {
  const [m, setM] = useState<MetricId>('firmness');
  const W = 340, H = 210, L = 40, R = 10, T = 12, B = 26;
  const data = useMemo(() => {
    const pts: {d: number; v: number | null; seg: string}[] = [], base: {d: number; v: number | null}[] = [];
    for (let d = 0; d <= maxDay; d += 2) { const r = p.at(m, d); pts.push({d, v: r.ok ? r.value : null, seg: r.ok ? r.from : ''}); if (p0) { const r0 = p0.at(m, d); base.push({d, v: r0.ok ? r0.value : null}); } }
    const meas = m === 'loss' || !p.start ? [] : obs.filter(o => o[m] != null && isDate(o.date)).map(o => ({d: daysBetween(p.start!, o.date), v: o[m] as number})).filter(x => x.d >= 0 && x.d <= maxDay);
    const vals = [...pts.map(x => x.v).filter((v): v is number => v !== null), ...meas.map(x => x.v), ...(meas.length ? base.map(x => x.v).filter((v): v is number => v !== null) : []), ...(m === 'firmness' && target ? [target] : []), ...(m === 'brix' ? [CONSUMER_BRIX.min] : [])];
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-6) { lo -= 1; hi += 1; } const pad = (hi - lo) * .1; lo -= pad; hi += pad;
    return {pts, meas, lo, hi, base: meas.length ? base : []};
  }, [p, p0, m, obs, maxDay, target]);
  const pref = m === 'brix' ? CONSUMER_BRIX.min : null, prefR = pref ? metricReach(p, 'brix', pref, maxDay) : null, prefT = prefR && pref ? prefReachText(prefR, pref) : null;
  const tg = m === 'firmness' && target ? target : null, reach = tg ? firmnessReach(p, tg, maxDay) : null, rt = reach && tg ? reachText(reach, tg) : null;
  const x = (d: number) => L + (W - L - R) * d / maxDay, y = (v: number) => data ? T + (H - T - B) * (1 - (v - data.lo) / (data.hi - data.lo)) : 0;
  // 계산 출발점(처음 값 → 최근 측정값)이 바뀌는 곳은 선을 잇지 않습니다(이어 그리면 없는 급변처럼 보임).
  // 직접 잰 값이 있으면, 그 이전 구간은 계산선을 그리지 않고 잰 값끼리 잇습니다(처음 값 계산선과 실측이 어긋나 보이는 것 방지).
  const hasMeasuredSeg = !!data && data.pts.some(pt => pt.seg === 'measured');
  const measPath = data && data.meas.length > 1 ? [...data.meas].sort((a, b) => a.d - b.d).map((pt, i) => `${i ? 'L' : 'M'}${x(pt.d).toFixed(1)},${y(pt.v).toFixed(1)}`).join('') : '';
  // 처음 예측선: 잰 값이 있을 때만, 처음 값에서 계산한 선을 연한 회색으로 그려 실제와 비교합니다.
  const basePath = data && hasMeasuredSeg ? data.base.reduce((acc, pt, i) => pt.v === null ? acc : acc + `${i && data.base[i - 1].v !== null ? 'L' : 'M'}${x(pt.d).toFixed(1)},${y(pt.v).toFixed(1)}`, '') : '';
  const drawn = data ? data.pts.filter(pt => !hasMeasuredSeg || pt.seg === 'measured') : [];
  const path = data ? drawn.reduce((s, pt, i) => pt.v === null ? s : s + `${i && drawn[i - 1].v !== null && drawn[i - 1].seg === pt.seg ? 'L' : 'M'}${x(pt.d).toFixed(1)},${y(pt.v).toFixed(1)}`, '') : '';
  const selR = p.at(m, sel), today = p.todayDay;
  const ticks = [0, Math.round(maxDay / 4), Math.round(maxDay / 2), Math.round(maxDay * 3 / 4), maxDay];
  return <section className="ag" aria-label="저장 중 변화 그래프"><h2>그래프</h2>
    <div className="ma-days" role="group" aria-label="볼 항목">{EASY_METRICS.map(k => <button key={k} type="button" aria-pressed={m === k} className={m === k ? 'active' : ''} onClick={() => setM(k)}>{SHORT[k].replace(' 감소', '')}</button>)}</div>
    {!data ? <p className="ma-sub">{josa(SHORT[m], '은는')} 계산할 수 없어요. {(() => { const r = p.at(m, sel); return r.ok ? '' : r.reason; })()}</p> : <>
      <svg viewBox={`0 0 ${W} ${H}`} className="ag-svg" role="img" aria-label={`${SHORT[m]} 저장 일수별 계산값`}>
        {[data.lo + (data.hi - data.lo) * .1, (data.lo + data.hi) / 2, data.hi - (data.hi - data.lo) * .1].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ag-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="ag-tick">{fmtNum(v, Math.max(0, Math.min(3, Math.ceil(-Math.log10((data.hi - data.lo) / 4)))))}</text></g>)}
        {ticks.map((d, i) => <text key={d} x={x(d)} y={H - 8} textAnchor={i === ticks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'} className="ag-tick">{d}일</text>)}
        {today !== null && today >= 0 && today <= maxDay && <g><line x1={x(today)} x2={x(today)} y1={T} y2={H - B} className="ag-today" /><text x={x(today) + 3} y={T + 9} className="ag-tick ag-today-t">오늘</text></g>}
        {tg && data && <g><line x1={L} x2={W - R} y1={y(tg)} y2={y(tg)} className="ag-target" /><text x={W - R} y={y(tg) - 5} textAnchor="end" className="ag-tick ag-target-t">내 기준 {tg} N</text>{reach?.kind === 'at' && <circle cx={x(reach.day)} cy={y(tg)} r={5} className="ag-target-dot" />}</g>}
        {pref && <g><line x1={L} x2={W - R} y1={y(pref)} y2={y(pref)} className="ag-pref" /><text x={W - R} y={y(pref) - 5} textAnchor="end" className="ag-tick ag-pref-t">소비자 선호 하한 {pref} °Brix</text>{prefR?.kind === 'at' && <circle cx={x(prefR.day)} cy={y(pref)} r={5} className="ag-pref-dot" />}</g>}
        {basePath && <path d={basePath} className="ag-baseline" />}
        {measPath && <path d={measPath} className="ag-measline" />}
        <path d={path} className="ag-line" />
        {data.meas.map((pt, i) => <circle key={i} cx={x(pt.d)} cy={y(pt.v)} r={4} className="ag-meas"><title>{`${pt.d}일 실측 ${fmtNum(pt.v, metricMeta[m].digits)} ${UNIT(m)}`}</title></circle>)}
        {selR.ok && sel <= maxDay && (!hasMeasuredSeg || selR.from === 'measured') && <circle cx={x(sel)} cy={y(selR.value)} r={5} className="ag-sel" />}
      </svg>
      <p className="ag-legend"><span className="ag-k line" />{basePath ? '잰 값부터 다시 계산' : '계산값'}{basePath && <><span className="ag-k base" />처음 값 기준 예측</>}{data.meas.length > 0 && <><span className="ag-k dot" />{measLabel}{measPath ? ' (점선: 잰 값 잇기)' : ''}</>}{tg && <><span className="ag-k target" />내 기준</>}{pref && <><span className="ag-k pref" />소비자 선호 하한{prefT && <b className="ag-pref-reach">{prefT}</b>}</>}<span className="ag-unit">단위 {UNIT(m)}</span></p>
      {rt && <p className={'ag-reach' + (reach?.kind === 'at' || reach?.kind === 'already' ? ' hit' : '')}>{rt}</p>}
    </>}
  </section>;
}


