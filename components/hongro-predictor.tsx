'use client';

import {useEffect, useMemo, useRef, useState, type FormEvent} from 'react';
import {AlertTriangle, BookOpen, Check, ChevronDown, Download, LineChart, RotateCcw} from 'lucide-react';
import {rowsToCsv} from '@/lib/csv';
import {
  calculateHongro, HONGRO_DELTA_UNITS, HONGRO_DISCLAIMER, HONGRO_MODEL_VERSION, HONGRO_REGRESSION,
  HONGRO_SOURCE_FILES, HONGRO_STORAGE_EQUATIONS, HONGRO_STORAGE_LABELS, HONGRO_SUGAR_EQUATION_CONFLICT,
  HONGRO_UNITS, HONGRO_UNITS_CONFLICT, HONGRO_WEATHER_FIELDS, type HongroResult,
} from '@/lib/hongro';

type Metric = 'firmness' | 'acidity' | 'brix';
type InitialKey = Metric | 'weight' | 'diameter';
type WeatherKey = 'chang_min4' | 'chang_LC56' | 'chang_LC78' | 'chang_9rain';
type Storage = 'cold0' | 'cold4';
type HongroForm = {
  source: 'measured' | 'weather'; storage: Storage; days: string;
  initial: Record<InitialKey, string>; weather: Record<WeatherKey, string>;
};
const metrics: Metric[] = ['firmness', 'acidity', 'brix'];
const initialKeys: InitialKey[] = [...metrics, 'weight', 'diameter'];
const weatherKeys: WeatherKey[] = ['chang_min4', 'chang_LC56', 'chang_LC78', 'chang_9rain'];
const metricLabels: Record<InitialKey, string> = {firmness: '경도', acidity: '산도', brix: '당도', weight: '중량', diameter: '횡경'};
const digits: Record<InitialKey, number> = {firmness: 2, acidity: 4, brix: 2, weight: 2, diameter: 2};
const blankForm = (): HongroForm => ({source: 'measured', storage: 'cold0', days: '0', initial: {firmness: '', acidity: '', brix: '', weight: '', diameter: ''}, weather: {chang_min4: '', chang_LC56: '', chang_LC78: '', chang_9rain: ''}});
const draftKey = (userId: string) => `appletrack:hongro:draft:v1:${encodeURIComponent(userId)}`;
const numeric = (value: string): number | undefined => value.trim() === '' ? undefined : Number(value);
const format = (value: number, key: InitialKey) => value.toLocaleString('ko-KR', {maximumFractionDigits: digits[key]});
const change = (value: number, key: Metric) => `${value > 0 ? '+' : ''}${format(value, key)} ${HONGRO_DELTA_UNITS[key]}`;

function readForm(value: unknown): HongroForm | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Partial<HongroForm>;
  const strings = (o: unknown, keys: string[]) => !!o && typeof o === 'object' && keys.every(k => typeof (o as Record<string, unknown>)[k] === 'string' && String((o as Record<string, unknown>)[k]).length < 100);
  if ((d.source !== 'measured' && d.source !== 'weather') || (d.storage !== 'cold0' && d.storage !== 'cold4') || typeof d.days !== 'string' || d.days.length >= 100 || !strings(d.initial, initialKeys) || !strings(d.weather, weatherKeys)) return null;
  return {source: d.source, storage: d.storage, days: d.days, initial: {...d.initial!}, weather: {...d.weather!}};
}

