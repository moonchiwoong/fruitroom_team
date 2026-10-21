'use client';
import {createBrowserClient} from '@supabase/ssr';
import {createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {Apple, Loader2, LogIn} from 'lucide-react';

const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);

type Session = {email: string; signOut: () => Promise<void>};
const SessionContext = createContext<Session | null>(null);
/** 로그인한 팀원 정보와 로그아웃 함수. 헤더에서 사용합니다. */
export const useTeamSession = () => useContext(SessionContext);

export default function TeamAuth({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false), [allowed, setAllowed] = useState(false), [userEmail, setUserEmail] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = client(); let mounted = true;
    async function check() {
      const {data} = await c.auth.getUser();
      if (!data.user) { if (mounted) { setAllowed(false); setReady(true); } return; }
      const r = await c.from('team_members').select('user_id').eq('user_id', data.user.id).maybeSingle();
      if (!mounted) return;
      setAllowed(!r.error && !!r.data); setUserEmail(data.user.email ?? ''); setReady(true);
      if (r.error || !r.data) setError('로그인한 계정이 팀원 목록에 없습니다. 관리자에게 등록을 요청해 주세요.');
    }
    void check();
    const {data: {subscription}} = c.auth.onAuthStateChange(() => { setTimeout(() => { void check(); }, 0); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  if (!ready) return <div className="auth-loading"><Loader2 className="spin" size={22} />로그인 상태를 확인하고 있어요…</div>;
  if (allowed) return <SessionContext.Provider value={{email: userEmail, signOut: async () => { await client().auth.signOut(); setAllowed(false); }}}>{children}</SessionContext.Provider>;

  return <main className="auth-page">
    <section className="auth-intro">
      <span className="brand-mark"><Apple size={24} /></span>
      <h1>과실연구소</h1>
      <p>사과의 초기 품질 예측부터 저장 환경·품질 기록까지, 팀이 함께 쓰는 작업 공간입니다.</p>
      <ul><li>산지·기상 조건으로 수확 직후 품질 예측</li><li>저장 방식별 품질 변화 비교</li><li>물량별 온습도·품질·사진 기록 공유</li></ul>
    </section>
    <section className="auth-card">
      <h2>팀 로그인</h2>
      <p>등록된 팀원 계정으로 로그인해 주세요.</p>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        try { const r = await client().auth.signInWithPassword({email, password}); if (r.error) setError('로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.'); }
        catch { setError('연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
        finally { setBusy(false); }
      }}>
        <label>이메일<input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" /></label>
        <label>비밀번호<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <LogIn size={16} />}{busy ? '로그인 중…' : '로그인'}</button>
        {error && <p role="alert" className="auth-error">{error}</p>}
      </form>
    </section>
  </main>;
}
