'use client';
import {useMemo, useState} from 'react';
import {ArrowDown, ArrowUp, Minus, CloudRain, Download, Info, MapPin, RotateCcw, Sprout, Thermometer, TriangleAlert, Warehouse} from 'lucide-react';
import {
  contributions, defaultInputs, inputInfo, inputKeys, MAX_STORAGE_DAYS, metricInfo, metricKeys, predictAll, predictMetric,
  regionIds, regions, regionSummary, reliability, samples, storageFormula, storageIds, storageInfo, storageMetricInfo, storageValue,
  type Initial, type InputKey, type Inputs, type MetricKey, type RegionId, type StorageMetric,
} from '@/lib/initial-quality';

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d}) : '—');
const inputIcon: Record<InputKey, typeof CloudRain> = {rain9: CloudRain, lc56: Sprout, lc78: Sprout, min4: Thermometer};

export default function InitialQuality() {
  const [region, setRegion] = useState<RegionId>('cheongsong');
  const [text, setText] = useState<Record<InputKey, string>>(() => toText(defaultInputs('cheongsong')));
  const [metric, setMetric] = useState<MetricKey>('firmness');
  const summary = regionSummary(region);

  const inputs = useMemo(() => Object.fromEntries(inputKeys.map(k => [k, parseFloat(text[k])])) as Inputs, [text]);
  const valid = inputKeys.every(k => Number.isFinite(inputs[k]));
  const outside = valid ? inputKeys.filter(k => inputs[k] < summary.inputRange[k].min || inputs[k] > summary.inputRange[k].max) : [];
  const result = valid ? predictAll(region, inputs) : null;

  function chooseRegion(r: RegionId) { setRegion(r); setText(toText(defaultInputs(r))); }
  function loadYear(y: string) {
    const row = summary.yearMeans.find(m => String(m.year) === y);
    if (row) setText(toText(Object.fromEntries(inputKeys.map(k => [k, Math.round(row.inputs[k] * 10) / 10])) as Inputs));
  }

  return <div className="iq">
    <section className="iq-step">
      <StepTitle n={1} title="산지 선택" desc="산지마다 학습 데이터와 회귀식이 다릅니다." />
      <div className="iq-regions" role="radiogroup" aria-label="산지 선택">
        {regionIds.map(r => {
          const s = regionSummary(r), best = metricKeys.reduce((a, m) => regions[r].equations[m].r2 > regions[r].equations[a].r2 ? m : a, metricKeys[0]);
          return <button key={r} role="radio" aria-checked={region === r} className={'iq-region' + (region === r ? ' active' : '')} onClick={() => chooseRegion(r)}>
            <span className="iq-region-name"><MapPin size={16} />{regions[r].name} 사과</span>
            <span className="iq-region-area">{regions[r].area}</span>
            <span className="iq-region-meta">학습 {s.count}건 · {s.years[0]}–{s.years.at(-1)}년</span>
            <span className="iq-region-best">가장 잘 맞는 항목 <b>{metricInfo[best].label} R² {regions[r].equations[best].r2.toFixed(2)}</b></span>
          </button>;
        })}
      </div>
    </section>

    <div className="iq-columns">
      <section className="iq-step iq-card">
        <StepTitle n={2} title="기상 조건 입력" desc={`${regions[region].name} 학습 데이터 평균으로 채워 두었습니다.`} />
        <div className="iq-presets">
          <label>연도 평균 불러오기
            <select value="" onChange={e => loadYear(e.target.value)} aria-label="연도 평균 불러오기">
              <option value="">연도 선택</option>
              {summary.yearMeans.map(m => <option key={m.year} value={m.year}>{m.year}년 평균</option>)}
            </select>
          </label>
          <button className="btn btn-ghost" onClick={() => setText(toText(defaultInputs(region)))}><RotateCcw size={15} />전체 평균값</button>
        </div>
        <div className="iq-inputs">
          {inputKeys.map(k => {
            const info = inputInfo[k], range = summary.inputRange[k], Icon = inputIcon[k];
            const v = inputs[k], out = Number.isFinite(v) && (v < range.min || v > range.max);
            const lo = Math.floor(range.min - (range.max - range.min) * 0.15), hi = Math.ceil(range.max + (range.max - range.min) * 0.15);
            return <div key={k} className={'iq-input' + (out ? ' out' : '')}>
              <div className="iq-input-head">
                <label htmlFor={'iq-' + k}><Icon size={16} />{info.label}<code>{info.code}</code></label>
                <div className="iq-number">
                  <input id={'iq-' + k} type="number" inputMode="decimal" step={info.step} value={text[k]} onChange={e => setText(t => ({...t, [k]: e.target.value}))} />
                  <span>{info.unit}</span>
                </div>
              </div>
              <input type="range" aria-label={info.label + ' 조절'} min={Math.max(k === 'rain9' ? 0 : -50, lo)} max={hi} step={info.step}
                value={Number.isFinite(v) ? v : range.mean} onChange={e => setText(t => ({...t, [k]: e.target.value}))} />
              <div className="iq-input-foot">
                <span>{info.hint}</span>
                <span>학습 범위 {fmt(range.min, info.digits)} ~ {fmt(range.max, info.digits)}{out && <b> · 범위 밖</b>}</span>
              </div>
            </div>;
          })}
        </div>
      </section>

      <section className="iq-step iq-card iq-result-card">
        <StepTitle n={3} title="예측 초기 품질" desc="수확 직후 품질의 회귀식 예측값입니다." />
        {!valid && <div className="iq-alert"><TriangleAlert size={16} />모든 기상 값을 숫자로 입력해 주세요.</div>}
        {outside.length > 0 && <div className="iq-alert"><TriangleAlert size={16} /><span><b>{outside.map(k => inputInfo[k].label).join(', ')}</b> 값이 학습 데이터 범위를 벗어났습니다. 범위 밖 예측은 오차가 커질 수 있어요.</span></div>}
        {result && <div className="iq-results">
          {metricKeys.map(m => {
            const info = metricInfo[m], eq = regions[region].equations[m], rel = reliability(eq.r2), diff = result[m] - summary.actualMean[m];
            return <button key={m} className={'iq-result' + (metric === m ? ' active' : '')} onClick={() => setMetric(m)} aria-pressed={metric === m}>
              <span className="iq-result-label">{info.label}<em className={'rel rel-' + rel.level}>{rel.label}</em></span>
              <strong>{fmt(result[m], info.digits)}<small>{info.unit}</small></strong>
              <span className="iq-result-err">± {fmt(summary.rmse[m], info.digits)} (평균 오차) · R² {eq.r2.toFixed(2)}</span>
              {Math.abs(diff) < summary.rmse[m] * 0.1
                ? <span className="iq-result-diff same"><Minus size={13} />산지 평균({fmt(summary.actualMean[m], info.digits)})과 비슷</span>
                : <span className={'iq-result-diff ' + (diff >= 0 ? 'up' : 'down')}>{diff >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}산지 평균 {fmt(summary.actualMean[m], info.digits)}보다 {fmt(Math.abs(diff), info.digits)} {diff >= 0 ? '높음' : '낮음'}</span>}
            </button>;
          })}
        </div>}
        {result && <button className="btn btn-outline iq-download" onClick={() => downloadCsv(region, inputs, result)}><Download size={15} />예측 결과 CSV 저장</button>}
      </section>
    </div>

    {result && <div className="iq-columns iq-analysis">
      <section className="iq-card">
        <div className="iq-card-head"><div><h3>{metricInfo[metric].label}에 영향을 준 기상 요인</h3><p>산지 평균 기상과 비교했을 때 각 요인이 예측값을 얼마나 올리거나 내렸는지 보여줍니다.</p></div></div>
        <MetricTabs value={metric} onChange={setMetric} />
        <Contribution region={region} metric={metric} inputs={inputs} />
      </section>
      <section className="iq-card">
        <div className="iq-card-head"><div><h3>{regions[region].name} 실측값과 회귀식 비교</h3><p>점 하나가 학습 데이터 1건입니다. 대각선에 가까울수록 예측이 잘 맞습니다.</p></div></div>
        <Scatter region={region} metric={metric} predicted={result[metric]} />
      </section>
    </div>}

    {result && <Storage predicted={{firmness: result.firmness, brix: result.brix, acidity: result.acidity}} />}

    <section className="iq-card iq-method">
      <div className="iq-card-head"><div><h3><Info size={17} />예측 방법과 한계</h3></div></div>
      <ul>
        <li>산지별 학습 데이터 200건(2018~2025년)에 다중선형회귀를 적합한 식입니다. 입력 기상 값 4개로 수확 직후 품질 5개 항목을 계산합니다.</li>
        <li>R²는 실측값의 변동을 식이 설명하는 비율입니다. 0.6 이상은 ‘설명력 높음’, 0.4 미만은 ‘참고용’으로 표시합니다.</li>
        <li>± 값은 학습 데이터에서 실측과 예측의 평균 차이(RMSE)입니다. 개별 과원의 관리 방식·수세·수확 시기는 식에 들어 있지 않습니다.</li>
        <li>저장 중 품질 변화는 예측된 초기값(또는 직접 입력한 실측값)에서 출발하는 저장 방식별 동적 예측식입니다.</li>
      </ul>
      <details>
        <summary>{regions[region].name} 회귀식 계수 보기</summary>
        <div className="iq-table-wrap"><table className="iq-table">
          <thead><tr><th>항목</th><th>절편</th>{inputKeys.map(k => <th key={k}>{inputInfo[k].code}</th>)}<th>R²</th></tr></thead>
          <tbody>{metricKeys.map(m => {const eq = regions[region].equations[m]; return <tr key={m}><td>{metricInfo[m].label} ({metricInfo[m].unit})</td><td>{eq.intercept.toFixed(4)}</td>{inputKeys.map(k => <td key={k}>{eq.coef[k].toFixed(6)}</td>)}<td>{eq.r2.toFixed(4)}</td></tr>;})}</tbody>
        </table></div>
      </details>
    </section>
  </div>;
}