function evaluate(form: HongroForm): {result: HongroResult | null; errors: Record<string, string>; message: string} {
  const errors: Record<string, string> = {}, day = numeric(form.days);
  if (day === undefined || !Number.isFinite(day) || day < 0 || day > 120) errors.days = '저장일은 0~120일의 유한한 숫자로 입력해 주세요. 범위 밖에서는 결과를 제공하지 않습니다.';
  if (form.source === 'measured') {
    for (const key of initialKeys) {
      const value = numeric(form.initial[key]);
      if (value === undefined && metrics.includes(key as Metric)) errors[`initial.${key}`] = `${metricLabels[key]} 초기값을 입력해 주세요.`;
      else if (value !== undefined && (!Number.isFinite(value) || value < 0)) errors[`initial.${key}`] = '0 이상의 유한한 숫자를 입력해 주세요.';
    }
  } else {
    for (const key of weatherKeys) {
      const value = numeric(form.weather[key]);
      if (value === undefined || !Number.isFinite(value)) errors[`weather.${key}`] = '기상값을 입력해 주세요. 빈값은 0으로 바꾸지 않습니다.';
    }
  }
  if (Object.keys(errors).length) return {result: null, errors, message: '필수 입력값과 저장일 범위를 확인해 주세요.'};
  const common = {cultivar: 'hongro', region: 'geochang', storage: form.storage, days: day};
  const input = form.source === 'measured'
    ? {...common, source: 'measured', initial: Object.fromEntries(initialKeys.filter(k => form.initial[k].trim() !== '').map(k => [k, numeric(form.initial[k])]))}
    : {...common, source: 'weather', weather: Object.fromEntries(weatherKeys.map(k => [k, numeric(form.weather[k])]))};
  try { return {result: calculateHongro(input), errors, message: ''}; }
  catch (error) { return {result: null, errors, message: error instanceof Error ? error.message : '입력 조건으로 계산할 수 없습니다.'}; }
}

