'use client';
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {ArrowLeftRight, X} from 'lucide-react';
import {addDays, fmtDate, fmtNum, kgfToN, metricMeta, MODEL_RANGE, N_PER_KGF, nToKgf, roundTo, type DataKind, type MeasuredPoint, type MetricId, type Series} from '@/lib/tracker';
import {pressureConversion, parseOptionalNumber} from '@/lib/quality-policy';

/** 데이터 종류 표시. 색만이 아니라 글자와 테두리 모양으로도 구분합니다. */
export function KindBadge({kind, verified}: {kind: DataKind | '시연용 계산'; verified?: boolean}) {
  const cls = kind === '실측' ? 'k-measured' : kind === '예시' ? 'k-example' : kind === '미측정' ? 'k-missing' : 'k-model';
  return <span className={'kind ' + cls}>{kind}{kind === '모델 계산' && verified === false ? ' · 검증 미확인' : ''}</span>;
}

/** 경도 단위 변환 창. 원래 값(N)은 그대로 두고 표시용 변환값만 보여 줍니다. */
export function HardnessConvert({valueN, probeMm, label = '단위 변환'}: {valueN: number | null; probeMm: number | null; label?: string}) {
  const [open, setOpen] = useState(false), [n, setN] = useState(''), [k, setK] = useState('');
  const box = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => { if (open) { setN(valueN === null ? '' : String(roundTo(valueN, 2))); setK(valueN === null ? '' : String(roundTo(nToKgf(valueN), 3))); } }, [open, valueN]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const parsed = parseOptionalNumber(n), nv = parsed.status === 'valid' ? parsed.value : null;
  const pressure = pressureConversion(nv, {diameterMm: probeMm});
  return <span className="conv" ref={box}>
    <button type="button" className="conv-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}><ArrowLeftRight size={13} />{label}</button>
    {open && <div className="conv-pop" id={id} role="dialog" aria-label="경도 단위 변환">
      <div className="conv-head"><b>경도 단위 변환</b><button type="button" onClick={() => setOpen(false)} aria-label="닫기"><X size={15} /></button></div>
      <div className="conv-row">
        <label>N(힘)<input type="number" inputMode="decimal" value={n} onChange={e => { setN(e.target.value); const v = Number(e.target.value); setK(e.target.value === '' || !Number.isFinite(v) ? '' : String(roundTo(nToKgf(v), 3))); }} /></label>
        <span aria-hidden="true">≈</span>
        <label>kgf<input type="number" inputMode="decimal" value={k} onChange={e => { setK(e.target.value); const v = Number(e.target.value); setN(e.target.value === '' || !Number.isFinite(v) ? '' : String(roundTo(kgfToN(v), 2))); }} /></label>
      </div>
      {nv !== null && <p className="conv-result">{fmtNum(nv, 1)} N ≈ {fmtNum(nToKgf(nv), 2)} kgf</p>}
      <p className="conv-note">1 kgf = {N_PER_KGF} N 기준입니다. 저장되는 원래 측정값은 N이며, 변환값은 표시용입니다.</p>
      <div className="conv-area">
        <b>kgf/cm² (압력)</b>
        <p className="conv-note">{pressure.ok ? '환산 근거 표시 기능을 준비 중입니다.' : pressure.reason} 힘(N), 강성(N/mm), 압력(N/mm²)은 서로 다른 지표입니다.</p>
      </div>
    </div>}
  </span>;
}

