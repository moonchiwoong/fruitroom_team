'use client';
import BigTextToggle from '@/components/big-text-toggle';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import type {TrackerRequest} from '@/components/quality-tracker';
import type {ModelInfoContext} from '@/components/model-info';
import type {Lot} from '@/lib/lot-types';
import {exampleForm, payloadFromForm} from '@/lib/tracker-form';
import {addDays, todayKST} from '@/lib/tracker';
import {lotPredictor} from '@/lib/lot-predict';
import type {Observation} from '@/lib/lot-types';

const NewApple = dynamic(() => import('@/components/new-apple'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
const LotPreview = dynamic(() => import('@/components/lot-preview'), {ssr: false, loading: () => <div className="loading-strip">예시를 불러오는 중…</div>});
const ModelInfo = dynamic(() => import('@/components/model-info'), {ssr: false, loading: () => <div className="loading-strip">계산 근거를 불러오는 중…</div>});

type View = 'track' | 'basis';
type Mode = 'example' | 'real';
const readUrl = (): {view: View; mode: Mode} => {
  const q = new URLSearchParams(window.location.search);
  return {view: q.get('view') === 'basis' ? 'basis' : 'track', mode: q.get('mode') === 'real' ? 'real' : 'example'};
};

/** 비회원 체험: 예시로 결과를 보고, 내 측정값도 입력해 볼 수 있습니다. 저장할 때만 로그인합니다. */
export default function GuestTry() {
  const [{view, mode}, setState] = useState(readUrl);
  const [, setRequest] = useState<TrackerRequest>(() => ({mode: readUrl().mode, lotId: 'new', n: 1}));
  const [modelContext, setModelContext] = useState<ModelInfoContext | undefined>();
  const [trackerVisited, setTrackerVisited] = useState(() => view === 'track');
  const modeRef = useRef(mode);
  // 뒤로 가기·앞으로 가기에도 화면을 주소와 맞춥니다.
  useEffect(() => {
    const onPop = () => {
      const next = readUrl();
      // 히스토리에는 결과 문맥이 저장되지 않으므로 오래된 결과를 일반 근거 화면에 남기지 않습니다.
      setModelContext(undefined);
      if (next.mode !== modeRef.current) setRequest(r => ({mode: next.mode, lotId: 'new', n: r.n + 1}));
      modeRef.current = next.mode;
      if (next.view === 'track') setTrackerVisited(true);
      setState(next);
    };
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: {view?: View; mode?: Mode}) => {
    const cur = readUrl(), v = next.view ?? cur.view, m = next.mode ?? cur.mode;
    const q = new URLSearchParams(); if (m === 'real') q.set('mode', 'real'); if (v === 'basis') q.set('view', 'basis');
    history.pushState(null, '', '/try' + (q.toString() ? `?${q}` : ''));
    if (v === 'track') setTrackerVisited(true);
    setState({view: v, mode: m});
    if (next.mode && m !== modeRef.current) setRequest(r => ({mode: m, lotId: 'new', n: r.n + 1}));
    modeRef.current = m;
    window.scrollTo({top: 0});
  }, []);
  const toLogin = (signup = false) => { window.location.href = signup ? '/?auth=signup#join' : '/?auth=login#join'; };

  return <div className="site guest">
    <header className="site-header2"><div className="site-header-inner">
      <a className="brand2" href="/" aria-label="애플트랙 첫 화면"><img src="/assets/appletrack-logo.svg" alt="" width={170} height={42} style={{display:'block', width:'clamp(132px, 16vw, 170px)', height:'auto'}} /></a>
      <nav className="guest-nav" aria-label="체험 메뉴">
        <button className={'nav-link' + (view === 'track' ? ' active' : '')} aria-current={view === 'track' ? 'page' : undefined} onClick={() => go({view: 'track'})}>품질 예측 체험</button>
        <button className={'nav-link' + (view === 'basis' ? ' active' : '')} aria-current={view === 'basis' ? 'page' : undefined} onClick={() => {setModelContext(undefined); go({view: 'basis'});}}>계산 근거</button>
      </nav>
      <div className="guest-utils"><BigTextToggle className="btn btn-ghost" /><button className="btn btn-ghost" onClick={() => toLogin()}>로그인</button><button className="btn btn-primary" onClick={() => toLogin(true)}>가입하기</button></div>
    </div></header>
    <main className="site-main">
      <div className="page-hero"><div className="page-hero-inner">
        <h1>{view === 'basis' ? '계산 근거·적용 범위' : '애플트랙 체험'}</h1>
        {view !== 'basis' && <p>예시 사과를 보거나, 내 사과 정보를 넣어 바로 결과를 볼 수 있어요. 가입하지 않아도 돼요.</p>}
      </div></div>
      <div className="page-body">
        {trackerVisited && <div hidden={view !== 'track'}><SimpleTry mode={mode} setMode={m => go({mode: m})} onLogin={() => toLogin(true)} /></div>}
        {view === 'basis' && <ModelInfo context={modelContext} />}
      </div>
    </main>
    <footer className="site-footer"><div className="site-footer-bottom guest-foot">애플트랙 by FarmBridge · 체험 화면의 예시 데이터는 실제 측정 기록이 아니며, 계산은 시연용입니다.</div></footer>
  </div>;
}

/** 간단 체험: ‘예시 사과’(예시 데이터)와 ‘내 사과로 해 보기’(저장 없이 결과) 두 가지만 있습니다. */
function SimpleTry({mode, setMode, onLogin}: {mode: Mode; setMode: (m: Mode) => void; onLogin: () => void}) {
  const example = useMemo(() => {
    const f = exampleForm(), payload = payloadFromForm(f, 'real');
    const lot = {id: 'example', ...payload, latest_observation: null} as unknown as Lot;
    // 예시 측정값: 손으로 정한 숫자 대신, 같은 예측식으로 계산한 값을 반올림해 씁니다(실제 측정이 아니라는 것을 화면에 밝힘).
    const p = lotPredictor(lot, []), start = lot.storage_start_date || lot.intake_date, today = todayKST();
    const obs = [7, 14, 21, 27].map(d => ({d, date: addDays(start, d)})).filter(x => x.date <= today).map(({d, date}) => {
      const v = (m: 'firmness' | 'brix' | 'acidity', k: number) => { const r = p.at(m, d); return r.ok ? Math.round(r.value * k) / k : null; };
      return {id: `example-${d}`, lot_id: 'example', date, firmness: v('firmness', 10), brix: v('brix', 10), acidity: v('acidity', 1000), weight: null, tracked_weight: null, defects: '없음', sample_count: 10, notes: '예시(식으로 계산한 가상 값)'} as unknown as Observation;
    });
    return {lot, obs};
  }, []);
  return <div className="ma try-simple">
    <div className="ma-days try-tabs" role="tablist" aria-label="체험 방식">
      <button type="button" role="tab" aria-selected={mode === 'example'} className={mode === 'example' ? 'active' : ''} onClick={() => setMode('example')}>예시 사과 보기</button>
      <button type="button" role="tab" aria-selected={mode === 'real'} className={mode === 'real' ? 'active' : ''} onClick={() => setMode('real')}>내 사과로 해 보기</button>
    </div>
    {mode === 'example' ? <>
      <div className="ma-title"><h1>예시 사과 · 후지</h1><p>후지 · 일반 저온 · 1-MCP 미처리 · <b>예시 데이터(실제 기록 아님)</b></p></div>
      <LotPreview lot={example.lot} observations={example.obs} obsLabel="예시 측정" />
      <p className="ma-foot">예시 측정값은 예측식으로 계산한 가상 값이에요(실제 측정 아님) · 시연용 계산 · 출하·안전 판정 아님</p>
      <div className="ma-actions"><button type="button" className="ma-primary big" onClick={() => setMode('real')}>내 사과로 해 보기</button></div>
    </> : <NewApple guest onLogin={onLogin} />}
  </div>;
}
