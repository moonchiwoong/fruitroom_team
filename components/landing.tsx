'use client';
import {useEffect, useRef, useState} from 'react';
import dynamic from 'next/dynamic';
import {Apple, ArrowDown, ArrowRight, Camera, Check, FileSpreadsheet, Loader2, Lock, MailCheck, UserRound, Users} from 'lucide-react';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {regions, storageIds, storageInfo, storageValue, type RegionId} from '@/lib/initial-quality';

const LandingApple = dynamic(() => import('@/components/landing-apple'), {ssr: false});

type Mode = 'signup' | 'login' | 'reset' | 'recovery';

export default function Landing({recovery = false, onRecovered}: {recovery?: boolean; onRecovered?: () => void}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'signup');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { if (recovery) { setMode('recovery'); goJoin(); } }, [recovery]);

  // 스크롤하면 문구가 차례로 나타납니다.
  useEffect(() => {
    // 화면 아래쪽 92% 지점을 지나면 나타납니다. 빠르게 지나쳐도(위로 지나간 것 포함) 놓치지 않아요.
    let ticking = false;
    const check = () => {
      ticking = false;
      root.current?.querySelectorAll('.reveal:not(.in)').forEach(el => { if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('in'); });
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(check); } };
    check(); window.addEventListener('scroll', onScroll, {passive: true}); window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  const [intent, setIntent] = useState<'real' | 'example' | null>(null);
  /** 시작 버튼: 로그인 후 이어서 열 화면을 기억하고 가입·로그인 영역으로 이동 */
  function start(m: 'real' | 'example') { setIntent(m); try { sessionStorage.setItem('appletrack:intent', m); } catch { /* 무시 */ } goJoin('signup'); }
  function goJoin(m?: Mode) { if (m) setMode(m); document.getElementById('join')?.scrollIntoView({behavior: 'smooth', block: 'start'}); }

  return <div className="landing" ref={root}>
    <LandingApple />
    <header className="landing-nav">
      <div className="landing-nav-inner">
        <button className="brand2" onClick={() => window.scrollTo({top:0,behavior:"smooth"})} aria-label="애플트랙 홈"><span className="brand-mark2"><Apple size={20} /></span><span className="brand-text">애플트랙<small>by FarmBridge</small></span></button>
        <nav aria-label="주요 메뉴" className="landing-main-menu"><button className="landing-link" aria-current="page" onClick={() => window.scrollTo({top:0,behavior:"smooth"})}>홈</button><button className="landing-link" onClick={() => start('real')}>품질 예측</button><button className="landing-link" onClick={() => { history.replaceState(null,'','#lots'); goJoin('login'); }}>물량 관리</button></nav><nav aria-label="계정 메뉴">
          <button className="landing-link" onClick={() => goJoin('login')}>로그인</button>
          <button className="btn btn-primary" onClick={() => start('real')}>시작하기</button>
        </nav>
      </div>
    </header>

    <section className="l-hero" data-apple="0,-0.68,0.72" data-apple-mobile="0,-0.66,0.5">
      <div className="l-hero-text reveal in">
        <span className="l-kicker">사과 품질 예측·저장 관리</span>
        <h1>초기 품질부터<br /><em>저장 중 변화까지</em></h1>
        <p>초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
        <div className="l-actions">
          <button className="btn btn-primary btn-lg" onClick={() => start('real')}>실측값 입력<ArrowRight size={18} /></button>
          <button className="btn btn-outline btn-lg" onClick={() => start('example')}>예시로 체험</button>
        </div>
        <p className="l-note">로그인 후 바로 이어집니다. 예시값은 실제 측정 기록이 아닙니다.</p>
      </div>
      <button className="l-scroll" onClick={() => document.getElementById('l-input')?.scrollIntoView({behavior: 'smooth'})}><span>스크롤해서 알아보기</span><ArrowDown size={18} /></button>
    </section>

    <section id="l-input" className="l-section right-apple" data-apple="0.5,0,1" data-apple-mobile="0,0.5,0.55">
      <div className="l-copy reveal">
        <span className="l-kicker">① 초기 품질 입력</span>
        <h2>잰 값 그대로,<br />입력합니다.</h2>
        <p>측정일과 표본 수, 경도(N)·당도(°Brix)·산도(%)를 넣으세요. 한 항목만 측정했어도 괜찮아요. 측정하지 않은 값은 ‘미측정’으로 남기고 0으로 바꾸지 않습니다.</p>
        <div className="l-metrics l-metrics-4">
          <div><span>경도 <i className="kind k-example">예시</i></span><strong>72.0<small>N</small></strong></div>
          <div><span>당도 <i className="kind k-example">예시</i></span><strong>14.2<small>°Brix</small></strong></div>
          <div><span>산도 <i className="kind k-example">예시</i></span><strong>0.380<small>%</small></strong></div>
          <div><span>감모율</span><strong className="l-missing">미측정</strong></div>
        </div>
        <p className="l-note">경도 옆 ‘단위 변환’으로 N ↔ kgf(1 kgf = 9.80665 N)를 확인할 수 있어요.</p>
      </div>
    </section>

    <section className="l-section left-apple" data-apple="-0.5,0.02,0.95" data-apple-mobile="0,0.5,0.55">
      <div className="l-copy reveal">
        <span className="l-kicker">② 저장 조건 · ③ 변화 확인</span>
        <h2>저장 시작일부터,<br />날짜별로 봅니다.</h2>
        <p>저장 시작일을 0일로 계산해 날짜와 경과일을 함께 보여 줍니다. 저온·1-MCP·CA 조건별 변화와 선택 날짜의 핵심 변화를 한 문장으로 요약해요.</p>
        <MiniStorage firmness={72} brix={14.2} acidity={0.38} />
      </div>
    </section>

    <section className="l-section right-apple" data-apple="0.5,0,0.9" data-apple-mobile="0,0.5,0.55">
      <div className="l-copy reveal">
        <span className="l-kicker">④ 측정값과 비교</span>
        <h2>계산은 선, 실측은 점.<br />나란히 비교합니다.</h2>
        <p>후속 측정을 기록하면 같은 날짜의 계산값과 차이를 보여 줍니다. 분석 기준일 이후의 미래 가정 구간은 점선으로 구분해요.</p>
        <ul className="l-list">
          <li><Check size={18} /><div><b>실측 · 모델 계산 · 예시 · 미측정</b><span>모든 값에 종류와 검증 상태를 표시</span></div></li>
          <li><FileSpreadsheet size={18} /><div><b>온습도 이력·사진</b><span>물량 상세에서 함께 관리 (계산 반영 여부를 구분)</span></div></li>
          <li><Camera size={18} /><div><b>결과 내보내기</b><span>입력 조건·날짜·단위·모델 정보를 함께 CSV로</span></div></li>
        </ul>
      </div>
    </section>

    <section className="l-section left-apple" data-apple="-0.5,0.02,0.85" data-apple-mobile="0,0.5,0.5">
      <div className="l-copy reveal">
        <span className="l-kicker">나만의 작업 공간</span>
        <h2>내 데이터는,<br />나만 봅니다.</h2>
        <p>가입하면 나만의 공간이 생겨요. 작성 중인 입력은 자동으로 임시 저장되어 새로고침해도 복구됩니다.</p>
        <ul className="l-list">
          <li><UserRound size={18} /><div><b>입력 초안 자동 복구</b><span>계정·물량·입력 모드별로 따로 보관</span></div></li>
          <li><Lock size={18} /><div><b>개인 기록</b><span>내 물량과 측정 기록은 다른 사람에게 보이지 않아요</span></div></li>
          <li><Users size={18} /><div><b>팀과 공유도 가능</b><span>팀원은 원하는 물량만 팀과 함께 볼 수 있어요</span></div></li>
        </ul>
      </div>
    </section>

    <section id="join" className="l-join" data-apple="-0.56,-0.05,0.62" data-apple-mobile="0,0.6,0.34">
      <div className="l-join-head reveal">
        <h2>지금 시작해 보세요.</h2>
        <p>{intent === 'example' ? '로그인하면 ‘예시로 체험’ 화면으로 바로 이동합니다.' : intent === 'real' ? '로그인하면 ‘실측값 입력’ 화면으로 바로 이동합니다.' : '이메일로 가입하면 바로 나만의 기록을 시작할 수 있어요.'}</p>
      </div>
      <AuthCard mode={mode} setMode={setMode} onRecovered={onRecovered} />
    </section>

    <footer className="l-footer">
      <span>© 애플트랙 by FarmBridge</span>
      <span>계산값은 시연용이며 출하·안전 판정을 대신하지 않습니다.</span>
    </footer>
  </div>;
}