/** 품질 변화 그래프: 실측은 점, 모델 계산은 선, 분석 기준일 이후(미래 가정)는 점선. */
export function TrackerChart({metric, series, baseline, measured, startDate, asOfDay, selectedDay, onSelect, exampleMode, maxDays = MODEL_RANGE.displayDays, unit, sourceLabel}: {
  metric: MetricId; series: Series; baseline: {series: Series; label: string} | null; measured: MeasuredPoint[]; startDate: string;
  asOfDay: number; selectedDay: number; onSelect: (d: number) => void; exampleMode: boolean; maxDays?: number; unit?: string; sourceLabel?: string;
}) {
  const svg = useRef<SVGSVGElement>(null), dragging = useRef(false);
  // 화면 폭에 맞춰 좌표계를 정해 글자가 작은 화면에서도 읽히게 합니다(1단위 ≈ 1px).
  const [box, setBox] = useState(760);
  useEffect(() => { const el = svg.current?.parentElement; if (!el) return; const ro = new ResizeObserver(([e]) => setBox(Math.round(e.contentRect.width))); ro.observe(el); return () => ro.disconnect(); }, []);
  const compact = box < 560;
  const H_DAYS = maxDays, W = Math.max(300, Math.min(box, 900)), H = compact ? 280 : 330, L = compact ? 46 : 58, R = compact ? 10 : 18, T = 26, B = compact ? 52 : 58;
  const meta = {...metricMeta[metric], unit: unit ?? metricMeta[metric].unit};
  const {lo, hi} = useMemo(() => {
    const vals: number[] = [...measured.map(m => m.value)];
    if (series.ok) vals.push(...series.points.map(p => p.value));
    if (baseline?.series.ok) vals.push(...baseline.series.points.map(p => p.value));
    if (!vals.length) return {lo: 0, hi: 1};
    let a = Math.min(...vals), b = Math.max(...vals); if (metric === 'loss') a = Math.min(a, 0);
    const pad = Math.max((b - a) * 0.12, metric === 'acidity' ? 0.01 : metric === 'loss' ? 0.2 : 0.3); return {lo: a - pad, hi: b + pad};
  }, [series, baseline, measured, metric]);
  const x = (d: number) => L + d / H_DAYS * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = (s: Series, seg: 'past' | 'future') => {
    if (!s.ok) return '';
    // 미래 점선은 분석 기준일의 마지막 과거 점에서 이어지게 그립니다.
    const ff = s.points.findIndex(p => p.segment === 'future');
    const list = seg === 'past' ? s.points.filter(p => p.segment === 'past') : ff < 0 ? [] : s.points.slice(Math.max(0, ff - 1));
    return list.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  };
  const pick = (clientX: number) => { const r = svg.current!.getBoundingClientRect(); const d = Math.round(((clientX - r.left) / r.width * W - L) / (W - L - R) * H_DAYS); onSelect(Math.max(0, Math.min(H_DAYS, d))); };
  const ticks = Array.from({length: compact ? 4 : 7}, (_, i) => i * H_DAYS / (compact ? 3 : 6));
  const yt = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
  const selectedInRange = Number.isInteger(selectedDay) && selectedDay >= 0 && selectedDay <= H_DAYS;
  const sel = selectedInRange && series.ok && selectedDay >= series.startDay && selectedDay <= series.endDay ? series.points[selectedDay - series.startDay] : null;
  return <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="tchart" role="img"
    aria-label={`${meta.label} 변화 그래프 (${meta.unit}). ${sourceLabel ? `초기품질 출처: ${sourceLabel}. ` : ''}${exampleMode ? '예시 측정' : '실측'} ${measured.length}개 점, 모델 계산 선, 저장 0~${H_DAYS}일, 분석 기준일 저장 ${asOfDay}일차`}
    onPointerDown={e => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); pick(e.clientX); }}
    onPointerMove={e => { if (dragging.current) pick(e.clientX); }} onPointerUp={() => { dragging.current = false; }}>
    {yt.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="g" /><text x={L - 8} y={y(v) + 4} textAnchor="end" className="tk">{fmtNum(v, meta.digits === 3 ? 2 : meta.digits)}</text></g>)}
    {ticks.map(t => <g key={t}><text x={x(t)} y={H - B + 18} textAnchor="middle" className="tk">{t}일</text><text x={x(t)} y={H - B + 33} textAnchor="middle" className="tk dim">{fmtDate(addDays(startDate, t)).slice(5)}</text></g>)}
    <text x={4} y={T - 10} textAnchor="start" className="ax">{meta.unit}</text>
    <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="ax">{compact ? `경과일 / 날짜 (${fmtDate(startDate)} = 0일)` : `저장 경과일 / 날짜 (저장 시작일 ${fmtDate(startDate)} = 0일)`}</text>
    {asOfDay >= 0 && asOfDay <= H_DAYS && <g><line x1={x(asOfDay)} x2={x(asOfDay)} y1={T} y2={H - B} className="asof" /><text x={x(asOfDay) + 5} y={T + 11} className="asof-t">오늘</text>
      {!compact && <><text x={x(asOfDay) - 5} y={H - B - 6} textAnchor="end" className="zone">과거 관측</text><text x={x(asOfDay) + 5} y={H - B - 6} className="zone">미래 가정 →</text></>}</g>}
    {baseline?.series.ok && <><path d={path(baseline.series, 'past')} className="base-line" /><path d={path(baseline.series, 'future')} className="base-line fut" /></>}
    {series.ok && <><path d={path(series, 'past')} className="calc-line" /><path d={path(series, 'future')} className="calc-line fut" /></>}
    {measured.map(m => m.day >= 0 && m.day <= H_DAYS && <circle key={m.id} cx={x(m.day)} cy={y(m.value)} r={5} className={exampleMode ? 'pt ex' : 'pt'}><title>{`${fmtDate(m.date)} (저장 ${m.day}일차) ${exampleMode ? '예시 측정' : '실측'} ${fmtNum(m.value, meta.digits)} ${meta.unit}`}</title></circle>)}
    {selectedInRange && <line x1={x(selectedDay)} x2={x(selectedDay)} y1={T} y2={H - B} className="selline" />}
    {sel && <circle cx={x(selectedDay)} cy={y(sel.value)} r={5.5} className="selpt" />}
    {selectedInRange && <text x={Math.min(x(selectedDay) + 6, W - R - 80)} y={T + 26} className="sel-t">선택 {selectedDay}일차</text>}
  </svg>;
}

export function ChartLegend({exampleMode, hasBaseline, baselineLabel, initialSource, hasMeasured = true}: {exampleMode: boolean; hasBaseline: boolean; baselineLabel: string; initialSource?: string; hasMeasured?: boolean}) {
  return <div className="tlegend">
    {initialSource && <span>초기품질 출처: {initialSource}</span>}
    {hasMeasured && <span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" className={exampleMode ? 'pt ex' : 'pt'} /></svg>{exampleMode ? '예시 측정(점)' : '실측(점)'}</span>}
    <span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" className="calc-line" /></svg>모델 계산 · 과거 구간(실선)</span>
    <span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" className="calc-line fut" /></svg>미래 가정(점선)</span>
    {hasBaseline && <span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" className="base-line fut" /></svg>{baselineLabel}</span>}
    <span><svg width="10" height="14"><line x1="5" x2="5" y1="0" y2="14" className="asof" /></svg>오늘</span>
  </div>;
}
