'use client';
import {createBrowserClient} from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;
/** 브라우저에서 쓰는 Supabase 클라이언트 (한 번만 만듭니다). */
export function supabaseBrowser() {
  if (!client) client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return client;
}

/** Supabase 인증 오류를 한국어 안내로 바꿉니다. */
export function authMessage(error: {message?: string; code?: string} | null | undefined): string {
  const m = (error?.message ?? '').toLowerCase(), code = error?.code ?? '';
  if (code === 'user_already_exists' || m.includes('already registered')) return '이미 쓰고 있는 아이디예요. 다른 아이디를 정하거나 로그인해 주세요.';
  if (code === 'invalid_credentials' || m.includes('invalid login')) return '아이디 또는 비밀번호가 맞지 않습니다.';
  if (code === 'email_not_confirmed' || m.includes('not confirmed')) return '이메일 인증이 아직 끝나지 않았어요. 받은 메일의 링크를 눌러 주세요.';
  if (code === 'weak_password' || m.includes('password should')) return '비밀번호가 너무 약해요. 8자 이상, 영문과 숫자를 섞어 주세요.';
  if (code === 'over_email_send_rate_limit' || m.includes('rate limit')) return '요청이 많아 잠시 막혔어요. 몇 분 뒤 다시 시도해 주세요.';
  if (code === 'signup_disabled' || m.includes('signups not allowed')) return '현재 회원가입이 닫혀 있습니다. 관리자에게 문의해 주세요.';
  if (m.includes('invalid email') || code === 'email_address_invalid') return '아이디(또는 이메일) 형식을 확인해 주세요.';
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