function toText(x: Inputs) { return Object.fromEntries(inputKeys.map(k => [k, String(x[k])])) as Record<InputKey, string>; }

function StepTitle({n, title, desc}: {n: number; title: string; desc: string}) {
  return <div className="iq-step-title"><span>{n}</span><div><h2>{title}</h2><p>{desc}</p></div></div>;
}

function MetricTabs({value, onChange}: {value: MetricKey; onChange: (m: MetricKey) => void}) {
  return <div className="seg" role="tablist">{metricKeys.map(m => <button key={m} role="tab" aria-selected={value === m} className={value === m ? 'active' : ''} onClick={() => onChange(m)}>{metricInfo[m].label}</button>)}</div>;
}

function Contribution({region, metric, inputs}: {region: RegionId; metric: MetricKey; inputs: Inputs}) {
  const rows = contributions(region, metric, inputs), info = metricInfo[metric];
  const max = Math.max(...rows.map(r => Math.abs(r.value)), regionSummary(region).rmse[metric] * 0.25, 1e-9);
  const total = rows.reduce((s, r) => s + r.value, 0);
  return <div className="contrib">
    {rows.map(r => <div className="contrib-row" key={r.key}>
      <span className="contrib-label">{inputInfo[r.key].short}</span>
      <div className="contrib-track"><i className="contrib-axis" />
        <span className={'contrib-bar ' + (r.value >= 0 ? 'up' : 'down')} style={r.value >= 0 ? {width: `${Math.abs(r.value) / max * 50}%`, left: '50%'} : {width: `${Math.abs(r.value) / max * 50}%`, right: '50%'}} />
      </div>
      <span className={'contrib-value ' + (r.value >= 0 ? 'up' : 'down')}>{r.value >= 0 ? '+' : '−'}{fmt(Math.abs(r.value), info.digits + 1)}</span>
    </div>)}
    <p className="contrib-total">합계 {total >= 0 ? '+' : '−'}{fmt(Math.abs(total), info.digits + 1)} {info.unit} → 산지 평균 대비 예측값 변화</p>
  </div>;
}

