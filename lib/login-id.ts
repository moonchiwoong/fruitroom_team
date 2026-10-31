// 아이디 로그인: Supabase 인증은 이메일 형식이 필요하므로, 아이디를 실제로 메일이 가지 않는 주소(.invalid, RFC 2606)로 바꿔 씁니다.
// 예전에 이메일로 가입한 계정은 '@'가 들어간 이메일 그대로 로그인합니다.
export const ID_DOMAIN = 'id.appletrack.invalid';
export const ID_RULE = '영문 소문자·숫자·밑줄(_) 4~20자';
export const normalizeId = (s: string) => s.trim().toLowerCase();
export const validId = (s: string) => /^[a-z0-9][a-z0-9_]{3,19}$/.test(s);
export const isEmailLogin = (s: string) => s.includes('@');
export const toAuthEmail = (input: string) => { const v = normalizeId(input); return isEmailLogin(v) ? v : `${v}@${ID_DOMAIN}`; };
export const isIdAccount = (email: string) => email.toLowerCase().endsWith('@' + ID_DOMAIN);
/** 화면에 보일 아이디. 아이디 계정은 아이디만, 예전 이메일 계정은 이메일 그대로. */
export const displayLogin = (email: string) => isIdAccount(email) ? email.slice(0, email.indexOf('@')) : email;