export default function HongroPredictor({userId}: {userId: string}) {
  const [form, setForm] = useState<HongroForm>(blankForm);
  const [readyUser, setReadyUser] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [compare, setCompare] = useState(false);
  const [draftStatus, setDraftStatus] = useState<{tone: 'ok' | 'warn' | 'info'; text: string}>({tone: 'info', text: '입력 내용을 이 기기에 자동으로 임시 저장합니다.'});
  const resultsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setForm(blankForm()); setSubmitted(false); setCompare(false);
    try {
      const raw = localStorage.getItem(draftKey(userId));
      if (raw) {
        const saved = JSON.parse(raw) as {version?: number; form?: unknown; savedAt?: string};
        const restored = saved.version === 1 ? readForm(saved.form) : null;
        if (!restored) throw new Error('invalid draft');
        setForm(restored);
        setDraftStatus({tone: 'info', text: '이 계정으로 작성하던 홍로 입력을 복구했습니다. 품질 변화 보기를 눌러 다시 계산하세요.'});
      } else setDraftStatus({tone: 'info', text: '입력 내용을 이 기기에 자동으로 임시 저장합니다.'});
    } catch { setDraftStatus({tone: 'warn', text: '초안을 읽지 못했습니다. 새 입력으로 시작합니다.'}); }
    setReadyUser(userId);
  }, [userId]);
  const ready = readyUser === userId;
  const evaluation = useMemo(() => evaluate(form), [form]);
  const result = ready && submitted ? evaluation.result : null;
  const day = numeric(form.days), dayValid = day !== undefined && Number.isFinite(day) && day >= 0 && day <= 120;
  function update(next: HongroForm) {
    if (!ready) return;
    setForm(next);
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(draftKey(userId), JSON.stringify({version: 1, form: next, savedAt}));
      setDraftStatus({tone: 'ok', text: `이 기기에 임시 저장됨 · ${new Date(savedAt).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'})}`});
    } catch { setDraftStatus({tone: 'warn', text: '임시 저장에 실패했습니다. 새로고침 전에 필요한 값을 별도로 보관해 주세요.'}); }
  }
  function reset() {
    setForm(blankForm()); setSubmitted(false); setCompare(false);
    try { localStorage.removeItem(draftKey(userId)); setDraftStatus({tone: 'info', text: '이 계정의 홍로 초안을 지웠습니다.'}); }
    catch { setDraftStatus({tone: 'warn', text: '화면은 비웠지만 이 기기의 초안은 삭제하지 못했습니다.'}); }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); setSubmitted(true);
    if (!evaluation.result) {
      const key = Object.keys(evaluation.errors)[0];
      document.getElementById(key ? `hongro-${key.replace('.', '-')}` : 'hongro-calculation-error')?.focus();
    } else requestAnimationFrame(() => resultsRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'}));
  }
  const fieldError = (key: string, raw: string) => submitted || raw !== '' ? evaluation.errors[key] : undefined;
  if (!ready) return <div className="loading-strip" role="status">이 계정의 홍로 입력을 불러오는 중…</div>;

  return <div id="hongro-predictor" className="hongro-predictor">
    <div className="hongro-heading"><div><span className="qt-section-label">홍로 · 거창</span><h2>홍로 저장 품질 예측</h2></div><span className="kind k-example">수식 기반 계산 · 검증 미확인</span></div>
    <p className="hongro-disclaimer">{HONGRO_DISCLAIMER}</p>
    <div className="hongro-layout">
      <form className="hongro-input" onSubmit={submit} noValidate>
        <section className="hongro-panel" aria-labelledby="hongro-input-heading"><h3 id="hongro-input-heading">초기 품질 입력</h3>
          <div className="seg hongro-source" role="radiogroup" aria-label="초기값 입력 방식">
            <button type="button" id="hongro-source-measured" role="radio" aria-checked={form.source === 'measured'} className={form.source === 'measured' ? 'active' : ''} onClick={() => update({...form, source: 'measured'})}>직접 입력</button>
            <button type="button" id="hongro-source-weather" role="radio" aria-checked={form.source === 'weather'} className={form.source === 'weather' ? 'active' : ''} onClick={() => update({...form, source: 'weather'})}>기상 회귀 추정</button>
          </div>
          {form.source === 'measured' ? <><p className="qt-help">초기 경도·산도·당도는 필수입니다. 직접 측정한 값을 해당 단위로 입력하세요.</p><div className="hongro-fields">
            {initialKeys.map(key => <NumberField key={key} id={`hongro-initial-${key}`} label={key === 'firmness' ? '경도(N, 직경 11mm 탐침)' : `${metricLabels[key]} (${HONGRO_UNITS[key]})`} value={form.initial[key]} onChange={value => update({...form, initial: {...form.initial, [key]: value}})} error={fieldError(`initial.${key}`, form.initial[key])} optional={key === 'weight' || key === 'diameter'} min={0} />)}
          </div><p className="qt-help">중량·횡경은 초기값만 표시합니다. 저장 중 변화 모델은 없습니다.</p></> : <><p className="qt-help">4개 기상변수를 모두 입력하세요. 초기 품질은 회귀 추정값이며 실측값이 아닙니다.</p><div className="hongro-fields">
            {HONGRO_WEATHER_FIELDS.map(field => <NumberField key={field.key} id={`hongro-weather-${field.key}`} label={`${field.label} (${field.unit})`} value={form.weather[field.key]} onChange={value => update({...form, weather: {...form.weather, [field.key]: value}})} error={fieldError(`weather.${field.key}`, form.weather[field.key])} hint={`변수 ${field.key} · 합성 참고자료 ${field.reference.min}~${field.reference.max} (검증 적용범위 아님)`} />)}
          </div><p className="qt-help">위 변수 정의와 단위에 맞는 기상값을 입력하세요. 참고자료 범위만으로 적용 가능성을 판단하지 않습니다.</p></>}
          <div className="hongro-unit-note"><AlertTriangle size={15} /><p>경도 단위 확인 필요: 제공 이미지의 N/mm 표기와 사용자 지정·PDF의 N(직경 11mm 탐침)이 다릅니다. 초기 회귀자료와 저장식의 측정 기준이 같은지 확인이 필요합니다.</p></div>
        </section>
        <section className="hongro-panel" aria-labelledby="hongro-storage-heading"><h3 id="hongro-storage-heading">저장 조건</h3>
          <div className="seg hongro-storage" role="radiogroup" aria-label="홍로 저장 조건">{(['cold0', 'cold4'] as Storage[]).map(storage => <button type="button" id={`hongro-storage-${storage}`} key={storage} role="radio" aria-checked={form.storage === storage} className={form.storage === storage ? 'active' : ''} onClick={() => update({...form, storage})}>{HONGRO_STORAGE_LABELS[storage]}</button>)}</div>
          <NumberField id="hongro-days" label="저장일 (일)" value={form.days} min={0} max={120} onChange={days => update({...form, days})} error={fieldError('days', form.days)} hint="0~120일 · 소수 입력 가능 · 범위 밖 외삽 없음" />
          <label className="hongro-slider-label" htmlFor="hongro-day-slider">저장일 선택 <strong>{dayValid ? `${day}일` : '입력값 확인 필요'}</strong></label>
          <input id="hongro-day-slider" className="qt-slider" type="range" min={0} max={120} step="any" value={dayValid ? day : 0} aria-valuetext={dayValid ? `${day}일` : '숫자 입력이 유효하지 않습니다. 슬라이더로 저장일을 다시 선택하세요.'} onChange={event => update({...form, days: event.target.value})} />
          <div className="qt-range-ends"><span>0일 · 저장 시작</span><span>120일</span></div>
        </section>
        <button type="submit" id="hongro-calculate" className="btn btn-primary"><LineChart size={17} />품질 변화 보기</button>
        <div className={`hongro-draft draft-${draftStatus.tone}`} role="status">{draftStatus.tone === 'ok' && <Check size={14} />}{draftStatus.text}</div>
        <button type="button" className="linkbtn hongro-reset" onClick={reset}><RotateCcw size={13} />홍로 입력 초기화</button>
        <p className="qt-help">이 화면의 입력은 이 기기의 계정별 초안으로만 보관됩니다. Supabase 정식 물량·측정 기록에는 저장하지 않습니다.</p>
      </form>

      <div className="hongro-output">
        {submitted && !result ? <section id="hongro-calculation-error" className="hongro-empty hongro-error" role="alert" tabIndex={-1}><AlertTriangle size={26} /><h3>계산 결과를 표시할 수 없습니다</h3><p>{evaluation.errors.days || evaluation.message}</p><p className="qt-help">입력을 수정하면 다시 계산합니다. 이전 결과를 대신 표시하지 않습니다.</p></section> : !result ? <section className="hongro-empty"><LineChart size={30} /><h3>초기 품질에서 시작하세요</h3><p>직접 측정한 값을 입력하거나 기상 회귀 추정을 선택한 뒤, 품질 변화 보기를 누르세요.</p><p className="qt-help">홍로·거창 전용 · 0℃와 4℃ · 0~120일</p></section> : <section id="hongro-results" ref={resultsRef} className="hongro-results" aria-label="홍로 품질 예측 결과">
          <div className="hongro-result-heading"><div><span className="qt-section-label">{HONGRO_STORAGE_LABELS[form.storage]}</span><h3>저장 {result.input.days}일의 예상 품질</h3></div><span className={`kind ${form.source === 'weather' ? 'k-example' : 'k-measured'}`}>{form.source === 'weather' ? '초기값: 기상 회귀 추정' : '초기값: 직접 입력'}</span></div>
          <div className="hongro-metric-grid">{metrics.map(metric => <article key={metric} className="hongro-metric" data-hongro-metric={metric}><h4>{metric === 'firmness' ? '경도(N, 직경 11mm 탐침)' : `${metricLabels[metric]} (${HONGRO_UNITS[metric]})`}</h4><p className="hongro-predicted"><strong data-value="predicted">{format(result.predicted[metric], metric)}</strong><small>{HONGRO_UNITS[metric]}</small></p><dl><div><dt>초기 품질</dt><dd data-value="initial">{format(result.initial[metric], metric)} {HONGRO_UNITS[metric]}</dd></div><div><dt>초기 대비 변화량</dt><dd data-value="delta">{change(result.delta[metric], metric)}</dd></div></dl></article>)}</div>
          <div className="hongro-initial-only">{(['weight', 'diameter'] as const).map(metric => <div key={metric}><span>초기 {metricLabels[metric]}</span><strong data-hongro-initial={metric}>{result.initial[metric] === undefined ? '미입력' : `${format(result.initial[metric]!, metric)} ${HONGRO_UNITS[metric]}`}</strong><small>저장 중 변화 모델 없음</small></div>)}</div>
          <p className="qt-help hongro-sugar-note"><strong>모델에서 저장 중 당도 변화를 반영하지 않음</strong> · S(t)=S₀ 식을 적용해 초기값을 유지합니다. 실제로 당도가 변하지 않는다는 뜻은 아닙니다.</p>
          {result.warnings.length > 0 && <div className="hongro-result-warnings">{result.warnings.map((warning, index) => <p className="qt-help" key={index}><AlertTriangle size={13} /> {warning}</p>)}</div>}
          <label className="qt-check hongro-compare-control"><input id="hongro-compare" type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)} />동일한 초기값으로 0℃·4℃ 비교</label>
          {compare && <div className="qt-table-wrap hongro-compare-table"><table className="qt-table"><caption>저장 {result.input.days}일 · 두 조건 모두 같은 초기값 사용</caption><thead><tr><th>지표</th><th>0℃</th><th>4℃</th><th>4℃ − 0℃</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric}><th>{metricLabels[metric]}<small> ({HONGRO_UNITS[metric]})</small></th><td>{format(result.comparison.cold0.predicted[metric], metric)}</td><td>{format(result.comparison.cold4.predicted[metric], metric)}</td><td>{change(result.comparison.cold4.predicted[metric] - result.comparison.cold0.predicted[metric], metric)}</td></tr>)}</tbody></table></div>}
          <div className="hongro-chart-list">{metrics.map(metric => <HongroChart key={metric} metric={metric} result={result} compare={compare} onSelect={days => update({...form, days: String(days)})} />)}</div>
          <p className="qt-help">그래프는 저장 0~120일의 수식 계산입니다. 선은 실측 이력이 아니며, 각 지표의 세로축 단위가 다릅니다. 그래프나 저장일 슬라이더에서 날짜를 선택할 수 있습니다.</p>
        </section>}
        <button id="hongro-export" type="button" className="btn btn-outline hongro-export" disabled={!result} onClick={() => { if (result) exportHongro(result); }}><Download size={16} />홍로 결과 CSV 내보내기</button>
        <HongroSources result={evaluation.result} />
      </div>
    </div>
  </div>;
}

