'use client';
import {useCallback, useEffect, useState} from 'react';
import dynamic from 'next/dynamic';
import {Apple} from 'lucide-react';
import type {TrackerRequest} from '@/components/quality-tracker';

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
  // 뒤로 가기·앞으로 가기에도 화면을 주소와 맞춥니다.
  useEffect(() => {
    const onPop = () => { const next = readUrl(); setState(next); setRequest(r => ({mode: next.mode, lotId: 'new', n: r.n + 1})); };
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: {view?: View; mode?: Mode}) => {
    const cur = readUrl(), v = next.view ?? cur.view, m = next.mode ?? cur.mode;
    const q = new URLSearchParams(); if (m === 'real') q.set('mode', 'real'); if (v === 'basis') q.set('view', 'basis');
    history.pushState(null, '', '/try' + (q.toString() ? `?${q}` : ''));
    setState({view: v, mode: m}); if (next.mode) setRequest(r => ({mode: m, lotId: 'new', n: r.n + 1}));
    window.scrollTo({top: 0});
  }, []);
  const toLogin = (signup = false) => { window.location.href = signup ? '/?auth=signup#join' : '/?auth=login#join'; };

  return <div className="site guest">
    <header className="site-header2"><div className="site-header-inner">
      <a className="brand2" href="/" aria-label="애플트랙 첫 화면"><span className="brand-mark2"><Apple size={20} /></span><span className="brand-text">애플트랙<small>by FarmBridge</small></span></a>
      <nav className="guest-nav" aria-label="체험 메뉴">
        <button className={'nav-link' + (view === 'track' ? ' active' : '')} aria-current={view === 'track' ? 'page' : undefined} onClick={() => go({view: 'track'})}>품질 예측 체험</button>
        <button className={'nav-link' + (view === 'basis' ? ' active' : '')} aria-current={view === 'basis' ? 'page' : undefined} onClick={() => go({view: 'basis'})}>계산 근거</button>
      </nav>
      <div className="guest-utils"><button className="btn btn-ghost" onClick={() => toLogin()}>로그인</button><button className="btn btn-primary" onClick={() => toLogin(true)}>가입하기</button></div>
    </div></header>
    <main className="site-main">
      <div className="page-hero"><div className="page-hero-inner">
        <h1>{view === 'basis' ? '계산 근거·적용 범위' : '품질 예측 체험'}</h1>
        <p>{view === 'basis' ? '계산에 쓰는 식과 출처, 적용 조건과 검증 상태입니다.' : mode === 'example' ? '예시 값으로 저장 조건과 날짜를 바꿔 보세요. 가입하지 않아도 됩니다.' : '내 측정값을 넣어 결과를 볼 수 있어요. 기록으로 저장할 때만 로그인이 필요합니다.'}</p>
      </div></div>
      <div className="page-body">
        {view === 'track'
          ? <QualityTracker guest lots={[]} onLotsChanged={() => undefined} request={request} openModelInfo={() => go({view: 'basis'})} openLot={() => undefined}
            onModeChange={m => go({mode: m})} onRequireLogin={() => toLogin()} />
          : <ModelInfo />}
      </div>
    </main>
    <footer className="site-footer"><div className="site-footer-bottom guest-foot">애플트랙 by FarmBridge · 체험 화면의 예시 데이터는 실제 측정 기록이 아니며, 계산은 시연용입니다.</div></footer>
  </div>;
}
