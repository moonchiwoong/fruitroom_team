// 한국어 조사 고르기: 마지막 글자에 받침이 있으면 앞 조사(을·은·이·과), 없으면 뒤 조사(를·는·가·와).
// 한글이 아니면(영문·숫자) 두 형태를 함께 씁니다.
export function josa(word: string, pair: '을를' | '은는' | '이가' | '과와'): string {
  const last = word.trim().slice(-1), code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${pair[0]}(${pair[1]})`;
  return word + (code % 28 ? pair[0] : pair[1]);
}