function NumberField({id, label, value, onChange, error, hint, optional, min, max}: {id: string; label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; optional?: boolean; min?: number; max?: number}) {
  return <div className={`qf${error ? ' has-err' : ''}`}><label className="qf-label" htmlFor={id}>{label}{optional && <small> · 선택</small>}</label><input id={id} type="number" inputMode="decimal" step="any" min={min} max={max} value={value} onChange={event => onChange(event.target.value)} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-note` : undefined} />{(error || hint) && <span id={`${id}-note`} className={error ? 'qf-err' : 'qf-hint'}>{error || hint}</span>}</div>;
}

function HongroChart({metric, result, compare, onSelect}: {metric: Metric; result: HongroResult; compare: boolean; onSelect: (day: number) => void}) {
  const holder = useRef<HTMLDivElement>(null), [width, setWidth] = useState(680);
  useEffect(() => { const element = holder.current; if (!element) return; const resize = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width))); resize.observe(element); return () => resize.disconnect(); }, []);
  const W = Math.max(260, Math.min(width, 1000)), H = 205, L = 48, R = 15, T = 26, B = 38;
  const values = (compare ? [...result.comparison.cold0.series, ...result.comparison.cold4.series] : result.series).map(point => point[metric]);
  const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * 0.12, metric === 'acidity' ? 0.005 : 0.2);
  const lo = Math.max(0, min - pad), hi = max + pad;
  const x = (day: number) => L + day / 120 * (W - L - R), y = (value: number) => T + (hi - value) / (hi - lo) * (H - T - B);
  const path = (series: HongroResult['series']) => series.map((point, index) => `${index ? 'L' : 'M'}${x(point.days).toFixed(2)},${y(point[metric]).toFixed(2)}`).join('');
  return <article className="hongro-chart"><div className="hongro-chart-heading"><h4>{metricLabels[metric]} 저장 변화</h4><span>{HONGRO_UNITS[metric]}</span></div><div ref={holder}><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metricLabels[metric]} 저장 변화 그래프 · ${HONGRO_UNITS[metric]}`} className="hongro-svg" onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); onSelect(Math.round(Math.max(0, Math.min(120, ((event.clientX - rect.left) / rect.width * W - L) / (W - L - R) * 120)) * 10) / 10); }}>
    <title>{metricLabels[metric]} · {HONGRO_UNITS[metric]} · 0~120일 수식 계산</title>
    {[0, 0.5, 1].map(fraction => { const value = lo + (hi - lo) * fraction; return <g key={fraction}><line x1={L} x2={W - R} y1={y(value)} y2={y(value)} className="hongro-gridline" /><text x={L - 7} y={y(value) + 4} textAnchor="end">{format(value, metric)}</text></g>; })}
    {[0, 30, 60, 90, 120].map(day => <text key={day} x={x(day)} y={H - B + 20} textAnchor="middle">{day}</text>)}<text x={(L + W - R) / 2} y={H - 2} textAnchor="middle">저장일 (일)</text>
    {compare ? <><path d={path(result.comparison.cold0.series)} className="hongro-line cold0" /><path d={path(result.comparison.cold4.series)} className="hongro-line cold4" /></> : <path d={path(result.series)} className={`hongro-line ${result.input.storage}`} />}
    <line x1={x(result.input.days)} x2={x(result.input.days)} y1={T} y2={H - B} className="hongro-selected-line" /><circle cx={x(result.input.days)} cy={y(result.predicted[metric])} r={4} className={`hongro-selected ${result.input.storage}`} />
  </svg></div><div className="hongro-legend">{(compare ? ['cold0', 'cold4'] as const : [result.input.storage]).map(storage => <span key={storage}><i className={storage} />{HONGRO_STORAGE_LABELS[storage]}</span>)}<span>선택 {result.input.days}일</span></div></article>;
}

