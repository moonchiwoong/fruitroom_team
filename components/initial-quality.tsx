'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {ArrowDown, ArrowUp, Minus, Bookmark, BookmarkCheck, FolderOpen, Loader2, Save, Trash2, UserRound, CloudRain, Download, Info, MapPin, RotateCcw, Sprout, Thermometer, TriangleAlert, Warehouse} from 'lucide-react';
import {
  contributions, defaultInputs, inputInfo, inputKeys, MAX_STORAGE_DAYS, metricInfo, metricKeys, predictAll, predictMetric,
  regionIds, regions, regionSummary, reliability, samples,
  type InputKey, type Inputs, type MetricKey, type RegionId,
} from '@/lib/initial-quality';
import {useTeamSession} from '@/components/team-auth';
import {deletePrediction, listPredictions, savePrediction, type SavedPrediction} from '@/lib/my-predictions';

const fmt = (v: number, d: number) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', {minimumFractionDigits: d, maximumFractionDigits: d}) : '—');
const inputIcon: Record<InputKey, typeof CloudRain> = {rain9: CloudRain, lc56: Sprout, lc78: Sprout, min4: Thermometer};

export default function InitialQuality() {
  const session = useTeamSession();
  const home = session?.profile.region || 'cheongsong';
  // 내 기본값(산지·기상값)이 있으면 그 값으로 시작합니다.
  const startInputs = (r: RegionId) => r === session?.profile.region && session?.profile.default_inputs ? session.profile.default_inputs : defaultInputs(r);
  const [region, setRegion] = useState<RegionId>(home);
  const [text, setText] = useState<Record<InputKey, string>>(() => toText(startInputs(home)));
  const [saved, setSaved] = useState<SavedPrediction[] | null>(null), [savedError, setSavedError] = useState('');
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(''), [flash, setFlash] = useState('');
  const [weatherKind, setWeatherKind] = useState<'관측 기상값' | '가정값'>('가정값'), [showScatter, setShowScatter] = useState(false);
  const refreshSaved = useCallback(() => { listPredictions().then(r => { setSaved(r); setSavedError(''); }).catch(e => { setSaved([]); setSavedError((e as Error).message); }); }, []);
  useEffect(() => { if (session) refreshSaved(); }, [session?.userId, refreshSaved]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(''), 3500); return () => clearTimeout(t); }, [flash]);
  const [metric, setMetric] = useState<MetricKey>('firmness');
  const summary = regionSummary(region);

  const inputs = useMemo(() => Object.fromEntries(inputKeys.map(k => [k, parseFloat(text[k])])) as Inputs, [text]);
  const valid = inputKeys.every(k => Number.isFinite(inputs[k]));
  const outside = valid ? inputKeys.filter(k => inputs[k] < summary.inputRange[k].min || inputs[k] > summary.inputRange[k].max) : [];
  const result = valid ? predictAll(region, inputs) : null;

  function chooseRegion(r: RegionId) { setRegion(r); setText(toText(startInputs(r))); }
  async function saveRecord() {
    if (!result) return; setBusy('save');
    try { const rec = await savePrediction({region, title: title.trim() || `${regions[region].name} · ${new Date().toLocaleDateString('ko-KR')}`, inputs, result}); setSaved(s => [rec, ...(s ?? [])]); setTitle(''); setFlash('예측 기록에 저장했어요.'); }
    catch (e) { setFlash((e as Error).message); } finally { setBusy(''); }
  }
  async function saveDefaults() {
    if (!session || !valid) return; setBusy('default');
    const err = await session.saveProfile({region, default_inputs: inputs}); setBusy(''); setFlash(err ?? '이 산지와 기상값을 내 기본값으로 저장했어요.');
  }
  function openRecord(r: SavedPrediction) { setRegion(r.region); setText(toText(r.inputs)); window.scrollTo({top: 0, behavior: 'smooth'}); setFlash(`‘${r.title}’ 기록을 불러왔어요.`); }
  async function removeRecord(r: SavedPrediction) {
    if (!window.confirm(`‘${r.title}’ 기록을 삭제할까요?`)) return;
    try { await deletePrediction(r.id); setSaved(s => (s ?? []).filter(x => x.id !== r.id)); } catch (e) { setFlash((e as Error).message); }
  }
  const isMyDefault = !!session?.profile.default_inputs && session.profile.region === region && inputKeys.every(k => session.profile.default_inputs![k] === inputs[k]);
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
            <span className="iq-region-best">학습 R²가 가장 높은 항목 <b>{metricInfo[best].label} {regions[r].equations[best].r2.toFixed(2)}</b></span>
          </button>;
        })}
      </div>
    </section>

    <div className="iq-columns">
      <section className="iq-step iq-card">
        <StepTitle n={2} title="기상 조건 입력" desc={`${regions[region].name} 학습 데이터 평균으로 채워 두었습니다.`} />
        <div className="iq-kind"><span>입력한 기상값의 종류</span><div className="seg">{(['관측 기상값', '가정값'] as const).map(k => <button key={k} className={weatherKind === k ? 'active' : ''} aria-pressed={weatherKind === k} onClick={() => setWeatherKind(k)}>{k}</button>)}</div>
          <small>학습 평균·연도 평균은 해당 연도의 실제 관측값이 아니므로 ‘가정값’입니다.</small></div>
        <div className="iq-presets">
          <label>연도 평균 불러오기
            <select value="" onChange={e => loadYear(e.target.value)} aria-label="연도 평균 불러오기">
              <option value="">연도 선택</option>
              {summary.yearMeans.map(m => <option key={m.year} value={m.year}>{m.year}년 평균</option>)}
            </select>
          </label>
          <button className="btn btn-ghost" onClick={() => setText(toText(defaultInputs(region)))}><RotateCcw size={15} />전체 평균값</button>
          {session?.profile.default_inputs && session.profile.region === region && <button className="btn btn-ghost" onClick={() => setText(toText(session.profile.default_inputs!))}><UserRound size={15} />내 기본값</button>}
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
        <StepTitle n={3} title="회귀식 계산값" desc={`수확 직후 품질의 회귀식 계산값 · 입력 기상값: ${weatherKind}`} />
        {!valid && <div className="iq-alert"><TriangleAlert size={16} />모든 기상 값을 숫자로 입력해 주세요.</div>}
        {outside.length > 0 && <div className="iq-alert"><TriangleAlert size={16} /><span><b>{outside.map(k => inputInfo[k].label).join(', ')}</b> 값이 학습 데이터 범위를 벗어났습니다. 범위 밖 예측은 오차가 커질 수 있어요.</span></div>}
        {result && <div className="iq-results">
          {metricKeys.map(m => {
            const info = metricInfo[m], eq = regions[region].equations[m], rel = reliability(eq.r2), diff = result[m] - summary.actualMean[m];
            return <button key={m} className={'iq-result' + (metric === m ? ' active' : '')} onClick={() => setMetric(m)} aria-pressed={metric === m}>
              <span className="iq-result-label">{info.label}<em className={'rel rel-' + rel.level}>{rel.label}</em></span>
              <strong>{fmt(result[m], info.digits)}<small>{info.unit}</small></strong>
              <span className="iq-result-err">학습 RMSE: {fmt(summary.rmse[m], info.digits)} {info.unit} · 학습 R² {eq.r2.toFixed(2)}</span>
              {Math.abs(diff) < summary.rmse[m] * 0.1
                ? <span className="iq-result-diff same"><Minus size={13} />산지 평균({fmt(summary.actualMean[m], info.digits)})과 비슷</span>
                : <span className={'iq-result-diff ' + (diff >= 0 ? 'up' : 'down')}>{diff >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}산지 평균 {fmt(summary.actualMean[m], info.digits)}보다 {fmt(Math.abs(diff), info.digits)} {diff >= 0 ? '높음' : '낮음'}</span>}
            </button>;
          })}
        </div>}
        {result && session && <div className="iq-save">
          <div className="iq-save-row">
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder={`기록 이름 (예: ${regions[region].name} 우리 과원 ${new Date().getFullYear()})`} aria-label="예측 기록 이름" />
            <button className="btn btn-primary" onClick={saveRecord} disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="spin" size={15} /> : <Save size={15} />}기록 저장</button>
          </div>
          <div className="iq-save-row">
            <button className="btn btn-outline" onClick={saveDefaults} disabled={busy === 'default' || isMyDefault}>{isMyDefault ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}{isMyDefault ? '내 기본값과 같아요' : '이 값을 내 기본값으로'}</button>
            <button className="btn btn-outline" onClick={() => downloadCsv(region, inputs, result, weatherKind)}><Download size={15} />CSV 저장</button>
          </div>
          {flash && <p className="iq-flash" role="status">{flash}</p>}
        </div>}
        {result && !session && <button className="btn btn-outline iq-download" onClick={() => downloadCsv(region, inputs, result, weatherKind)}><Download size={15} />예측 결과 CSV 저장</button>}
      </section>
    </div>

    {result && <button className="btn btn-outline iq-scatter-btn" aria-expanded={showScatter} onClick={() => setShowScatter(v => !v)}>{showScatter ? '기상요인 산포도 접기' : '기상요인 산포도 자세히 보기'}</button>}
    {result && showScatter && <div className="iq-columns iq-analysis">
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


    {session && <section className="iq-card" id="my-predictions">
      <div className="iq-card-head"><div><h3><FolderOpen size={18} />내 예측 기록</h3><p>저장한 예측은 나만 볼 수 있어요. 불러오면 그때의 산지와 기상값으로 다시 계산합니다.</p></div></div>
      {saved === null ? <div className="loading-strip"><Loader2 className="spin" size={16} />불러오는 중…</div>
        : savedError ? <div className="iq-alert">{savedError}</div>
        : !saved.length ? <p className="iq-empty">아직 저장한 예측이 없어요. 위에서 ‘기록 저장’을 눌러 보세요.</p>
        : <div className="iq-table-wrap"><table className="iq-table iq-saved">
          <thead><tr><th>기록</th><th>산지</th>{metricKeys.map(m => <th key={m}>{metricInfo[m].label} <small>{metricInfo[m].unit}</small></th>)}<th>저장일</th><th /></tr></thead>
          <tbody>{saved.map(r => <tr key={r.id}>
            <td className="iq-saved-title">{r.title}</td><td>{regions[r.region]?.name ?? r.region}</td>
            {metricKeys.map(m => <td key={m}>{fmt(r.result[m], metricInfo[m].digits)}</td>)}
            <td>{new Date(r.created_at).toLocaleDateString('ko-KR')}</td>
            <td className="iq-saved-actions"><button className="btn btn-ghost" onClick={() => openRecord(r)}>불러오기</button><button className="btn btn-ghost iq-del" onClick={() => removeRecord(r)} aria-label={`${r.title} 삭제`}><Trash2 size={15} /></button></td>
          </tr>)}</tbody>
        </table></div>}
    </section>}

    <section className="iq-card iq-method">
      <div className="iq-card-head"><div><h3><Info size={17} />계산 방법과 한계</h3></div></div>
      <ul>
        <li>산지별 학습 자료 {summary.count}건({summary.years[0]}~{summary.years.at(-1)}년)에 다중선형회귀를 적합한 식입니다. 기상 값 4개로 수확 직후 품질 5개 항목을 계산합니다.</li>
        <li><b>학습 R²·학습 RMSE</b>는 식을 만든 같은 자료에서 잰 적합도입니다. <b>별도 평가 성능: 평가 자료가 없어 표시하지 않습니다.</b> 개별 과실의 예측구간이나 신뢰구간이 아닙니다.</li>
        <li>학습 범위를 벗어난 입력은 외삽이라 경고를 보여 드립니다. 개별 과원의 관리 방식·수세·수확 시기는 식에 들어 있지 않습니다.</li>
        <li>여기의 경도는 <b>N/mm(강성)</b>입니다. 실측 입력과 저장 모델의 경도(N, 힘)와 다른 지표라 저장 중 변화 계산의 초기값으로 연결하지 않습니다.</li>
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

function downloadCsv(region: RegionId, inputs: Inputs, result: Record<MetricKey, number>, weatherKind: string) {
  const s = regionSummary(region);
  const lines = [
    ['구분', '항목', '값', '단위', '학습 R2', '학습 RMSE'],
    ['산지', regions[region].name, '', '', '', ''],
    ['입력 기상값 종류', weatherKind, '', '', '', ''],
    ['별도 평가 성능', '평가 자료 없음', '', '', '', ''],
    ...inputKeys.map(k => ['입력', `${inputInfo[k].label}(${inputInfo[k].code})`, String(inputs[k]), inputInfo[k].unit, '', '']),
    ...metricKeys.map(m => ['회귀식 계산값', metricInfo[m].label, result[m].toFixed(4), metricInfo[m].unit, regions[region].equations[m].r2.toFixed(4), s.rmse[m].toFixed(4)]),
  ];
  const csv = lines.map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `초기품질예측_${regions[region].name}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
