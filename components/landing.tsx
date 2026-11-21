'use client';
import BigTextToggle from '@/components/big-text-toggle';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import {ArrowRight, ClipboardList, Gauge, LineChart, Loader2, MailCheck} from 'lucide-react';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {ID_RULE, isEmailLogin, normalizeId, toAuthEmail, validId} from '@/lib/login-id';
import {regions, type RegionId} from '@/lib/initial-quality';
import {addDays, computeSeries, describeChange, fmtDate, fmtNum, todayKST, valueAt, type MetricId} from '@/lib/tracker';
import {HANDOFF_KEY} from '@/lib/tracker-form';
import {PROFILE_REGIONS} from '@/lib/profile-regions';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';
import '@/components/health/health.css';

type Mode = 'signup' | 'login' | 'reset' | 'recovery';

// 사과가 갈라지며 데이터가 되는 스크롤 장면 (3D). 불러오는 동안은 같은 소개 문구만 보여 줍니다.
const AppleSplitStory = dynamic(() => import('@/components/apple-split-story'), {ssr: false, loading: () => <div className="as-loading" />});
const webglOK = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };

/** 움직임 줄이기를 켠 사용자에게는 애니메이션 없이 바로 보여 줍니다. */
const motionOK = () => typeof window !== 'undefined' && !!window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 화면에 들어오면 한 번만 true가 됩니다. */
function useInView<T extends Element>(enabled: boolean) {
  const ref = useRef<T>(null), [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    if (seen || !ref.current) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, {threshold: 0.25});
    io.observe(ref.current); return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}


/** 로그인 전 첫 화면. 체험은 /try 에서 로그인 없이 바로 시작합니다. */
export default function Landing({recovery = false, onRecovered}: {recovery?: boolean; onRecovered?: () => void}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'login');
  const [handoff, setHandoff] = useState(false);
  const [motion] = useState(motionOK);
  // 움직임 줄이기 설정이거나 3D를 쓸 수 없으면 기존 첫 화면(정지 화면)을 보여 줍니다.
  const [story, setStory] = useState(() => motionOK() && webglOK());
  const storyFail = useCallback(() => setStory(false), []);
  const rootRef = useRef<HTMLDivElement>(null);
  // 스크롤해서 화면에 들어온 요소(data-reveal)를 차례로 떠오르게 합니다.
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!motion || !('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), {threshold: 0.15, rootMargin: '0px 0px -8% 0px'});
    items.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [motion]);
  useEffect(() => {
    if (recovery) { setMode('recovery'); goJoin(); return; }
    // 체험 화면의 ‘로그인’·‘로그인하고 저장하기’로 들어온 경우 가입·로그인 영역을 바로 보여 줍니다.
    const q = new URLSearchParams(window.location.search).get('auth');
    if (q === 'login' || q === 'signup') setMode(q);
    try { setHandoff(!!sessionStorage.getItem(HANDOFF_KEY)); } catch { /* 무시 */ }
    if (window.location.hash === '#join') requestAnimationFrame(() => goJoin());
  }, [recovery]);
  function goJoin(m?: Mode) { if (m) setMode(m); document.getElementById('join')?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }

  // 넓은 화면·마우스 사용이면 실제 3D 사과를 천천히 돌리고, 마우스를 따라 무대가 살짝 기웁니다(움직임 줄이기 설정이면 끔).
  const [wide3d, setWide3d] = useState(false);
  useEffect(() => { const q = window.matchMedia('(min-width: 861px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'); const f = () => setWide3d(q.matches); f(); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, []);
  const tilt = (e: React.PointerEvent<HTMLDivElement>) => { if (!wide3d) return; const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; e.currentTarget.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`); e.currentTarget.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`); };
  const untilt = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.style.setProperty('--rx', '0deg'); e.currentTarget.style.setProperty('--ry', '0deg'); };
  const cards: [MetricId, string][] = [['firmness', '저장 일수별 단단함'], ['brix', '단맛 변화'], ['acidity', '신맛 변화'], ['loss', '무게가 줄어든 정도']];
  return <div ref={rootRef} className="lh">
    <header className="lh-top lh-up"><img src="/assets/appletrack-logo.svg" alt="애플트랙" width={152} height={34} /><a href="/try">로그인 없이 체험하기</a><BigTextToggle /></header>
    <div className="lh-wrap">
      <section aria-labelledby="lh-title">
        <p className="lh-kicker lh-up lh-d1">사과 저장 품질 기록</p>
        <h1 id="lh-title" className="lh-up lh-d2">저장고 속 사과,<br />오늘은 어떨까요?</h1>
        <p className="lh-lead lh-up lh-d3">{handoff ? '로그인하면 체험 화면에서 입력하던 내용으로 돌아가 이어서 저장할 수 있어요.' : '수확 때 잰 값과 저장 온도로 경도·당도·산도 변화를 계산해 보여 드려요.'}</p>
        <div id="join" className="lh-up lh-d4"><AuthCard mode={mode} setMode={setMode} onRecovered={onRecovered} /></div>
      </section>
      <div className="lh-stage" aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
        <div className="lh-ring" />
        <div className="lh-apple lh-up lh-d2">{wide3d ? <HeroApple3D /> : <img src="/assets/apple-still.webp" alt="" />}</div>
        {cards.map(([m, t], i) => <div key={m} className={`lh-card lh-c${i} lh-up lh-d${i + 2}`}><div className={motion ? 'lh-float' : ''}><span className="hs-lab" style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}</span><p>{t}</p></div></div>)}
      </div>
    </div>
    <footer className="lh-foot"><span>© 애플트랙 by FarmBridge</span><span>계산값은 시연용이며 출하·안전 판정을 대신하지 않습니다.</span><a href="/privacy"><b>개인정보처리방침</b></a><a href="/terms">이용약관</a><a href="mailto:mooncw@jbnu.ac.kr">문의</a></footer>
  </div>;
}

