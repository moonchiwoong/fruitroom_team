'use client';

import {useEffect, useId, useState} from 'react';
import {requestJson} from '@/components/lot-forms';
import {changePct, type GarakTrendResponse, type TrendPoint, type TrendVariety} from '@/lib/garak-trend';

const won = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 0});
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const SOURCE = 'https://www.data.go.kr/data/15141809/openapi.do';

/** 서울가락 시세 요약: 작년 같은 날·어제·오늘(10kg 환산, 등급 합산)과 전일·전년 대비, 연도별 같은 날 꺾은선. */
export default function GarakSummary({variety}: {variety?: string | null}) {
  const id = useId();
  const [v, setV] = useState<TrendVariety>(/홍로/.test(variety ?? '') ? '홍로' : '후지');
  const [res, setRes] = useState<{v: TrendVariety; data: GarakTrendResponse | null; failed: boolean} | null>(null);
  useEffect(() => {
    const c = new AbortController();
    requestJson<GarakTrendResponse>(`/api/market/apple-auctions/garak?variety=${encodeURIComponent(v)}`, {signal: c.signal})
      .then(data => setRes({v, data, failed: false}))
      .catch(() => { if (!c.signal.aborted) setRes({v, data: null, failed: true}); });
    return () => c.abort();
  }, [v]);
  const cur = res?.v === v ? res : null;
  const d = cur?.data;
  const latest = d?.today ?? d?.yesterday ?? null;
  const dayPct = changePct(d?.today ?? null, d?.yesterday ?? null);
  const yearPct = changePct(latest, d?.lastYear ?? null);
  return <section className="gk" aria-labelledby={`${id}-h`}>
    <div className="gk-head">
      <h3 id={`${id}-h`}>서울가락 시세 <span>{v} · 10kg 환산</span></h3>
      <div className="gk-seg" role="radiogroup" aria-label="품종">{(['후지', '홍로'] as const).map(x =>
        <button key={x} type="button" role="radio" aria-checked={v === x} className={v === x ? 'on' : ''} onClick={() => setV(x)}>{x}</button>)}</div>
    </div>
    {!cur ? <p className="apple-auction__notice" role="status">서울가락 시세를 확인하고 있어요…</p>
      : !d || d.status !== 'ready' ? <p className="apple-auction__notice" role="status">{cur.failed || d?.status === 'unavailable' ? '서울가락 시세를 불러오지 못했어요.' : `최근 서울가락에서 ${v} 경매 거래를 찾지 못했어요.`}</p>
      : <>
        <dl className="gk-tiles">
          <Tile label="작년 같은 날" p={d.lastYear} />
          <Tile label="어제" p={d.yesterday} />
          <Tile label="오늘" p={d.today} live />
        </dl>
        <p className="gk-pcts">
          <Pct label="전일 대비" v={dayPct} none={d.today ? '어제 값 없음' : '오늘 경매 전'} />
          <Pct label={`전년 대비${d.today ? '' : '(어제 기준)'}`} v={yearPct} none="비교 값 없음" />
        </p>
        {d.years.length > 1 && <Chart points={d.years} />}
        <p className="apple-auction__note">등급을 모두 합친 경매 거래의 kg당 평균 × 10 · 오늘은 실시간, 나머지는 정산 자료 · 휴장일이면 그 전 거래일 값{d.partial ? ' · 일부 날짜는 불러오지 못했어요' : ''} · <a href={SOURCE} target="_blank" rel="noreferrer">출처 aT</a></p>
      </>}
  </section>;
}

function Tile({label, p, live}: {label: string; p: TrendPoint | null; live?: boolean}) {
  return <div className={'gk-tile' + (live ? ' live' : '')}><dt>{label}{p && <small>{md(p.date)}</small>}</dt>
    <dd>{p ? <><b className="hs-num">{won.format(p.per10kg)}</b>원</> : <span>값 없음</span>}</dd></div>;
}

function Pct({label, v, none}: {label: string; v: number | null; none: string}) {
  if (v === null) return <span className="gk-pct">{label} <em>{none}</em></span>;
  const dir = v > 0 ? 'up' : v < 0 ? 'down' : 'same';
  return <span className={'gk-pct ' + dir}>{label} <b>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='} {Math.abs(v).toFixed(1)}%</b></span>;
}

function Chart({points}: {points: (TrendPoint & {year: number})[]}) {
  const W = 320, H = 130, L = 8, R = 8, T = 22, B = 22;
  const vals = points.map(p => p.per10kg), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => L + (W - L - R) * (points.length === 1 ? .5 : i / (points.length - 1));
  const y = (val: number) => T + (H - T - B) * (1 - (val - lo) / span);
  return <figure className="gk-chart">
    <figcaption>연도별 같은 날 (원/10kg)</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.map(p => `${p.year}년 ${won.format(p.per10kg)}원`).join(', ')}>
      <line x1={L} x2={W - R} y1={H - B + 4} y2={H - B + 4} stroke="#E5E8EB" />
      <polyline fill="none" stroke="#E5322D" strokeWidth="2.2" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.per10kg)}`).join(' ')} />
      {points.map((p, i) => <g key={p.year}>
        <circle cx={x(i)} cy={y(p.per10kg)} r={i === points.length - 1 ? 4.5 : 3.5} fill={i === points.length - 1 ? '#E5322D' : '#fff'} stroke="#E5322D" strokeWidth="2" />
        <text x={x(i) + (i === points.length - 1 ? -7 : i === 0 ? 2 : 0)} y={y(p.per10kg) - 10} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="10" fontWeight={i === points.length - 1 ? 700 : 400} fill={i === points.length - 1 ? '#E5322D' : '#4E5968'}>{(p.per10kg / 10000).toFixed(1)}만</text>
        <text x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="10" fill="#8A8A8E">{p.year}</text>
      </g>)}
    </svg>
  </figure>;
}
