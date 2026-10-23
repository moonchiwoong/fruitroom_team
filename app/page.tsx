'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {Apple, ArrowRight, BookOpen, ChevronRight, ClipboardList, FlaskConical, Home as HomeIcon, Info, LineChart, LogOut, Menu, MessageCircle, ShieldCheck, UserRound, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {requestJson} from '@/components/lot-forms';
import {KindBadge} from '@/components/tracker-parts';
import type {TrackerRequest} from '@/components/quality-tracker';
import AIAssistant, {type AssistantContext} from '@/components/ai-assistant';
import type {Lot} from '@/lib/lot-types';
import type {StorageId} from '@/lib/initial-quality';
import type {MetricId} from '@/lib/tracker';
import {computeSeries, fmtNum, valueAt, daysBetween, todayKST, fmtDate} from '@/lib/tracker';

const QualityTracker = dynamic(() => import('@/components/quality-tracker'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
const LotsPage = dynamic(() => import('@/components/lots-page'), {ssr: false, loading: () => <div className="loading-strip">물량을 불러오는 중…</div>});
const ModelInfo = dynamic(() => import('@/components/model-info'), {ssr: false, loading: () => <div className="loading-strip">모델 정보를 불러오는 중…</div>});
const Account = dynamic(() => import('@/components/account'), {ssr: false});

type Page = 'home' | 'track' | 'lots' | 'model' | 'account';
const pages: {id: Page; label: string; icon: typeof Apple; kicker: string; title: string; desc: string; hidden?: boolean}[] = [
  {id: 'home', label: '홈', icon: HomeIcon, kicker: '', title: '', desc: ''},
  {id: 'track', label: '품질 예측', icon: LineChart, kicker: '① 초기 품질 입력 → ② 저장 조건 선택 → ③ 변화 확인', title: '품질 예측', desc: '초기 품질을 입력하고, 저장 기간에 따른 변화를 계산해 실제 측정값과 비교하세요.'},
  {id: 'lots', label: '물량 관리', icon: ClipboardList, kicker: 'STORAGE LOTS', title: '물량 관리', desc: '물량별 초기·후속 측정 기록, 온습도 이력, 사진을 한곳에서 확인합니다.'},
  {id: 'model', hidden: true, label: '모델 정보', icon: BookOpen, kicker: 'MODEL INFO', title: '모델 정보', desc: '계산에 쓰는 수식과 출처, 적용 조건, 검증 상태를 확인합니다. 기상 기반 회귀식도 여기에서 볼 수 있어요.'},
  {id: 'account', label: '내 정보', icon: UserRound, kicker: 'MY ACCOUNT', title: '내 정보', desc: '이름·소속·주 산지를 관리합니다.', hidden: true},
];
// 예전 주소(#predict 등)로 들어와도 새 화면으로 연결합니다.
const legacy: Record<string, Page> = {predict: 'model', overview: 'lots', environment: 'lots', photos: 'lots', simulator: 'track'};

export default function Home() {
  const session = useTeamSession();
  const [aiContext, setAIContext] = useState<AssistantContext | null>(null);
  const [modelContext, setModelContext] = useState<{modelId: StorageId | null; metric: MetricId} | undefined>();
  const [tab, setTabState] = useState<Page>('home'), [menu, setMenu] = useState(false);
  const [lots, setLots] = useState<Lot[]>([]), [lotsError, setLotsError] = useState(''), [lotsLoaded, setLotsLoaded] = useState(false);
  const [trackReq, setTrackReq] = useState<TrackerRequest | null>(null), [lotFocus, setLotFocus] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { const d = await requestJson<{lots: Lot[]}>('/api/lots'); setLots(d.lots); setLotsError(''); return d.lots; }
    catch (e) { setLotsError((e as Error).message); return [] as Lot[]; }
    finally { setLotsLoaded(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const setTab = useCallback((p: Page) => { setTabState(p); setMenu(false); history.replaceState(null, '', '#' + p); window.scrollTo({top: 0, behavior: 'smooth'}); }, []);
  const openTracker = useCallback((mode: 'real' | 'example', lotId?: string) => { setTrackReq(r => ({mode, lotId, n: (r?.n ?? 0) + 1})); setTab('track'); }, [setTab]);
  useEffect(() => {
    const h = window.location.hash.slice(1); const p = (legacy[h] ?? h) as Page;
    if (pages.some(x => x.id === p)) setTabState(p);
    // 소개 화면에서 ‘실측값 입력’·‘예시로 체험’을 누르고 로그인한 경우
    try { const intent = sessionStorage.getItem('appletrack:intent'); if (intent === 'real' || intent === 'example') { sessionStorage.removeItem('appletrack:intent'); openTracker(intent, intent === 'real' ? 'new' : undefined); } } catch { /* 무시 */ }
  }, [openTracker]);
  const current = pages.find(p => p.id === tab)!;

  return <div className="site">
    <SiteHeader tab={tab} setTab={setTab} menu={menu} setMenu={setMenu} />
    <main className="site-main">
      {tab === 'home' && <HomePage lots={lots} loaded={lotsLoaded} error={lotsError} retry={reload} openTracker={openTracker} setTab={setTab} onAskAI={() => setAIContext({mode:'real',scope:'all'})} />}
      {tab !== 'home' && <div className={"page-hero" + (tab === "track" ? " page-hero-track" : "")}><div className="page-hero-inner"><span className="page-kicker">{current.kicker}</span><h1>{current.title}</h1><p>{current.desc}</p></div></div>}
      <div className="page-body">
        {tab === 'track' && <QualityTracker lots={lots} onLotsChanged={reload} request={trackReq} onAskAI={setAIContext} openModelInfo={context => {setModelContext(context); setTab('model');}} openLot={id => { setLotFocus(id); setTab('lots'); }} />}
        {tab === 'lots' && (lotsLoaded ? <LotsPage lots={lots} loadError={lotsError} reload={reload} openTracker={openTracker} focusId={lotFocus} onAskAI={id => setAIContext({mode:'real',scope:'lot',lotId:id})} /> : <div className="loading-strip">물량을 불러오는 중…</div>)}
        {tab === 'model' && <ModelInfo {...modelContext} />}
        {tab === 'account' && <Account onOpenPredict={() => { setTab('model'); }} />}
      </div>
    </main>
    <SiteFooter setTab={setTab} />
    {aiContext && <AIAssistant key={session?.userId || 'anonymous'} initialContext={aiContext} lots={lots} onClose={() => setAIContext(null)} onNavigate={(page, id) => {if(page==='track') openTracker('real',id); else if(page==='lots'){if(id)setLotFocus(id);setTab('lots');}else setTab('model');}} />}
  </div>;
}

function Brand({onClick}: {onClick: () => void}) {
  return <button className="brand2" onClick={onClick} aria-label="애플트랙 홈"><span className="brand-mark2"><Apple size={20} /></span>
    <span className="brand-text">애플트랙<small>by FarmBridge</small></span></button>;
}

function ProjectGuide() {
  return <Dialog><DialogTrigger asChild><button className="nav-util"><Info size={16} /><span>안내</span></button></DialogTrigger>
    <DialogContent className="record-dialog guide-dialog"><DialogHeader><DialogTitle>애플트랙 사용 안내</DialogTitle><DialogDescription>초기 품질부터 저장 중 변화까지 — 사과 품질 예측·저장 관리</DialogDescription></DialogHeader>
      <div className="guide-body">
        <h3>이렇게 씁니다</h3><p>① 초기 품질(경도·당도·산도)을 입력하고 → ② 저장 조건을 고른 뒤 → ③ 날짜별 변화를 확인하고 실제 측정값과 비교합니다. 처음이라면 ‘예시로 체험’으로 같은 흐름을 둘러보세요.</p>
        <h3>값의 종류를 구분합니다</h3><p><b>실측</b>(직접 측정), <b>모델 계산</b>(수식 결과), <b>예시</b>(가상 값), <b>미측정</b>을 따로 표시합니다. 측정하지 않은 값은 0이나 예시값으로 바꾸지 않습니다.</p>
        <h3>계산은 아직 ‘시연용’입니다</h3><p>저장 중 변화식은 출처 자료에 검증 기간·성능이 없어 검증 미확인 상태입니다. 오차 범위를 표시하지 않으며, 출하일·보관 가능일·안전성을 판정하지 않습니다. 자세한 내용은 ‘모델 정보’에서 확인하세요.</p>
        <h3>입력 내용은 자동으로 임시 저장됩니다</h3><p>새로고침해도 작성 중인 내용을 복구합니다. 초안은 이 브라우저에만 있고, ‘저장’을 눌러야 정식 기록이 됩니다.</p>
      </div></DialogContent></Dialog>;
}

function SiteHeader({tab, setTab, menu, setMenu}: {tab: Page; setTab: (p: Page) => void; menu: boolean; setMenu: (v: boolean) => void}) {
  const session = useTeamSession();
  return <header className="site-header2"><div className="site-header-inner">
    <Brand onClick={() => setTab('home')} />
    <nav className={'site-nav' + (menu ? ' open' : '')} aria-label="주요 메뉴">
      {pages.filter(p => !p.hidden).map(p => { const Icon = p.icon; return <button key={p.id} className={'nav-link' + (tab === p.id ? ' active' : '')} aria-current={tab === p.id ? 'page' : undefined} onClick={() => setTab(p.id)}><Icon size={16} />{p.label}</button>; })}
      <div className="nav-mobile-foot">{session && <><button onClick={() => setTab('account')}><UserRound size={15} />{session.displayName} · 내 정보</button><button onClick={() => void session.signOut()}><LogOut size={15} />로그아웃</button></>}</div>
    </nav>
    <div className="site-utils"><ProjectGuide />
      {session && <div className="user-chip"><button className={'user-btn' + (tab === 'account' ? ' active' : '')} onClick={() => setTab('account')} title="내 정보"><span className="user-avatar">{session.displayName.slice(0, 1).toUpperCase()}</span><span className="account-menu-label">내 정보</span></button>
        <button className="nav-util" onClick={() => void session.signOut()} title="로그아웃"><LogOut size={16} /><span>로그아웃</span></button></div>}
      <button className="menu-toggle" aria-label={menu ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
  </div></header>;
}

function HomePage({lots, loaded, error, retry, openTracker, setTab, onAskAI}: {lots: Lot[]; loaded: boolean; error: string; retry: () => void; onAskAI: () => void; openTracker: (m: 'real' | 'example', lotId?: string) => void; setTab: (p: Page) => void}) {
  const session = useTeamSession();
  return <div className="refreshed-home">
    <section className="home-hero refresh-hero">
      <div className="home-hero-text">
        <span className="page-kicker">APPLETRACK · BY FARMBRIDGE</span>
        <h1>초기 품질부터<br /><em>저장 중 변화까지</em></h1>
        <p>초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => openTracker('real', 'new')}>실측값 입력<ArrowRight size={18} /></button>
          <button className="btn btn-outline btn-lg" onClick={() => openTracker('example')}><FlaskConical size={17} />예시로 체험</button>
        </div>
        <span className="home-calc-note">계산은 시연용입니다. 출하·안전 판정을 대신하지 않습니다.</span>
      </div>
      <aside className="home-start-guide" aria-label="품질 예측 시작 안내">
        <div className="start-guide-title"><Apple size={24} /><span>기록에서 시작하는<br /><strong>나의 사과 품질 예측</strong></span></div>
        <ol>{[['01','초기 품질 입력','측정한 값만, 단위와 날짜까지'],['02','저장 조건 선택','기록된 조건과 미래 가정을 구분'],['03','품질 변화 확인','계산은 선, 실측은 점으로 비교']].map(([n,title,desc]) => <li key={n}><span>{n}</span><div><b>{title}</b><p>{desc}</p></div></li>)}</ol>
      </aside>
    </section>
    <section className="recent-lots home-section">
      <div className="home-section-head"><div><span className="section-label">{session?.displayName ? `${session.displayName}님의 작업 공간` : '내 작업 공간'}</span><h2>최근 물량에서 이어가기</h2></div><button className="btn btn-plain" onClick={() => setTab('lots')}>물량 관리<ArrowRight size={16}/></button></div>
      {!loaded ? <div className="loading-strip" role="status">접근 가능한 물량을 불러오는 중입니다.</div> : error ? <div className="error-box" role="alert">{error}<button onClick={retry}>다시 불러오기</button></div> : lots.length ? <div className="recent-lot-list">{lots.slice(0,3).map(l => <button key={l.id} className="recent-lot" onClick={() => openTracker('real',l.id)}><span className="recent-lot-icon"><Apple size={23}/></span><span className="recent-lot-copy"><b>{l.name}</b><span>{l.variety} · {l.location || '저장고 미입력'}</span><small>저장 {Math.max(0,daysBetween(l.storage_start_date || l.intake_date,todayKST()))}일차 · {l.observation_count ? `후속 측정 ${l.observation_count}건` : '후속 측정 기록 없음'}</small></span><span className="recent-lot-action">품질 변화 보기<ChevronRight size={18}/></span></button>)}</div> : <div className="home-empty"><ClipboardList size={28}/><div><b>아직 등록한 물량이 없어요.</b><p>실측값을 입력해 기록을 시작하거나, 예시로 먼저 둘러보세요.</p></div><button className="btn btn-outline" onClick={() => openTracker('real','new')}>첫 물량 입력</button></div>}
    </section>
    <section className="home-ai-entry"><MessageCircle size={30}/><div><h3>기록에 궁금한 점이 있나요?</h3><p>최근 측정과 계산에 반영된 조건을 쉽게 확인하세요.</p></div><button className="btn btn-outline" data-ai-return onClick={onAskAI}>내 물량에 질문하기<ArrowRight size={16}/></button></section>
  </div>;
}

function SiteFooter({setTab}: {setTab: (p: Page) => void}) {
  return <footer className="site-footer"><div className="site-footer-inner">
    <div className="footer-brand"><span className="brand-mark2"><Apple size={18} /></span><div><strong>애플트랙 <span className="by">by FarmBridge</span></strong><p>초기 품질부터 저장 중 변화까지. 실측·모델 계산·예시·미측정을 구분해 표시하며, 계산값은 출하·안전 판정을 대신하지 않습니다.</p></div></div>
    <nav aria-label="하단 메뉴">{pages.map(p => <button key={p.id} onClick={() => setTab(p.id)}>{p.id === 'model' ? '전체 모델 정보' : p.label}</button>)}</nav>
  </div><div className="site-footer-bottom"><ShieldCheck size={14} />사과 품질 예측·저장 관리 · FarmBridge</div></footer>;
}
