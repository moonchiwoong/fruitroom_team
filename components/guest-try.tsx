'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import type {TrackerRequest} from '@/components/quality-tracker';
import type {ModelInfoContext} from '@/components/model-info';

const QualityTracker = dynamic(() => import('@/components/quality-tracker'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
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
  const [request, setRequest] = useState<TrackerRequest>(() => ({mode: readUrl().mode, lotId: 'new', n: 1}));
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
      <div className="guest-utils"><button className="btn btn-ghost" onClick={() => toLogin()}>로그인</button><button className="btn btn-primary" onClick={() => toLogin(true)}>가입하기</button></div>
    </div></header>
    <main className="site-main">
      <div className="page-hero"><div className="page-hero-inner">
        <h1>{view === 'basis' ? '계산 근거·적용 범위' : '사과 품질을 확인해 보세요'}</h1>
        {view !== 'basis' && <p>보관 조건을 기록하고, 초기 품질 입력 방식을 골라 주세요. 가입하지 않아도 써 볼 수 있어요.</p>}
      </div></div>
      <div className="page-body">
        {trackerVisited && <div hidden={view !== 'track'}><QualityTracker guest lots={[]} onLotsChanged={() => undefined} request={request} openModelInfo={context => {setModelContext(context); go({view: 'basis'});}} openLot={() => undefined}
          onModeChange={m => go({mode: m})} onRequireLogin={() => toLogin()} /></div>}
        {view === 'basis' && <ModelInfo context={modelContext} />}
      </div>
    </main>
    <footer className="site-footer"><div className="site-footer-bottom guest-foot">애플트랙 by FarmBridge · 체험 화면의 예시 데이터는 실제 측정 기록이 아니며, 계산은 시연용입니다.</div></footer>
  </div>;
}
