'use client';

import {useEffect, useId, useState} from 'react';
import {requestJson} from '@/components/lot-forms';
import {todayKST} from '@/lib/tracker';
import {changePct, NOTE_MIN_CHANGE, YEAR_NOTES, type GarakTrendResponse, type TrendPoint, type TrendVariety, type WeekPoint} from '@/lib/garak-trend';

const won = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 0});
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const SOURCE = 'https://www.data.go.kr/data/15141809/openapi.do';
const asPoint = (w: WeekPoint | undefined): TrendPoint | null => (w ? {date: w.to, per10kg: w.per10kg, kg: w.kg} : null);

/** 서울가락 시세: 어제·오늘(하루), 작년 이맘때(7일 평균), 전일·전년 대비, 연도별 7일 평균 꺾은선과 크게 바뀐 해의 사유. */
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
  const ys = d?.years ?? [];
  // 올해·작년 값은 연도가 정확히 맞을 때만 씁니다(중간 해가 빠졌을 때 다른 해끼리 비교하지 않음).
  const year0 = +todayKST().slice(0, 4);
  const thisWeek = ys.find(w => w.year === year0), lastWeek = ys.find(w => w.year === year0 - 1);
  const dayPct = changePct(d?.today ?? null, d?.yesterday ?? null);
  const yearPct = changePct(asPoint(thisWeek), asPoint(lastWeek));
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
          <Tile label="작년 이맘때" sub="7일 평균" p={asPoint(lastWeek)} />
          <Tile label="어제" p={d.yesterday} />
          <Tile label="오늘" p={d.today} live />
        </dl>
        <p className="gk-pcts">
          <Pct label="전일 대비" v={dayPct} none={d.today ? '어제 값 없음' : '오늘 경매 전'} />
          <Pct label="전년 대비(최근 7일 평균)" v={yearPct} none="비교 값 없음" />
        </p>
        {ys.length > 1 && <Chart v={v} points={ys} />}
        <p className="apple-auction__note">등급을 모두 합친 경매 거래의 kg당 평균 × 10 · 오늘·어제는 하루 값, 연도 비교는 같은 날짜까지 7일 물량 가중 평균 · 오늘은 실시간, 나머지는 정산 자료{d.partial ? ' · 일부 날짜는 불러오지 못했어요' : ''} · <a href={SOURCE} target="_blank" rel="noreferrer">출처 aT</a></p>
      </>}
  </section>;
}

function Tile({label, sub, p, live}: {label: string; sub?: string; p: TrendPoint | null; live?: boolean}) {
  return <div className={'gk-tile' + (live ? ' live' : '')}><dt>{label}<small>{sub ?? (p ? md(p.date) : '')}</small></dt>
    <dd>{p ? <><b className="hs-num">{won.format(p.per10kg)}</b>원</> : <span>값 없음</span>}</dd></div>;
}

function Pct({label, v, none}: {label: string; v: number | null; none: string}) {
  if (v === null) return <span className="gk-pct">{label} <em>{none}</em></span>;
  const dir = v > 0 ? 'up' : v < 0 ? 'down' : 'same';
  return <span className={'gk-pct ' + dir}>{label} <b>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='} {Math.abs(v).toFixed(1)}%</b></span>;
}

