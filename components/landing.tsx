'use client';
import {useEffect, useMemo, useState} from 'react';
import {Apple, ArrowRight, Loader2, MailCheck} from 'lucide-react';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {regions, type RegionId} from '@/lib/initial-quality';
import {addDays, computeSeries, fmtDate, fmtNum, summarySentence, todayKST, valueAt, type MetricId} from '@/lib/tracker';
import {HANDOFF_KEY} from '@/lib/tracker-form';

type Mode = 'signup' | 'login' | 'reset' | 'recovery';

/** 로그인 전 첫 화면. 체험은 /try 에서 로그인 없이 바로 시작합니다. */
export default function Landing({recovery = false, onRecovered}: {recovery?: boolean; onRecovered?: () => void}) {
  const [mode, setMode] = useState<Mode>(recovery ? 'recovery' : 'signup');
  const [handoff, setHandoff] = useState(false);
  useEffect(() => {
    if (recovery) { setMode('recovery'); goJoin(); return; }
    // 체험 화면의 ‘로그인’·‘로그인하고 저장하기’로 들어온 경우 가입·로그인 영역을 바로 보여 줍니다.
    const q = new URLSearchParams(window.location.search).get('auth');
    if (q === 'login' || q === 'signup') setMode(q);
    try { setHandoff(!!sessionStorage.getItem(HANDOFF_KEY)); } catch { /* 무시 */ }
    if (window.location.hash === '#join') requestAnimationFrame(() => goJoin());
  }, [recovery]);
  function goJoin(m?: Mode) { if (m) setMode(m); document.getElementById('join')?.scrollIntoView({block: 'start'}); }

  return <div className="landing landing-v2">
    <header className="landing-nav">
      <div className="landing-nav-inner">
        <a className="brand2" href="/" aria-label="애플트랙 첫 화면"><span className="brand-mark2"><Apple size={20} /></span><span className="brand-text">애플트랙<small>by FarmBridge</small></span></a>
        <nav aria-label="계정 메뉴" className="landing-account">
          <a className="landing-link" href="/try">예시 체험</a>
          <button className="landing-link" onClick={() => goJoin('login')}>로그인</button>
          <button className="btn btn-primary btn-sm" onClick={() => goJoin('signup')}>가입하기</button>
        </nav>
      </div>
    </header>

    <main>
      <section className="lv-hero" aria-labelledby="lv-title">
        <div className="lv-hero-copy">
          <p className="lv-kicker">사과 품질 예측·저장 관리</p>
          <h1 id="lv-title">초기 품질부터<br />저장 중 변화까지</h1>
          <p className="lv-lead">초기 품질을 입력하고, 저장 기간에 따른 변화를 예측해 실제 측정값과 비교하세요.</p>
          <div className="lv-actions">
            <a className="btn btn-primary btn-lg" href="/try">예시로 체험하기<ArrowRight size={18} /></a>
            <a className="btn btn-soft btn-lg" href="/try?mode=real">내 측정값 입력하기</a>
          </div>
          <p className="lv-note">가입하지 않아도 바로 볼 수 있어요. 기록으로 저장할 때만 로그인합니다.</p>
        </div>
        <ServicePreview />
      </section>

      <section className="lv-section" aria-labelledby="lv-how">
        <h2 id="lv-how">세 단계면 충분해요</h2>
        <ol className="lv-steps">
          <li><span>1</span><div><b>초기 품질 입력</b><p>측정일, 표본 수와 경도(N)·당도(°Brix)·산도(%)를 넣어요. 한 항목만 있어도 됩니다.</p></div></li>
          <li><span>2</span><div><b>저장 조건 선택</b><p>저장 시작일을 0일로 두고, 저온·1-MCP·CA 등 저장 조건을 고릅니다.</p></div></li>
          <li><span>3</span><div><b>변화 확인</b><p>날짜를 고르면 변화를 한 문장으로 요약하고, 후속 측정값과 그래프로 비교해요.</p></div></li>
        </ol>
      </section>

      <section className="lv-section lv-split" aria-labelledby="lv-kinds">
        <div className="lv-apple"><img src="/assets/apple-still.webp" alt="" width={210} height={210} loading="lazy" /></div>
        <div>
          <h2 id="lv-kinds">값이 어디서 왔는지 항상 보여 줍니다</h2>
          <p className="lv-body">측정한 값과 계산한 값, 예시 값을 섞지 않아요. 측정하지 않은 항목은 0으로 바꾸지 않고 ‘미측정’으로 남깁니다.</p>
          <ul className="lv-kinds">
            <li><span className="kind k-measured">실측</span>직접 측정해 기록한 값</li>
            <li><span className="kind k-model">모델 계산</span>수식으로 계산한 값 · 현재는 시연용</li>
            <li><span className="kind k-example">예시</span>체험용 가상 값 · 실제 기록 아님</li>
            <li><span className="kind k-missing">미측정</span>측정하지 않은 항목</li>
          </ul>
        </div>
      </section>

      <section id="join" className="lv-join" aria-labelledby="lv-join-title">
        <div className="lv-join-copy">
          <h2 id="lv-join-title">{mode === 'login' ? '다시 오셨네요' : '내 기록을 저장하려면'}</h2>
          <p>{handoff ? '로그인하면 체험 화면에서 입력하던 내용으로 돌아가 이어서 저장할 수 있어요.' : '가입하면 물량별 측정 기록, 온습도 이력, 사진을 내 계정에 저장합니다. 내 기록은 나만 볼 수 있어요.'}</p>
        </div>
        <AuthCard mode={mode} setMode={setMode} onRecovered={onRecovered} />
      </section>
    </main>

    <footer className="l-footer">
      <span>© 애플트랙 by FarmBridge</span>
      <span>계산값은 시연용이며 출하·안전 판정을 대신하지 않습니다.</span>
    </footer>
  </div>;
}