// 첫 화면 이미지 경로는 이곳에서 변경합니다.
const HERO = { image: '/assets/photos/hero-orchard.svg', position: 'center center' };

function Hero({onJoin, animate}: {onJoin: (mode: Mode) => void; animate: boolean}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const guide = () => {
    setOpen(false);
    document.getElementById('service-guide')?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  };
  return <>
    <header className="shot-header">
      <div className="shot-header-inner">
        <a className="shot-logo" href="/" aria-label="애플트랙 첫 화면"><img src="/assets/appletrack-logo.svg" alt="" width={170} height={42} style={{display:'block', width:'clamp(132px, 16vw, 170px)', height:'auto'}} /></a>
        <BigTextToggle className="shot-bigtext" />
        <button ref={toggle} className="shot-menu-toggle" type="button" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="shot-nav" onClick={() => setOpen(!open)}><span /><span /><span /></button>
        <nav id="shot-nav" className={'shot-nav' + (open ? ' is-open' : '')} aria-label="주요 메뉴">
          <button type="button" onClick={guide}>이용 가이드</button>
          <a href="/try">예시 체험</a>
          <button type="button" onClick={() => { setOpen(false); onJoin('login'); }}>로그인</button>
          <button type="button" className="shot-signup" onClick={() => { setOpen(false); onJoin('signup'); }}>가입하기</button>
        </nav>
      </div>
    </header>
    <section className="shot-hero" aria-labelledby="shot-title">
      <div className="shot-copy">
        <p className="shot-kicker">사과 품질 예측·저장 관리</p>
        <h1 id="shot-title">초기 품질부터<br />저장 중 변화까지</h1>
        <p className="shot-lead">초기 품질을 입력하고, 저장 기간에 따른 변화를<br className="shot-desktop-break" /> 예측해 실제 측정값과 비교하세요.</p>
        <div className="shot-actions">
          <a className="shot-action shot-primary" href="/try">예시로 체험하기 <ArrowRight size={18} aria-hidden="true" /></a>
          <a className="shot-action shot-secondary" href="/try?mode=real">내 측정값 입력하기</a>
        </div>
        <p className="shot-note">가입하지 않아도 바로 볼 수 있어요.<br />기록으로 저장할 때만 로그인합니다.</p>
      </div>
      <div className="shot-visual">
        <img className="shot-photo" src={HERO.image} alt="" style={{objectPosition: HERO.position}} />
        <div className="shot-card"><ServicePreview animate={animate} /></div>
      </div>
    </section>
    <style jsx>{`
      :global(.as-intro-copy h2) {font-size:clamp(34px,4.2vw,54px); line-height:1.22; font-weight:700; letter-spacing:-1.4px; color:var(--ds-text); margin:0}
      .shot-header {background:#fff}
      .shot-header-inner {max-width:1440px; margin:0 auto; padding:26px 40px; min-height:98px; display:flex; align-items:center; justify-content:space-between; gap:24px; border-bottom:1px solid #e8eeea}
      .shot-logo {display:inline-flex; align-items:center; gap:12px; color:#18241e; text-decoration:none; font-size:22px; font-weight:800; line-height:1.1; white-space:nowrap}
      .shot-logo-mark {width:52px; height:52px; display:grid; place-items:center; border-radius:15px; background:#bc423a; color:white}
      .shot-logo small {display:block; margin-top:4px; font-size:13px; font-weight:500; color:#71847b; letter-spacing:.01em}
      .shot-nav {display:flex; align-items:center; gap:14px}
      .shot-nav a,.shot-nav button {font:inherit; font-size:16px; font-weight:600; color:#20372d; text-decoration:none; background:transparent; border:0; border-radius:9px; padding:12px 14px; min-height:46px; white-space:nowrap; cursor:pointer}
      .shot-nav a:hover,.shot-nav button:hover {background:#eef4ef}
      .shot-nav .shot-signup {background:#225c41; color:#fff; padding:12px 22px}
      .shot-nav .shot-signup:hover {background:#184a33}
      .shot-menu-toggle {display:none}
      .shot-hero {max-width:1440px; margin:0 auto; padding:72px 40px 100px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:clamp(44px,7vw,110px); align-items:center; min-height:650px}
      .shot-copy {min-width:0; word-break:keep-all}
      .shot-kicker {font-size:16px; color:#2d6b47; font-weight:700; margin:0 0 30px}
      .shot-kicker:before {content:''; display:inline-block; width:9px; height:9px; border-radius:50%; background:#4e865c; vertical-align:middle; margin-right:10px}
      .shot-copy h1 {margin:0; font-size:clamp(42px,4.7vw,70px); line-height:1.24; font-weight:900; letter-spacing:-.055em; color:#18241e}
      .shot-lead {color:#65796e; font-size:18px; line-height:1.85; margin:30px 0 0}
      .shot-actions {display:flex; flex-wrap:wrap; gap:12px; margin-top:34px}
      .shot-action {min-height:56px; padding:0 23px; border-radius:9px; display:inline-flex; gap:18px; align-items:center; justify-content:center; text-decoration:none; font-size:16px; font-weight:700}
      .shot-primary {background:#225c41; color:white}.shot-primary:hover {background:#184a33}
      .shot-secondary {background:#eaf3ed; color:#225c41}.shot-secondary:hover {background:#dcebe1}
      .shot-note {color:#87978e; font-size:14px; line-height:1.8; margin:24px 0 0}
      .shot-visual {position:relative; min-width:0; padding:0 0 74px 36px}
      .shot-photo {display:block; width:100%; aspect-ratio:1.03; object-fit:cover; border-radius:20px; background:#e8eee9}
      .shot-card {position:absolute; width:min(83%,440px); bottom:0; left:0; filter:drop-shadow(0 16px 28px rgba(25,59,42,.12))}
      .shot-card :global(.lv-preview) {background:#fff; border:1px solid #e8eeea; border-radius:18px; box-shadow:none; padding:20px; gap:10px}
      .shot-card :global(.lv-preview-values > div) {background:#f6f9f6}
      .shot-header :global(:focus-visible),.shot-hero :global(:focus-visible) {outline:3px solid #3264ff; outline-offset:3px}
      @media(max-width:950px) {
        .shot-hero {gap:35px; padding:50px 26px 80px; min-height:0}
        .shot-header-inner {padding:20px 26px}
        .shot-copy h1 {font-size:clamp(36px,5.4vw,55px)}
        .shot-card {width:88%}
      }
      @media(max-width:700px) {
        .shot-header-inner {padding:16px 20px; min-height:76px; position:relative; flex-wrap:wrap}
        .shot-logo {font-size:19px}.shot-logo-mark {width:44px; height:44px; border-radius:12px}.shot-logo small {font-size:11px}
        .shot-menu-toggle {display:flex; flex-direction:column; justify-content:center; gap:5px; width:44px; height:44px; padding:9px; background:transparent; border:0; cursor:pointer}
        .shot-menu-toggle span {display:block; width:100%; height:2px; background:#1e392b}
        .shot-nav {display:none; width:100%; flex-direction:column; align-items:stretch; gap:2px; padding-bottom:5px}
        .shot-nav.is-open {display:flex}
        .shot-nav a,.shot-nav button {text-align:left; padding:11px 12px; width:100%}
        .shot-nav .shot-signup {text-align:center}
        .shot-hero {display:flex; flex-direction:column; align-items:stretch; gap:38px; padding:52px 20px 65px}
        .shot-kicker {margin-bottom:20px; font-size:14px}
        .shot-copy h1 {font-size:clamp(35px,9vw,49px); letter-spacing:-.05em}
        .shot-lead {font-size:16px; margin-top:22px; line-height:1.75}
        .shot-desktop-break {display:none}
        .shot-actions {margin-top:25px; gap:10px}
        .shot-action {min-height:52px; font-size:15px; padding:0 17px}
        .shot-note {margin-top:20px; font-size:13px}
        .shot-visual {padding:0 0 0 14px}
        .shot-photo {aspect-ratio:1.08; border-radius:16px}
        .shot-card {position:relative; left:auto; bottom:auto; width:min(90%,390px); margin:-90px 0 0 -14px}
        .shot-card :global(.lv-preview) {padding:14px; gap:7px}
      }
      @media(max-width:380px) {.shot-actions {flex-direction:column}.shot-action {width:100%}}
      @media(prefers-reduced-motion:reduce) {.shot-header *, .shot-hero * {transition:none!important; animation:none!important}}
    `}</style>
  </>;
}