function Scatter({region, metric, predicted}: {region: RegionId; metric: MetricKey; predicted: number}) {
  const pts = useMemo(() => samples(region).map(s => ({p: predictMetric(region, metric, s.inputs), a: s.actual[metric]})), [region, metric]);
  const vals = [...pts.flatMap(p => [p.p, p.a]), predicted];
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const W = 520, H = 330, L = 56, R = 16, T = 14, B = 44;
  const x = (v: number) => L + (v - lo) / (hi - lo) * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f), d = metricInfo[metric].digits;
  return <svg viewBox={`0 0 ${W} ${H}`} className="iq-chart" role="img" aria-label={`${metricInfo[metric].label} 실측값 대비 예측값 산점도`}>
    {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{fmt(t, d)}</text><text x={x(t)} y={H - B + 18} textAnchor="middle" className="tick">{fmt(t, d)}</text></g>)}
    <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} className="diag" />
    {pts.map((p, i) => <circle key={i} cx={x(p.p)} cy={y(p.a)} r="3.4" className="dot" />)}
    <line x1={x(predicted)} x2={x(predicted)} y1={T} y2={H - B} className="marker" />
    <text x={Math.min(x(predicted) + 6, W - R - 90)} y={T + 14} className="marker-label">이번 예측 {fmt(predicted, d)}</text>
    <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="axis">회귀식 예측값 ({metricInfo[metric].unit})</text>
    <text transform={`translate(14 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="axis">실측값</text>
  </svg>;
}

function Storage({predicted}: {predicted: Initial}) {
  const [source, setSource] = useState<'pred' | 'manual'>('pred');
  const [manual, setManual] = useState({firmness: '', brix: '', acidity: ''});
  const [day, setDay] = useState(120);
  const init: Initial = source === 'pred' ? predicted : {
    firmness: parseFloat(manual.firmness) || predicted.firmness,
    brix: parseFloat(manual.brix) || predicted.brix,
    acidity: parseFloat(manual.acidity) || predicted.acidity,
  };
  const metrics: StorageMetric[] = ['firmness', 'brix', 'acidity', 'loss'];
  return <section className="iq-step iq-card iq-storage">
    <StepTitle n={4} title="저장 중 품질 변화" desc="초기 품질에서 출발해 저장 방식별로 시간에 따라 어떻게 변하는지 봅니다." />
    <div className="iq-storage-controls">
      <div className="seg" role="tablist" aria-label="초기값 선택">
        <button role="tab" aria-selected={source === 'pred'} className={source === 'pred' ? 'active' : ''} onClick={() => setSource('pred')}>예측 초기값 사용</button>
        <button role="tab" aria-selected={source === 'manual'} className={source === 'manual' ? 'active' : ''} onClick={() => setSource('manual')}>실측 초기값 입력</button>
      </div>
      {source === 'manual' && <div className="iq-manual">
        {(['firmness', 'brix', 'acidity'] as const).map(k => <label key={k}>{metricInfo[k].label}
          <span className="iq-number"><input type="number" inputMode="decimal" step="any" placeholder={fmt(predicted[k], metricInfo[k].digits)} value={manual[k]} onChange={e => setManual(m => ({...m, [k]: e.target.value}))} /><span>{metricInfo[k].unit}</span></span>
        </label>)}
      </div>}
      <label className="iq-day">
        <span>저장 기간 <b>{day}일</b></span>
        <input type="range" min={0} max={MAX_STORAGE_DAYS} step={1} value={day} onChange={e => setDay(+e.target.value)} aria-label="저장 기간(일)" />
        <span className="iq-day-scale"><span>0일</span><span>100일</span><span>200일</span><span>{MAX_STORAGE_DAYS}일</span></span>
      </label>
    </div>

    <div className="iq-table-wrap"><table className="iq-table iq-day-table">
      <thead><tr><th>저장 {day}일 차</th>{metrics.map(m => <th key={m}>{storageMetricInfo[m].label} <small>{storageMetricInfo[m].unit}</small></th>)}</tr></thead>
      <tbody>
        <tr className="muted"><td>저장 시작 (0일)</td>{metrics.map(m => <td key={m}>{fmt(storageValue('cold', m, 0, init), storageMetricInfo[m].digits)}</td>)}</tr>
        {storageIds.map(s => <tr key={s}><td><i className="swatch" style={{background: storageInfo[s].color}} />{storageInfo[s].label}</td>
          {metrics.map(m => {const v = storageValue(s, m, day, init), v0 = storageValue(s, m, 0, init); return <td key={m}>{fmt(v, storageMetricInfo[m].digits)}<span className="delta">{v - v0 >= 0 ? '+' : '−'}{fmt(Math.abs(v - v0), storageMetricInfo[m].digits)}</span></td>;})}
        </tr>)}
      </tbody>
    </table></div>

    <div className="iq-mini-grid">
      {metrics.map(m => <div key={m} className="iq-mini">
        <div className="iq-mini-head"><h4>{storageMetricInfo[m].label} <small>{storageMetricInfo[m].unit}</small></h4><span>{storageMetricInfo[m].note}</span></div>
        <LineChart metric={m} init={init} day={day} />
      </div>)}
    </div>
    <div className="iq-legend">{storageIds.map(s => <span key={s}><i style={{background: storageInfo[s].color}} />{storageInfo[s].label}</span>)}</div>
    <details className="iq-formulas">
      <summary><Warehouse size={15} />저장 방식별 동적 예측식</summary>
      <div className="iq-table-wrap"><table className="iq-table">
        <thead><tr><th>항목</th>{storageIds.map(s => <th key={s}>{storageInfo[s].label}</th>)}</tr></thead>
        <tbody>{metrics.map(m => <tr key={m}><td>{storageMetricInfo[m].label}</td>{storageIds.map(s => <td key={s}><code>{storageFormula[m][s]}</code></td>)}</tr>)}</tbody>
      </table></div>
      <p>t는 저장 일수, y₀·S₀는 초기값입니다. 원자료의 저장 경도식은 N 단위로 제공되어 초기 경도와 단위 해석을 확인할 필요가 있습니다.</p>
    </details>
  </section>;
}

function LineChart({metric, init, day}: {metric: StorageMetric; init: Initial; day: number}) {
  const W = 320, H = 170, L = 44, R = 10, T = 10, B = 26, days = Array.from({length: 61}, (_, i) => i * 5);
  const series = storageIds.map(s => ({s, v: days.map(t => storageValue(s, metric, t, init))}));
  const all = series.flatMap(x => x.v); let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) {hi += 1; lo -= 1;} const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = (t: number) => L + t / MAX_STORAGE_DAYS * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const d = storageMetricInfo[metric].digits;
  return <svg viewBox={`0 0 ${W} ${H}`} className="iq-chart" role="img" aria-label={`${storageMetricInfo[metric].label} 저장 기간별 변화`}>
    {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{fmt(t, Math.min(d, 2))}</text></g>)}
    {[0, 100, 200, 300].map(t => <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="tick">{t}일</text>)}
    {series.map(({s, v}) => <path key={s} d={v.map((val, i) => `${i ? 'L' : 'M'}${x(days[i]).toFixed(1)},${y(val).toFixed(1)}`).join('')} fill="none" stroke={storageInfo[s].color} strokeWidth="2.2" strokeLinejoin="round" />)}
    <line x1={x(day)} x2={x(day)} y1={T} y2={H - B} className="marker" />
    {storageIds.map(s => <circle key={s} cx={x(day)} cy={y(storageValue(s, metric, day, init))} r="3.6" fill={storageInfo[s].color} stroke="var(--surface)" strokeWidth="1.5" />)}
  </svg>;
}

function downloadCsv(region: RegionId, inputs: Inputs, result: Record<MetricKey, number>) {
  const s = regionSummary(region);
  const lines = [
    ['구분', '항목', '값', '단위', 'R2', '평균오차(RMSE)'],
    ['산지', regions[region].name, '', '', '', ''],
    ...inputKeys.map(k => ['입력', `${inputInfo[k].label}(${inputInfo[k].code})`, String(inputs[k]), inputInfo[k].unit, '', '']),
    ...metricKeys.map(m => ['예측', metricInfo[m].label, result[m].toFixed(4), metricInfo[m].unit, regions[region].equations[m].r2.toFixed(4), s.rmse[m].toFixed(4)]),
  ];
  const csv = lines.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `초기품질예측_${regions[region].name}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
