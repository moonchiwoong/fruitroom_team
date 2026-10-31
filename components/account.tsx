'use client';
import {useEffect, useState} from 'react';
import {Check, Loader2, LogOut, Mail, MapPin, Save, ShieldCheck, Users, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {PROFILE_REGIONS} from '@/lib/profile-regions';
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
        <div><h2>{session.displayName}</h2><p><Mail size={14} />{session.email}</p></div>
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
        <p className="account-sub">{session.isTeam ? '팀원 계정입니다. 내 개인 물량과 함께 팀 공유 물량을 볼 수 있고, 새 물량을 팀과 공유할 수 있어요.' : '개인 계정입니다. 내가 등록한 물량·기록·예측은 나만 볼 수 있어요.'}</p>
      </section>
      <button className="btn btn-ghost account-logout" onClick={() => void session.signOut()}><LogOut size={15} />로그아웃</button>
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
