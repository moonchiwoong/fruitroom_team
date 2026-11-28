'use client';
// ‘새 사과’: 농가용 간단 등록 화면. 품종 → 생산지 → 수확일 → 보관 → 처음 품질(자동/직접) 다섯 가지만 묻습니다.
// 저장 형식과 검사는 기존 품질 예측 화면과 같은 lib/tracker-form(payloadFromForm·validateForm)을 그대로 씁니다.
// 계산은 lib/lot-predict(기존 예측식)만 쓰고, 날씨 값이 다 없으면 계산하지 않습니다(값을 채우거나 추정하지 않음).
import {FUJI_REGION_KEYS, HONGRO_REGION_KEYS, isFujiRegionKey, isHongroRegionKey} from '@/lib/regions';
import {harvestMonthError} from '@/lib/harvest-window';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {josa} from '@/lib/josa';
import {ArrowLeft, Check, Loader2} from 'lucide-react';
import type {Lot} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {useTeamSession} from '@/components/team-auth';
import {emptyForm, payloadFromForm, validateForm, suggestName, type TrackerForm, type FujiRegion} from '@/lib/tracker-form';
import {lotPredictor, EASY_METRICS} from '@/lib/lot-predict';
import {todayKST, isDate} from '@/lib/tracker';
import LotPreview from '@/components/lot-preview';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import RegionMapPicker, {MAP_CREDIT, MAP_PINS, type MapRegion} from '@/components/region-map-picker';
import '@/components/health/health.css';
import type {HongroRegion} from '@/lib/hongro';

// 품종별로 초기 품질 회귀식이 있는 산지. 관측지점·기간은 WEATHER_STATIONS 한 곳에서 관리합니다.
const FUJI_REGIONS: FujiRegion[] = [...FUJI_REGION_KEYS];
const HONGRO_REGION_IDS: HongroRegion[] = [...HONGRO_REGION_KEYS];
const label = (id: keyof typeof WEATHER_STATIONS) => WEATHER_STATIONS[id].label;

function Seg<T extends string>({name, legend, value, options, onChange}: {name: string; legend: ReactNode; value: T | ''; options: {value: T; label: string; disabled?: boolean; tag?: string}[]; onChange: (v: T) => void}) {
  return <fieldset className="qt3-q na-q"><legend className="qt3-q-head">{legend}</legend>
    <div className={'qt3-seg' + (options.length > 3 ? ' na-seg-wrap' : '')}>{options.map(o => <label key={o.value} className={(value === o.value ? 'active' : '') + (o.disabled ? ' disabled' : '')}>
      <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
      <span>{value === o.value && <Check size={15} aria-hidden="true" />}{o.label}{o.tag && <small className="seg-tag">{o.tag}</small>}</span></label>)}</div>
  </fieldset>;
}

type Weather = {state: 'idle' | 'loading' | 'ok' | 'pending' | 'error'; msg?: string; key?: string; values?: Record<string, number | null>};

