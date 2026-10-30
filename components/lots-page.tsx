'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Boxes, Camera, Check, ClipboardList, Download, Info, Loader2, MessageCircle, Pencil, Plus, Search, Upload, Warehouse, Archive} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {applePhoto} from '@/lib/photos';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {requestJson} from '@/components/lot-forms';
import {LotEditor, MeasurementForm} from '@/components/lot-dialogs';
import {EnvironmentChart} from '@/components/lot-charts';
import {reviewLot} from '@/lib/lot-analysis';
import {preparePhoto} from '@/lib/prepare-photo';
import {today, type Lot, type Observation, type Photo, type Stats} from '@/lib/lot-types';
import {daysBetween, fmtDate, fmtNum, isDate} from '@/lib/tracker';
import {baselineObservation, hasInitialValues, lotReadiness, lotSummary, mcpLabel, quantityUnit, storageStart, weatherInitial} from '@/lib/lot-readiness';

type Analysis = {lot: Lot; asOf: string; stats: Stats; observations: Observation[]; photos: Photo[]};
type Sub = 'records' | 'environment' | 'photos';
export type LotsFocus = {id: string | null; create?: boolean; n: number};
const shortDate = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}월 ${day}일`; };
const fmt = (n: number | null | undefined, d = 1) => n === null || n === undefined ? null : fmtNum(n, d);
const V = ({v, d = 1, unit}: {v: number | null | undefined; d?: number; unit?: string}) => { const t = fmt(v, d); return t === null ? <span className="lm-missing" title="이번 기록에서 미측정">—</span> : <>{t}{unit && <small> {unit}</small>}</>; };
const qty = (l: Lot) => typeof l.quantity === 'number' ? `${l.quantity.toLocaleString('ko-KR')}${quantityUnit(l)}` : '수량 미입력';
const daysIn = (l: Lot) => Math.max(0, daysBetween(storageStart(l), today()));

export default function LotsPage({lots, loadError, reload, openTracker, focus, onAskAI}: {lots: Lot[]; loadError: string; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void; focus?: LotsFocus | null; onAskAI?: (lotId: string) => void}) {
  const session = useTeamSession();
  const shared = (l: Lot) => !!l.owner_id && !!session?.userId && l.owner_id !== session.userId;
  const [owner, setOwner] = useState<'all' | 'mine' | 'shared'>('all'), [query, setQuery] = useState('');
  const [id, setId] = useState<string>(focus?.id ?? ''), [mobileDetail, setMobileDetail] = useState(!!focus?.id);
  const [sub, setSub] = useState<Sub>('records'), [showAll, setShowAll] = useState(false);
  const [editor, setEditor] = useState<{open: boolean; lot: Lot | null}>({open: false, lot: null});
  const [measure, setMeasure] = useState<{open: boolean; obs: Observation | null; preset: boolean; prefill?: Observation | null}>({open: false, obs: null, preset: false});
  const [loadedData, setData] = useState<Analysis | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [rowErrors, setRowErrors] = useState<string[]>([]);
  const [dateInput, setDateInput] = useState('');
  const detailRef = useRef<HTMLElement>(null);

  // 정렬: 저장 시작일 최신순(같으면 등록 최신순). 목록 위 안내와 실제 정렬이 같아야 합니다.
  const sorted = useMemo(() => [...lots].sort((a, b) => storageStart(b).localeCompare(storageStart(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [lots]);
  const filtered = useMemo(() => { const q = query.trim().toLocaleLowerCase('ko-KR');
    return sorted.filter(l => (owner === 'all' || (owner === 'shared') === shared(l)) && (!q || [l.name, l.variety, l.location ?? ''].some(v => v.toLocaleLowerCase('ko-KR').includes(q)))); }, [sorted, query, owner, session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = {all: lots.length, mine: lots.filter(l => !shared(l)).length, shared: lots.filter(shared).length};
  const summary = useMemo(() => lotSummary(lots, shared), [lots, session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 검색·필터 결과와 상세를 맞춥니다: 남아 있으면 유지, 사라지면 결과의 첫 물량, 결과가 없으면 상세를 숨깁니다.
  useEffect(() => {
    if (!filtered.length) { if (id) setId(''); setMobileDetail(false); return; }
    if (!filtered.some(l => l.id === id)) { setId(filtered[0].id); if (mobileDetail) setMobileDetail(false); }
  }, [filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  // 홈·품질 예측에서 특정 물량으로 들어온 경우: 그 물량이 보이도록 검색·필터를 풀고 선택합니다.
  useEffect(() => {
    if (!focus) return;
    if (focus.create) { setEditor({open: true, lot: null}); return; }
    if (!focus.id || !lots.some(l => l.id === focus.id)) return;
    if (!filtered.some(l => l.id === focus.id)) { setQuery(''); setOwner('all'); }
    setId(focus.id); setMobileDetail(true); setSub('records');
    requestAnimationFrame(() => detailRef.current?.focus({preventScroll: true}));
  }, [focus?.n, lots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = filtered.find(l => l.id === id) ?? null;
  const data = loadedData?.lot.id === selected?.id ? loadedData : null;
  useEffect(() => { setNotice(''); setRowErrors([]); setShowAll(false); setDateInput(''); }, [id]);
  useEffect(() => {
    setData(null); setError(''); if (!selected) { setLoading(false); return; }
    const ctl = new AbortController(); setLoading(true);
    requestJson<Analysis>(`/api/lots/${selected.id}/analysis?asOf=${today()}`, {signal: ctl.signal}).then(r => { if (!ctl.signal.aborted) setData(r); }).catch(e => { if (!ctl.signal.aborted && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [selected?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setVersion(v => v + 1); void reload(); };
  const selectLot = (lotId: string) => { setId(lotId); setMobileDetail(true); setSub('records');
    requestAnimationFrame(() => { const mobile = window.matchMedia('(max-width: 900px)').matches; detailRef.current?.focus({preventScroll: !mobile}); if (mobile) window.scrollTo({top: 0}); }); };
  const backToList = () => { setMobileDetail(false); requestAnimationFrame(() => document.getElementById('lot-choice-' + id)?.focus()); };
  function tabKeys(e: React.KeyboardEvent<HTMLButtonElement>) { const order: Sub[] = ['records', 'environment', 'photos']; const i = order.indexOf(sub); const next = e.key === 'ArrowRight' ? order[(i + 1) % 3] : e.key === 'ArrowLeft' ? order[(i + 2) % 3] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[2] : null; if (next) { e.preventDefault(); setSub(next); document.getElementById('lot-tab-' + next)?.focus(); } }

  async function upload(e: React.FormEvent<HTMLFormElement>, kind: 'environment' | 'photos') {
    e.preventDefault(); if (!selected) return; const form = e.currentTarget; setBusy(kind); setError(''); setRowErrors([]); setNotice('');
    try {
      const payload = new FormData(form);
      if (kind === 'photos') { const file = payload.get('file'); if (!(file instanceof File)) throw new Error('사진을 선택해 주세요.'); payload.set('file', await preparePhoto(file)); }
      const r = await requestJson<{inserted: number; duplicates: number; mismatched: number}>(`/api/lots/${selected.id}/${kind}`, {method: 'POST', body: payload});
      setNotice(kind === 'environment' ? `${r.inserted}건 저장 · 중복 시각 ${r.duplicates}건 제외(파일 안 중복 + 이미 저장된 기록) · 다른 센서 ${r.mismatched}건 제외 · 원본 CSV 보관 완료` : '사진과 촬영 정보를 저장했습니다.');
      form.reset(); refresh();
    } catch (err) { setError((err as Error).message); setRowErrors((err as Error & {rows?: string[]}).rows ?? []); }
    finally { setBusy(''); }
  }
  async function post(path: string, body: unknown, msg: string) {
    if (!selected) return; setBusy('save'); setError('');
    try { await requestJson(`/api/lots/${selected.id}/${path}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); setNotice(msg); refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  function downloadTemplate() {
    if (!selected) return; const d = selected.intake_date, s = selected.sensor_id || 'T-01';
    const csv = `timestamp,sensor_id,temperature,humidity\n${d}T00:00:00+09:00,${s},0.4,93\n${d}T01:00:00+09:00,${s},0.6,92\n${d}T02:00:00+09:00,${s},0.5,93\n`;
    const url = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = 'environment-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const onLotSaved = async (lot: Lot) => { const isNew = !editor.lot; setEditor({open: false, lot: null}); setNotice(isNew ? `‘${lot.name}’ 물량을 등록했습니다.` : '물량 정보를 저장했습니다.'); await reload(); setVersion(v => v + 1);
    if (isNew) { setQuery(''); setOwner('all'); setId(lot.id); setMobileDetail(true); } };

  const head = <div className="lm-head">
    <div><h1>물량 관리</h1><p>저장한 사과와 측정 기록을 한눈에 확인하세요.</p></div>
    <button className="btn btn-primary" onClick={() => setEditor({open: true, lot: null})}><Plus size={17} />새 물량 등록</button>
  </div>;
  const editorEl = <LotEditor open={editor.open} lot={editor.lot} onClose={() => setEditor({open: false, lot: null})} onSaved={lot => void onLotSaved(lot)} />;

  if (!lots.length) return <div className="lm">{head}
    <section className="empty-panel"><ClipboardList size={34} /><h2>{loadError ? '물량을 불러오지 못했습니다.' : '아직 등록한 물량이 없어요.'}</h2>
      <p>{loadError || '물량을 등록하고 측정 기록·온습도 이력·사진을 여기서 관리하세요.'}</p>
      <div className="qt-inline-btns"><button className="btn btn-primary" onClick={() => setEditor({open: true, lot: null})}><Plus size={16} />새 물량 등록</button><button className="btn btn-outline" onClick={() => openTracker('example')}>예시로 체험</button>{loadError && <button className="btn btn-outline" onClick={() => void reload()}>다시 불러오기</button>}</div>
    </section>{editorEl}</div>;

  const lot = data?.lot ?? selected;
  const obs = data?.observations ?? [];
  const byNewest = [...obs].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const latestObs = byNewest[0] ?? null;
  const baseObs = lot ? baselineObservation(lot, obs) : null;
  const ready = lot ? lotReadiness(lot) : null;
  const review = data ? reviewLot(data.lot, data.stats, data.observations) : null;
  const totalText = [summary.totals['상자'] ? `${summary.totals['상자'].toLocaleString('ko-KR')}상자` : '', summary.totals.kg ? `${summary.totals.kg.toLocaleString('ko-KR')}kg` : ''].filter(Boolean);

  return <div className={'lm' + (mobileDetail && selected ? ' has-detail' : '')}>
    <div className="lm-overview">
      {head}
    </div>
    {loadError && <div className="error-box" role="alert">목록을 새로 불러오지 못했습니다. {loadError}<button onClick={() => void reload()}>목록 다시 불러오기</button></div>}
    {notice && <div className="success-notice" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="알림 닫기">×</button></div>}
    {error && <div className="error-box" role="alert">{error}{rowErrors.length > 0 && <ul className="row-errors">{rowErrors.map(r => <li key={r}>{r}</li>)}</ul>}<button onClick={refresh}>다시 불러오기</button></div>}

    <div className="lm-work">
      <aside className="lm-list" aria-label="저장 물량 목록">
        <div className="lm-list-head"><h2>저장 물량 <span>{filtered.length}</span></h2><span className="lm-sort">저장 시작일 최신순</span></div>
        <label className="lm-search"><Search size={18} aria-hidden="true" /><span className="sr-only">물량 이름·품종·저장고로 찾기</span><input id="lot-search-input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="이름, 품종, 저장고로 검색" /></label>
        <div className="lm-filter" role="group" aria-label="물량 구분">
          {([['all', '전체'], ['mine', '내 물량'], ['shared', '공유받음']] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={owner === k} className={owner === k ? 'active' : ''} onClick={() => setOwner(k)}>{t} <span>{counts[k]}</span></button>)}
        </div>
        {(query.trim() || owner !== 'all') && <p className="lm-result" role="status">{filtered.length}건 표시 · 전체 {lots.length}건</p>}
        <ul>{filtered.map(l => { const o = l.latest_observation; return <li key={l.id}>
          <button id={'lot-choice-' + l.id} type="button" disabled={!!busy} onClick={() => selectLot(l.id)} className={'lm-item' + (selected?.id === l.id ? ' chosen' : '')} aria-current={selected?.id === l.id ? 'true' : undefined}>
            <img src={applePhoto(l.id)} alt="" loading="lazy" />
            <span className="lm-item-copy"><b>{l.name}{!l.name.includes(l.variety) && <> · {l.variety}</>}{shared(l) && <em className="lm-tag">공유받음</em>}</b>
              <span>{l.location || '저장고 미입력'} · {qty(l)} · {daysIn(l)}일째</span>
              <span className={o ? 'lm-rec' : 'lm-rec none'}>{o ? `최근 측정 ${shortDate(o.date)} · ${l.observation_count ?? 1}회` : '아직 측정 기록 없음'}</span></span>
            {selected?.id === l.id && <Check size={18} className="lm-item-check" aria-hidden="true" />}
          </button></li>; })}</ul>
        {!filtered.length && <div className="lm-empty" role="status"><Search size={24} /><h3>표시할 물량이 없어요.</h3><p>검색어나 구분을 바꿔 주세요.</p><button className="btn btn-outline" onClick={() => { setQuery(''); setOwner('all'); }}>검색·필터 지우기</button></div>}
      </aside>

      {!selected ? <section className="lm-detail lm-detail-empty" aria-label="선택한 물량 상세"><ClipboardList size={28} /><p>{filtered.length ? '물량을 선택하면 상세 정보와 측정 기록을 볼 수 있어요.' : '검색 결과가 없어 상세 정보를 표시하지 않아요.'}</p></section>
      : <section className="lm-detail" ref={detailRef} tabIndex={-1} aria-label="선택한 물량 상세">
        <button type="button" className="lm-back btn btn-outline" disabled={!!busy} onClick={backToList}><ArrowLeft size={16} />물량 목록으로</button>
        <div className="lm-dhead">
          <div className="lm-badges"><span>{lot!.variety}</span><span>{shared(lot!) ? '공유받음 · 팀 공유' : lot!.team_shared ? '내 물량 · 팀 공유' : '내 물량 · 나만 보기'}</span></div>
          <div className="lm-dtitle"><h2>{lot!.name}</h2>
            <div className="lm-dactions"><button type="button" className="btn btn-outline" onClick={() => setEditor({open: true, lot: lot!})}><Pencil size={15} />정보 수정</button>
              <button type="button" className="btn btn-primary" onClick={() => openTracker('real', lot!.id)}>품질 변화 보기<ArrowUpRight size={16} /></button></div></div>
          <p className="lm-dsub">{fmtDate(storageStart(lot!))} 저장 시작 · {lot!.storage} · 1-MCP {mcpLabel(lot!.mcp)} · {typeof lot!.details?.storage_temperature === 'number' ? `${lot!.details.storage_temperature}℃` : '온도 미기록'}</p>
          <dl className="lm-facts">
            <div><dt>저장 위치</dt><dd>{lot!.location || '미입력'}</dd></div>
            <div><dt>저장 수량</dt><dd>{qty(lot!)}</dd></div>
            <div><dt>저장 기간</dt><dd>{daysIn(lot!)}일째</dd></div>
            <div><dt>최근 측정일</dt><dd>{latestObs ? shortDate(latestObs.date) : lot!.latest_observation ? shortDate(lot!.latest_observation.date) : '기록 없음'}</dd></div>
          </dl>
          {ready && <div className={'lm-ready ' + ready.status} role="status"><Info size={16} aria-hidden="true" /><div><b>예측 준비 · {ready.title}</b><span>{ready.detail}</span>
            {ready.status === 'needs-date' && <div className="lm-ready-actions">
              <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => void post('update', {initial_measured_on: storageStart(lot!), details: {initial_same_start: true}}, '초기 측정일을 저장 시작일로 기록했습니다.')}>저장 시작일({shortDate(storageStart(lot!))})에 측정했어요</button>
              <label className="lm-inline-date"><span className="sr-only">초기 측정일</span><input type="date" min={storageStart(lot!)} max={today()} value={dateInput} onChange={e => setDateInput(e.target.value)} /></label>
              <button type="button" className="btn btn-outline" disabled={!!busy || !isDate(dateInput)} onClick={() => void post('update', {initial_measured_on: dateInput, details: {initial_same_start: dateInput === storageStart(lot!)}}, '초기 측정일을 기록했습니다.')}>측정일 저장</button></div>}
            {ready.status === 'needs-initial' && <div className="lm-ready-actions"><button type="button" className="btn btn-outline" disabled={!data} onClick={() => setMeasure({open: true, obs: null, preset: true})}><Plus size={15} />예측 기준 초기 측정 추가</button></div>}
            {ready.status === 'conditions' && <div className="lm-ready-actions"><button type="button" className="btn btn-outline" onClick={() => setEditor({open: true, lot: lot!})}><Pencil size={15} />보관 조건 수정</button></div>}
          </div></div>}
        </div>

        {loading && <div className="loading-strip"><Loader2 size={17} className="spin" />기록을 불러오는 중입니다.</div>}

        <div id="lot-record-panel" role="tabpanel" aria-labelledby={'lot-tab-' + sub} className="lm-panel">
        {sub === 'records' && data && lot && <>
          <section className="lm-base" aria-label="예측 기준 초기 측정">
            {weatherInitial(lot) ? <><h3>예측 기준 초기값 · 날씨 기반 추정</h3><p>실측이 아닌 날씨 선택값으로 추정한 초기 품질이에요. 실제로 측정한 기록을 기준으로 바꾸려면 아래 이력에서 ‘기준 지정’을 눌러 주세요.</p></>
            : hasInitialValues(lot) ? <><h3>예측 기준 초기 측정 · {lot.initial_measured_on ? shortDate(lot.initial_measured_on) : <span className="lm-warn-text">측정일 미기록</span>}</h3>
                <p>{baseObs ? '아래 측정 이력의 한 기록을 기준으로 지정했어요. 초기 기록을 유지하며 후속 측정과 비교합니다.' : '물량을 등록할 때 입력한 초기 측정이에요. 초기 기록을 유지하며 후속 측정과 비교합니다.'}</p>
                <dl className="lm-vals small"><div><dt>경도</dt><dd><V v={lot.firmness} unit="N" /></dd></div><div><dt>당도</dt><dd><V v={lot.brix} unit="°Brix" /></dd></div><div><dt>산도</dt><dd><V v={lot.acidity} d={2} unit="%" /></dd></div><div><dt>측정한 사과 수</dt><dd>{lot.initial_sample_count ? `${lot.initial_sample_count}개` : '미기록'}</dd></div></dl></>
            : <><h3>예측 기준 초기 측정이 아직 없어요</h3><p>측정 기록을 추가하면서 ‘예측 기준 초기 측정으로 지정’을 선택하거나, 이력의 기록을 기준으로 지정해 주세요. 가장 오래된 기록을 자동으로 기준으로 쓰지 않아요.</p></>}
          </section>

          <section className="lm-recent" aria-label="최근 측정 기록">
            <div className="lm-sec-head"><div><h3>{latestObs ? `최근 측정 기록 · ${shortDate(latestObs.date)}` : '아직 측정 기록이 없어요'}</h3><p>{latestObs ? `${obs.length}회 측정 기록 · 실측 · 같은 날 측정한 값만 함께 보여 줘요` : '측정한 날 기록하면 실제 품질 변화를 비교하기 쉬워요.'}</p></div>
              <button type="button" className="btn btn-primary lm-add" disabled={!data || loading || !!busy} onClick={() => setMeasure({open: true, obs: null, preset: false})}><Plus size={16} />측정 기록 추가</button></div>
            {latestObs && <dl className="lm-vals">{([['firmness', '경도', 'N', 1], ['brix', '당도', '°Brix', 1], ['acidity', '산도', '%', 2]] as const).map(([k, t, u, d]) => { const v = latestObs[k] ?? null, base = lot[k];
              return <div key={k}><dt>{t}</dt><dd>{v === null ? <span className="lm-missing-big">— <small>이번 기록에서 미측정</small></span> : <>{fmtNum(v, d)}<small> {u}</small></>}</dd>{base !== null && base !== undefined && <span className="lm-vs">초기 측정 {fmtNum(base, d)} {u}</span>}</div>; })}</dl>}
          </section>

          <section className="lm-history" aria-label="측정 이력">
            <div className="lm-sec-head"><h3>측정 이력 <span>{obs.length + (hasInitialValues(lot) && !baseObs ? 1 : 0)}</span></h3><span className="lm-sort">최신순</span></div>
            {!showAll ? <div className="lm-table-wrap"><table className="lm-table">
              <thead><tr><th>측정일</th><th>경도 N</th><th>당도 °Brix</th><th>산도 %</th><th>사과 수</th><th>메모</th><th><span className="sr-only">관리</span></th></tr></thead>
              <tbody>
                {byNewest.map(o => { const isBase = baseObs?.id === o.id; return <tr key={o.id} className={isBase ? 'is-base' : ''}>
                  <td>{shortDate(o.date)}{isBase && <em className="lm-base-tag">예측 기준 초기</em>}</td><td><V v={o.firmness} /></td><td><V v={o.brix} /></td><td><V v={o.acidity} d={2} /></td><td>{o.sample_count ?? '—'}</td>
                  <td className="lm-note">{o.notes || (o.defects && o.defects !== '미확인' ? `외관: ${o.defects}` : '—')}</td>
                  <td className="lm-row-actions"><button type="button" className="linkbtn" onClick={() => setMeasure({open: true, obs: o, preset: false})}>수정</button>
                    </td>
                </tr>; })}
                {!byNewest.length && !(hasInitialValues(lot) && !baseObs) && <tr><td colSpan={7} className="lm-note">아직 기록이 없어요. ‘측정 기록 추가’로 첫 기록을 남겨 주세요.</td></tr>}
                {hasInitialValues(lot) && !baseObs && <tr className="is-base"><td>{lot.initial_measured_on ? shortDate(lot.initial_measured_on) : <span className="lm-warn-text">측정일 미기록</span>}<em className="lm-base-tag">예측 기준 초기 · 등록 시 입력</em></td>
                  <td><V v={lot.firmness} /></td><td><V v={lot.brix} /></td><td><V v={lot.acidity} d={2} /></td><td>{lot.initial_sample_count ?? '—'}</td><td className="lm-note">{lot.notes || '첫 측정'}</td>
                  <td className="lm-row-actions"><button type="button" className="linkbtn" onClick={() => setMeasure({open: true, obs: null, preset: true, prefill: {id: 'initial', lot_id: lot.id, date: lot.initial_measured_on ?? '', firmness: lot.firmness, brix: lot.brix, acidity: lot.acidity ?? null, weight: null, tracked_weight: null, defects: '미확인', sample_count: lot.initial_sample_count ?? null, notes: '', details: {measure: lot.details?.measure}}})}>수정</button></td></tr>}
              </tbody></table></div>
            : <div className="qt-table-wrap lot-history-table"><table className="qt-table">
              <thead><tr><th>측정일</th><th>구분</th><th>경과일</th><th>사과 수</th><th>경도 N</th><th>당도 °Brix</th><th>산도 %</th><th>평균 중량 g</th><th>추적 표본 중량 g</th><th>외관</th><th>측정 조건</th><th>메모</th></tr></thead>
              <tbody>
                {byNewest.map(o => <tr key={o.id} className={baseObs?.id === o.id ? 'row-initial' : ''}><td data-label="측정일">{fmtDate(o.date)}</td><td data-label="구분">{baseObs?.id === o.id ? '예측 기준 초기' : '측정'}</td><td data-label="저장 경과일">{daysBetween(storageStart(lot), o.date)}일차</td><td data-label="사과 수">{o.sample_count ?? '—'}</td>
                  <td data-label="경도 N"><V v={o.firmness} /></td><td data-label="당도 °Brix"><V v={o.brix} /></td><td data-label="산도 %"><V v={o.acidity} d={3} /></td><td data-label="평균 중량 g"><V v={o.weight} /></td><td data-label="추적 표본 중량 g"><V v={o.tracked_weight} /></td><td data-label="외관">{o.defects}</td><td data-label="측정 조건"><small>{measureText(o.details?.measure)}</small></td><td data-label="메모"><small>{o.notes || '—'}</small></td></tr>)}
                {hasInitialValues(lot) && !baseObs && <tr className="row-initial"><td data-label="측정일">{lot.initial_measured_on ? fmtDate(lot.initial_measured_on) : <small>측정일 미기록</small>}</td><td data-label="구분">예측 기준 초기 · 등록 시 입력</td><td data-label="저장 경과일">{lot.initial_measured_on ? `${daysBetween(storageStart(lot), lot.initial_measured_on)}일차` : '—'}</td><td data-label="사과 수">{lot.initial_sample_count ?? '—'}</td>
                  <td data-label="경도 N"><V v={lot.firmness} /></td><td data-label="당도 °Brix"><V v={lot.brix} /></td><td data-label="산도 %"><V v={lot.acidity} d={3} /></td><td data-label="평균 중량 g"><V v={lot.weight} /></td><td data-label="추적 표본 중량 g"><V v={lot.details?.tracked?.initial_weight} /></td><td data-label="외관">—</td><td data-label="측정 조건"><small>{measureText(lot.details?.measure)}</small></td><td data-label="메모"><small>{lot.notes || '—'}</small></td></tr>}
              </tbody></table></div>}
            <p className="lm-hint">‘—’는 그 기록에서 측정하지 않은 항목이에요(0이 아니에요). 예측 기준 초기 측정은 날짜 순서와 별도로 지정해요.</p>
            <div className="lm-foot-links"><button type="button" className="ah-textlink" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? '간단히 보기' : '전체 항목 보기'}<ArrowRight size={16} /></button></div>
          </section>

          <details className="lm-more">
            <summary>보관 조건·공유 범위 자세히 보기</summary>
            <dl className="lot-dl">
              <div><dt>수확일</dt><dd>{lot.harvest_date ? fmtDate(lot.harvest_date) : '미입력'}</dd></div>
              <div><dt>입고일</dt><dd>{fmtDate(lot.intake_date)}</dd></div>
              <div><dt>저장 시작일</dt><dd>{fmtDate(storageStart(lot))}{(!lot.storage_start_date || lot.storage_start_date === lot.intake_date) && <small> 입고일과 같음</small>}</dd></div>
              <div><dt>보관 방식 / 1-MCP</dt><dd>{lot.storage} / {mcpLabel(lot.mcp)}</dd></div>
              <div><dt>포장</dt><dd>{lot.packaging || '미입력'}</dd></div>
              <div><dt>온습도 센서 번호</dt><dd>{lot.sensor_id || '미입력'}</dd></div>
              <div><dt>공유 범위</dt><dd>{lot.team_shared ? '팀과 공유 · 팀원이 보고 추가·수정할 수 있어요' : '나만 보기'}{shared(lot) && ' · 공유 범위는 등록한 사람만 바꿀 수 있어요'}</dd></div>
              {lot.details?.mcp && (lot.details.mcp.treated_on || lot.details.mcp.product) && <div><dt>1-MCP 처리 기록</dt><dd>{[lot.details.mcp.treated_on && fmtDate(lot.details.mcp.treated_on), lot.details.mcp.product, lot.details.mcp.concentration, lot.details.mcp.hours != null && `${lot.details.mcp.hours}h`, lot.details.mcp.temp != null && `${lot.details.mcp.temp}°C`].filter(Boolean).join(' · ')}</dd></div>}
              {lot.details?.ca && (lot.details.ca.from || lot.details.ca.o2 != null) && <div><dt>CA 환경</dt><dd>{[lot.details.ca.from && `${fmtDate(lot.details.ca.from)}~${lot.details.ca.to ? fmtDate(lot.details.ca.to) : ''}`, lot.details.ca.o2 != null && `O₂ ${lot.details.ca.o2}%`, lot.details.ca.co2 != null && `CO₂ ${lot.details.ca.co2}%`].filter(Boolean).join(' · ')}</dd></div>}
            </dl>
          </details>
          <details className="lm-more review">
            <summary>기록 점검 메모 <small>규칙 기반 · 안전 판정 아님</small></summary>
            <p className="lot-review-label">{review?.label}</p>
            <ul>{review?.reasons.map(r => <li key={r}><AlertTriangle size={13} />{r}</li>)}</ul>
            <p className="qt-help">보관 가능일·출하일은 제공하지 않습니다.</p>
          </details>
          {onAskAI && <button type="button" className="ah-textlink lv2-ask" disabled={!data || loading || !!error} data-ai-return onClick={() => onAskAI(lot.id)}><MessageCircle size={16} />이 사과 상태 요약해 보기</button>}
        </>}

        {sub === 'environment' && data && lot && <>
          <div className="upload-panel">
            <div><span className="section-label">온습도 이력</span><h2>센서 CSV 업로드</h2><p>센서 <strong>{lot.sensor_id || '미입력'}</strong> · 원본 CSV도 함께 보관합니다. 온습도 이력은 <b>기록·표시용</b>이며 현재 품질 예측 계산에는 반영하지 않습니다.</p></div>
            <form onSubmit={e => upload(e, 'environment')} className="upload-form"><input aria-label="환경 CSV 파일" name="file" type="file" accept=".csv,text/csv" required disabled={!!busy || !lot.sensor_id} /><button className="primary-button" disabled={!!busy || !lot.sensor_id}><Upload size={16} />{busy === 'environment' ? '저장 중…' : 'CSV 업로드'}</button></form>
            <button className="text-button" onClick={downloadTemplate}><Download size={15} />CSV 예시 양식</button>
            {!lot.sensor_id && <p className="upload-format warn">센서 번호가 없어 업로드할 수 없습니다. <button type="button" className="linkbtn" onClick={() => setEditor({open: true, lot})}>정보 수정</button>에서 ‘입고·수확·포장·센서 기록’을 열어 센서 번호를 넣어 주세요.</p>}
            <details className="upload-guide" open={!data.stats.count || undefined}><summary><Info size={14} />업로드 규칙과 예시 양식</summary><ul>
              <li><b>필수 열</b>: timestamp, sensor_id, temperature, humidity (한글 머리글 측정일시·센서번호·온도·습도도 인식)</li>
              <li><b>시간대</b>: 시각에 +09:00 등 시간대가 없으면 한국 시간으로 읽습니다. 형식 예: 2026-09-01T13:00:00+09:00 또는 2026-09-01 13:00</li>
              <li><b>센서 ID</b>: 이 물량의 센서 번호와 다른 행은 저장하지 않고 개수만 알려 드립니다.</li>
              <li><b>중복 시각</b>: 파일 안에서 같은 시각이 반복되면 첫 행만, 이미 저장된 시각은 저장하지 않습니다.</li>
              <li><b>비정상 값</b>: 온도 −15~50°C, 습도 0~100% 밖이거나 날짜가 잘못된 행이 하나라도 있으면 <b>전체 업로드를 취소</b>하고 문제 행을 보여 드립니다.</li>
              <li><b>제한</b>: UTF-8, 1MB·3,000행 이하, 물량당 최대 20,000행. 기록 공백은 보간하지 않습니다.</li>
            </ul><pre className="lm-csv">timestamp,sensor_id,temperature,humidity{'\n'}{lot.intake_date}T00:00:00+09:00,{lot.sensor_id || 'T-01'},0.4,93</pre></details>
          </div>
          {data.stats.count > 0 ? <>
            <div className="stat-grid">
              <Stat label="평균 온도" value={fmt(data.stats.meanTemperature, 2) ?? '—'} unit="°C" sub={`시간 표준편차 ${fmt(data.stats.sdTemperature, 2) ?? '—'}°C`} />
              <Stat label="평균 상대습도" value={fmt(data.stats.meanHumidity, 1) ?? '—'} unit="%" sub={`시간 표준편차 ${fmt(data.stats.sdHumidity, 2) ?? '—'}%`} />
              <Stat label="온도 범위" value={`${fmt(data.stats.minTemperature, 1) ?? '—'} ~ ${fmt(data.stats.maxTemperature, 1) ?? '—'}`} unit="°C" sub="오늘까지 기록" />
              <Stat label="기록 공백" value={String(data.stats.gapCount)} unit="구간" sub={`추정 누락 ${data.stats.missingSlots}건 · 대표 간격 ${data.stats.expectedIntervalMinutes ?? '미확인'}분 · 보간 안 함`} />
            </div>
            <div className="environment-charts">
              <section className="data-panel"><div className="section-head"><h2>온도 이력 <span>°C</span></h2><span>{data.stats.count.toLocaleString()}개 기록</span></div><EnvironmentChart stats={data.stats} metric="temperature" /></section>
              <section className="data-panel"><div className="section-head"><h2>상대습도 이력 <span>%</span></h2><span>{lot.sensor_id || '센서 미입력'}</span></div><EnvironmentChart stats={data.stats} metric="humidity" /></section>
            </div>
            <div className="range-summary">참고 범위(온도 −1~1°C · 습도 90~95%) 이탈 노출: <strong>{data.stats.outOfRangeHours.toFixed(1)}시간</strong><span>관측 간격이 일정한 구간의 직전 값을 유지한다고 가정 · 긴 공백 제외</span></div>
          </> : <div className="lm-env-empty"><Upload size={22} /><div><b>아직 올린 온습도 기록이 없어요.</b><p>센서에서 받은 CSV를 위 양식에 맞춰 올리면 평균·범위·기록 공백과 그래프를 보여 드려요.</p></div></div>}
        </>}

        {sub === 'photos' && data && lot && <>
          <div className="upload-panel">
            <div><span className="section-label">사진</span><h2>같은 조건에서 찍고, 나란히 비교하세요.</h2><p>사진으로 경도·당도·안전성을 추정하지 않습니다.</p></div>
            <form className="photo-upload" onSubmit={e => upload(e, 'photos')}>
              <label>촬영일<input aria-label="사진 촬영일" name="date" type="date" defaultValue={today()} min={lot.intake_date} max={today()} required /></label>
              <label>사진 파일<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required disabled={!!busy} /></label>
              <label>촬영 메모<input name="notes" placeholder="거리·조명·표본 번호" maxLength={500} /></label>
              <button className="primary-button" disabled={!!busy}><Upload size={16} />{busy === 'photos' ? '저장 중…' : '사진 저장'}</button>
            </form>
            <p className="upload-format">JPG·PNG·WebP · 입력 최대 12MB · 긴 변 최대 1,600px의 JPEG 사본으로 저장합니다.</p>
          </div>
          <PhotoComparison key={lot.id} photos={data.photos} />
          <div className="photo-guidance"><Camera size={24} /><div><h3>촬영 조건을 맞추면 비교가 쉬워요.</h3><p>같은 거리와 각도, 일정한 조명, 단색 배경을 사용하세요. 색 변화·주름·상처는 측정 기록의 외관 관찰로 남겨 주세요.</p></div></div>
        </>}
        </div>
        {sub === 'records' && <div className="lm-sticky"><button type="button" className="btn btn-primary" disabled={!data || loading || !!busy} onClick={() => setMeasure({open: true, obs: null, preset: false})}><Plus size={16} />측정 기록 추가</button></div>}
      </section>}
    </div>
    {editorEl}
    {lot && <MeasurementForm open={measure.open} lot={lot} observation={measure.obs} prefill={measure.prefill} presetInitial={measure.preset} isBaseline={!!measure.obs && baseObs?.id === measure.obs.id} hasBaseline={hasInitialValues(lot) || weatherInitial(lot)}
      onClose={() => setMeasure({open: false, obs: null, preset: false})} onSaved={msg => { setMeasure({open: false, obs: null, preset: false}); setNotice(msg); refresh(); }} />}
  </div>;
}

