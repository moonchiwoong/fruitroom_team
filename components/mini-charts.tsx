'use client';
// PC 사과 대시보드: 네 항목을 각자 자기 단위의 작은 그래프로 나란히 그립니다(단위를 섞지 않음).
// 선은 lotPredictor(기존 예측식) 계산값만, 동그라미는 내가 잰 값. 계산 못 한 날은 선을 끊습니다.
import {firmnessReach, metricReach, prefReachText, reachText} from '@/lib/target-reach';
import {CONSUMER_BRIX} from '@/lib/consumer-compare';
import {useMemo} from 'react';
import type {Observation} from '@/lib/lot-types';
import type {lotPredictor} from '@/lib/lot-predict';
import {fmtNum, metricMeta, daysBetween, isDate, type MetricId} from '@/lib/tracker';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';

type P = ReturnType<typeof lotPredictor>;
const UNIT = (m: MetricId) => m === 'firmness' ? 'N' : metricMeta[m].unit;
import {EASY_METRICS} from '@/lib/lot-predict';
const ORDER = EASY_METRICS as readonly MetricId[]; // 위 타일과 같은 순서
const W = 300, H = 120, L = 34, R = 8, T = 10, B = 20;

export default function MiniCharts({p, obs, sel, maxDay, target = null}: {p: P; obs: Observation[]; sel: number; maxDay: number; target?: number | null}) {
  return <div className="mc-grid">{ORDER.map(m => <Mini key={m} m={m} p={p} obs={obs} sel={sel} maxDay={maxDay} target={m === 'firmness' ? target : null} />)}</div>;
}

function Mini({m, p, obs, sel, maxDay, target}: {m: MetricId; p: P; obs: Observation[]; sel: number; maxDay: number; target: number | null}) {
  const data = useMemo(() => { const a: {d: number; v: number | null}[] = []; for (let d = 0; d <= maxDay; d += 2) { const r = p.at(m, d); a.push({d, v: r.ok ? r.value : null}); } return a; }, [p, m, maxDay]);
  const meas = m === 'loss' || !p.start ? [] : obs.filter(o => o[m] != null && isDate(o.date)).map(o => ({d: daysBetween(p.start!, o.date), v: o[m] as number})).filter(x => x.d >= 0 && x.d <= maxDay);
  const reach = target ? firmnessReach(p, target, maxDay) : null, rt = reach && target ? reachText(reach, target) : null;
  const pref = m === 'brix' ? CONSUMER_BRIX.min : null, prefR = pref ? metricReach(p, 'brix', pref, maxDay) : null, prefT = prefR && pref ? prefReachText(prefR, pref) : null;
  const vals = [...data.filter(x => x.v !== null).map(x => x.v as number), ...meas.map(x => x.v), ...(target ? [target] : []), ...(pref ? [pref] : [])];
  const now = p.at(m, sel);
  if (!vals.length) return <figure className="mc"><figcaption><span style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}</span></figcaption><p className="mc-na">{now.ok ? '' : now.reason}</p></figure>;
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const X = (d: number) => L + (W - L - R) * d / maxDay, Y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let path = '', open = false; for (const x of data) { if (x.v === null) { open = false; continue; } path += `${open ? 'L' : 'M'}${X(x.d).toFixed(1)},${Y(x.v).toFixed(1)}`; open = true; }
  const dg = metricMeta[m].digits, tickDg = hi - lo - 2 * pad < 3 * 10 ** -dg ? dg + 1 : dg; // 범위가 좁으면 눈금 자리를 하나 더
  return <figure className="mc">
    <figcaption><span style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}</span><b>{now.ok ? <>{fmtNum(now.value, dg)}<small> {UNIT(m)}</small></> : <small>계산 없음</small>}</b></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${METRIC_LABEL[m]} 저장 일수별 계산값`}>
      {[lo + pad, (lo + hi) / 2, hi - pad].map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="mc-grid-line" /><text x={L - 4} y={Y(v) + 3} textAnchor="end" className="mc-ax">{fmtNum(v, tickDg)}</text></g>)}
      <path d={path} fill="none" stroke={METRIC_COLOR[m]} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" className="mc-line" />
      {target && <g><line x1={L} x2={W - R} y1={Y(target)} y2={Y(target)} className="mc-target" /><text x={W - R} y={Y(target) - 4} textAnchor="end" className="mc-target-t">내 기준 {target} N</text>{reach?.kind === 'at' && <circle cx={X(reach.day)} cy={Y(target)} r="4" className="mc-target-dot" />}</g>}
      {pref && <g><line x1={L} x2={W - R} y1={Y(pref)} y2={Y(pref)} className="mc-pref" /><text x={W - R} y={Y(pref) - 4} textAnchor="end" className="mc-pref-t">소비자 선호 하한 {pref} °Brix</text>{prefR?.kind === 'at' && <circle cx={X(prefR.day)} cy={Y(pref)} r="4" className="mc-pref-dot" />}</g>}
      <line x1={X(sel)} x2={X(sel)} y1={T} y2={H - B} className="mc-today" />
      {now.ok && <circle cx={X(sel)} cy={Y(now.value)} r="4" fill={METRIC_COLOR[m]} stroke="#fff" strokeWidth="2" />}
      {meas.map((x, i) => <circle key={i} cx={X(x.d)} cy={Y(x.v)} r="4" fill="#fff" stroke="#1c1c1e" strokeWidth="1.6" />)}
      {[0, Math.round(maxDay / 2), maxDay].map(d => <text key={d} x={X(d)} y={H - 5} textAnchor={d === 0 ? 'start' : d === maxDay ? 'end' : 'middle'} className="mc-ax">{d}일</text>)}
    </svg>
    {pref && <p className="mc-legend"><span className="mc-k line" style={{background: METRIC_COLOR[m]}} />계산값<span className="mc-k pref" />소비자 선호 하한{prefT && <b className="mc-pref-reach">{prefT}</b>}</p>}
    {rt && <p className={'mc-reach' + (reach?.kind === 'at' || reach?.kind === 'already' ? ' hit' : '')}>{rt}</p>}
  </figure>;
}
