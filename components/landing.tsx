'use client';
import BigTextToggle from '@/components/big-text-toggle';
import {useEffect, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import {ArrowRight, Loader2, MailCheck} from 'lucide-react';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {ID_RULE, isEmailLogin, normalizeId, toAuthEmail, validId} from '@/lib/login-id';
import {type MetricId} from '@/lib/tracker';
import {HANDOFF_KEY} from '@/lib/tracker-form';
import {PROFILE_REGIONS} from '@/lib/profile-regions';
import {MetricIcon, METRIC_COLOR, METRIC_LABEL} from '@/components/health/metric-icons';
import '@/components/health/health.css';
import LandingSections from '@/components/landing-sections';

type Mode = 'signup' | 'login' | 'reset' | 'recovery';

// 사과가 갈라지며 데이터가 되는 스크롤 장면 (3D). 불러오는 동안은 같은 소개 문구만 보여 줍니다.

/** 움직임 줄이기를 켠 사용자에게는 애니메이션 없이 바로 보여 줍니다. */
const motionOK = () => typeof window !== 'undefined' && !!window.matchMedia && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/** 로그인 전 첫 화면. 체험은 /try 에서 로그인 없이 바로 시작합니다. */
export default function Landing({recovery = false, onRecovered}: {recovery?: boolean; onRecovered?: () => void}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'login');
  const [handoff, setHandoff] = useState(false);
  const [motion] = useState(motionOK);
  // 움직임 줄이기 설정이거나 3D를 쓸 수 없으면 기존 첫 화면(정지 화면)을 보여 줍니다.
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
  // 사과는 화면 크기와 상관없이 팀이 만든 3D 모델(apple-web.glb)만 보여 주고, 천천히 돌립니다.
  useEffect(() => { const q = window.matchMedia('(min-width: 861px) and (pointer: fine) and (prefers-reduced-motion: no-preference)'); const f = () => setWide3d(q.matches); f(); q.addEventListener('change', f); return () => q.removeEventListener('change', f); }, []);
  const tilt = (e: React.PointerEvent<HTMLDivElement>) => { if (!wide3d) return; const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; e.currentTarget.style.setProperty('--rx', `${(-y * 4).toFixed(2)}deg`); e.currentTarget.style.setProperty('--ry', `${(x * 5).toFixed(2)}deg`); };
  const untilt = (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.style.setProperty('--rx', '0deg'); e.currentTarget.style.setProperty('--ry', '0deg'); };
  const cards: [MetricId, string][] = [['firmness', '저장 일수별 단단함'], ['brix', '단맛 변화'], ['acidity', '신맛 변화'], ['loss', '무게가 줄어든 정도']];
  return <div ref={rootRef} className="lh">
    <header className="lh-top lh-up"><img src="/assets/appletrack-logo.svg" alt="애플트랙" width={152} height={34} /><nav className="lh-nav" aria-label="소개"><a href="#how">사용법</a><a href="#regions">산지</a><a href="#dashboard">대시보드</a></nav><BigTextToggle /></header>
    <div className="lh-wrap">
      <section aria-labelledby="lh-title">
        <p className="lh-kicker lh-up lh-d1">사과 저장 품질 기록</p>
        <h1 id="lh-title" className="lh-up lh-d2">저장고 속 사과,<br />오늘은 어떨까요?</h1>
        <p className="lh-lead lh-up lh-d3">{handoff ? '로그인하면 체험 화면에서 입력하던 내용으로 돌아가 이어서 저장할 수 있어요.' : '수확 때 잰 값(또는 그 해 날씨)과 저장 조건으로 단단함·단맛·신맛 변화를 계산해 보여 드려요.'}</p>
        <a href="/try" className="btn lh-try-link lh-up lh-d4">로그인 없이 체험하기 <ArrowRight size={18} aria-hidden="true" /></a>
        <div id="join" className="lh-up lh-d5"><AuthCard mode={mode} setMode={setMode} onRecovered={onRecovered} /></div>
      </section>
      <div className="lh-stage" aria-hidden="true" onPointerMove={tilt} onPointerLeave={untilt}>
        <div className="lh-ring" />
        <div className="lh-apple lh-up lh-d2"><HeroApple3D /></div>
        {cards.map(([m, t], i) => <div key={m} className={`lh-card lh-c${i} lh-up lh-d${i + 2}`}><div className={motion ? 'lh-float' : ''}><span className="hs-lab" style={{color: METRIC_COLOR[m]}}><MetricIcon m={m} />{METRIC_LABEL[m]}</span><p>{t}</p></div></div>)}
      </div>
    </div>
    <LandingSections onStart={() => { document.getElementById('join')?.scrollIntoView({behavior: 'smooth', block: 'center'}); }} />
    <footer className="lh-foot"><span>© 애플트랙 by FarmBridge</span><span>계산값은 시연용이며 출하·안전 판정을 대신하지 않습니다.</span><a href="/privacy"><b>개인정보처리방침</b></a><a href="/terms">이용약관</a><a href="mailto:mooncw@jbnu.ac.kr">문의</a><span>사진: <a href="https://unsplash.com/ko/@chris_robert?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noreferrer">chris robert</a> / <a href="https://unsplash.com/ko/%EC%82%AC%EC%A7%84/%EB%B6%89%EC%9D%80-%EC%97%B4%EB%A7%A4%EA%B0%80%EC%9E%88%EB%8A%94-%EB%82%98%EB%AC%B4-5f8SUQv83_A?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText" target="_blank" rel="noreferrer">Unsplash</a></span></footer>
  </div>;
}

// 첫 화면 이미지 경로는 이곳에서 변경합니다.



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

const AppleViewer3D = dynamic(() => import('@/components/quality-apple-viewer'), {ssr: false, loading: () => <div className="lh-apple-wait" aria-hidden="true" />});
const NO_METRIC = {ok: false, value: null, unit: ''};
function HeroApple3D() {
  return <AppleViewer3D bare gentleRotate day={0} cultivar="후지" metrics={{firmness: NO_METRIC, brix: NO_METRIC, acidity: NO_METRIC, loss: {...NO_METRIC, unit: '%'}}} />;
}