function measureText(m?: {probe_mm?: number | null; peeled?: string | null; position?: string | null; fruit_temp?: number | null; instrument?: string | null} | null) {
  if (!m) return '—';
  const t = [m.probe_mm != null && `탐침 ${m.probe_mm}mm`, m.peeled, m.position, m.fruit_temp != null && `과실 ${m.fruit_temp}°C`, m.instrument].filter(Boolean).join(' · ');
  return t || '—';
}
function Stat({label, value, unit, sub}: {label: string; value: string; unit: string; sub: string}) { return <section className="stat-card"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{sub}</p></section>; }
function PhotoComparison({photos}: {photos: Photo[]}) {
  const [left, setLeft] = useState(''), [right, setRight] = useState('');
  useEffect(() => { setLeft(photos[0]?.id ?? ''); setRight(photos.length > 1 ? photos.at(-1)!.id : ''); }, [photos]);
  if (!photos.length) return <div className="lm-env-empty"><Camera size={22} /><div><b>아직 저장한 사진이 없어요.</b><p>첫 관찰 사진을 올리면 기준 사진으로 쓸 수 있어요. 두 장 이상이면 나란히 비교해요.</p></div></div>;
  return <>{photos.length === 1 && <p className="lm-hint">사진이 한 장이라 아직 비교할 수 없어요. 다른 날 같은 조건으로 한 장 더 올려 주세요.</p>}
    {left && right && left === right && <p className="lm-hint">같은 사진을 두 칸에 골랐어요. 비교하려면 다른 날짜의 사진을 골라 주세요.</p>}
    <div className="photo-comparison">{[{id: left, set: setLeft, label: '기준 사진'}, {id: right, set: setRight, label: '비교 사진'}].map((slot, i) => { const p = photos.find(p => p.id === slot.id);
    return <section key={slot.label} className="photo-card"><div><h2>{slot.label}</h2><Select value={slot.id || 'none'} onValueChange={v => slot.set(v === 'none' ? '' : v)}><SelectTrigger aria-label={slot.label + ' 선택'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">사진 선택</SelectItem>{photos.map(p => <SelectItem key={p.id} value={p.id}>{p.date} · {p.name}</SelectItem>)}</SelectContent></Select></div>
      {p ? <><img src={`/api/media/${p.id}`} alt={`${p.date} 촬영한 ${slot.label}`} /><p>{p.date} · {p.notes || '촬영 메모 없음'}</p></> : <div className="photo-empty"><Camera size={34} /><h3>{i === 0 ? '기준 사진을 선택해 주세요.' : photos.length < 2 ? '비교할 사진이 아직 없어요.' : '비교할 사진을 선택해 주세요.'}</h3><p>실제 사진만 이곳에 표시합니다.</p></div>}</section>; })}</div></>;
}
