'use client';
import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {Loader2} from 'lucide-react';
import {supabaseBrowser} from '@/lib/supabase-browser';
import {displayLogin} from '@/lib/login-id';
import type {Inputs, RegionId} from '@/lib/initial-quality';

const Landing = dynamic(() => import('@/components/landing'), {ssr: false, loading: () => <Splash />});

import {type ProfileRegion} from '@/lib/profile-regions';
export type Profile = {name: string; affiliation: string; region: ProfileRegion | ''; default_inputs: Inputs | null};
export type Session = {
  userId: string; email: string; loginId: string; profile: Profile; isTeam: boolean;
  displayName: string;
  saveProfile: (patch: Partial<Profile>) => Promise<string | null>;
  signOut: () => Promise<void>;
};
const SessionContext = createContext<Session | null>(null);
/** 로그인한 사용자 정보. 로그인 화면 밖(앱 내부)에서만 값이 있습니다. */
export const useTeamSession = () => useContext(SessionContext);

const emptyProfile: Profile = {name: '', affiliation: '', region: '', default_inputs: null};

export default function TeamAuth({children}: {children: ReactNode}) {
  const [state, setState] = useState<'loading' | 'out' | 'in' | 'recovery'>('loading');
  const [user, setUser] = useState<{id: string; email: string; meta: Record<string, unknown>} | null>(null);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [isTeam, setIsTeam] = useState(false);
  const loadVersion = useRef(0);
  const accountScope = useRef({id: null as string | null});
  const trackAccount = useCallback((id: string | null) => {
    if (accountScope.current.id !== id) accountScope.current = {id};
  }, []);

  const load = useCallback(async (version = ++loadVersion.current) => {
    if (version !== loadVersion.current) return;
    const c = supabaseBrowser();
    const {data} = await c.auth.getUser();
    if (version !== loadVersion.current) return;
    trackAccount(data.user?.id ?? null);
    if (!data.user) { setUser(null); setProfile(emptyProfile); setIsTeam(false); setState(s => s === 'recovery' ? s : 'out'); return; }
    const u = {id: data.user.id, email: data.user.email ?? '', meta: (data.user.user_metadata ?? {}) as Record<string, unknown>};
    const [p, t] = await Promise.all([
      c.from('profiles').select('name,affiliation,region,default_inputs').eq('id', u.id).maybeSingle(),
      c.from('team_members').select('user_id').eq('user_id', u.id).maybeSingle(),
    ]);
    if (version !== loadVersion.current) return;
    // profiles 테이블이 아직 없으면 가입 때 넣은 정보로 대신합니다.
    const meta = u.meta;
    setProfile(!p.error && p.data ? {...emptyProfile, ...p.data} : {
      name: String(meta.name ?? ''), affiliation: String(meta.affiliation ?? ''),
      region: (['geochang', 'cheongsong', 'jangsu', 'yeongju'].includes(String(meta.region)) ? meta.region : '') as Profile['region'], default_inputs: null,
    });
    setIsTeam(!t.error && !!t.data);
    setUser(u); setState(s => s === 'recovery' ? s : 'in');
  }, [trackAccount]);

  useEffect(() => {
    const c = supabaseBrowser(); void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const {data: {subscription}} = c.auth.onAuthStateChange((event, session) => {
      // Invalidate pending reads immediately, before the deferred Supabase call.
      const version = ++loadVersion.current;
      const nextId = session?.user.id ?? null;
      if (nextId !== accountScope.current.id || event === 'SIGNED_OUT') {
        trackAccount(nextId);
        setUser(null); setProfile(emptyProfile); setIsTeam(false);
        setState(nextId ? 'loading' : 'out');
      }
      if (event === 'PASSWORD_RECOVERY') setState('recovery');
      clearTimeout(timer);
      timer = setTimeout(() => { void load(version); }, 0);
    });
    return () => {
      ++loadVersion.current;
      accountScope.current = {id: null};
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [load, trackAccount]);

  const saveProfile = useCallback(async (patch: Partial<Profile>) => {
    const scope = accountScope.current;
    if (!user || scope.id !== user.id) return '로그인이 필요합니다.';
    const next = {...profile, ...patch};
    const r = await supabaseBrowser().from('profiles').upsert({id: user.id, ...next, updated_at: new Date().toISOString()});
    if (scope !== accountScope.current) return '계정이 변경되었습니다. 현재 계정에서 다시 확인해 주세요.';
    if (r.error) return '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
    setProfile(next); return null;
  }, [user, profile]);

  // 비회원 체험(/try): 로그인 없이 공개 예시 데이터와 계산만 사용합니다. 개인 데이터 API는 쓰지 않습니다.
  const [guestPath, setGuestPath] = useState<boolean | null>(null);
  useEffect(() => { setGuestPath(window.location.pathname.replace(/\/+$/, '') === '/try'); }, []);
  useEffect(() => {
    if (!guestPath || state !== 'in') return;
    // 이미 로그인한 사용자는 같은 화면을 개인 작업 공간에서 이어 갑니다.
    try { const mode = new URLSearchParams(window.location.search).get('mode') === 'real' ? 'real' : 'example'; sessionStorage.setItem('appletrack:intent', mode); } catch { /* 무시 */ }
    window.location.replace('/#track');
  }, [guestPath, state]);

  if (state === 'loading' || guestPath === null) return <Splash />;
  if (guestPath) return state === 'in' ? <Splash /> : <>{children}</>;
  if (state === 'out' || state === 'recovery' || !user) return <Landing recovery={state === 'recovery'} onRecovered={() => setState(user ? 'in' : 'out')} />;

  const session: Session = {
    userId: user.id, email: user.email, profile, isTeam,
    displayName: profile.name || user.email.split('@')[0], loginId: displayLogin(user.email),
    saveProfile,
    signOut: async () => {
      const scope = accountScope.current;
      ++loadVersion.current;
      await supabaseBrowser().auth.signOut();
      if (scope === accountScope.current) {
        ++loadVersion.current;
        trackAccount(null);
        setUser(null); setProfile(emptyProfile); setIsTeam(false); setState('out');
      }
      window.scrollTo(0, 0);
    },
  };
  return <SessionContext.Provider key={user.id} value={session}>{children}</SessionContext.Provider>;
}

function Splash() {
  return <div className="auth-loading"><Loader2 className="spin" size={22} />잠시만요…</div>;
}
