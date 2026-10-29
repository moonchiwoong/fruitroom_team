'use client';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import {Apple, ArrowRight, ClipboardList, Gauge, LineChart, Loader2, MailCheck} from 'lucide-react';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {regions, type RegionId} from '@/lib/initial-quality';
import {addDays, computeSeries, describeChange, fmtDate, fmtNum, todayKST, valueAt, type MetricId} from '@/lib/tracker';
import {HANDOFF_KEY} from '@/lib/tracker-form';

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
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'signup');
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

  const d = (i: number) => ({'data-reveal': '', style: {'--d': `${i * 90}ms`} as React.CSSProperties});
  return <div ref={rootRef} className={'landing landing-v2' + (motion ? ' lv-motion' : '')}>
    <Hero onJoin={goJoin} />

    <main>
      <div id="service-intro">
      {story ? <AppleSplitStory onFail={storyFail} intro={<div className="lv-hero-copy as-intro-copy">
          <p className="lv-kicker">사과 품질 예측·저장 관리</p>
          <h2 id="lv-title"><span className="lv-line">초기 품질부터</span><span className="lv-line">저장 중 변화까지</span></h2>
          <p className="lv-lead">초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
          <div className="lv-actions">
            <a className="btn btn-primary btn-lg" href="/try">예시로 체험하기<ArrowRight size={18} /></a>
            <a className="btn btn-soft btn-lg" href="/try?mode=real">내 측정값 입력하기</a>
          </div>
          <p className="lv-note">가입하지 않아도 바로 볼 수 있어요. 기록으로 저장할 때만 로그인합니다.</p>
        </div>} /> :
      <section className="lv-hero" aria-labelledby="lv-title">
        <div className="lv-hero-copy">
          <p className="lv-kicker" {...d(0)}>사과 품질 예측·저장 관리</p>
          <h2 id="lv-title"><span className="lv-line" {...d(1)}>초기 품질부터</span><span className="lv-line" {...d(2)}>저장 중 변화까지</span></h2>
          <p className="lv-lead" {...d(3)}>초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
          <div className="lv-actions" {...d(4)}>
            <a className="btn btn-primary btn-lg" href="/try">예시로 체험하기<ArrowRight size={18} /></a>
            <a className="btn btn-soft btn-lg" href="/try?mode=real">내 측정값 입력하기</a>
          </div>
          <p className="lv-note" {...d(5)}>가입하지 않아도 바로 볼 수 있어요. 기록으로 저장할 때만 로그인합니다.</p>
        </div>
        <div className="lv-preview-wrap" {...d(4)}><ServicePreview animate={motion} /></div>
      </section>}
      </div>

      <section className="lv-section" aria-labelledby="lv-how">
        <h2 id="lv-how" {...d(0)}>세 단계면 충분해요</h2>
        <ol className="lv-steps">
          <li {...d(1)}><span>1</span><div><b>초기 품질 입력</b><p>측정일, 표본 수와 경도(N)·당도(°Brix)·산도(%)를 넣어요. 한 항목만 있어도 됩니다.</p></div></li>
          <li {...d(2)}><span>2</span><div><b>저장 조건 선택</b><p>저장 시작일을 0일로 두고, 저온·1-MCP·CA 등 저장 조건을 고릅니다.</p></div></li>
          <li {...d(3)}><span>3</span><div><b>변화 확인</b><p>날짜를 고르면 변화를 한 문장으로 요약하고, 후속 측정값과 그래프로 비교해요.</p></div></li>
        </ol>
      </section>

      <section className="lv-section lv-split" aria-labelledby="lv-kinds">
        <div {...d(0)}>
          <h2 id="lv-kinds">값이 어디서 왔는지 항상 보여 줍니다</h2>
          <p className="lv-body">측정한 값과 계산한 값, 예시 값을 섞지 않아요. 측정하지 않은 항목은 0으로 바꾸지 않고 ‘미측정’으로 남깁니다.</p>
          <ul className="lv-kinds">
            <li><span className="kind k-measured">실측</span>직접 측정해 기록한 값</li>
            <li><span className="kind k-model">모델 계산</span>수식으로 계산한 값 · 현재는 시연용</li>
            <li><span className="kind k-example">예시</span>체험용 가상 값 · 실제 기록 아님</li>
            <li><span className="kind k-missing">미측정</span>측정하지 않은 항목</li>
          </ul>
        </div>
        <figure className="lv-flow" {...d(1)}>
          <ol>
            <li><span className="lv-flow-icon" aria-hidden="true"><Gauge size={22} strokeWidth={1.75} /></span><b>측정</b><p>경도계·당도계 등으로 표본을 측정해요.</p></li>
            <li><span className="lv-flow-icon" aria-hidden="true"><ClipboardList size={22} strokeWidth={1.75} /></span><b>기록</b><p>측정일·표본 수와 함께 값을 남겨요. 재지 않은 항목은 ‘미측정’으로 둬요.</p></li>
            <li><span className="lv-flow-icon" aria-hidden="true"><LineChart size={22} strokeWidth={1.75} /></span><b>비교</b><p>같은 날짜의 계산값과 나란히 놓고 차이를 확인해요.</p></li>
          </ol>
          <figcaption>서비스 흐름 도식 · 실제 측정 사진이 아닙니다</figcaption>
        </figure>
      </section>

      <section id="join" className="lv-join" aria-labelledby="lv-join-title">
        <div className="lv-join-copy" {...d(0)}>
          <h2 id="lv-join-title">{mode === 'login' ? '다시 오셨네요' : '내 기록을 저장하려면'}</h2>
          <p>{handoff ? '로그인하면 체험 화면에서 입력하던 내용으로 돌아가 이어서 저장할 수 있어요.' : '가입하면 물량별 측정 기록, 온습도 이력, 사진을 내 계정에 저장합니다. 내 기록은 나만 볼 수 있어요.'}</p>
        </div>
        <div className="lv-join-card" {...d(1)}><AuthCard mode={mode} setMode={setMode} onRecovered={onRecovered} /></div>
      </section>
    </main>

    <footer className="l-footer">
      <span>© 애플트랙 by FarmBridge</span>
      <span>계산값은 시연용이며 출하·안전 판정을 대신하지 않습니다.</span>
    </footer>
  </div>;
}

