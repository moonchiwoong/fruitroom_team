'use client';
// ‘새 사과’: 농가용 간단 등록 화면. 품종 → 생산지 → 수확일 → 보관 → 처음 품질(자동/직접) 다섯 가지만 묻습니다.
// 저장 형식과 검사는 기존 품질 예측 화면과 같은 lib/tracker-form(payloadFromForm·validateForm)을 그대로 씁니다.
// 계산은 lib/lot-predict(기존 예측식)만 쓰고, 날씨 값이 다 없으면 계산하지 않습니다(값을 채우거나 추정하지 않음).
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {ArrowLeft, Check, Loader2} from 'lucide-react';
import type {Lot} from '@/lib/lot-types';
import {requestJson} from '@/components/lot-forms';
import {useTeamSession} from '@/components/team-auth';
import {emptyForm, payloadFromForm, validateForm, suggestName, type TrackerForm, type FujiRegion} from '@/lib/tracker-form';
import {lotPredictor, easyChange, EASY_METRICS} from '@/lib/lot-predict';
import {fmtNum, metricMeta, todayKST, isDate} from '@/lib/tracker';
import LotPreview from '@/components/lot-preview';

const FUJI_REGIONS: {id: FujiRegion; label: string; station: string}[] = [{id: 'cheongsong', label: '청송', station: '청송군 청송읍'}, {id: 'jangsu', label: '장수', station: '장수군 장수읍'}, {id: 'yeongju', label: '영주', station: '영주시 봉현면'}];
const SHORT: Record<string, string> = {firmness: '단단함', loss: '무게', brix: '단맛', acidity: '신맛'};

function Seg<T extends string>({name, legend, value, options, onChange}: {name: string; legend: ReactNode; value: T | ''; options: {value: T; label: string; disabled?: boolean; tag?: string}[]; onChange: (v: T) => void}) {
  return <fieldset className="qt3-q na-q"><legend className="qt3-q-head">{legend}</legend>
    <div className="qt3-seg">{options.map(o => <label key={o.value} className={(value === o.value ? 'active' : '') + (o.disabled ? ' disabled' : '')}>
      <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
      <span>{value === o.value && <Check size={15} aria-hidden="true" />}{o.label}{o.tag && <small className="seg-tag">{o.tag}</small>}</span></label>)}</div>
  </fieldset>;
}

type Weather = {state: 'idle' | 'loading' | 'ok' | 'pending' | 'error'; msg?: string; key?: string};

