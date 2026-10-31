'use client';
import {useEffect, useState} from 'react';
import {Check, Loader2, LogOut, Mail, MapPin, Save, ShieldCheck, Users, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {PROFILE_REGIONS} from '@/lib/profile-regions';
import {authMessage, supabaseBrowser} from '@/lib/supabase-browser';
import {ID_RULE, displayLogin, normalizeId, toAuthEmail, validId} from '@/lib/login-id';
import {countPredictions} from '@/lib/my-predictions';
import {inputInfo, inputKeys, regionIds, regions, type RegionId} from '@/lib/initial-quality';

export default function Account({onOpenPredict}: {onOpenPredict: () => void}) {
  const session = useTeamSession();
  const [form, setForm] = useState({name: '', affiliation: '', region: '' as import('@/lib/profile-regions').ProfileRegion | ''});
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ok: boolean; text: string} | null>(null), [count, setCount] = useState<number | null>(null);

  useEffect(() => { if (session) setForm({name: session.profile.name, affiliation: session.profile.affiliation, region: session.profile.region}); }, [session?.profile.name, session?.profile.affiliation, session?.profile.region]);
  useEffect(() => { void countPredictions().then(setCount); }, []);
  if (!session) return null;
  const d = session.profile.default_inputs;

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!session) return;
    if (!form.name.trim()) { setMsg({ok: false, text: '이름을 입력해 주세요.'}); return; }
    setBusy(true); const err = await session.saveProfile({name: form.name.trim(), affiliation: form.affiliation.trim(), region: form.region}); setBusy(false);
    setMsg(err ? {ok: false, text: err} : {ok: true, text: '내 정보를 저장했어요.'});
  }
  async function clearDefaults() { if (!session) return; const err = await session.saveProfile({default_inputs: null}); setMsg(err ? {ok: false, text: err} : {ok: true, text: '기본 기상값을 지웠어요.'}); }

  return <div className="account">
    <section className="iq-card account-main">
      <div className="account-id">
        <span className="account-avatar">{session.displayName.slice(0, 1).toUpperCase()}</span>
        <div><h2>{session.displayName}</h2><p><Mail size={14} />{session.loginId}</p></div>
      </div>
      <form onSubmit={save} className="account-form">
        <label>이름<input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} maxLength={50} required /></label>
        <label>소속<input value={form.affiliation} onChange={e => setForm(f => ({...f, affiliation: e.target.value}))} maxLength={80} placeholder="○○농가, △△연구소" /></label>
        <label>주 산지
          <select value={form.region} onChange={e => setForm(f => ({...f, region: e.target.value as RegionId | ''}))}>
            <option value="">선택 안 함</option>
            {PROFILE_REGIONS.map(r => <option key={r.id} value={r.id}>{r.name} ({r.area})</option>)}
          </select>
          <small>모델 정보의 기상 기반 계산(상세 기능)이 이 산지로 시작합니다.</small>
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}저장</button>
        {msg && <p className={msg.ok ? 'account-ok' : 'auth-error'} role="status">{msg.ok && <Check size={15} />}{msg.text}</p>}
      </form>
    </section>

    <div className="account-side">
      <section className="iq-card" hidden>
        <h3 className="account-h"><MapPin size={17} />내 기본 기상값 <small>기상 기반 계산용</small></h3>
        {d ? <>
          <p className="account-sub">{session.profile.region ? (PROFILE_REGIONS.find(r => r.id === session.profile.region)?.name ?? '산지 미지정') : '산지 미지정'} 기준</p>
          <dl className="account-dl">{inputKeys.map(k => <div key={k}><dt>{inputInfo[k].label}</dt><dd>{d[k]} {inputInfo[k].unit}</dd></div>)}</dl>
          <button className="btn btn-ghost" onClick={clearDefaults}><X size={15} />기본값 지우기</button>
        </> : <p className="account-sub">아직 없어요. 모델 정보 › 기상 기반 계산에서 ‘이 값을 내 기본값으로’를 누르면 저장됩니다.</p>}
      </section>
      <section className="iq-card" hidden>
        <h3 className="account-h"><Save size={17} />저장한 기상 기반 계산</h3>
        <p className="account-big">{count ?? '–'}<small>건</small></p>
        <button className="btn btn-outline" onClick={onOpenPredict}>모델 정보에서 보기</button>
      </section>
      <section className="iq-card">
        <h3 className="account-h">{session.isTeam ? <Users size={17} /> : <ShieldCheck size={17} />}데이터 공유 범위</h3>
        <p className="account-sub">{session.isTeam ? '팀원 계정입니다. 내 사과와 함께 팀이 공유한 사과을 볼 수 있고, 새 사과를 팀과 공유할 수 있어요.' : '개인 계정입니다. 내가 등록한 사과·기록·예측은 나만 볼 수 있어요.'}</p>
      </section>
      <button className="btn btn-ghost account-logout" onClick={() => void session.signOut()}><LogOut size={15} />로그아웃</button>
      <LoginChange email={session.email} />
      <Withdraw onDone={() => void session.signOut()} />
    </div>
  </div>;
}