/** guest: 비회원 체험. 저장하지 않고 결과를 바로 보여 주며, 저장 버튼은 가입·로그인으로 보냅니다. */
export default function NewApple({onBack, onSaved, guest = false, onLogin}: {onBack?: () => void; onSaved?: (lot: Lot) => void | Promise<void>; guest?: boolean; onLogin?: () => void}) {
  const session = useTeamSession(), today = todayKST();
  const [cultivar, setCultivar] = useState<'후지' | '홍로'>('후지');
  const hongro = cultivar === '홍로';
  const profileRegion = session?.profile?.region;
  const [region, setRegion] = useState<FujiRegion | ''>(''), [hRegion, setHRegion] = useState<HongroRegion | ''>('');
  // 시작 방법: 'region' = 지도에서 산지를 골라 날씨로 추정, 'measured' = 직접 잰 값. 고르기 전에는 두 갈래만 보여 줍니다.
  const [path, setPath] = useState<'region' | 'measured' | null>(null), [mapRegion, setMapRegion] = useState<MapRegion | ''>('');
  function pickMap(r: MapRegion) {
    setMapRegion(r);
    const cv = MAP_PINS[r].cultivars, next = cv.includes(cultivar) ? cultivar : cv[0];
    setCultivar(next);
    if (MAP_PINS[r].cultivars.includes('후지')) setRegion(r as FujiRegion);
    if (MAP_PINS[r].cultivars.includes('홍로')) setHRegion(r as HongroRegion);
  }
  useEffect(() => {
    if (!region && FUJI_REGIONS.includes(profileRegion as FujiRegion)) setRegion(profileRegion as FujiRegion);
    if (!hRegion && HONGRO_REGION_IDS.includes(profileRegion as HongroRegion)) setHRegion(profileRegion as HongroRegion);
  }, [profileRegion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [harvest, setHarvest] = useState(''), [same, setSame] = useState(true), [start, setStart] = useState('');
  const [temp, setTemp] = useState<'0' | '4' | ''>('');
  const [storage, setStorage] = useState<'일반 저온' | 'CA'>('일반 저온'), [mcp, setMcp] = useState<'미처리' | '처리' | ''>('');
  const [source, setSource] = useState<'weather' | 'measured'>('weather');
  const [m, setM] = useState({brix: '', firmness: '', acidity: ''}), [unit, setUnit] = useState<'N' | 'kgf'>(() => { try { return window.localStorage.getItem('appletrack:firmunit') === 'kgf' ? 'kgf' : 'N'; } catch { return 'N'; } });
  const [name, setName] = useState(''), [place, setPlace] = useState(''), [boxes, setBoxes] = useState('');
  const [wx, setWx] = useState<Weather>({state: 'idle'}), [retryWeather, setRetryWeather] = useState(0);
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const startDate = same ? harvest : start, year = isDate(harvest) ? +harvest.slice(0, 4) : null;
  const wRegion = path === 'region' ? mapRegion : hongro ? hRegion : region;
  const rainMonth = wRegion ? WEATHER_STATIONS[wRegion].rainMonth : 9;

  // 날씨로 추정: 수확한 해 4~9월 농업기상 일자료(서버 경로)로 네 값을 받습니다. 빠진 값은 비워 둡니다.
  const wKey = path === 'region' && year && wRegion ? `${wRegion}:${year}` : '';
  const vals = wKey && wx.key === wKey ? wx.values : undefined;
  useEffect(() => {
    if (!wKey) { setWx({state: 'idle'}); return; }
    const request = new AbortController();
    setWx({state: 'loading', key: wKey});
    fetch(`/api/weather/hongro?year=${year}&region=${wRegion}`, {signal: request.signal}).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (request.signal.aborted) return;
      if (!r.ok) { setWx({state: 'error', key: wKey, msg: j.error || '날씨 자료를 불러오지 못했어요.'}); return; }
      if (!Array.isArray(j.variables)) { setWx({state: 'error', key: wKey, msg: '날씨 자료를 불러오지 못했어요.'}); return; }
      const v = Object.fromEntries((j.variables as {key: string; value: number | null}[]).map(x => [x.key, x.value]));
      const missing = Object.values(v).some(x => x === null);
      setWx({state: missing ? 'pending' : 'ok', key: wKey, values: v, msg: missing ? (year && today < `${year}-${String(rainMonth + 1).padStart(2, '0')}-01` ? `${rainMonth}월 강수량은 ${rainMonth}월이 끝나야 집계돼서, ${rainMonth + 1}월 1일부터 자동으로 추정해요. 지금 저장해 두면 돼요. 당도나 단단함을 재면 바로 예측돼요.` : ((j.variables as {reason: string | null}[]).map(x => x.reason).find(Boolean) ?? '날씨 값이 빠져 있어 지금은 계산하지 않아요.')) : undefined});
    }).catch(() => { if (!request.signal.aborted) setWx({state: 'error', key: wKey, msg: '날씨 자료를 불러오지 못했어요.'}); });
    return () => request.abort();
  }, [wKey, year, wRegion, rainMonth, today, retryWeather]);

  const form: TrackerForm = useMemo(() => {
    const f = emptyForm(), s = (v: number | null | undefined) => v === null || v === undefined ? '' : String(v);
    f.variety = cultivar; f.harvest_date = harvest; f.sameStart = true; f.intake_date = startDate; f.storage_start_date = startDate;
    f.initialSameStart = true; f.mcpSelected = true; f.firmness_unit = unit; f.name = name; f.name_auto = !name.trim();
    if (hongro) {
      f.storage = '일반 저온'; f.mcp = '미처리'; f.temperature = temp;
      f.hongro = {...f.hongro, source, storage: temp === '4' ? 'cold4' : 'cold0', region: isHongroRegionKey(wRegion) ? wRegion : 'geochang'};
      if (source === 'weather') f.hongro.weather = {chang_min4: s(vals?.chang_min4), chang_LC56: s(vals?.chang_LC56), chang_LC78: s(vals?.chang_LC78), chang_9rain: s(vals?.chang_9rain)};
      else f.hongro.initial = {...f.hongro.initial, ...m};
    } else {
      f.storage = storage; f.mcp = mcp || '미확인'; f.mcpSelected = !!mcp;
      if (source === 'weather') f.fuji = {source: 'weather', region: isFujiRegionKey(wRegion) ? wRegion : '', year: year ? String(year) : '', weather: {rain9: s(vals?.chang_9rain), lc56: s(vals?.chang_LC56), lc78: s(vals?.chang_LC78), min4: s(vals?.chang_min4)}};
      else { f.firmness = m.firmness; f.brix = m.brix; f.acidity = m.acidity; if (region) f.fuji = {...f.fuji, region}; }
    }
    return f;
  }, [cultivar, hongro, harvest, startDate, unit, name, temp, source, vals, m, storage, mcp, region, wRegion, year]);

  // 저장 전 미리보기: 저장될 내용 그대로 기존 예측식으로 계산합니다.
  const preview = useMemo(() => {
    if (!isDate(startDate)) return null;
    let payload; try { payload = payloadFromForm(form); } catch { return null; }
    const fake = {id: 'preview', ...payload, latest_observation: null} as unknown as Lot;
    try { const p = lotPredictor(fake), day = 60; return {day, rows: EASY_METRICS.map(k => ({k, r: p.at(k, day)})), weather: p.weather, lot: fake}; } catch { return null; }
  }, [form, startDate]);

  const harvestErr = harvestMonthError(cultivar, harvest);
  const missing = [!harvest && '수확일', !same && !start && '저장 시작일', hongro && !temp && '저장고 온도', !hongro && !mcp && '1-MCP 처리 여부', source === 'weather' && !wRegion && '생산지', source === 'measured' && !m.brix.trim() && !m.firmness.trim() && !m.acidity.trim() && '잰 값(하나 이상)'].filter(Boolean) as string[];
  // 체험 안내는 지금 화면에 보이는 단계·입력란에 맞춥니다(산지를 고르기 전에는 품종별 저장 조건을 묻지 않음).
  const shownMissing = missing.map(x => x === '1-MCP 처리 여부' ? '보관 방식·1-MCP 처리' : x);
  const guestHint = path === null ? '' : path === 'region' && !mapRegion ? '지도에서 생산지를 먼저 골라 주세요. 고른 산지에 예측식이 있는 품종과 그 품종의 저장 조건을 이어서 물어봐요.'
    : shownMissing.length ? `${shownMissing.join(', ')} 항목을 고르면 아래에 바로 결과가 나와요. ${hongro ? '홍로는 저장고 온도(0℃·4℃)를' : '후지는 보관 방식(일반 저온·CA)과 1-MCP 처리를'} 물어봐요. 가입하지 않아도 돼요.` : '';
  async function save() {
    setErr('');
    if (missing.length) { setErr(`아직 안 고른 항목이 있어요: ${missing.join(', ')}`); return; }
    if (harvestErr) { setErr(harvestErr); return; }
    const e = Object.values(validateForm(form, true)).filter(Boolean) as string[];
    if (e.length) { setErr(e[0]); return; }
    setSaving(true);
    try {
      const pl = payloadFromForm(form), q = Number(boxes);
      const selectedRegion = wRegion || null;
      const r = await requestJson<{lot: Lot}>('/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
        ...pl, location: place.trim() || null, ...(boxes.trim() && Number.isFinite(q) && q > 0 ? {quantity: q} : {}),
        details: {...pl.details, region: selectedRegion, ...(hongro && source === 'measured' && selectedRegion ? {region_confirmed: true} : {}), quantity_unit: '상자'},
      })});
      await onSaved?.(r.lot);
    } catch (x) { setErr((x as Error).message); } finally { setSaving(false); }
  }
  const setUnitSaved = (u: 'N' | 'kgf') => { setUnit(u); try { window.localStorage.setItem('appletrack:firmunit', u); } catch { /* 무시 */ } };
  const station = wRegion ? WEATHER_STATIONS[wRegion].name : undefined;

  return <div className="ma ma-detail na">
    {!guest && onBack && <button type="button" className="ma-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />내 사과</button>}
    <div className="ma-title"><h1>{guest ? '내 사과로 해 보기' : '새 사과'}</h1><p>다섯 가지만 고르면 저장 중 변화를 계산해요.{guest ? ' 가입하지 않아도 결과를 볼 수 있어요.' : ''}</p></div>

    {path === null ? <div className="na-start" role="group" aria-label="시작 방법">
      <button type="button" onClick={() => { setPath('region'); setSource('weather'); }}>
        <b>지역으로 시작</b><p>지도에서 산지를 고르면 그 해 농업기상 자료로 처음 품질을 추정해요. 잰 값이 없을 때 좋아요.</p><em>산지 8곳 · 날씨로 추정 →</em></button>
      <button type="button" onClick={() => { setPath('measured'); setSource('measured'); }}>
        <b>직접 잰 값으로 시작</b><p>수확하거나 입고할 때 잰 당도·단단함·신맛을 넣어요. 하나만 있어도 돼요.</p><em>더 정확해요 →</em></button>
    </div> : <>
    <div className="na-sheet">
    <div className="na-sheet-h"><b>{path === 'region' ? '주산지로 시작' : '직접 잰 값으로 시작'}</b><button type="button" className="na-switch" onClick={() => setPath(null)}>시작 방법 바꾸기</button></div>

    {path === 'region' && <section className="na-card na-full na-maprow"><h2><span>1</span>주산지</h2>
      <RegionMapPicker value={mapRegion} onPick={pickMap} credit={false} />
      {mapRegion && <p className="ma-sub">관측지점 {WEATHER_STATIONS[mapRegion].name} · 이 산지는 {MAP_PINS[mapRegion].cultivars.join('·')} 예측식이 있어요.</p>}
      <p className="rmp-credit">{MAP_CREDIT}</p></section>}

    {(path === 'measured' || mapRegion) && <section className="na-card"><h2><span>{path === 'region' ? 2 : 1}</span>품종</h2>
      <Seg name="na-cultivar" legend="품종" value={cultivar} options={(['후지', '홍로'] as const).filter(c => path !== 'region' || !mapRegion || MAP_PINS[mapRegion].cultivars.includes(c)).map(c => ({value: c, label: c}))} onChange={setCultivar} /></section>}

    {path === 'measured' && <section className="na-card"><h2><span>2</span>생산지 <small className="ma-sub">기록용 · 선택</small></h2>
      {hongro ? <Seg name="na-region-h" legend="생산지" value={hRegion} options={HONGRO_REGION_IDS.map(id => ({value: id, label: label(id)}))} onChange={setHRegion} />
        : <Seg name="na-region" legend="생산지" value={region} options={FUJI_REGIONS.map(id => ({value: id, label: label(id)}))} onChange={setRegion} />}</section>}

    {(path === 'measured' || mapRegion) && <>
    <section className="na-card"><h2><span>3</span>수확일</h2>
      <label className="na-field"><span>수확일</span><input id="na-harvest" type="date" max={today} value={harvest} aria-invalid={!!harvestErr} aria-describedby={harvestErr ? 'na-harvest-err' : undefined} onChange={e => setHarvest(e.target.value)} /></label>
      {harvestErr && <p id="na-harvest-err" className="na-err" role="alert">{harvestErr}</p>}
      <label className="new-date-check"><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /><span>수확 당일 바로 저장고에 넣었어요</span></label>
      {!same && <label className="na-field"><span>저장 시작일</span><input id="na-start" type="date" min={harvest || undefined} max={today} value={start} onChange={e => setStart(e.target.value)} /></label>}</section>

    <section className="na-card"><h2><span>4</span>보관</h2>
      {hongro ? <><p className="na-fixed">일반 저온 · 1-MCP 미처리 <small>홍로 예측식이 있는 조건이에요.</small></p>
        <Seg name="na-temp" legend="저장고 온도" value={temp} options={[{value: '0', label: '0℃'}, {value: '4', label: '4℃'}]} onChange={setTemp} /></>
        : <><Seg name="na-storage" legend="보관 방식" value={storage} options={[{value: '일반 저온', label: '일반 저온'}, {value: 'CA', label: 'CA'}]} onChange={v => { setStorage(v); if (v === 'CA') setMcp('미처리'); }} />
          <Seg name="na-mcp" legend="1-MCP 처리" value={mcp} options={[{value: '처리', label: '처리함', disabled: storage === 'CA', tag: storage === 'CA' ? '준비 중' : undefined}, {value: '미처리', label: '미처리'}]} onChange={setMcp} /></>}</section>

    <section className={'na-card' + (source === 'weather' ? '' : ' na-full')}><h2><span>5</span>{source === 'weather' ? '처음 품질' : '잰 값'}</h2>
      {source === 'weather' ? <div className="na-wx" role="status" aria-live="polite">
        {!wKey ? <p className="ma-sub">{!wRegion ? '생산지를 고르면' : '수확일을 넣으면'} 그 해 농업기상 자료로 처음 품질을 추정해요.</p>
          : wx.key !== wKey || wx.state === 'loading' ? <p><Loader2 className="spin" size={15} aria-hidden="true" />{year}년 4~9월 {station} 날씨를 모으는 중이에요…</p>
          : wx.state === 'ok' ? <p><b>{year}년 농업기상 {station} 관측</b>으로 추정해요(실측 아님).</p>
          : wx.state === 'pending' ? <p className="warn">{wx.msg}</p>
          : wx.state === 'error' ? <><p className="warn">{wx.msg} 그대로 저장하면 나중에 다시 받아 와요. 직접 잰 값이 있으면 넣어 주세요.</p><button type="button" className="linkbtn" onClick={() => setRetryWeather(n => n + 1)}>다시 불러오기</button></> : null}
      </div> : <div className="na-measure">
        <label className="na-field"><span>단맛(당도)</span><input type="number" inputMode="decimal" step="any" placeholder="예: 14.2" value={m.brix} onChange={e => setM(x => ({...x, brix: e.target.value}))} /><em>°Brix</em></label>
        <label className="na-field"><span>단단함</span><input type="number" inputMode="decimal" step="any" placeholder={unit === 'N' ? '예: 60' : '예: 6.1'} value={m.firmness} onChange={e => setM(x => ({...x, firmness: e.target.value}))} />
          <select aria-label="단단함 단위" value={unit} onChange={e => setUnitSaved(e.target.value as 'N' | 'kgf')}><option value="N">N</option><option value="kgf">kg (kgf)</option></select></label>
        <label className="na-field"><span>신맛(산도)</span><input type="number" inputMode="decimal" step="any" placeholder="예: 0.35" value={m.acidity} onChange={e => setM(x => ({...x, acidity: e.target.value}))} /><em>%</em></label>
        <p className="ma-sub">잰 것만 넣어도 돼요. 저장을 시작한 날 잰 값으로 계산해요.</p>
      </div>}</section>

    <details className="na-more"><summary>더 넣기 (선택) · 이름·저장고·상자 수</summary>
      <label className="na-field"><span>이름</span><input type="text" maxLength={80} placeholder={suggestName(form)} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="na-field"><span>저장고</span><input type="text" maxLength={80} placeholder="예: 1번 저장고" value={place} onChange={e => setPlace(e.target.value)} /></label>
      <label className="na-field"><span>상자 수</span><input type="number" inputMode="numeric" min={1} step={1} placeholder="예: 120" value={boxes} onChange={e => setBoxes(e.target.value)} /><em>상자</em></label>
      <p className="ma-sub">상자 수를 넣으면 무게가 줄어든 만큼을 ‘몇 상자 무게’로도 보여 줘요.</p></details>

    </>}
    </div>
    {guest && guestHint && <p className="ma-hint muted na-guest-hint" aria-live="polite">{guestHint}</p>}
    {guest && preview && missing.length === 0 && !harvestErr && <section id="na-result" className="na-card na-result" aria-label="결과"><h2>결과</h2><LotPreview lot={preview.lot} /><p className="ma-sub">시연용 계산 · 출하·안전 판정 아님</p>
      <button type="button" className="linkbtn na-save-link" onClick={onLogin}>이 사과를 계속 기록하려면 가입하기 →</button></section>}

    </>}
    {err && <p className="error-box" role="alert">{err}</p>}
    {guest || path === null ? null
    : <div className="ma-actions"><button type="button" className="ma-primary big" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}저장하기</button></div>}
  </div>;
}
