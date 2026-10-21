'use client';
import {useEffect, useState} from 'react';
import {Check, Loader2, LogOut, Mail, MapPin, Save, ShieldCheck, Users, X} from 'lucide-react';
import {useTeamSession} from '@/components/team-auth';
import {countPredictions} from '@/lib/my-predictions';
import {inputInfo, inputKeys, regionIds, regions, type RegionId} from '@/lib/initial-quality';

export default function Account({onOpenPredict}: {onOpenPredict: () => void}) {
  const session = useTeamSession();
  const [form, setForm] = useState({name: '', affiliation: '', region: '' as RegionId | ''});
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
            {regionIds.map(r => <option key={r} value={r}>{regions[r].name} ({regions[r].area})</option>)}
          </select>
          <small>초기 품질 예측을 열면 이 산지로 시작합니다.</small>
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}저장</button>
        {msg && <p className={msg.ok ? 'account-ok' : 'auth-error'} role="status">{msg.ok && <Check size={15} />}{msg.text}</p>}
      </form>
    </section>

    <div className="account-side">
      <section className="iq-card">
        <h3 className="account-h"><MapPin size={17} />내 기본 기상값</h3>
        {d ? <>
          <p className="account-sub">{session.profile.region ? regions[session.profile.region as RegionId].name : '산지 미지정'} 기준</p>
          <dl className="account-dl">{inputKeys.map(k => <div key={k}><dt>{inputInfo[k].label}</dt><dd>{d[k]} {inputInfo[k].unit}</dd></div>)}</dl>
          <button className="btn btn-ghost" onClick={clearDefaults}><X size={15} />기본값 지우기</button>
        </> : <p className="account-sub">아직 없어요. 초기 품질 예측에서 ‘이 값을 내 기본값으로’를 누르면 저장됩니다.</p>}
      </section>
      <section className="iq-card">
        <h3 className="account-h"><Save size={17} />저장한 예측</h3>
        <p className="account-big">{count ?? '–'}<small>건</small></p>
        <button className="btn btn-outline" onClick={onOpenPredict}>예측 기록 보기</button>
      </section>
      <section className="iq-card">
        <h3 className="account-h">{session.isTeam ? <Users size={17} /> : <ShieldCheck size={17} />}데이터 공유 범위</h3>
        <p className="account-sub">{session.isTeam ? '팀원 계정입니다. 내 개인 물량과 함께 팀 공유 물량을 볼 수 있고, 새 물량을 팀과 공유할 수 있어요.' : '개인 계정입니다. 내가 등록한 물량·기록·예측은 나만 볼 수 있어요.'}</p>
      </section>
      <button className="btn btn-ghost account-logout" onClick={() => void session.signOut()}><LogOut size={15} />로그아웃</button>
    </div>
  </div>;
}
