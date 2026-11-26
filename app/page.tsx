'use client';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import '@/components/health/health.css';
import dynamic from 'next/dynamic';
import BigTextToggle from '@/components/big-text-toggle';
import {Apple, BookOpen, ClipboardList, Home as HomeIcon, Info, LineChart, LogOut, Menu, ShieldCheck, UserRound, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {requestJson} from '@/components/lot-forms';
import type {TrackerRequest} from '@/components/quality-tracker';
import type {LotsFocus} from '@/components/lots-page';
import type {ModelInfoContext} from '@/components/model-info';
import {clearDraft, HANDOFF_KEY, loadDraft, saveDraft, type TrackerHandoff} from '@/lib/tracker-form';
import AIAssistant, {type AssistantContext} from '@/components/ai-assistant';
import type {Lot} from '@/lib/lot-types';

const QualityTracker = dynamic(() => import('@/components/quality-tracker'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
const MyApples = dynamic(() => import('@/components/my-apples'), {ssr: false, loading: () => <div className="loading-strip">사과 목록을 불러오는 중…</div>});
const ModelInfo = dynamic(() => import('@/components/model-info'), {ssr: false, loading: () => <div className="loading-strip">모델 정보를 불러오는 중…</div>});
const Account = dynamic(() => import('@/components/account'), {ssr: false});
const HomeSummary = dynamic(() => import('@/components/health/home-summary'), {ssr: false, loading: () => <div className="loading-strip">요약을 불러오는 중…</div>});

type Page = 'home' | 'track' | 'lots' | 'model' | 'account';
const pages: {id: Page; label: string; icon: typeof Apple; kicker: string; title: string; desc: string; hidden?: boolean}[] = [
  {id: 'home', label: '요약', icon: HomeIcon, kicker: '', title: '', desc: ''},
  {id: 'track', hidden: true, label: '품질 예측', icon: LineChart, kicker: '', title: '품질 예측', desc: '초기 품질을 입력하고, 저장 기간에 따른 변화를 계산해 실제 측정값과 비교하세요.'},
  {id: 'lots', label: '내 사과', icon: ClipboardList, kicker: 'MY APPLES', title: '내 사과', desc: '물량별 초기·후속 측정 기록, 온습도 이력, 사진을 한곳에서 확인합니다.'},
  {id: 'model', hidden: true, label: '모델 정보', icon: BookOpen, kicker: 'MODEL INFO', title: '모델 정보', desc: '계산에 쓰는 수식과 출처, 적용 조건, 검증 상태를 확인합니다. 기상 기반 회귀식도 여기에서 볼 수 있어요.'},
  {id: 'account', label: '내 정보', icon: UserRound, kicker: 'MY ACCOUNT', title: '내 정보', desc: '이름·소속·주 산지를 관리합니다.'},
];
// 예전 주소(#predict 등)로 들어와도 새 화면으로 연결합니다.
const legacy: Record<string, Page> = {predict: 'model', overview: 'lots', environment: 'lots', photos: 'lots', simulator: 'track'};

export default function Home() {
  const session = useTeamSession();
  const [aiContext, setAIContext] = useState<AssistantContext | null>(null);
  const [modelContext, setModelContext] = useState<ModelInfoContext | undefined>();
  const [tab, setTabState] = useState<Page>('home'), [menu, setMenu] = useState(false);
  const [trackerVisited, setTrackerVisited] = useState(false), [lotsVisited, setLotsVisited] = useState(false);
  const scrollMemo = useRef<Partial<Record<Page, number>>>({}), tabRef = useRef<Page>('home');
  const [lots, setLots] = useState<Lot[]>([]), [lotsError, setLotsError] = useState(''), [lotsLoaded, setLotsLoaded] = useState(false);
  const [trackReq, setTrackReq] = useState<TrackerRequest | null>(null), [lotFocus, setLotFocusState] = useState<LotsFocus | null>(null);
  const setLotFocus = useCallback((id: string | null, create = false) => setLotFocusState(f => ({id, create, n: (f?.n ?? 0) + 1})), []);
  const reload = useCallback(async () => {
    try { const d = await requestJson<{lots: Lot[]}>('/api/lots'); setLots(d.lots); setLotsError(''); return d.lots; }
    catch (e) { setLotsError((e as Error).message); return [] as Lot[]; }
    finally { setLotsLoaded(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const setTab = useCallback((p: Page, keepResultContext = false) => {
    if (p === 'model' && !keepResultContext) setModelContext(undefined);
    if (p === 'track') setTrackerVisited(true);
    if (p === 'lots') setLotsVisited(true);
    // 물량 관리는 화면을 유지하므로, 돌아올 때 목록 스크롤 위치도 되살립니다.
    scrollMemo.current[tabRef.current] = window.scrollY; const back = p === 'lots' ? scrollMemo.current.lots ?? 0 : 0; tabRef.current = p;
    setTabState(p); setMenu(false); history.replaceState(null, '', '/#' + p); requestAnimationFrame(() => window.scrollTo({top: back}));
  }, []);
  const openTracker = useCallback((mode: 'real' | 'example', lotId?: string) => { setTrackReq(r => ({mode, lotId, n: (r?.n ?? 0) + 1})); setTab('track'); }, [setTab]);
  // 주소: 화면은 #home·#lots 등, 사과 상세는 #lot/<기록 id>. 새로고침·직접 열기·뒤로 가기 모두 주소를 기준으로 화면을 맞춥니다.
  const applyHash = useCallback(() => {
    const h = window.location.hash.slice(1);
    const lotId = h.startsWith('lot/') ? decodeURIComponent(h.slice(4)) : null;
    if (lotId) { setLotsVisited(true); tabRef.current = 'lots'; setTabState('lots'); setLotFocus(lotId); return; }
    const p = (legacy[h] ?? h) as Page;
    if (pages.some(x => x.id === p)) { if (p === 'track') setTrackerVisited(true); if (p === 'lots') { setLotsVisited(true); setLotFocus(null); } tabRef.current = p; setTabState(p); }
  }, [setLotFocus]);
  useEffect(() => { applyHash(); window.addEventListener('popstate', applyHash); return () => window.removeEventListener('popstate', applyHash); }, [applyHash]);
  // 소개·체험 화면에서 ‘실측값 입력’·‘예시로 체험’을 누르고 로그인한 경우
  const sessionUser = session?.userId;
  // 로그인한 농가는 홈 대신 바로 ‘내 사과’ 목록에서 시작합니다(주소에 다른 화면이 지정된 경우는 그대로).
  useEffect(() => {
    try {
      const intent = sessionStorage.getItem('appletrack:intent');
      if (intent === 'real' || intent === 'example') {
        sessionStorage.removeItem('appletrack:intent');
        // 체험 화면에서 입력하던 내용이 있으면 이 계정의 ‘새 입력’ 초안으로 옮겨 이어서 저장할 수 있게 합니다.
        const raw = intent === 'real' ? sessionStorage.getItem(HANDOFF_KEY) : null;
        const handoff = raw ? JSON.parse(raw) as TrackerHandoff : null;
        if (handoff && sessionUser) {
          const existing = loadDraft(sessionUser, 'real', handoff.draftKey);
          if (!existing || existing.savedAt < handoff.draft.savedAt) saveDraft(sessionUser, 'real', handoff.draftKey, handoff.draft);
          clearDraft('anon', 'real', handoff.draftKey); sessionStorage.removeItem(HANDOFF_KEY);
        }
        setTrackReq(r => ({mode: intent, lotId: intent === 'real' ? 'new' : undefined, cultivar: handoff?.cultivar, n: (r?.n ?? 0) + 1})); setTab('track');
      }
    } catch { /* 무시 */ }
  }, [sessionUser]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="site">
    <SiteHeader tab={tab} setTab={setTab} menu={menu} setMenu={setMenu} />
    <main className={'site-main tab-' + tab}>
      {tab === 'home' && <HomeSummary lots={lots} loaded={lotsLoaded} error={lotsError} retry={reload} name={session?.displayName ?? ''} openAccount={() => setTab('account')} openLot={id => { setLotFocus(id); setTab('lots'); }} newLot={() => { setLotFocus(null, true); setTab('lots'); }} />}
      {tab === 'account' && <PageHead title="내 정보" desc="이름·소속·주 산지를 관리합니다." />}
      {tab === 'model' && <PageHead title="계산 근거" />}
      <div className="page-body">
        {trackerVisited && <div hidden={tab !== 'track'}><QualityTracker lots={lots} onLotsChanged={reload} request={trackReq} onAskAI={setAIContext} openModelInfo={context => {setModelContext(context); setTab('model', true);}} openLot={id => { setLotFocus(id); setTab('lots'); }} /></div>}
        {lotsVisited && <div hidden={tab !== 'lots'}>{lotsLoaded ? <MyApples lots={lots} loadError={lotsError} reload={reload} openTracker={openTracker} focus={lotFocus} openModel={() => setTab('model')} /> : <div className="loading-strip">사과 목록을 불러오는 중…</div>}</div>}
        {tab === 'model' && <ModelInfo context={modelContext} />}
        {tab === 'account' && <Account onOpenPredict={() => { setTab('model'); }} />}
      </div>
    </main>
    <SiteFooter setTab={setTab} />
    {aiContext && <AIAssistant key={session?.userId || 'anonymous'} initialContext={aiContext} lots={lots} onClose={() => setAIContext(null)} onNavigate={(page, id) => {if(page==='track') openTracker('real',id); else if(page==='lots'){if(id)setLotFocus(id);setTab('lots');}else setTab('model');}} />}
  </div>;
}

function Brand({onClick}: {onClick: () => void}) {
  return <button className="brand2" onClick={onClick} aria-label="애플트랙 홈"><img src="/assets/appletrack-logo.svg" alt="" width={170} height={42} style={{display:'block', width:'clamp(132px, 16vw, 170px)', height:'auto'}} /></button>;
}

function ProjectGuide() {
  return <Dialog><DialogTrigger asChild><button type="button" className="nav-util" aria-label="안내"><Info size={16} aria-hidden="true" /><span>안내</span></button></DialogTrigger>
    <DialogContent className="record-dialog guide-dialog"><DialogHeader><DialogTitle>애플트랙 사용 안내</DialogTitle><DialogDescription>수확일만 넣으면 저장 중 변화까지 — 사과 품질 예측·저장 관리</DialogDescription></DialogHeader>
      <div className="guide-body">
        <h3>이렇게 써요</h3><p>① ‘내 사과’에서 <b>새 사과</b>를 눌러 품종·생산지·수확일과 저장 조건(후지는 저장 방식·1-MCP 처리 여부, 홍로는 저장고 온도 0℃·4℃)을 넣어요. 처음 품질은 그 해 농업기상 자료로 자동 추정해요. → ② 사과를 누르면 오늘과 <b>저장 시작일부터 센</b> 30·60·90·120일째의 단단함·무게·단맛·신맛을 쉬운 말로 보여줘요(버튼 아래에 그날 날짜와 ‘저장 ○일째’가 함께 나와요). → ③ 당도나 단단함을 재면 <b>측정 추가</b>로 넣어요. 그 값에서 다시 이어 계산하고, 예측과 실제의 차이도 보여줘요.</p>
        <h3>날짜 기준</h3><p>품질 화면의 30·60·90·120일은 <b>저장 시작일부터</b> 센 날이에요. 버튼 아래에 그날 날짜와 ‘저장 ○일째’가 함께 나와요.</p>
        <h3>내 기준</h3><p>사과 상세에서 단단함 기준을 넣으면 계산상 언제쯤 닿는지 ‘○월 중순쯤’으로 보여줘요. 출하 판정이 아니라 계산이에요.</p>
        <h3>값의 출처를 구분해요</h3><p>직접 잰 값(실측), 날씨로 추정한 값, 계산값을 섞지 않고 표시해요.</p>
        <h3>계산은 아직 ‘시연용’이에요</h3><p>예측식의 정확도는 아직 검증되지 않았어요. 출하·안전 여부를 판정하지 않아요.</p>
        <h3>다 판 사과는</h3><p>사과 상세 아래 ‘출하 완료로 옮기기’로 목록에서 정리할 수 있어요.</p>
      </div></DialogContent></Dialog>;
}

function SiteHeader({tab, setTab, menu, setMenu}: {tab: Page; setTab: (p: Page) => void; menu: boolean; setMenu: (v: boolean) => void}) {
  const session = useTeamSession(), signedIn = !!session?.userId;
  return <header className="site-header2 app-header"><div className="site-header-inner">
    <Brand onClick={() => setTab('home')} />
    <nav className={'site-nav' + (menu ? ' open' : '')} aria-label="주요 메뉴">
      {pages.filter(p => !p.hidden).map(p => <button key={p.id} className={'nav-link' + (tab === p.id ? ' active' : '')} aria-current={tab === p.id ? 'page' : undefined} onClick={() => setTab(p.id)}>{p.label}</button>)}
      <div className="nav-mobile-foot">{session && <button onClick={() => void session.signOut()}><LogOut size={15} />로그아웃</button>}</div>
    </nav>
    <div className="site-utils"><BigTextToggle /><ProjectGuide />
      {session && <button className="nav-util app-logout" onClick={() => void session.signOut()} title="로그아웃"><LogOut size={16} /><span>로그아웃</span></button>}
      <button className="menu-toggle" aria-label={menu ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
  </div></header>;
}

/** 화면 제목: 큰 제목(왼쪽) + 짧은 설명 + 오른쪽 주요 버튼 */
function PageHead({title, desc, action}: {title: ReactNode; desc?: ReactNode; action?: ReactNode}) {
  return <div className="app-head"><div className="app-head-inner">
    <h1 className="app-title">{title}</h1>
    {desc && <p className="app-desc">{desc}</p>}
    {action && <div className="app-head-action">{action}</div>}
  </div></div>;
}


function SiteFooter({setTab}: {setTab: (p: Page) => void}) {
  const signedIn = !!useTeamSession()?.userId;
  return <footer className="site-footer"><div className="site-footer-inner">
    <div className="footer-brand"><div><img src="/assets/appletrack-logo.svg" alt="애플트랙" width={170} height={42} style={{display:'block', width:'clamp(132px, 16vw, 170px)', height:'auto'}} /><p>수확일만 넣으면 저장 중 사과 품질 변화를 보여줘요. 직접 잰 값과 계산값을 구분해 표시하며, 출하·안전 판정은 하지 않아요.</p></div></div>
    <nav aria-label="하단 메뉴">{pages.filter(p => !p.hidden).map(p => <button key={p.id} onClick={() => setTab(p.id)}>{p.label}</button>)}</nav>
  </div><div className="site-footer-bottom"><ShieldCheck size={14} />사과 품질 예측·저장 관리 · FarmBridge</div><div className="site-footer-legal"><a href="/privacy"><b>개인정보처리방침</b></a><a href="/terms">이용약관</a><a href="mailto:mooncw@jbnu.ac.kr">문의</a></div></footer>;
}