function Chart({v, points}: {v: TrendVariety; points: WeekPoint[]}) {
  const W = 320, H = 140, L = 8, R = 8, T = 26, B = 24;
  const vals = points.map(p => p.per10kg), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i: number) => L + (W - L - R) * (points.length === 1 ? .5 : i / (points.length - 1));
  const y = (val: number) => T + (H - T - B) * (1 - (val - lo) / span);
  // 전년보다 크게 바뀐 해 중 사유가 정리된 해만 ⓘ를 붙입니다.
  const noted = points.map((p, i) => {
    const prev = points[i - 1];
    const pct = prev && prev.year === p.year - 1 ? (p.per10kg - prev.per10kg) / prev.per10kg * 100 : null;
    return pct !== null && Math.abs(pct) >= NOTE_MIN_CHANGE && YEAR_NOTES[v][p.year] ? {pct, note: YEAR_NOTES[v][p.year]} : null;
  });
  const last = [...noted.keys()].filter(i => noted[i]).at(-1);
  const [open, setOpen] = useState<number | null>(last ?? null);
  const sel = open !== null ? noted[open] : null;
  const anchor = (i: number) => (i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle');
  // 값 글자가 선과 겹치지 않게: 위·아래 자리 중 선이 덜 지나가는 쪽에 둡니다(같으면 위).
  const lineY = (px: number) => { for (let i = 1; i < points.length; i++) { const a = x(i - 1), b = x(i); if (px >= a && px <= b) return y(points[i - 1].per10kg) + (y(points[i].per10kg) - y(points[i - 1].per10kg)) * (px - a) / (b - a || 1); } return null; };
  const labelDy = points.map((p, i) => {
    const text = `${(p.per10kg / 10000).toFixed(1)}만${noted[i] ? ' ⓘ' : ''}`, w = text.length * 6 + 4, cx = x(i) + (i === points.length - 1 ? -7 : i === 0 ? 2 : 0), py = y(p.per10kg);
    const x0 = anchor(i) === 'start' ? cx : anchor(i) === 'end' ? cx - w : cx - w / 2;
    const hits = (top: number, bottom: number) => { let n = 0; for (let k = 0; k <= 10; k++) { const ly = lineY(x0 + w * k / 10); if (ly !== null && ly >= top && ly <= bottom) n++; } return n; };
    const up = hits(py - 21, py - 5), down = py + 19 <= H - 16 ? hits(py + 5, py + 21) : Infinity;
    return down < up ? 17 : -10;
  });
  return <figure className="gk-chart">
    <figcaption>연도별 이맘때 (같은 날짜까지 7일 평균, 원/10kg){noted.some(Boolean) ? ' · ⓘ나 아래 버튼을 누르면 이유가 나와요' : ''}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.map(p => `${p.year}년 ${won.format(p.per10kg)}원`).join(', ')}>
      <line x1={L} x2={W - R} y1={H - B + 4} y2={H - B + 4} stroke="#E5E8EB" />
      <polyline fill="none" stroke="#E5322D" strokeWidth="2.2" strokeLinejoin="round" points={points.map((p, i) => `${x(i)},${y(p.per10kg)}`).join(' ')} />
      {points.map((p, i) => <g key={p.year} {...(noted[i] ? {role: 'button', tabIndex: 0, className: 'gk-pt' + (open === i ? ' on' : ''), 'aria-label': `${p.year}년 가격 변동 이유 보기`, style: {cursor: 'pointer'}, onClick: () => setOpen(open === i ? null : i), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === i ? null : i); } }} : {})}>
        {noted[i] && <rect x={x(i) - 20} y={0} width="40" height={H} rx="10" className="gk-hit" />}
        <circle cx={x(i)} cy={y(p.per10kg)} r={open === i ? 5 : 3.5} fill={open === i ? '#E5322D' : '#fff'} stroke="#E5322D" strokeWidth="2" />
        <text x={x(i) + (i === points.length - 1 ? -7 : i === 0 ? 2 : 0)} y={y(p.per10kg) + labelDy[i]} textAnchor={anchor(i)} fontSize="10" fontWeight={noted[i] || i === points.length - 1 ? 700 : 400} fill={noted[i] ? '#A32D2D' : '#4E5968'}>{(p.per10kg / 10000).toFixed(1)}만{noted[i] ? ' ⓘ' : ''}</text>
        <text x={x(i)} y={H - 4} textAnchor={anchor(i)} fontSize="10" fill="#8A8A8E">{p.year}</text>
      </g>)}
    </svg>
    {noted.some(Boolean) && <div className="gk-why-btns">{noted.map((n, i) => n && <button key={points[i].year} type="button" aria-expanded={open === i} className={open === i ? 'on' : ''} onClick={() => setOpen(open === i ? null : i)}>
      {points[i].year}년 {n.pct > 0 ? '▲' : '▼'} {Math.abs(n.pct).toFixed(0)}% 이유</button>)}</div>}
    {sel && open !== null && <div className="gk-why" role="note">
      <b>{points[open].year}년 이맘때 값이 {sel.pct > 0 ? '높았던' : '낮았던'} 이유</b>
      <p>{sel.note.text}</p>
      <a href={sel.note.url} target="_blank" rel="noreferrer">출처: {sel.note.source}</a>
    </div>}
  </figure>;
}