// 첫 화면 문구와 배경을 한곳에서 수정할 수 있습니다. video에 영상 경로를 넣으면 image가 포스터가 됩니다.
const HERO = {
  brand: '애플트랙',
  subtitle: '사과 품질 예측부터 저장 관리까지',
  titleFirst: '사과의 시간을',
  titleLast: '읽다',
  accent: '#3264FF',
  image: '/assets/photos/hero.webp',
  position: 'center center',
  video: '',
};

function Hero({onJoin}: {onJoin: (mode: Mode) => void}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('hero');
  const [allowVideo, setAllowVideo] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAllowVideo(!media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    const update = () => {
      const ids = ['hero', 'service-intro', 'join'];
      const current = ids.reduce((found, id) => {
        const el = document.getElementById(id);
        return el && el.getBoundingClientRect().top <= window.innerHeight * .45 ? id : found;
      }, 'hero');
      setActive(current);
    };
    update(); window.addEventListener('scroll', update, {passive: true});
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  const scrollTo = (id: string) => {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  };
  return <>
    <section id="hero" className="hero-full" aria-labelledby="hero-title" style={{'--hero-accent': HERO.accent, backgroundImage: `linear-gradient(rgba(0,0,0,.48), rgba(0,0,0,.48)), url("${HERO.image}")`, backgroundPosition: HERO.position} as React.CSSProperties}>
      {HERO.video && allowVideo ? <><video className="hero-video" style={{objectPosition: HERO.position}} autoPlay muted loop playsInline poster={HERO.image} aria-hidden="true"><source src={HERO.video} /></video><div className="hero-video-shade" aria-hidden="true" /></> : null}
      <header className="hero-header">
        <a className="hero-logo" href="#hero" onClick={e => {e.preventDefault(); scrollTo('hero');}} aria-label="애플트랙 첫 화면"><Apple size={26} aria-hidden="true" /><span>애플트랙<small>by FarmBridge</small></span></a>
        <div className="hero-menu-wrap">
          <button ref={menuButton} className="hero-menu-toggle" type="button" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="hero-menu" onClick={() => setOpen(!open)}><span /><span /><span /></button>
          <nav id="hero-menu" className="hero-menu" aria-label="계정 메뉴" hidden={!open}>
            <a href="/try">예시 체험</a>
            <button type="button" onClick={() => { setOpen(false); onJoin('login'); }}>로그인</button>
            <button type="button" onClick={() => { setOpen(false); onJoin('signup'); }}>가입하기</button>
          </nav>
        </div>
      </header>
      <div className="hero-copy">
        <p className="hero-brand">{HERO.brand}</p>
        <p className="hero-subtitle">{HERO.subtitle}</p>
        <h1 id="hero-title"><span className="hero-title-line"><span>{HERO.titleFirst}</span>{' '}<span className="hero-title-last">{HERO.titleLast}</span></span></h1>
      </div>
      <button className="hero-scroll" type="button" onClick={() => scrollTo('service-intro')} aria-label="다음 콘텐츠로 이동"><span className="hero-mouse" aria-hidden="true" /><span>SCROLL</span></button>
    </section>
    <nav className="hero-dots" aria-label="페이지 섹션 이동">
      {[['hero', '첫 화면'], ['service-intro', '서비스 소개'], ['join', '가입 및 로그인']].map(([id, label]) => <button type="button" key={id} aria-label={label} aria-current={active === id ? 'location' : undefined} onClick={() => scrollTo(id)}><span /></button>)}
    </nav>
    <style jsx>{`
      :global(.lv-hero h2), :global(.as-intro-copy h2) {font-size:clamp(34px,4.2vw,54px); line-height:1.23; font-weight:700; letter-spacing:-1.2px; color:var(--ds-text); margin:0}
      :global(.lv-hero h2 .lv-line), :global(.as-intro-copy h2 .lv-line) {display:block; color:inherit; background:none; -webkit-text-fill-color:currentColor}
      .hero-full {position:relative; isolation:isolate; width:100%; min-height:100vh; min-height:100svh; display:grid; place-items:center; padding:120px 60px 120px; background-size:cover; background-repeat:no-repeat; background-color:#263b2d; color:#fff; overflow:hidden}
      .hero-video, .hero-video-shade {position:absolute; inset:0; width:100%; height:100%; z-index:-1}
      .hero-video {object-fit:cover; object-position:center}
      .hero-video-shade {background:rgba(0,0,0,.48)}
      .hero-header {position:absolute; top:0; left:0; right:0; display:flex; justify-content:space-between; align-items:center; padding:32px 52px; z-index:3}
      .hero-logo {display:inline-flex; align-items:center; gap:9px; color:#fff; font-size:21px; font-weight:800; line-height:1; text-decoration:none}
      .hero-logo small {display:block; font-size:9px; font-weight:500; letter-spacing:.06em; margin-top:5px}
      .hero-menu-wrap {position:relative}
      .hero-menu-toggle {width:48px; height:48px; border:0; padding:11px 7px; background:transparent; display:flex; flex-direction:column; justify-content:space-between; color:#fff}
      .hero-menu-toggle span {display:block; height:2px; width:100%; background:currentColor}
      .hero-menu {position:absolute; right:0; top:56px; width:190px; background:#fff; color:#17231b; box-shadow:0 12px 35px #0004; padding:8px; border-radius:8px}
      .hero-menu[hidden] {display:none}
      .hero-menu a,.hero-menu button {display:block; width:100%; text-align:left; background:none; border:0; border-radius:5px; padding:13px; color:inherit; font-weight:600; font-size:15px; text-decoration:none}
      .hero-menu a:hover,.hero-menu button:hover {background:#edf2ef}
      .hero-copy {position:relative; z-index:1; width:100%; text-align:center; word-break:keep-all; animation:hero-in .8s ease-out both}
      .hero-brand {font-size:clamp(15px,1.4vw,21px); font-weight:700; margin:0 0 18px; letter-spacing:.05em}
      .hero-subtitle {font-size:clamp(18px,2.3vw,32px); font-weight:500; line-height:1.5; margin:0 0 19px}
      .hero-copy h1 {font-size:clamp(44px,8.5vw,128px); line-height:1.18; letter-spacing:-.065em; font-weight:900; color:#fff; margin:0; word-break:keep-all}
      .hero-title-line {display:inline-block; color:#fff; border-bottom:clamp(7px,1vw,15px) solid var(--hero-accent); padding-bottom:.04em}
      .hero-copy h1 span {color:#fff}
      .hero-scroll {position:absolute; bottom:32px; left:50%; transform:translateX(-50%); background:none; border:0; color:#fff; display:flex; align-items:center; flex-direction:column; gap:9px; font-size:10px; font-weight:700; letter-spacing:.18em; padding:8px; z-index:2}
      .hero-scroll:active {transform:translateX(-50%)}
      .hero-mouse {display:block; width:20px; height:32px; border:1.5px solid #fff; border-radius:12px; position:relative}
      .hero-mouse:after {content:''; position:absolute; top:6px; left:50%; width:2px; height:6px; background:#fff; transform:translateX(-50%); border-radius:2px}
      .hero-dots {position:fixed; z-index:15; left:27px; top:50%; transform:translateY(-50%); display:flex; flex-direction:column; align-items:center; gap:3px; padding:5px; border-radius:30px; background:rgba(0,0,0,.23)}
      .hero-dots button {width:26px; height:26px; border:0; border-radius:50%; padding:0; background:none; display:grid; place-items:center}
      .hero-dots button[aria-current] {background:rgba(255,255,255,.3)}
      .hero-dots button span {width:6px; height:6px; border-radius:50%; background:#fff}
      .hero-full :focus-visible,.hero-dots :focus-visible {outline:2px solid #fff; outline-offset:3px}
      @keyframes hero-in {from {opacity:0; transform:translateY(18px)} to {opacity:1; transform:none}}
      @media (max-width:700px) {
        :global(.lv-hero h2), :global(.as-intro-copy h2) {font-size:32px; letter-spacing:-1px}
        .hero-full {padding:110px 24px 120px}
        .hero-header {padding:20px}
        .hero-logo {font-size:18px}
        .hero-copy h1 {font-size:clamp(38px,10vw,58px); line-height:1.25; letter-spacing:-.06em}
        .hero-title-line {border:0; padding:0}
        .hero-title-line > span {display:block}
        .hero-title-last {display:table!important; margin:0 auto; border-bottom:8px solid var(--hero-accent); padding-bottom:.04em}
        .hero-brand {margin-bottom:14px}
        .hero-subtitle {font-size:16px; margin-bottom:17px}
        .hero-scroll {bottom:22px}
        .hero-dots {left:4px; padding:2px; gap:0}
        .hero-dots button {width:22px; height:22px}
      }
      @media (prefers-reduced-motion:reduce) {.hero-copy {animation:none}}
    `}</style>
  </>;
}

/** 첫 화면의 서비스 미리보기: 실제 계산 엔진으로 만든 예시 결과. 예시·시연용임을 함께 표시합니다. */
function ServicePreview({animate}: {animate: boolean}) {
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
  const [form, setForm] = useState({name: '', affiliation: '', region: '' as RegionId | '', email: '', password: '', confirm: '', agree: false});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value}));
  const switchTo = (m: Mode) => { setMode(m); setError(''); setDone(''); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setDone('');
    const c = supabaseBrowser(), email = form.email.trim();
    if ((mode === 'signup' || mode === 'recovery') && form.password.length < 8) return setError('비밀번호는 8자 이상으로 정해 주세요.');
    if ((mode === 'signup' || mode === 'recovery') && form.password !== form.confirm) return setError('비밀번호 확인이 일치하지 않습니다.');
    if (mode === 'signup' && !form.name.trim()) return setError('이름을 입력해 주세요.');
    if (mode === 'signup' && !form.agree) return setError('개인정보 수집·이용에 동의해 주세요.');
    setBusy(true);
    try {
      if (mode === 'signup') {
        const r = await c.auth.signUp({email, password: form.password, options: {emailRedirectTo: window.location.origin, data: {name: form.name.trim(), affiliation: form.affiliation.trim(), region: form.region}}});
        if (r.error) setError(authMessage(r.error));
        else if (r.data.user && r.data.user.identities?.length === 0) setError('이미 가입된 이메일입니다. 로그인해 주세요.');
        else if (!r.data.session) setDone(`${email}로 인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나고 바로 시작됩니다.`);
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
              {(Object.keys(regions) as RegionId[]).map(r => <option key={r} value={r}>{regions[r].name}</option>)}
            </select>
          </label>
        </div>
      </>}
      {mode !== 'recovery' && <label>이메일<input type="email" value={form.email} onChange={set('email')} autoComplete="email" placeholder="name@example.com" required /></label>}
      {mode !== 'reset' && <label><span>{mode === 'recovery' ? '새 비밀번호' : '비밀번호'}{mode !== 'login' && <small>8자 이상</small>}</span><input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>}
      {(mode === 'signup' || mode === 'recovery') && <label>비밀번호 확인<input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required /></label>}
      {mode === 'signup' && <label className="l-agree"><input type="checkbox" checked={form.agree} onChange={set('agree')} /><span>서비스 이용을 위한 개인정보(이메일·이름·소속) 수집·이용에 동의합니다.</span></label>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy && <Loader2 className="spin" size={16} />}{busy ? '처리 중…' : mode === 'signup' ? '가입하고 시작하기' : mode === 'login' ? '로그인' : mode === 'reset' ? '재설정 메일 받기' : '비밀번호 바꾸기'}</button>
      {error && <p role="alert" className="auth-error">{error}</p>}
      {mode === 'login' && <button type="button" className="l-textlink" onClick={() => switchTo('reset')}>비밀번호를 잊으셨나요?</button>}
      {mode === 'reset' && <button type="button" className="l-textlink" onClick={() => switchTo('login')}>로그인으로 돌아가기</button>}
    </form>}
  </div>;
}
