'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Camera, Check, ClipboardList, Download, Info, Loader2, MessageCircle, Search, Upload} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {applePhoto} from '@/lib/photos';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {ObservationForm, requestJson} from '@/components/lot-forms';
import {EnvironmentChart} from '@/components/lot-charts';
import {reviewLot} from '@/lib/lot-analysis';
import {preparePhoto} from '@/lib/prepare-photo';
import {today, type Lot, type Observation, type Photo, type Stats} from '@/lib/lot-types';
import {daysBetween, fmtDate, fmtNum} from '@/lib/tracker';

type Analysis = {lot: Lot; asOf: string; stats: Stats; observations: Observation[]; photos: Photo[]};
type Sub = 'records' | 'environment' | 'photos';
const shortDate = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}월 ${day}일`; };
const fmt = (n: number | null | undefined, d = 1) => n === null || n === undefined ? null : fmtNum(n, d);
const V = ({v, d = 1, unit}: {v: number | null | undefined; d?: number; unit?: string}) => { const t = fmt(v, d); return t === null ? <span className="kind k-missing">미측정</span> : <>{t}{unit && <small> {unit}</small>}</>; };

export default function LotsPage({lots, loadError, reload, openTracker, focusId, onAskAI}: {lots: Lot[]; loadError: string; reload: () => Promise<Lot[]>; openTracker: (mode: 'real' | 'example', lotId?: string) => void; focusId?: string | null; onAskAI?: (lotId: string) => void}) {
  const [id, setId] = useState<string>(focusId ?? lots[0]?.id ?? '');
  const [sub, setSub] = useState<Sub>('records');
  const session = useTeamSession();
  const shared = (l: Lot) => !!l.owner_id && !!session?.userId && l.owner_id !== session.userId;
  const [owner, setOwner] = useState<'all' | 'mine' | 'shared'>('all'), [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState(''), [mobileDetail, setMobileDetail] = useState(!!focusId);
  const detailRef = useRef<HTMLElement>(null);
  const filteredLots = useMemo(() => { const q = query.trim().toLocaleLowerCase('ko-KR'); return lots.filter(l => (owner === 'all' || (owner === 'shared') === shared(l)) && (!q || [l.name, l.variety, l.location ?? ''].some(v => v.toLocaleLowerCase('ko-KR').includes(q)))); }, [lots, query, owner, session?.userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loadedData, setData] = useState<Analysis | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [rowErrors, setRowErrors] = useState<string[]>([]);
  useEffect(() => { if (focusId) { setId(focusId); setMobileDetail(true); } }, [focusId]);
  useEffect(() => { if (!lots.some(l => l.id === id)) setId(lots[0]?.id ?? ''); }, [lots, id]);
  const selected = lots.find(l => l.id === id);
  const data = loadedData?.lot.id === selected?.id ? loadedData : null;
  useEffect(() => { setNotice(''); setRowErrors([]); setSub('records'); setShowAll(false); }, [id]);
  useEffect(() => {
    setData(null); setError(''); if (!selected) { setLoading(false); return; }
    const ctl = new AbortController(); setLoading(true);
    requestJson<Analysis>(`/api/lots/${selected.id}/analysis?asOf=${today()}`, {signal: ctl.signal}).then(result => { if (!ctl.signal.aborted) setData(result); }).catch(e => { if (!ctl.signal.aborted && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [selected?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setVersion(v => v + 1); void reload(); };
  const selectLot = (lotId: string) => { setId(lotId); setMobileDetail(true); setSub('records'); requestAnimationFrame(() => { const mobile = window.matchMedia('(max-width: 760px)').matches; detailRef.current?.focus({preventScroll: !mobile}); if (mobile) detailRef.current?.scrollIntoView({block: 'start'}); }); };
  function changeSub(next: Sub) { setSub(next); }
  function tabKeys(e: React.KeyboardEvent<HTMLButtonElement>) { const order: Sub[] = ['records', 'environment', 'photos']; const index = order.indexOf(sub); const next = e.key === 'ArrowRight' ? order[(index + 1) % 3] : e.key === 'ArrowLeft' ? order[(index + 2) % 3] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[2] : null; if (next) { e.preventDefault(); changeSub(next); document.getElementById('lot-tab-' + next)?.focus(); } }

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
  function downloadTemplate() {
    if (!selected) return; const d = selected.intake_date, s = selected.sensor_id || 'T-01';
    const csv = `timestamp,sensor_id,temperature,humidity\n${d}T00:00:00+09:00,${s},0.4,93\n${d}T01:00:00+09:00,${s},0.6,92\n${d}T02:00:00+09:00,${s},0.5,93\n`;
    const url = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = 'environment-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!lots.length) return <section className="empty-panel">
    <ClipboardList size={34} /><h2>{loadError ? '물량을 불러오지 못했습니다.' : '아직 등록한 물량이 없어요.'}</h2>
    <p>{loadError || '초기 품질을 입력하면 물량 기록이 만들어지고, 후속 측정·온습도 이력·사진을 여기서 관리합니다.'}</p>
    <div className="qt-inline-btns"><button className="btn btn-primary" onClick={() => openTracker('real', 'new')}>실측값 입력</button><button className="btn btn-outline" onClick={() => openTracker('example')}>예시로 체험</button>{loadError && <button className="btn btn-outline" onClick={() => void reload()}>다시 불러오기</button>}</div>
  </section>;

  const review = data ? reviewLot(data.lot, data.stats, data.observations) : null;
  const lot = data?.lot ?? selected ?? lots[0];
  const start = lot.storage_start_date || lot.intake_date;
  const latest = (k: 'firmness' | 'brix' | 'acidity') => [...(data?.observations ?? [])].reverse().find(o => o[k] !== null && o[k] !== undefined);

  const latestObs = data?.observations.length ? data.observations[data.observations.length - 1] : null;
  const recent = latestObs ? {date: latestObs.date, firmness: latestObs.firmness, brix: latestObs.brix, acidity: latestObs.acidity ?? null}
    : {date: lot.initial_measured_on || start, firmness: lot.firmness, brix: lot.brix, acidity: lot.acidity};
  const simpleRows = data ? [...data.observations].reverse().map(o => ({id: o.id, date: o.date, firmness: o.firmness, brix: o.brix, note: o.notes || (o.defects && o.defects !== '미확인' ? `외관: ${o.defects}` : '정기 측정')}))
    .concat([{id: 'initial', date: lot.initial_measured_on || start, firmness: lot.firmness, brix: lot.brix, note: '첫 측정'}]) : [];
  const counts = {all: lots.length, mine: lots.filter(l => !shared(l)).length, shared: lots.filter(shared).length};

  return <div className={"lots lots-v2" + (mobileDetail ? " has-detail" : "")}>
    <div className="lv2-toolbar">
      <label className="lv2-search"><Search size={20} aria-hidden="true" /><span className="sr-only">사과 이름·품종·저장고로 찾기</span><input id="lot-search-input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="사과 이름 · 품종 · 저장고로 찾기" /></label>
      <div className="lv2-filter" role="tablist" aria-label="사과 구분">
        {([['all', '전체'], ['mine', '내 사과'], ['shared', '공유받음']] as const).map(([k, t]) => <button key={k} role="tab" aria-selected={owner === k} className={owner === k ? 'active' : ''} onClick={() => setOwner(k)}>{t} <span>{counts[k]}</span></button>)}
      </div>
    </div>
    {loadError && <div className="error-box" role="alert">목록을 새로 불러오지 못했습니다. {loadError}<button onClick={() => void reload()}>목록 다시 불러오기</button></div>}
    {notice && <div className="success-notice" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="알림 닫기">×</button></div>}
    {error && <div className="error-box" role="alert">{error}{rowErrors.length > 0 && <ul className="row-errors">{rowErrors.map(r => <li key={r}>{r}</li>)}</ul>}<button onClick={refresh}>다시 불러오기</button></div>}

    <div className="lv2-workspace">
    <aside className="lv2-list" aria-label="저장 사과 목록">
      <h2 className="app-subtitle">저장 사과 목록</h2>
      {query.trim() && <p className="lot-search-count" role="status">{filteredLots.length}개 검색 결과</p>}
      <ul>{filteredLots.map(l => { const o = l.latest_observation; return <li key={l.id}><button id={'lot-choice-' + l.id} disabled={!!busy} onClick={() => selectLot(l.id)} className={'lv2-item' + (selected?.id === l.id ? ' chosen' : '')} aria-pressed={selected?.id === l.id}>
        <img src={applePhoto(l.id)} alt="" loading="lazy" />
        <span className="lv2-item-copy"><b>{l.name}{!l.name.includes(l.variety) && <> · {l.variety}</>}{shared(l) && <em className="lv2-shared">공유받음</em>}</b>
          <span>저장 {Math.max(0, daysBetween(l.storage_start_date || l.intake_date, today()))}일째</span>
          <span>{o ? `최근 측정 ${shortDate(o.date)}` : '아직 측정 기록 없음'}</span></span>
      </button></li>; })}</ul>
      {!filteredLots.length && <div className="lot-search-empty"><Search size={25} /><h3>찾는 사과가 없어요.</h3><p>사과 이름, 품종 또는 저장고로 다시 찾아보세요.</p><button className="btn btn-outline" onClick={() => { setQuery(''); setOwner('all'); }}>검색 지우기</button></div>}
    </aside>

    {selected && <section className="lv2-detail" ref={detailRef} tabIndex={-1} aria-label="선택한 사과 상세">
      <button className="lot-back btn btn-outline" disabled={!!busy} onClick={() => { setMobileDetail(false); requestAnimationFrame(() => (document.getElementById('lot-choice-' + id) ?? document.getElementById('lot-search-input'))?.focus()); }}><ArrowLeft size={16} />사과 목록으로</button>
      <div className="lv2-detail-head">
        <div><h2 className="app-subtitle">{lot.name}{!lot.name.includes(lot.variety) && <> · {lot.variety}</>}</h2>
          <p>{shortDate(start)} 저장 시작 · {lot.storage}{lot.mcp === '처리' ? ' · 1-MCP 처리' : lot.mcp === '미확인' ? ' · 1-MCP 미확인' : ''}{shared(lot) ? ' · 공유받음' : lot.team_shared ? ' · 팀 공유' : ''}</p></div>
        <button className="ah-textlink" onClick={() => openTracker('real', lot.id)}>품질 변화 보기<ArrowUpRight size={16} /></button>
      </div>
      <div className="lv2-tabs" role="tablist" aria-label="기록 종류">
        {([['records', '측정 기록'], ['environment', '온습도 기록'], ['photos', '사진']] as [Sub, string][]).map(([k, t]) => <button key={k} id={'lot-tab-' + k} role="tab" aria-controls="lot-record-panel" aria-selected={sub === k} tabIndex={sub === k ? 0 : -1} className={sub === k ? 'active' : ''} onKeyDown={tabKeys} onClick={() => changeSub(k)}>{t}</button>)}
      </div>
      {loading && <div className="loading-strip"><Loader2 size={17} className="spin" />기록을 불러오는 중입니다.</div>}

      <div id="lot-record-panel" role="tabpanel" aria-labelledby={'lot-tab-' + sub} className="lot-record-panel">
      {sub === 'records' && data && <>
        <section className="lv2-recent">
          <h3>{latestObs ? '최근 측정' : '처음 측정'} · {recent.date ? shortDate(recent.date) : '측정일 미입력'}</h3>
          <dl>
            <div><dt>경도<small>(단단한 정도)</small></dt><dd><V v={recent.firmness} unit="N" /></dd></div>
            <div><dt>당도</dt><dd><V v={recent.brix} unit="°Brix" /></dd></div>
            <div><dt>산도</dt><dd><V v={recent.acidity} d={2} unit="%" /></dd></div>
          </dl>
        </section>
        <section className="lv2-records">
          <div className="lv2-records-head"><h3>측정 기록</h3><ObservationForm lot={lot} label="오늘 측정값 기록" className="btn btn-outline" onSaved={() => { setNotice('측정 기록을 저장했습니다.'); refresh(); }} disabled={!data || loading || !!busy} /></div>
          {!showAll ? <div className="lv2-table-wrap"><table className="lv2-table">
            <thead><tr><th>측정일</th><th>경도</th><th>당도</th><th>메모</th></tr></thead>
            <tbody>{simpleRows.slice(0, 6).map(r => <tr key={r.id}><td>{r.date ? shortDate(r.date) : '—'}</td><td><V v={r.firmness} unit="N" /></td><td><V v={r.brix} unit="°Brix" /></td><td>{r.note}</td></tr>)}</tbody>
          </table></div> : <>
        <div className="qt-table-wrap lot-history-table"><table className="qt-table">
          <thead><tr><th>측정일</th><th>구분</th><th>경과일</th><th>표본 수</th><th>경도 N</th><th>당도 °Brix</th><th>산도 %</th><th>평균 중량 g</th><th>추적 표본 중량 g</th><th>외관</th><th>측정 조건</th><th>메모</th></tr></thead>
          <tbody>
            <tr className="row-initial"><td data-label="측정일">{lot.initial_measured_on ? fmtDate(lot.initial_measured_on) : <small>측정일 미입력</small>}</td><td data-label="구분">초기</td><td data-label="저장 경과일">{lot.initial_measured_on ? `${daysBetween(start, lot.initial_measured_on)}일차` : '—'}</td><td data-label="표본 수">{lot.initial_sample_count ?? '—'}</td>
              <td data-label="경도 N"><V v={lot.firmness} /></td><td data-label="당도 °Brix"><V v={lot.brix} /></td><td data-label="산도 %"><V v={lot.acidity} d={3} /></td><td data-label="평균 중량 g"><V v={lot.weight} /></td><td data-label="추적 표본 중량 g"><V v={lot.details?.tracked?.initial_weight} /></td><td data-label="외관">—</td>
              <td data-label="측정 조건"><small>{measureText(lot.details?.measure)}</small></td><td data-label="메모"><small>{lot.notes || '—'}</small></td></tr>
            {data.observations.map(o => <tr key={o.id}><td data-label="측정일">{fmtDate(o.date)}</td><td data-label="구분">후속</td><td data-label="저장 경과일">{daysBetween(start, o.date)}일차</td><td data-label="표본 수">{o.sample_count}</td>
              <td data-label="경도 N"><V v={o.firmness} /></td><td data-label="당도 °Brix"><V v={o.brix} /></td><td data-label="산도 %"><V v={o.acidity} d={3} /></td><td data-label="평균 중량 g"><V v={o.weight} /></td><td data-label="추적 표본 중량 g"><V v={o.tracked_weight} /></td><td data-label="외관">{o.defects}</td><td data-label="측정 조건"><small>{measureText(o.details?.measure)}</small></td><td data-label="메모"><small>{o.notes || '—'}</small></td></tr>)}
          </tbody>
        </table></div>
          </>}
          <div className="lv2-records-foot">
            <button className="ah-textlink" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? '간단히 보기' : '전체 기록 보기'}<ArrowRight size={16} /></button>
            <span aria-hidden="true" className="lv2-sep" />
            <button className="ah-textlink" onClick={() => openTracker('real', lot.id)}>사과 정보 수정<ArrowUpRight size={16} /></button>
          </div>
        </section>
        <div className="lot-ov lv2-more">
        <details className="lot-ov-card lot-basic-info">
          <summary>물량·저장 조건 상세</summary>
          <dl className="lot-dl">
            <div><dt>수확일</dt><dd>{lot.harvest_date ? fmtDate(lot.harvest_date) : '미입력'}</dd></div>
            <div><dt>입고일</dt><dd>{fmtDate(lot.intake_date)}</dd></div>
            <div><dt>저장 시작일</dt><dd>{fmtDate(start)}{!lot.storage_start_date && <small> 입고일과 같음</small>}</dd></div>
            <div><dt>저장 환경 / 1-MCP</dt><dd>{lot.storage} / {lot.mcp}</dd></div>
            <div><dt>포장 / 저장고 위치</dt><dd>{lot.packaging || '미입력'} / {lot.location || '미입력'}</dd></div>
            <div><dt>입고 중량</dt><dd>{lot.quantity != null ? `${lot.quantity.toLocaleString()} kg` : '미입력'}</dd></div>
            <div><dt>센서 번호</dt><dd>{lot.sensor_id || '미입력'}</dd></div>
            {lot.details?.mcp && (lot.details.mcp.treated_on || lot.details.mcp.product) && <div><dt>1-MCP 처리</dt><dd>{[lot.details.mcp.treated_on && fmtDate(lot.details.mcp.treated_on), lot.details.mcp.product, lot.details.mcp.concentration, lot.details.mcp.hours != null && `${lot.details.mcp.hours}h`, lot.details.mcp.temp != null && `${lot.details.mcp.temp}°C`].filter(Boolean).join(' · ')}</dd></div>}
            {lot.details?.ca && (lot.details.ca.from || lot.details.ca.o2 != null) && <div><dt>CA 환경</dt><dd>{[lot.details.ca.from && `${fmtDate(lot.details.ca.from)}~${lot.details.ca.to ? fmtDate(lot.details.ca.to) : ''}`, lot.details.ca.o2 != null && `O₂ ${lot.details.ca.o2}%`, lot.details.ca.co2 != null && `CO₂ ${lot.details.ca.co2}%`].filter(Boolean).join(' · ')}</dd></div>}
          </dl>
        </details>
        <details className="lot-ov-card review">
          <summary>기록 점검 메모 <small>규칙 기반 · 안전 판정 아님</small></summary>
          <p className="lot-review-label">{review?.label}</p>
          <ul>{review?.reasons.map(r => <li key={r}><AlertTriangle size={13} />{r}</li>)}</ul>
          <p className="qt-help">보관 가능일·출하일은 제공하지 않습니다.</p>
        </details>
        </div>
        {onAskAI && <button className="ah-textlink lv2-ask" disabled={!data || loading || !!error} data-ai-return onClick={() => onAskAI(lot.id)}><MessageCircle size={16} />이 사과 상태 요약해 보기</button>}
      </>}

      {sub === 'environment' && data && <>
        <div className="upload-panel">
          <div><span className="section-label">온습도 이력</span><h2>센서 CSV 업로드</h2><p>센서 <strong>{lot.sensor_id || '미입력'}</strong> · 원본 CSV도 함께 보관합니다. 이 이력은 <b>표시용</b>이며 현재 저장 모델 계산에는 반영하지 않습니다.</p></div>
          <form onSubmit={e => upload(e, 'environment')} className="upload-form"><input aria-label="환경 CSV 파일" name="file" type="file" accept=".csv,text/csv" required disabled={!!busy || !lot.sensor_id} /><button className="primary-button" disabled={!!busy || !lot.sensor_id}><Upload size={16} />{busy === 'environment' ? '저장 중…' : 'CSV 업로드'}</button></form>
          <button className="text-button" onClick={downloadTemplate}><Download size={15} />CSV 예시 양식</button>
          {!lot.sensor_id && <p className="upload-format warn">센서 번호가 없어 업로드할 수 없습니다. ‘품질 변화 보기’에서 물량 정보를 열어 센서 번호를 넣거나, 물량을 새로 저장할 때 입력하세요.</p>}
          <details className="upload-guide"><summary><Info size={14} />업로드 규칙 자세히</summary><ul>
            <li><b>필수 열</b>: timestamp, sensor_id, temperature, humidity (한글 머리글 측정일시·센서번호·온도·습도도 인식)</li>
            <li><b>시간대</b>: 시각에 +09:00 등 시간대가 없으면 한국 시간으로 읽습니다. 형식 예: 2026-09-01T13:00:00+09:00 또는 2026-09-01 13:00</li>
            <li><b>센서 ID</b>: 이 물량의 센서 번호와 다른 행은 저장하지 않고 개수만 알려 드립니다.</li>
            <li><b>중복 시각</b>: 파일 안에서 같은 시각이 반복되면 첫 행만, 이미 저장된 시각은 저장하지 않습니다.</li>
            <li><b>비정상 값</b>: 온도 −15~50°C, 습도 0~100% 밖이거나 날짜가 잘못된 행이 하나라도 있으면 <b>전체 업로드를 취소</b>하고 문제 행을 보여 드립니다.</li>
            <li><b>제한</b>: UTF-8, 1MB·3,000행 이하, 물량당 최대 20,000행. 기록 공백은 보간하지 않습니다.</li>
          </ul></details>
        </div>
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
      </>}

      {sub === 'photos' && data && <>
        <div className="upload-panel">
          <div><span className="section-label">사진</span><h2>같은 조건에서 찍고, 나란히 비교하세요.</h2><p>실제 사진은 3D 외관 예시와 별개입니다. 사진으로 경도·당도·안전성을 추정하지 않습니다.</p></div>
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
    </section>}
    </div>
    <div className="lv2-foot"><span>측정한 날에 기록하면, 실제 품질 변화를 비교하기 쉬워요.</span></div>
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
  return <div className="photo-comparison">{[{id: left, set: setLeft, label: '기준 사진'}, {id: right, set: setRight, label: '비교 사진'}].map((slot, i) => { const p = photos.find(p => p.id === slot.id);
    return <section key={slot.label} className="photo-card"><div><h2>{slot.label}</h2><Select value={slot.id || 'none'} onValueChange={v => slot.set(v === 'none' ? '' : v)}><SelectTrigger aria-label={slot.label + ' 선택'}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">사진 선택</SelectItem>{photos.map(p => <SelectItem key={p.id} value={p.id}>{p.date} · {p.name}</SelectItem>)}</SelectContent></Select></div>
      {p ? <><img src={`/api/media/${p.id}`} alt={`${p.date} 촬영한 ${slot.label}`} /><p>{p.notes || '촬영 메모 없음'}</p></> : <div className="photo-empty"><Camera size={34} /><h3>{i === 0 ? '첫 관찰 사진을 등록해 주세요.' : '비교할 사진을 선택해 주세요.'}</h3><p>실제 사진만 이곳에 표시합니다.</p></div>}</section>; })}</div>;
}