/** guest: 비회원 체험. 저장하지 않고 결과를 바로 보여 주며, 저장 버튼은 가입·로그인으로 보냅니다. */
export default function NewApple({onBack, onSaved, guest = false, onLogin}: {onBack?: () => void; onSaved?: (lot: Lot) => void | Promise<void>; guest?: boolean; onLogin?: () => void}) {
  const session = useTeamSession(), today = todayKST();
  const [cultivar, setCultivar] = useState<'후지' | '홍로'>('후지');
  const hongro = cultivar === '홍로';
  const profileRegion = session?.profile?.region;
  const [region, setRegion] = useState<FujiRegion | ''>('');
  useEffect(() => { if (!region && (profileRegion === 'cheongsong' || profileRegion === 'jangsu' || profileRegion === 'yeongju')) setRegion(profileRegion); }, [profileRegion]); // eslint-disable-line react-hooks/exhaustive-deps
  const [harvest, setHarvest] = useState(''), [same, setSame] = useState(true), [start, setStart] = useState('');
  const [temp, setTemp] = useState<'0' | '4' | ''>('');
  const [storage, setStorage] = useState<'일반 저온' | 'CA'>('일반 저온'), [mcp, setMcp] = useState<'미처리' | '처리' | ''>('');
  const [source, setSource] = useState<'weather' | 'measured'>('weather');
  const [m, setM] = useState({brix: '', firmness: '', acidity: ''}), [unit, setUnit] = useState<'N' | 'kgf'>(() => { try { return window.localStorage.getItem('appletrack:firmunit') === 'kgf' ? 'kgf' : 'N'; } catch { return 'N'; } });
  const [name, setName] = useState(''), [place, setPlace] = useState(''), [boxes, setBoxes] = useState('');
  const [wx, setWx] = useState<Weather>({state: 'idle'}), [vals, setVals] = useState<Record<string, number | null> | null>(null);
  const [saving, setSaving] = useState(false), [err, setErr] = useState('');
  const startDate = same ? harvest : start, year = isDate(harvest) ? +harvest.slice(0, 4) : null;
  const wRegion = hongro ? 'geochang' : region;

  // 날씨로 추정: 수확한 해 4~9월 농업기상 일자료(서버 경로)로 네 값을 받습니다. 빠진 값은 비워 둡니다.
  const wKey = source === 'weather' && year && wRegion ? `${wRegion}:${year}` : '';
  useEffect(() => {
    if (!wKey || wx.key === wKey) return;
    let live = true; setWx({state: 'loading', key: wKey}); setVals(null);
    fetch(`/api/weather/hongro?year=${year}&region=${wRegion}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!live) return;
      if (!r.ok) { setWx({state: 'error', key: wKey, msg: j.error || '날씨 자료를 불러오지 못했어요.'}); return; }
      if (!Array.isArray(j.variables)) { setWx({state: 'error', key: wKey, msg: '날씨 자료를 불러오지 못했어요.'}); return; }
      const v = Object.fromEntries((j.variables as {key: string; value: number | null}[]).map(x => [x.key, x.value]));
      setVals(v);
      const missing = Object.values(v).some(x => x === null);
      setWx({state: missing ? 'pending' : 'ok', key: wKey, msg: missing ? (year && today < `${year}-10-01` ? '9월 강수량은 9월이 끝나야 집계돼서, 10월 1일부터 자동으로 추정해요. 지금 저장해 두면 돼요. 당도나 단단함을 재면 바로 예측돼요.' : ((j.variables as {reason: string | null}[]).map(x => x.reason).find(Boolean) ?? '날씨 값이 빠져 있어 지금은 계산하지 않아요.')) : undefined});
    }).catch(() => { if (live) setWx({state: 'error', key: wKey, msg: '날씨 자료를 불러오지 못했어요.'}); });
    return () => { live = false; };
  }, [wKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const form: TrackerForm = useMemo(() => {
    const f = emptyForm(), s = (v: number | null | undefined) => v === null || v === undefined ? '' : String(v);
    f.variety = cultivar; f.harvest_date = harvest; f.sameStart = true; f.intake_date = startDate; f.storage_start_date = startDate;
    f.initialSameStart = true; f.mcpSelected = true; f.firmness_unit = unit; f.name = name; f.name_auto = !name.trim();
    if (hongro) {
      f.storage = '일반 저온'; f.mcp = '미처리'; f.temperature = temp;
      f.hongro = {...f.hongro, source, storage: temp === '4' ? 'cold4' : 'cold0'};
      if (source === 'weather') f.hongro.weather = {chang_min4: s(vals?.chang_min4), chang_LC56: s(vals?.chang_LC56), chang_LC78: s(vals?.chang_LC78), chang_9rain: s(vals?.chang_9rain)};
      else f.hongro.initial = {...f.hongro.initial, ...m};
    } else {
      f.storage = storage; f.mcp = mcp || '미확인'; f.mcpSelected = !!mcp;
      if (source === 'weather') f.fuji = {source: 'weather', region, year: year ? String(year) : '', weather: {rain9: s(vals?.chang_9rain), lc56: s(vals?.chang_LC56), lc78: s(vals?.chang_LC78), min4: s(vals?.chang_min4)}};
      else { f.firmness = m.firmness; f.brix = m.brix; f.acidity = m.acidity; if (region) f.fuji = {...f.fuji, region}; }
    }
    return f;
  }, [cultivar, hongro, harvest, startDate, unit, name, temp, source, vals, m, storage, mcp, region, year]);

  // 저장 전 미리보기: 저장될 내용 그대로 기존 예측식으로 계산합니다.
  const preview = useMemo(() => {
    if (!isDate(startDate)) return null;
    let payload; try { payload = payloadFromForm(form); } catch { return null; }
    const fake = {id: 'preview', ...payload, latest_observation: null} as unknown as Lot;
    try { const p = lotPredictor(fake), day = 60; return {day, rows: EASY_METRICS.map(k => ({k, r: p.at(k, day)})), weather: p.weather, lot: fake}; } catch { return null; }
  }, [form, startDate]);

  const missing = [!harvest && '수확일', !same && !start && '저장 시작일', hongro && !temp && '저장고 온도', !hongro && !mcp && '1-MCP 처리 여부', !hongro && source === 'weather' && !region && '생산지', source === 'measured' && !m.brix.trim() && !m.firmness.trim() && !m.acidity.trim() && '잰 값(하나 이상)'].filter(Boolean) as string[];
  async function save() {
    setErr('');
    if (missing.length) { setErr(`${missing.join(', ')}을(를) 골라 주세요.`); return; }
    const e = Object.values(validateForm(form, true)).filter(Boolean) as string[];
    if (e.length) { setErr(e[0]); return; }
    setSaving(true);
    try {
      const r = await requestJson<{lot: Lot}>('/api/lots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify((() => { const pl = payloadFromForm(form), q = Number(boxes); return {...pl, location: place.trim() || null, ...(boxes.trim() && Number.isFinite(q) && q > 0 ? {quantity: q} : {}), details: {...pl.details, region: hongro ? 'geochang' : region || null, quantity_unit: '상자'}}; })())});
      await onSaved?.(r.lot);
    } catch (x) { setErr((x as Error).message); } finally { setSaving(false); }
  }
  const setUnitSaved = (u: 'N' | 'kgf') => { setUnit(u); try { window.localStorage.setItem('appletrack:firmunit', u); } catch { /* 무시 */ } };
  const station = hongro ? '거창군 거창읍' : FUJI_REGIONS.find(r => r.id === region)?.station;

  return <div className="ma ma-detail na">
    {!guest && onBack && <button type="button" className="ma-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />내 사과</button>}
    <div className="ma-title"><h1>{guest ? '내 사과로 해 보기' : '새 사과'}</h1><p>다섯 가지만 고르면 저장 중 변화를 계산해요.{guest ? ' 가입하지 않아도 결과를 볼 수 있어요.' : ''}</p></div>

    <section className="na-card"><h2><span>1</span>품종</h2>
      <Seg name="na-cultivar" legend="품종" value={cultivar} options={[{value: '후지', label: '후지'}, {value: '홍로', label: '홍로'}]} onChange={v => { setCultivar(v); setWx({state: 'idle'}); setVals(null); }} /></section>

    <section className="na-card"><h2><span>2</span>생산지</h2>
      {hongro ? <p className="na-fixed">거창 <small>홍로 예측식은 거창 자료로 만들었어요.</small></p>
        : <Seg name="na-region" legend="생산지" value={region} options={FUJI_REGIONS.map(r => ({value: r.id, label: r.label}))} onChange={v => { setRegion(v); setWx({state: 'idle'}); setVals(null); }} />}</section>

    <section className="na-card"><h2><span>3</span>수확일</h2>
      <label className="na-field"><span>수확일</span><input id="na-harvest" type="date" max={today} value={harvest} onChange={e => { setHarvest(e.target.value); setWx({state: 'idle'}); }} /></label>
      <label className="new-date-check"><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /><span>수확 당일 바로 저장고에 넣었어요</span></label>
      {!same && <label className="na-field"><span>저장 시작일</span><input id="na-start" type="date" min={harvest || undefined} max={today} value={start} onChange={e => setStart(e.target.value)} /></label>}</section>

    <section className="na-card"><h2><span>4</span>보관</h2>
      {hongro ? <><p className="na-fixed">일반 저온 · 1-MCP 미처리 <small>홍로 예측식이 있는 조건이에요.</small></p>
        <Seg name="na-temp" legend="저장고 온도" value={temp} options={[{value: '0', label: '0℃'}, {value: '4', label: '4℃'}]} onChange={setTemp} /></>
        : <><Seg name="na-storage" legend="보관 방식" value={storage} options={[{value: '일반 저온', label: '일반 저온'}, {value: 'CA', label: 'CA'}]} onChange={v => { setStorage(v); if (v === 'CA') setMcp('미처리'); }} />
          <Seg name="na-mcp" legend="1-MCP 처리" value={mcp} options={[{value: '처리', label: '처리함', disabled: storage === 'CA', tag: storage === 'CA' ? '준비 중' : undefined}, {value: '미처리', label: '미처리'}]} onChange={setMcp} /></>}</section>

    <section className="na-card"><h2><span>5</span>처음 품질</h2>
      <Seg name="na-source" legend="처음 품질" value={source} options={[{value: 'weather', label: '날씨로 자동'}, {value: 'measured', label: '직접 잰 값'}]} onChange={v => { setSource(v); setWx({state: 'idle'}); }} />
      {source === 'weather' ? <div className="na-wx" role="status" aria-live="polite">
        {!wKey ? <p className="ma-sub">{!hongro && !region ? '생산지를 고르면' : '수확일을 넣으면'} 그 해 농업기상 자료로 처음 품질을 추정해요.</p>
          : wx.state === 'loading' ? <p><Loader2 className="spin" size={15} aria-hidden="true" />{year}년 4~9월 {station} 날씨를 모으는 중이에요…</p>
          : wx.state === 'ok' ? <p><b>{year}년 농업기상 {station} 관측</b>으로 추정해요(실측 아님).</p>
          : wx.state === 'pending' ? <p className="warn">{wx.msg}</p>
          : wx.state === 'error' ? <><p className="warn">{wx.msg} 그대로 저장하면 나중에 다시 받아 와요. 직접 잰 값이 있으면 넣어 주세요.</p><button type="button" className="linkbtn" onClick={() => setWx({state: 'idle'})}>다시 불러오기</button></> : null}
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

    {guest && missing.length > 0 && <p className="ma-hint muted na-guest-hint">{missing.join(', ')}을(를) 고르면 아래에 바로 결과가 나와요. 가입하지 않아도 돼요.</p>}
    {guest && preview && missing.length === 0 && <section id="na-result" className="na-card na-result" aria-label="결과"><h2>결과</h2><LotPreview lot={preview.lot} /><p className="ma-sub">시연용 계산 · 출하·안전 판정 아님</p>
      <button type="button" className="linkbtn na-save-link" onClick={onLogin}>이 사과를 계속 기록하려면 가입하기 →</button></section>}
    {!guest && preview && <section className="na-card na-preview" aria-label="미리보기"><h2>저장 {preview.day}일 뒤 (미리보기)</h2>
      <div className="ma-rows">{preview.rows.map(({k, r}) => <div key={k} className="ma-row"><span>{SHORT[k]}</span><div>{r.ok ? <><b>{easyChange(k, r.value, r.first, preview.weather)}</b><small>{fmtNum(r.value, metricMeta[k].digits)} {k === 'firmness' ? 'N' : metricMeta[k].unit}</small></> : <><b className="na">계산 없음</b><small>{r.reason}</small></>}</div></div>)}</div>
      <p className="ma-sub">시연용 계산 · 출하·안전 판정 아님</p></section>}

    {err && <p className="error-box" role="alert">{err}</p>}
    {guest ? null
    : <div className="ma-actions"><button type="button" className="ma-primary big" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}저장하기</button></div>}
  </div>;
}