function MiniStorage({firmness, brix, acidity}: {firmness: number; brix: number; acidity: number}) {
  const init = {firmness, brix, acidity}, W = 460, H = 170, L = 8, R = 8, T = 14, B = 26, days = Array.from({length: 61}, (_, i) => i * 5);
  const series = storageIds.map(s => ({s, v: days.map(t => storageValue(s, 'brix', t, init))}));
  const all = series.flatMap(x => x.v), lo = Math.min(...all) - 0.15, hi = Math.max(...all) + 0.15;
  const x = (t: number) => L + t / 300 * (W - L - R), y = (val: number) => T + (hi - val) / (hi - lo) * (H - T - B);
  return <div className="l-mini">
    <div className="l-mini-head"><b>당도 변화 <i className="kind k-model">시연용 계산</i></b><span>예시 초기 당도 14.2 °Brix에서 출발</span></div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="저장 방식별 당도 변화">
      {[0, 100, 200, 300].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="#e6eae6" /><text x={x(t)} y={H - 8} textAnchor="middle" fontSize="12" fill="#5c6b61">{t}일</text></g>)}
      {series.map(({s, v}) => <path key={s} d={v.map((val, i) => `${i ? 'L' : 'M'}${x(days[i]).toFixed(1)},${y(val).toFixed(1)}`).join('')} fill="none" stroke={storageInfo[s].color} strokeWidth="2.6" strokeLinejoin="round" />)}
    </svg>
    <div className="l-mini-legend">{storageIds.map(s => <span key={s}><i style={{background: storageInfo[s].color}} />{storageInfo[s].short}</span>)}</div>
  </div>;
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
  return <div className="auth-card l-auth reveal">
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
