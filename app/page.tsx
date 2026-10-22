'use client';
import {useCallback, useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {Apple, ArrowRight, BookOpen, ChevronRight, ClipboardList, FlaskConical, Home as HomeIcon, Info, LineChart, LogOut, Menu, ShieldCheck, UserRound, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {requestJson} from '@/components/lot-forms';
import {KindBadge} from '@/components/tracker-parts';
import type {TrackerRequest} from '@/components/quality-tracker';
import type {Lot} from '@/lib/lot-types';
import {computeSeries, fmtNum, valueAt} from '@/lib/tracker';

const QualityTracker = dynamic(() => import('@/components/quality-tracker'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});
const LotsPage = dynamic(() => import('@/components/lots-page'), {ssr: false, loading: () => <div className="loading-strip">물량을 불러오는 중…</div>});
const ModelInfo = dynamic(() => import('@/components/model-info'), {ssr: false, loading: () => <div className="loading-strip">모델 정보를 불러오는 중…</div>});
const Account = dynamic(() => import('@/components/account'), {ssr: false});

type Page = 'home' | 'track' | 'lots' | 'model' | 'account';
const pages: {id: Page; label: string; icon: typeof Apple; kicker: string; title: string; desc: string; hidden?: boolean}[] = [
  {id: 'home', label: '홈', icon: HomeIcon, kicker: '', title: '', desc: ''},
  {id: 'track', label: '품질 변화', icon: LineChart, kicker: '① 초기 품질 입력 → ② 저장 조건 선택 → ③ 변화 확인', title: '품질 변화 확인', desc: '초기 품질을 입력하고, 저장 기간에 따른 변화를 계산해 실제 측정값과 비교하세요.'},
  {id: 'lots', label: '물량 관리', icon: ClipboardList, kicker: 'STORAGE LOTS', title: '물량 관리', desc: '물량별 초기·후속 측정 기록, 온습도 이력, 사진을 한곳에서 확인합니다.'},
  {id: 'model', label: '모델 정보', icon: BookOpen, kicker: 'MODEL INFO', title: '모델 정보', desc: '계산에 쓰는 수식과 출처, 적용 조건, 검증 상태를 확인합니다. 기상 기반 회귀식도 여기에서 볼 수 있어요.'},
  {id: 'account', label: '내 정보', icon: UserRound, kicker: 'MY ACCOUNT', title: '내 정보', desc: '이름·소속·주 산지를 관리합니다.', hidden: true},
];
// 예전 주소(#predict 등)로 들어와도 새 화면으로 연결합니다.
const legacy: Record<string, Page> = {predict: 'model', overview: 'lots', environment: 'lots', photos: 'lots', simulator: 'track'};

export default function Home() {
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
      {tab === 'home' && <HomePage lots={lots} openTracker={openTracker} setTab={setTab} />}
      {tab !== 'home' && <div className="page-hero"><div className="page-hero-inner"><span className="page-kicker">{current.kicker}</span><h1>{current.title}</h1><p>{current.desc}</p></div></div>}
      <div className="page-body">
        {tab === 'track' && <QualityTracker lots={lots} onLotsChanged={reload} request={trackReq} openModelInfo={() => setTab('model')} openLot={id => { setLotFocus(id); setTab('lots'); }} />}
        {tab === 'lots' && (lotsLoaded ? <LotsPage lots={lots} loadError={lotsError} reload={reload} openTracker={openTracker} focusId={lotFocus} /> : <div className="loading-strip">물량을 불러오는 중…</div>)}
        {tab === 'model' && <ModelInfo />}
        {tab === 'account' && <Account onOpenPredict={() => { setTab('model'); }} />}
      </div>
    </main>
    <SiteFooter setTab={setTab} />
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
      {session && <div className="user-chip"><button className={'user-btn' + (tab === 'account' ? ' active' : '')} onClick={() => setTab('account')} title="내 정보"><span className="user-avatar">{session.displayName.slice(0, 1).toUpperCase()}</span><span className="user-email">{session.displayName}</span></button>
        <button className="nav-util" onClick={() => void session.signOut()} title="로그아웃"><LogOut size={16} /><span>로그아웃</span></button></div>}
      <button className="menu-toggle" aria-label={menu ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
  </div></header>;
}

function HomePage({lots, openTracker, setTab}: {lots: Lot[]; openTracker: (m: 'real' | 'example', lotId?: string) => void; setTab: (p: Page) => void}) {
  const session = useTeamSession();
  // 홈 예시 카드: 예시 초기 경도 72.0 N에서 저온저장 식으로 120일차를 계산(시연용)
  const ex = useMemo(() => { const s = computeSeries({metric: 'firmness', anchor: {day: 0, date: '', value: 72, kind: '예시', source: 'initial'}, recorded: 'cold', future: 'cold', asOfDay: 0}); const v = valueAt(s, 120); return v.status === 'ok' ? v.value : null; }, []);
  const obsCount = lots.reduce((n, l) => n + (l.observation_count ?? 0), 0), envLots = lots.filter(l => l.environment_count).length;
  return <>
    <section className="home-hero">
      <div className="home-hero-text">
        <span className="page-kicker">{session ? `${session.displayName}님 · ` : ''}사과 품질 예측·저장 관리</span>
        <h1>초기 품질부터<br />저장 중 변화까지</h1>
        <p>초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => openTracker('real', 'new')}>실측값 입력<ArrowRight size={18} /></button>
          <button className="btn btn-outline btn-lg" onClick={() => openTracker('example')}><FlaskConical size={17} />예시로 체험</button>
        </div>
      </div>
      <div className="home-hero-visual" aria-label="예시 계산 카드">
        <div className="hero-card hero-card-main"><span>초기 경도 <KindBadge kind="예시" /></span><strong>72.0<small>N</small></strong><i className="hero-bar"><b style={{width: '100%'}} /></i><em>저장 시작일 = 0일차</em></div>
        <div className="hero-card hero-card-b"><span>저온저장 120일차 <KindBadge kind="모델 계산" verified={false} /></span><strong>{ex !== null ? `${fmtNum(ex, 1)} N` : '—'}</strong><em className="hero-sub">시연용 계산 · 오차 범위 미검증</em></div>
        <div className="hero-apple"><Apple size={120} strokeWidth={1.2} /></div>
      </div>
    </section>
    <section className="home-stats">
      <div><strong>{lots.length}</strong><span>내가 볼 수 있는 물량<small>{lots.length ? '물량 관리에서 확인' : '아직 등록 전'}</small></span></div>
      <div><strong>{obsCount}</strong><span>후속 측정 기록<small>초기 측정 제외</small></span></div>
      <div><strong>{envLots}</strong><span>온습도 이력 연결 물량<small>표시용 · 계산 미반영</small></span></div>
      <div><strong>4</strong><span>확인하는 지표<small>경도 · 당도 · 산도 · 감모율</small></span></div>
    </section>
    <section className="home-section"><div className="home-section-head"><h2>무엇을 할 수 있나요</h2><p>필요한 화면으로 바로 이동하세요.</p></div>
      <div className="feature-grid">
        <button className="feature-card primary" onClick={() => openTracker('real', 'new')}><span className="feature-icon"><LineChart size={22} /></span><span className="feature-tag">핵심</span><h3>품질 변화 확인</h3><p>초기 경도·당도·산도를 넣고 저장 시작일부터 날짜별 변화를 봅니다. 실제 측정값을 같은 그래프에 점으로 겹쳐 비교하고, 조건을 바꿔 체험용으로 비교할 수 있어요.</p><span className="feature-link">실측값 입력<ChevronRight size={16} /></span></button>
        <button className="feature-card" onClick={() => setTab('lots')}><span className="feature-icon"><ClipboardList size={22} /></span><span className="feature-tag">기록</span><h3>물량 관리</h3><p>물량별 초기·후속 측정, 온습도 이력(CSV), 사진을 한곳에서 관리합니다.</p><span className="feature-link">바로가기<ChevronRight size={16} /></span></button>
        <button className="feature-card" onClick={() => setTab('model')}><span className="feature-icon"><BookOpen size={22} /></span><span className="feature-tag">근거</span><h3>모델 정보</h3><p>계산식·출처·적용 조건·검증 상태와 기상 기반 회귀식의 상세 정보를 확인합니다.</p><span className="feature-link">바로가기<ChevronRight size={16} /></span></button>
        <button className="feature-card" onClick={() => openTracker('example')}><span className="feature-icon"><FlaskConical size={22} /></span><span className="feature-tag">체험</span><h3>예시로 체험</h3><p>예시값으로 같은 흐름을 둘러봅니다. 예시값은 실제 측정 기록이 아니며 저장되지 않아요.</p><span className="feature-link">시작하기<ChevronRight size={16} /></span></button>
      </div>
    </section>
    <section className="home-section"><div className="home-section-head"><h2>이렇게 이어집니다</h2><p>입력 → 조건 → 변화 확인 → 측정값과 비교</p></div>
      <ol className="flow">{[['초기 품질 입력', '측정일·표본 수와 경도(N)·당도·산도'], ['저장 조건 선택', '저장 시작일, 저장 환경, 1-MCP 처리 이력'], ['변화 확인', '날짜·경과일별 계산값과 한 문장 요약'], ['측정값과 비교', '후속 측정을 같은 날짜 계산값과 비교']].map(([t, d], i) => <li key={t}><span>{i + 1}</span><strong>{t}</strong><p>{d}</p></li>)}</ol>
    </section>
  </>;
}

function SiteFooter({setTab}: {setTab: (p: Page) => void}) {
  return <footer className="site-footer"><div className="site-footer-inner">
    <div className="footer-brand"><span className="brand-mark2"><Apple size={18} /></span><div><strong>애플트랙 <span className="by">by FarmBridge</span></strong><p>초기 품질부터 저장 중 변화까지. 실측·모델 계산·예시·미측정을 구분해 표시하며, 계산값은 출하·안전 판정을 대신하지 않습니다.</p></div></div>
    <nav aria-label="하단 메뉴">{pages.map(p => <button key={p.id} onClick={() => setTab(p.id)}>{p.label}</button>)}</nav>
  </div><div className="site-footer-bottom"><ShieldCheck size={14} />사과 품질 예측·저장 관리 · FarmBridge</div></footer>;
}