/** 첫 화면의 서비스 미리보기: 실제 계산 엔진으로 만든 예시 결과. 예시·시연용임을 함께 표시합니다. */
export function ServicePreview({animate}: {animate: boolean}) {
  const [ref, play] = useInView<HTMLElement>(animate);
  const data = useMemo(() => {
    const today = todayKST(), start = addDays(today, -28), asOfDay = 28, day = 60;
    const init: Record<Exclude<MetricId, 'loss'>, number> = {firmness: 72, brix: 14.2, acidity: 0.38};
    const series = (m: Exclude<MetricId, 'loss'>) => computeSeries({variety: '후지', metric: m, anchor: {day: 0, date: start, value: init[m], kind: '예시', source: 'initial'}, recorded: 'cold', future: 'cold', asOfDay});
    const f = series('firmness'), b = series('brix'), a = series('acidity');
    const fv = valueAt(f, day), ch = fv.status === 'ok' ? describeChange('firmness', fv.value, init.firmness) : null;
    const sentence = ch ? (ch.diff === 0 ? '경도 계산값은 초기값과 같습니다.' : `경도 계산값은 초기값보다 ${ch.text}.`) : '이 날짜의 경도 계산값이 없습니다.';
    return {start, asOfDay, day, f, values: {firmness: valueAt(f, day), brix: valueAt(b, day), acidity: valueAt(a, day)}, sentence};
  }, []);
  const W = 420, H = 150, L = 22, R = 24, T = 10, B = 24;
  const pts = data.f.ok ? data.f.points : [];
  const vals = pts.map(p => p.value), lo = Math.min(...vals) - 0.3, hi = Math.max(...vals) + 0.3;
  const x = (d: number) => L + d / 300 * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = (seg: 'past' | 'future') => { const ff = pts.findIndex(p => p.segment === 'future'); const list = seg === 'past' ? pts.filter(p => p.segment === 'past') : pts.slice(Math.max(0, ff - 1)); return list.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(''); };
  const units = {firmness: 'N', brix: '°Brix', acidity: '%'} as const, digits = {firmness: 1, brix: 1, acidity: 3} as const, labels = {firmness: '경도', brix: '당도', acidity: '산도'} as const;
  return <aside ref={ref} className={'lv-preview' + (animate ? ' lv-anim' : '') + (play ? ' is-play' : '')} aria-label="서비스 미리보기 (예시 데이터)">
    <div className="lv-preview-head"><span className="kind k-example">예시 데이터</span><span>후지 · 저온저장 · 저장 시작 {fmtDate(data.start)}</span></div>
    <p className="lv-preview-day">저장 {data.day}일차 · {fmtDate(addDays(data.start, data.day))}</p>
    <dl className="lv-preview-values">{(['firmness', 'brix', 'acidity'] as const).map(m => { const v = data.values[m]; return <div key={m}><dt>{labels[m]}</dt><dd>{v.status === 'ok' ? fmtNum(v.value, digits[m]) : '—'}<small>{units[m]}</small></dd></div>; })}</dl>
    <p className="lv-preview-sentence">{data.sentence}</p>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="예시 경도 변화 그래프. 실선은 분석 기준일까지, 점선은 이후 가정 구간">
      {[0, 100, 200, 300].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="#eef0f2" /><text x={x(t)} y={H - 6} textAnchor="middle" fontSize="12" fill="#6b7684">{t}일</text></g>)}
      <line x1={x(data.asOfDay)} x2={x(data.asOfDay)} y1={T} y2={H - B} stroke="#4e5968" strokeDasharray="3 3" />
 <defs><clipPath id="lv-draw"><rect className="lv-draw-rect" x={L - 4} y={0} width={W - L - R + 8} height={H} /></clipPath></defs>
      <g clipPath="url(#lv-draw)">
        <path d={path('past')} fill="none" stroke="#1d5c3c" strokeWidth="2.6" />
        <path d={path('future')} fill="none" stroke="#1d5c3c" strokeWidth="2.4" strokeDasharray="7 5" />
      </g>
      <circle className="lv-dot" cx={x(data.day)} cy={data.values.firmness.status === 'ok' ? y(data.values.firmness.value) : 0} r="5" fill="#fff" stroke="#1d5c3c" strokeWidth="2.4" />
    </svg>
    <p className="lv-preview-foot"><span className="kind k-model">시연용 계산</span>검증 미확인 · 오차 범위 미검증 · 출하·안전 판정이 아닙니다</p>
  </aside>;
}