function HongroSources({result}: {result: HongroResult | null}) {
  return <details className="qt-basis hongro-sources"><summary><BookOpen size={16} />계수·출처·적용 범위<ChevronDown size={15} /></summary><div>
    <p><strong>홍로·거창 전용 모델</strong> · 저장 방식은 0℃ 또는 4℃ 저온저장만 선택할 수 있으며, 계산 범위는 0~120일입니다. 품종·산지·저장 조건이 다르면 이 식을 적용하지 않습니다.</p>
    <p>{HONGRO_UNITS_CONFLICT}</p>
    <p>PDF의 측정법은 직경 11mm 탐침으로 적도 부위의 과피를 제거한 뒤 과실당 3회 측정한 평균을 Newton(N)으로 표시합니다. 이미지의 N/mm를 N으로 환산한 것이 아니라, 사용자 명세·PDF의 N 표기를 따릅니다.</p>
    <p>결정계수 R²는 초기 품질 회귀식의 자료 내 설명력입니다. 예측 정확도나 저장 모델 검증 성능으로 해석하지 않습니다.</p>
    <div className="qt-table-wrap hongro-coefficients"><table className="qt-table"><caption>제공 이미지의 초기 품질 회귀 계수 · 재학습하지 않은 원래 계수</caption><thead><tr><th>지표·단위</th><th>절편</th><th>chang_LC56</th><th>chang_LC78</th><th>chang_9rain</th><th>chang_min4</th><th>결정계수 R²</th></tr></thead><tbody>{(['diameter', 'weight', 'firmness', 'brix', 'acidity'] as const).map(metric => <tr key={metric}><th>{metricLabels[metric]}<br /><small>{HONGRO_UNITS[metric]}</small></th>{(['intercept', 'chang_LC56', 'chang_LC78', 'chang_9rain', 'chang_min4'] as const).map(key => <td key={key}>{HONGRO_REGRESSION[metric][key].toFixed(6)}</td>)}<td>{HONGRO_REGRESSION[metric].r2.toFixed(4)}</td></tr>)}</tbody></table></div>
    <p>초기값 = 절편 + Σ(변수별 계수 × 기상값). 특히 경도 회귀식의 R²는 0.2495입니다. chang_200.xlsx의 200건은 합성 참고자료이며 실제 농가에 대한 검증 자료가 아닙니다.</p>
    <div className="qt-table-wrap hongro-equations"><table className="qt-table"><caption>저장 변화식 · t는 저장일, F₀·A₀·S₀는 동일 초기값</caption><thead><tr><th>지표</th><th>0℃ 저온저장</th><th>4℃ 저온저장</th></tr></thead><tbody>{metrics.map(metric => <tr key={metric}><th>{metricLabels[metric]}<small> ({HONGRO_UNITS[metric]})</small></th><td>{HONGRO_STORAGE_EQUATIONS.cold0[metric]}</td><td>{HONGRO_STORAGE_EQUATIONS.cold4[metric]}</td></tr>)}</tbody></table></div>
    <p>{HONGRO_SUGAR_EQUATION_CONFLICT} 원문 비고의 0.4/0.3 °Brix 감소는 식에 추가하지 않습니다.</p>
    <dl className="hongro-model-metadata"><div><dt>모델 버전</dt><dd>{HONGRO_MODEL_VERSION}</dd></div><div><dt>저장 모델</dt><dd>사용자 제공 구간 선형식</dd></div><div><dt>검증 상태</dt><dd>독립 예측 성능 검증 미완료 · 0~120일은 팀 모델 구현 범위</dd></div>{result && <div><dt>초기값 구분</dt><dd>{result.metadata.initialKind}</dd></div>}</dl>
    <p>참고 PDF의 저장 실험은 홍로/M.9, 4개월 조건입니다. 문헌의 실험 조건과 이 구현 범위가 독립적으로 검증된 적용 기간을 뜻하지는 않습니다.</p>
    <p>출처: {HONGRO_SOURCE_FILES.join(' / ')}</p>
    <p>중량·횡경의 저장 중 변화는 계산하지 않습니다. 3D 외관이나 감모율을 이 모델 결과와 연결하지 않습니다.</p>
    <p>{HONGRO_DISCLAIMER}</p>
  </div></details>;
}

