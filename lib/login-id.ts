// 아이디 로그인: Supabase 인증은 이메일 형식이 필요하므로, 아이디(한글·영문·숫자·기호 아무거나)를
// 16진수로 바꿔 실제로 메일이 가지 않는 주소(.invalid, RFC 2606)에 넣어 씁니다. 예: 사과농가 → u...@id.appletrack.invalid
// 예전에 이메일로 가입한 계정은 '@'가 들어간 이메일 그대로 로그인합니다.
export const ID_DOMAIN = 'id.appletrack.invalid';
export const ID_RULE = '2자 이상, 한글 10자·영문 30자 이내';
const MAX_BYTES = 31; // 이메일 앞부분 64자 제한: 'u' + 16진수 62자
const bytes = (s: string) => new TextEncoder().encode(s);
/** 앞뒤 공백 제거, 한글 조합 통일, 영문은 소문자(대소문자 헷갈림 방지). */
export const normalizeId = (s: string) => s.normalize('NFC').trim().toLowerCase();
export const isEmailLogin = (s: string) => s.includes('@');
export function validId(s: string) { const v = normalizeId(s); return v.length >= 2 && !isEmailLogin(v) && bytes(v).length <= MAX_BYTES && !/[\u0000-\u001f]/.test(v); }
const hex = (s: string) => Array.from(bytes(s), b => b.toString(16).padStart(2, '0')).join('');
export const toAuthEmail = (input: string) => { const v = normalizeId(input); return isEmailLogin(v) ? v : `u${hex(v)}@${ID_DOMAIN}`; };
export const isIdAccount = (email: string) => email.toLowerCase().endsWith('@' + ID_DOMAIN);
/** 화면에 보일 아이디. 아이디 계정은 원래 아이디로, 예전 이메일 계정은 이메일 그대로. */
export function displayLogin(email: string) {
  if (!isIdAccount(email)) return email;
  const h = email.slice(1, email.indexOf('@'));
  try { return new TextDecoder('utf-8', {fatal: true}).decode(new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16)))); } catch { return email.slice(0, email.indexOf('@')); }
}