/** 첫 화면의 서비스 미리보기: 실제 계산 엔진으로 만든 예시 결과. 예시·시연용임을 함께 표시합니다. */
function ServicePreview() {
  const data = useMemo(() => {
    const today = todayKST(), start = addDays(today, -28), asOfDay = 28, day = 60;
    const init: Record<Exclude<MetricId, 'loss'>, number> = {firmness: 72, brix: 14.2, acidity: 0.38};
    const series = (m: Exclude<MetricId, 'loss'>) => computeSeries({variety: '후지', metric: m, anchor: {day: 0, date: start, value: init[m], kind: '예시', source: 'initial'}, recorded: 'cold', future: 'cold', asOfDay});
    const f = series('firmness'), b = series('brix'), a = series('acidity');
    const sentence = summarySentence({metric: 'firmness', day, date: addDays(start, day), at: valueAt(f, day), anchor: {day: 0, date: start, value: 72, kind: '예시', source: 'initial'}});
    return {start, asOfDay, day, f, values: {firmness: valueAt(f, day), brix: valueAt(b, day), acidity: valueAt(a, day)}, sentence};
  }, []);
  const W = 420, H = 150, L = 22, R = 24, T = 10, B = 24;
  const pts = data.f.ok ? data.f.points : [];
  const vals = pts.map(p => p.value), lo = Math.min(...vals) - 0.3, hi = Math.max(...vals) + 0.3;
  const x = (d: number) => L + d / 300 * (W - L - R), y = (v: number) => T + (hi - v) / (hi - lo) * (H - T - B);
  const path = (seg: 'past' | 'future') => { const ff = pts.findIndex(p => p.segment === 'future'); const list = seg === 'past' ? pts.filter(p => p.segment === 'past') : pts.slice(Math.max(0, ff - 1)); return list.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(''); };
  const units = {firmness: 'N', brix: '°Brix', acidity: '%'} as const, digits = {firmness: 1, brix: 1, acidity: 3} as const, labels = {firmness: '경도', brix: '당도', acidity: '산도'} as const;
  return <aside className="lv-preview" aria-label="서비스 미리보기 (예시 데이터)">
    <div className="lv-preview-head"><span className="kind k-example">예시 데이터</span><span>후지 · 저온저장 · 저장 시작 {fmtDate(data.start)}</span></div>
    <p className="lv-preview-day">저장 {data.day}일차 · {fmtDate(addDays(data.start, data.day))}</p>
    <dl className="lv-preview-values">{(['firmness', 'brix', 'acidity'] as const).map(m => { const v = data.values[m]; return <div key={m}><dt>{labels[m]}</dt><dd>{v.status === 'ok' ? fmtNum(v.value, digits[m]) : '—'}<small>{units[m]}</small></dd></div>; })}</dl>
    <p className="lv-preview-sentence">{data.sentence}</p>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="예시 경도 변화 그래프. 실선은 분석 기준일까지, 점선은 이후 가정 구간">
      {[0, 100, 200, 300].map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="#eef0f2" /><text x={x(t)} y={H - 6} textAnchor="middle" fontSize="12" fill="#6b7684">{t}일</text></g>)}
      <line x1={x(data.asOfDay)} x2={x(data.asOfDay)} y1={T} y2={H - B} stroke="#4e5968" strokeDasharray="3 3" />
      <path d={path('past')} fill="none" stroke="#1d5c3c" strokeWidth="2.6" />
      <path d={path('future')} fill="none" stroke="#1d5c3c" strokeWidth="2.4" strokeDasharray="7 5" />
      <circle cx={x(data.day)} cy={data.values.firmness.status === 'ok' ? y(data.values.firmness.value) : 0} r="5" fill="#fff" stroke="#1d5c3c" strokeWidth="2.4" />
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