function exportHongro(result: HongroResult) {
  const meta = result.metadata, rows: (string | number)[][] = [
    ['애플트랙 홍로·거창 품질 예측'], ['내보낸 시각', new Date().toISOString()], ['모델 ID·버전', meta.modelVersion], ['저장 모델 설명', meta.storageModel],
    ['품종', 'hongro', '홍로'], ['산지', 'geochang', '거창'], ['초기값 source', result.input.source, meta.initialKind], ['저장 방식', result.input.storage, HONGRO_STORAGE_LABELS[result.input.storage]], ['선택 저장일', result.input.days, '일'],
    ['계산 적용 범위', 0, 120, '일'], ['외삽', '범위 밖 결과 제공 안 함'], ['검증 상태', meta.validation], ['출처 파일', ...meta.sourceFiles], ['정식 기록 저장', '없음 · 이 기기의 사용자별 초안'],
    ['면책 안내', HONGRO_DISCLAIMER], ['단위 충돌·확인 필요', HONGRO_UNITS_CONFLICT], ['당도식 적용', meta.sugarEquationConflict], ['초기 회귀 R²', '결정계수이며 예측 정확도나 저장모델 검증 성능이 아님'],
    ['합성 참고자료', meta.referenceData.file, meta.referenceData.rows, '검증 적용범위 아님'], [], ['[초기 품질]', '값', '단위', '출처'],
  ];
  for (const key of initialKeys) rows.push([metricLabels[key], result.initial[key] ?? '미입력', HONGRO_UNITS[key], meta.initialKind]);
  if (result.input.source === 'weather') { rows.push([], ['[기상 입력]', '값', '단위']); for (const field of HONGRO_WEATHER_FIELDS) rows.push([field.key, result.input.weather[field.key], field.unit]); }
  if (meta.initialRegressionR2) { rows.push([], ['[초기 품질 회귀 결정계수]', 'R²']); for (const key of initialKeys) rows.push([metricLabels[key], meta.initialRegressionR2[key]]); }
  rows.push([], ['[선택일 결과]', '초기 품질', '선택일 예상', '변화량', '품질 단위', '변화량 단위']);
  for (const key of metrics) rows.push([metricLabels[key], result.initial[key], result.predicted[key], result.delta[key], HONGRO_UNITS[key], HONGRO_DELTA_UNITS[key]]);
  for (const key of ['weight', 'diameter'] as const) rows.push([metricLabels[key], result.initial[key] ?? '미입력', '저장 중 변화 모델 없음', '제공 안 함', HONGRO_UNITS[key]]);
  rows.push([], ['[동일 초기값 조건 비교]', '0℃ 예상', '4℃ 예상', '4℃−0℃', '품질 단위', '차이 단위']);
  for (const key of metrics) rows.push([metricLabels[key], result.comparison.cold0.predicted[key], result.comparison.cold4.predicted[key], result.comparison.cold4.predicted[key] - result.comparison.cold0.predicted[key], HONGRO_UNITS[key], HONGRO_DELTA_UNITS[key]]);
  rows.push([], ['[0~120일 수식 계산]', '저장 조건', '경도 N (Ø11 mm)', '산도 %', '당도 °Brix']);
  for (const storage of ['cold0', 'cold4'] as const) for (const point of result.comparison[storage].series) rows.push([point.days, storage, point.firmness, point.acidity, point.brix]);
  rows.push([], ['[계산 제한·경고]']); for (const warning of result.warnings) rows.push([warning]);
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rowsToCsv(rows)], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = `애플트랙_홍로_${result.input.storage}_${result.input.days}일.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
