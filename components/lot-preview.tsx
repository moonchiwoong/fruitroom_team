'use client';
// 저장하지 않은 사과(예시·비회원 입력)를 ‘내 사과’ 상세와 같은 모양으로 보여 줍니다. 계산은 lotPredictor(기존 식)만 씁니다.
import {useMemo, useState} from 'react';
import type {Lot, Observation} from '@/lib/lot-types';
import {lotPredictor, easyChange, EASY_METRICS} from '@/lib/lot-predict';
import {fmtNum, metricMeta, addDays} from '@/lib/tracker';
import {AppleGraph, Apple3D} from '@/components/apple-graph';

const SHORT: Record<string, string> = {firmness: '단단함', loss: '무게', brix: '단맛', acidity: '신맛'};
const md = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}/${day}`; };

export default function LotPreview({lot, observations = [], obsLabel = '측정'}: {lot: Lot; observations?: Observation[]; obsLabel?: string}) {
  const p = useMemo(() => { try { return lotPredictor(lot, observations); } catch { return null; } }, [lot, observations]);
  const hongro = /홍로/.test(lot.variety || '');
  const [day, setDay] = useState<number | null>(null);
  if (!p) return null;
  const today = p.todayDay !== null && p.todayDay >= 0 && p.todayDay <= (hongro ? 120 : 300) ? p.todayDay : null;
  const days = [...new Set([...(today !== null && today > 0 ? [today] : []), 30, 60, 90, 120, ...(hongro ? [] : [150, 200])])].sort((a, b) => a - b);
  const sel = day ?? (today && today > 0 ? today : 60);
  const obs = [...observations].sort((a, b) => b.date.localeCompare(a.date));
  return <div className="lp">
    <div className="ma-days" role="group" aria-label="저장 일수">{days.map(d => <button key={d} type="button" aria-pressed={sel === d} className={sel === d ? 'active' : ''} onClick={() => setDay(d)}>{d === today ? '오늘' : `${d}일`}</button>)}</div>
    <p className="ma-date">{p.start ? `${md(addDays(p.start, sel))} 기준 (저장 ${sel}일째)` : ''}</p>
    <div className="ma-rows">{EASY_METRICS.map(m => { const r = p.at(m, sel);
      return <div key={m + ':' + sel} className="ma-row"><span>{SHORT[m]}</span><div>{r.ok ? <><b>{easyChange(m, r.value, r.first, p.weather)}</b><small>{fmtNum(r.value, metricMeta[m].digits)} {m === 'firmness' ? 'N' : metricMeta[m].unit}</small></> : <><b className="na">계산 없음</b><small>{r.reason}</small></>}</div></div>; })}</div>
    <AppleGraph p={p} obs={observations} sel={sel} maxDay={hongro ? 120 : 200} measLabel={obsLabel === '측정' ? '내가 잰 값' : obsLabel} />
    <Apple3D p={p} sel={sel} cultivar={lot.variety || ''} />
    {obs.length > 0 && <section className="ma-records" aria-label={`${obsLabel} 기록`}><h2>{obsLabel} 기록</h2><ul>{obs.slice(0, 5).map(o => <li key={o.id} className="ma-rec"><span><b>{md(o.date)}</b> {[o.brix != null ? `단맛 ${o.brix}` : null, o.firmness != null ? `단단함 ${o.firmness} N` : null, o.acidity != null ? `신맛 ${o.acidity}%` : null].filter(Boolean).join(' · ')}</span></li>)}</ul></section>}
  </div>;
}