function AuthCard({mode, setMode, onRecovered}: {mode: Mode; setMode: (m: Mode) => void; onRecovered?: () => void}) {
  const [form, setForm] = useState({name: '', affiliation: '', region: '' as import('@/lib/profile-regions').ProfileRegion | '', email: '', password: '', confirm: '', agree: false});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  // 카카오는 아이디 로그인과 따로 돕니다. 카카오 오류 화면에서 ‘뒤로’로 돌아오면(페이지 복원) 도는 표시를 풉니다.
  const [kakaoBusy, setKakaoBusy] = useState(false);
  useEffect(() => {
    const reset = () => setKakaoBusy(false);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) reset(); };
    const onVis = () => { if (document.visibilityState === 'visible') reset(); };
    window.addEventListener('pageshow', onShow); document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pageshow', onShow); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value}));
  const switchTo = (m: Mode) => { setMode(m); setError(''); setDone(''); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setDone('');
    const c = supabaseBrowser(), login = normalizeId(form.email), email = toAuthEmail(login);
    if (mode === 'signup' && !validId(login)) return setError(`아이디는 ${ID_RULE}로 정해 주세요.`);
    if (mode === 'login' && !login) return setError('아이디를 입력해 주세요.');
    if (mode === 'reset' && !isEmailLogin(login)) return setError('아이디로 가입한 계정은 비밀번호 찾기 메일을 보낼 수 없어요. 아래 운영자 메일로 아이디를 알려 주세요.');
    if ((mode === 'signup' || mode === 'recovery') && form.password.length < 8) return setError('비밀번호는 8자 이상으로 정해 주세요.');
    if ((mode === 'signup' || mode === 'recovery') && form.password !== form.confirm) return setError('비밀번호 확인이 일치하지 않습니다.');
    if (mode === 'signup' && !form.name.trim()) return setError('이름을 입력해 주세요.');
    if (mode === 'signup' && !form.agree) return setError('개인정보 수집·이용에 동의해 주세요.');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const r = await c.auth.signUp({email, password: form.password, options: {data: {name: form.name.trim(), affiliation: form.affiliation.trim(), region: form.region}}});
        if (r.error) setError(authMessage(r.error));
        else if (r.data.user && r.data.user.identities?.length === 0) setError('이미 쓰고 있는 아이디예요. 다른 아이디를 정하거나 로그인해 주세요.');
        else if (!r.data.session) setError('가입은 됐지만 바로 로그인되지 않았어요. 운영자에게 문의해 주세요. (Supabase의 이메일 인증이 켜져 있어요)');
      } else if (mode === 'login') {
        const r = await c.auth.signInWithPassword({email, password: form.password});
        if (r.error) setError(authMessage(r.error));
      } else if (mode === 'reset') {
        const r = await c.auth.resetPasswordForEmail(email, {redirectTo: window.location.origin});
        if (r.error) setError(authMessage(r.error)); else setDone(`${email}로 비밀번호 재설정 링크를 보냈어요.`);
      } else {
        const r = await c.auth.updateUser({password: form.password});
        if (r.error) setError(authMessage(r.error)); else { setDone('비밀번호를 바꿨어요.'); onRecovered?.(); }
      }
    } catch { setError('연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }

  // 카카오 로그인: Supabase에 카카오 연결(REST API 키·Client Secret)이 켜져 있어야 동작합니다.
  async function kakao() {
    setError(''); setKakaoBusy(true);
    window.setTimeout(() => setKakaoBusy(false), 8000); // 이동이 안 되면 8초 뒤 다시 누를 수 있게
    try {
      const r = await supabaseBrowser().auth.signInWithOAuth({provider: 'kakao', options: {redirectTo: window.location.origin + '/'}});
      if (r.error) { setError(/provider is not enabled|Unsupported provider/i.test(r.error.message) ? '카카오 로그인이 아직 설정되지 않았어요. 운영자에게 알려 주세요.' : authMessage(r.error)); setKakaoBusy(false); }
    } catch { setError('연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); setKakaoBusy(false); }
  }

  const title = {signup: '회원가입', login: '로그인', reset: '비밀번호 찾기', recovery: '새 비밀번호 설정'}[mode];
  return <div className="auth-card l-auth">
    {(mode === 'signup' || mode === 'login') && <div className="seg l-tabs" role="tablist">
      <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'active' : ''} onClick={() => switchTo('signup')}>회원가입</button>
      <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchTo('login')}>로그인</button>
    </div>}
    {(mode === 'reset' || mode === 'recovery') && <h3>{title}</h3>}
    {done ? <div className="l-done"><MailCheck size={30} /><p>{done}</p>{mode !== 'recovery' && <button className="btn btn-outline" onClick={() => switchTo('login')}>로그인으로</button>}</div> :
    <form onSubmit={submit} noValidate>
      {mode === 'signup' && <>
        <label>이름<input value={form.name} onChange={set('name')} maxLength={50} autoComplete="name" placeholder="홍길동" required /></label>
        <div className="l-two">
          <label><span>소속 <small>선택</small></span><input value={form.affiliation} onChange={set('affiliation')} maxLength={80} placeholder="○○농가, △△연구소" /></label>
          <label><span>주 산지 <small>선택</small></span>
            <select value={form.region} onChange={set('region')}>
              <option value="">선택 안 함</option>
              {PROFILE_REGIONS.map(r => <option key={r.id} value={r.id}>{r.name} ({r.area})</option>)}
            </select>
          </label>
        </div>
      </>}
      {mode === 'reset' ? <><p className="auth-legal" style={{fontSize: 14, margin: 0}}>아이디로 가입한 계정은 운영자 메일(<a href="mailto:mooncw@jbnu.ac.kr">mooncw@jbnu.ac.kr</a>)로 아이디를 알려 주시면 비밀번호를 초기화해 드려요. 예전에 이메일로 가입했다면 아래에 이메일을 넣어 주세요.</p>
        <label>이메일 (예전 계정)<input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="name@example.com" required /></label></>
        : mode !== 'recovery' && <label><span>아이디{mode === 'signup' && <small>{ID_RULE}</small>}</span><input type="text" value={form.email} onChange={set('email')} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={mode === 'signup' ? '예: 거창사과농장' : '아이디 (예전 계정은 이메일)'} maxLength={mode === 'signup' ? 30 : 120} required /></label>}
      {mode !== 'reset' && <label><span>{mode === 'recovery' ? '새 비밀번호' : '비밀번호'}{mode !== 'login' && <small>8자 이상</small>}</span><input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>}
      {(mode === 'signup' || mode === 'recovery') && <label>비밀번호 확인<input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></label>}
      {mode === 'signup' && <label className="l-agree"><input type="checkbox" checked={form.agree} onChange={set('agree')} /><span>서비스 이용을 위한 개인정보(아이디·이름·소속) 수집·이용에 동의합니다.</span></label>}
      {mode === 'signup' && <p className="auth-legal" style={{fontSize: 13, color: 'var(--c-sub)', margin: '4px 0 0'}}>가입하면 <a href="/terms" target="_blank" rel="noreferrer">이용약관</a>과 <a href="/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a>을 확인한 것으로 봐요.</p>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy && <Loader2 className="spin" size={16} />}{busy ? '처리 중…' : mode === 'signup' ? '가입하고 시작하기' : mode === 'login' ? '로그인' : mode === 'reset' ? '재설정 메일 받기' : '비밀번호 바꾸기'}</button>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {(mode === 'login' || mode === 'signup') && <div className="l-kakao">
        <span className="l-or">또는</span>
        <button type="button" className="btn l-kakao-btn" disabled={kakaoBusy || busy} aria-busy={kakaoBusy} onClick={() => void kakao()}>{kakaoBusy && <Loader2 className="spin" size={16} />}<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>카카오로 {mode === 'signup' ? '시작하기' : '로그인'}</button>
        <p className="auth-legal" style={{fontSize: 12, color: 'var(--c-sub)', margin: '6px 0 0'}}>카카오로 시작하면 <a href="/terms" target="_blank" rel="noreferrer">이용약관</a>과 <a href="/privacy" target="_blank" rel="noreferrer">개인정보처리방침</a>을 확인한 것으로 봐요.</p>
      </div>}
      {mode === 'login' && <button type="button" className="l-textlink" onClick={() => switchTo('reset')}>비밀번호를 잊으셨나요?</button>}
      {mode === 'reset' && <button type="button" className="l-textlink" onClick={() => switchTo('login')}>로그인으로 돌아가기</button>}
    </form>}
  </div>;
}

const AppleViewer3D = dynamic(() => import('@/components/quality-apple-viewer'), {ssr: false, loading: () => <img src="/assets/apple-still.webp" alt="" />});
const NO_METRIC = {ok: false, value: null, unit: ''};
function HeroApple3D() {
  return <AppleViewer3D bare autoRotate day={0} cultivar="후지" metrics={{firmness: NO_METRIC, brix: NO_METRIC, acidity: NO_METRIC, loss: {...NO_METRIC, unit: '%'}}} />;
}