/** 회원 탈퇴: 내가 등록한 사과·측정 기록·첨부 파일과 계정을 지웁니다. ‘탈퇴’를 직접 입력해야 진행합니다. */
function Withdraw({onDone}: {onDone: () => void}) {
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/account/delete', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({confirm: text.trim()})});
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '탈퇴를 처리하지 못했어요.');
      window.alert('탈퇴가 끝났어요. 그동안 이용해 주셔서 고마워요.'); onDone(); window.location.href = '/';
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="linkbtn account-withdraw" onClick={() => setOpen(true)}>회원 탈퇴</button>;
  return <section className="iq-card account-withdraw-box">
    <h3 className="account-h">회원 탈퇴</h3>
    <p className="account-sub">내가 등록한 사과, 측정 기록, 첨부 파일과 계정이 모두 지워지고 되돌릴 수 없어요. 필요한 기록은 먼저 사과 상세의 ‘기록 내려받기’로 저장해 두세요. 다른 팀원이 등록한 기록은 지워지지 않아요.</p>
    <label className="account-sub" htmlFor="withdraw-confirm">계속하려면 <b>탈퇴</b>라고 입력해 주세요.</label>
    <input id="withdraw-confirm" className="account-input" value={text} onChange={e => setText(e.target.value)} autoComplete="off" />
    {err && <p className="auth-error" role="alert">{err}</p>}
    <div style={{display: 'flex', gap: 8, marginTop: 8}}>
      <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setText(''); setErr(''); }}>취소</button>
      <button type="button" className="btn account-withdraw-go" disabled={busy || text.trim() !== '탈퇴'} onClick={() => void go()}>{busy && <Loader2 className="spin" size={15} />}탈퇴하기</button>
    </div>
  </section>;
}

/** 아이디·비밀번호 바꾸기. 바꾸기 전에 지금 비밀번호로 본인 확인을 한 번 더 합니다. */
function LoginChange({email}: {email: string}) {
  const [open, setOpen] = useState<'' | 'email' | 'password'>(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState<{ok: boolean; text: string} | null>(null);
  const [cur, setCur] = useState(''), [nextEmail, setNextEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const reset = (o: typeof open) => { setOpen(o); setCur(''); setNextEmail(''); setPw(''); setPw2(''); setMsg(null); };
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!cur) return setMsg({ok: false, text: '지금 비밀번호를 넣어 주세요.'});
    if (open === 'email') { const n = normalizeId(nextEmail); if (!validId(n)) return setMsg({ok: false, text: `새 아이디는 ${ID_RULE}로 정해 주세요.`}); if (toAuthEmail(n) === email.toLowerCase()) return setMsg({ok: false, text: '지금 쓰는 아이디와 같아요.'}); }
    if (open === 'password') { if (pw.length < 8) return setMsg({ok: false, text: '새 비밀번호는 8자 이상으로 정해 주세요.'}); if (pw !== pw2) return setMsg({ok: false, text: '새 비밀번호 두 칸이 서로 달라요.'}); if (pw === cur) return setMsg({ok: false, text: '지금 비밀번호와 다르게 정해 주세요.'}); }
    setBusy(true);
    try {
      const c = supabaseBrowser();
      const check = await c.auth.signInWithPassword({email, password: cur});
      if (check.error) { setMsg({ok: false, text: '지금 비밀번호가 맞지 않아요.'}); return; }
      if (open === 'email') {
        const n = normalizeId(nextEmail), r = await c.auth.updateUser({email: toAuthEmail(n)});
        if (r.error) { setMsg({ok: false, text: authMessage(r.error)}); return; }
        const changed = r.data.user?.email?.toLowerCase() === toAuthEmail(n);
        reset(''); setMsg(changed ? {ok: true, text: `아이디를 ${n}(으)로 바꿨어요. 다음 로그인부터 새 아이디를 쓰세요.`} : {ok: false, text: '아이디 변경이 바로 적용되지 않았어요. 운영자에게 문의해 주세요.'});
      } else {
        const r = await c.auth.updateUser({password: pw});
        if (r.error) { setMsg({ok: false, text: authMessage(r.error)}); return; }
        reset('password'); setOpen(''); setMsg({ok: true, text: '비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.'});
      }
    } catch (x) { setMsg({ok: false, text: (x as Error).message || '처리하지 못했어요.'}); } finally { setBusy(false); }
  }
  return <section className="iq-card account-login">
    <h3 className="account-h"><ShieldCheck size={17} />로그인 정보</h3>
    <p className="account-sub">아이디 <b>{displayLogin(email)}</b> · 아이디는 바꿀 수 없어요. 보이는 이름은 위에서 바꿀 수 있어요.</p>
    {!open && <div className="account-login-btns"><button type="button" className="btn btn-ghost" onClick={() => reset('password')}>비밀번호 바꾸기</button></div>}
    {open && <form className="account-form" onSubmit={submit}>
      {open === 'email' ? <label>새 아이디 <small>{ID_RULE}</small><input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} autoComplete="username" value={nextEmail} onChange={e => setNextEmail(e.target.value)} required /></label>
        : <><label>새 비밀번호 (8자 이상)<input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required /></label>
          <label>새 비밀번호 한 번 더<input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></label></>}
      <label>지금 비밀번호 (본인 확인)<input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required /></label>
      <div className="account-login-btns"><button type="button" className="btn btn-ghost" onClick={() => reset('')}>취소</button><button className="btn btn-primary" disabled={busy}>{busy && <Loader2 className="spin" size={15} />}{open === 'email' ? '아이디 바꾸기' : '비밀번호 바꾸기'}</button></div>
    </form>}
    {msg && <p className={msg.ok ? 'account-ok' : 'auth-error'} role="status">{msg.ok && <Check size={15} />}{msg.text}</p>}
  </section>;
}
