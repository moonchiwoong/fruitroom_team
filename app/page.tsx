'use client';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import BigTextToggle from '@/components/big-text-toggle';
import {Apple, ArrowRight, ArrowUpRight, BookOpen, ClipboardList, Home as HomeIcon, Info, LineChart, LogOut, Menu, MessageCircle, ShieldCheck, UserRound, X} from 'lucide-react';
import {applePhoto} from '@/lib/photos';
import {useTeamSession} from '@/components/team-auth';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {requestJson} from '@/components/lot-forms';
import type {TrackerRequest} from '@/components/quality-tracker';
import type {LotsFocus} from '@/components/lots-page';
import type {ModelInfoContext} from '@/components/model-info';
import {clearDraft, HANDOFF_KEY, loadDraft, saveDraft, type TrackerHandoff} from '@/lib/tracker-form';
import AIAssistant, {type AssistantContext} from '@/components/ai-assistant';
import type {Lot} from '@/lib/lot-types';
import {fmtNum, daysBetween, todayKST} from '@/lib/tracker';
import {quantityUnit, storageStart} from '@/lib/lot-readiness';

const QualityTracker = dynamic(() => import('@/components/quality-tracker'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
const MyApples = dynamic(() => import('@/components/my-apples'), {ssr: false, loading: () => <div className="loading-strip">사과 목록을 불러오는 중…</div>});
const ModelInfo = dynamic(() => import('@/components/model-info'), {ssr: false, loading: () => <div className="loading-strip">모델 정보를 불러오는 중…</div>});
const Account = dynamic(() => import('@/components/account'), {ssr: false});
const ServicePreview = dynamic(() => import('@/components/landing').then(m => m.ServicePreview), {ssr: false});

type Page = 'home' | 'track' | 'lots' | 'model' | 'account';
const pages: {id: Page; label: string; icon: typeof Apple; kicker: string; title: string; desc: string; hidden?: boolean}[] = [
  {id: 'home', label: '홈', icon: HomeIcon, kicker: '', title: '', desc: ''},
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
  useEffect(() => {
    const h = window.location.hash.slice(1); const p = (legacy[h] ?? h) as Page;
    if (pages.some(x => x.id === p)) { if (p === 'track') setTrackerVisited(true); if (p === 'lots') setLotsVisited(true); tabRef.current = p; setTabState(p); }
  }, [openTracker]);
  // 소개·체험 화면에서 ‘실측값 입력’·‘예시로 체험’을 누르고 로그인한 경우
  const sessionUser = session?.userId;
  // 로그인한 농가는 홈 대신 바로 ‘내 사과’ 목록에서 시작합니다(주소에 다른 화면이 지정된 경우는 그대로).
  useEffect(() => { if (sessionUser && tabRef.current === 'home' && !location.hash.slice(1)) setTab('lots'); }, [sessionUser, setTab]);
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
      {tab === 'home' && <HomePage lots={lots} loaded={lotsLoaded} error={lotsError} retry={reload} openTracker={openTracker} setTab={setTab} openLot={id => { setLotFocus(id); setTab('lots'); }} newLot={() => { setLotFocus(null, true); setTab('lots'); }} onAskAI={() => setAIContext({mode:'real',scope:'all'})} />}
      {tab === 'account' && <PageHead title="내 정보" desc="이름·소속·주 산지를 관리합니다." />}
      {tab === 'model' && <PageHead title="계산 근거" />}
      <div className="page-body">
        {trackerVisited && <div hidden={tab !== 'track'}><QualityTracker lots={lots} onLotsChanged={reload} request={trackReq} onAskAI={setAIContext} openModelInfo={context => {setModelContext(context); setTab('model', true);}} openLot={id => { setLotFocus(id); setTab('lots'); }} /></div>}
        {lotsVisited && <div hidden={tab !== 'lots'}>{lotsLoaded ? <MyApples lots={lots} loadError={lotsError} reload={reload} openTracker={openTracker} focus={lotFocus} openModel={() => setTab('model')} /> : <div className="loading-strip">물량을 불러오는 중…</div>}</div>}
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
  return <Dialog><DialogTrigger asChild><button className="nav-util"><Info size={16} /><span>안내</span></button></DialogTrigger>
    <DialogContent className="record-dialog guide-dialog"><DialogHeader><DialogTitle>애플트랙 사용 안내</DialogTitle><DialogDescription>수확일만 넣으면 저장 중 변화까지 — 사과 품질 예측·저장 관리</DialogDescription></DialogHeader>
      <div className="guide-body">
        <h3>이렇게 써요</h3><p>① ‘내 사과’에서 <b>새 사과</b>를 눌러 품종·생산지·수확일·저장고 온도를 넣어요. 처음 품질은 그 해 농업기상 자료로 자동 추정해요. → ② 사과를 누르면 오늘·30·60·90·120일 뒤 단단함·무게·단맛·신맛을 쉬운 말로 보여줘요. → ③ 당도나 단단함을 재면 <b>측정 추가</b>로 넣어요. 그 값에서 다시 이어 계산하고, 예측과 실제의 차이도 보여줘요.</p>
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
      {pages.filter(p => !p.hidden && !(p.id === 'home' && signedIn)).map(p => <button key={p.id} className={'nav-link' + (tab === p.id ? ' active' : '')} aria-current={tab === p.id ? 'page' : undefined} onClick={() => setTab(p.id)}>{p.label}</button>)}
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

const storageDays = (l: Lot) => Math.max(0, daysBetween(storageStart(l), todayKST()));
const shortDate = (d: string) => { const [, m, day] = d.split('-').map(Number); return `${m}월 ${day}일`; };

function HomePage({lots, loaded, error, retry, openTracker, setTab, onAskAI, openLot, newLot}: {lots: Lot[]; loaded: boolean; error: string; retry: () => void; onAskAI: () => void; openTracker: (m: 'real' | 'example', lotId?: string) => void; setTab: (p: Page) => void; openLot: (id: string) => void; newLot: () => void}) {
  const session = useTeamSession();
  return <div className="app-home">
    <section className="ah-hero">
      <div className="ah-hero-copy">
        <h1 className="app-title">저장한 사과,<br />변화를 살피세요.</h1>
        <p className="app-lead">측정한 값을 기록하고, 저장 중 품질 변화를 확인하세요.</p>
        <div className="ah-actions">
          <button className="btn btn-primary btn-lg" onClick={newLot}>새 물량 등록하기<ArrowUpRight size={18} /></button>
          <button className="ah-textlink" onClick={() => openTracker('example')}>처음이라면 예시로 체험하기<ArrowRight size={17} /></button>
        </div>
      </div>
      <div className="ah-hero-preview"><ServicePreview animate={false} /></div>
    </section>

    <section className="ah-section" aria-labelledby="ah-my">
      <div className="ah-section-head"><div><p className="ah-eyebrow">MY APPLES</p><h2 id="ah-my" className="app-subtitle">내 저장 사과</h2></div>
        {lots.length > 0 && <button className="ah-textlink" onClick={() => setTab('lots')}>전체 보기<ArrowUpRight size={16} /></button>}</div>
      {!loaded ? <div className="loading-strip" role="status">내 사과를 불러오는 중입니다.</div>
        : error ? <div className="error-box" role="alert">{error}<button onClick={retry}>다시 불러오기</button></div>
        : lots.length ? <ul className="ah-lots">{[...lots].sort((a, b) => storageStart(b).localeCompare(storageStart(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 4).map(l => { const o = l.latest_observation; const brix = o?.brix ?? null; const shared = !!l.owner_id && !!session?.userId && l.owner_id !== session.userId;
          return <li key={l.id} className="ah-lot">
            <img className="ah-lot-photo" src={applePhoto(l.id)} alt="" loading="lazy" />
            <div className="ah-lot-name"><button type="button" className="ah-lot-link" onClick={() => openLot(l.id)}><b>{l.name}{!l.name.includes(l.variety) && <> · {l.variety}</>}</b></button>{shared && <em className="lm-tag">공유받음</em>}<span>{l.location || '저장고 미입력'} · {typeof l.quantity === 'number' ? `${l.quantity.toLocaleString('ko-KR')}${quantityUnit(l)}` : '수량 미입력'} · 저장 {storageDays(l)}일째</span></div>
            <dl className="ah-lot-meta">
              <div><dt>최근 측정</dt><dd>{o ? `${shortDate(o.date)} · ${l.observation_count ?? 1}회` : '아직 기록 없음'}</dd></div>
              <div><dt>당도</dt><dd>{o ? (brix !== null ? `${fmtNum(brix, 1)} °Brix` : <>— <small>이번 기록에서 미측정</small></>) : l.brix !== null ? <>{fmtNum(l.brix, 1)} °Brix <small>초기 측정</small></> : '미측정'}</dd></div>
            </dl>
            <div className="ah-lot-action"><button className="ah-textlink" onClick={() => openTracker('real', l.id)}>품질 변화 보기<ArrowUpRight size={16} /></button>
              <button className="btn btn-outline" onClick={() => openLot(l.id)}>기록 보기</button></div>
          </li>; })}</ul>
        : <div className="ah-empty"><img src={applePhoto('empty')} alt="" /><div><b>아직 등록한 사과가 없어요.</b><p>저장을 시작한 사과를 등록하고, 측정한 값을 기록해 보세요.</p></div>
          <button className="btn btn-primary" onClick={newLot}>새 물량 등록하기</button></div>}
    </section>

    <section className="ah-section ah-steps" aria-labelledby="ah-how">
      <h2 id="ah-how" className="app-subtitle">기록에서 변화까지,<br />세 단계면 충분해요.</h2>
      <ol>{[['01', '사과 등록', '저장하는 사과를 등록하세요.'], ['02', '측정값 기록', '주기적으로 측정한 값을 기록하세요.'], ['03', '품질 변화 확인', '저장 중인 사과의 품질 변화를 한눈에 확인하세요.']].map(([n, t, d]) =>
        <li key={n}><span>{n}</span><b>{t}</b><p>{d}</p></li>)}</ol>
    </section>
    <div className="ah-ask"><MessageCircle size={18} /><span>지금 내 사과 상태가 궁금하다면</span><button className="ah-textlink" data-ai-return onClick={onAskAI}>내 사과 상태 보기<ArrowRight size={16} /></button></div>
  </div>;
}

function SiteFooter({setTab}: {setTab: (p: Page) => void}) {
  return <footer className="site-footer"><div className="site-footer-inner">
    <div className="footer-brand"><div><img src="/assets/appletrack-logo.svg" alt="애플트랙" width={170} height={42} style={{display:'block', width:'clamp(132px, 16vw, 170px)', height:'auto'}} /><p>수확일만 넣으면 저장 중 사과 품질 변화를 보여줘요. 직접 잰 값과 계산값을 구분해 표시하며, 출하·안전 판정은 하지 않아요.</p></div></div>
    <nav aria-label="하단 메뉴">{pages.filter(p => !p.hidden).map(p => <button key={p.id} onClick={() => setTab(p.id)}>{p.label}</button>)}</nav>
  </div><div className="site-footer-bottom"><ShieldCheck size={14} />사과 품질 예측·저장 관리 · FarmBridge</div><div className="site-footer-legal"><a href="/privacy"><b>개인정보처리방침</b></a><a href="/terms">이용약관</a><a href="mailto:mooncw@jbnu.ac.kr">문의</a></div></footer>;
}
