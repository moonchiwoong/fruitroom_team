// 개인정보처리방침·이용약관 공통 틀. 정적 페이지라 로그인 없이 볼 수 있습니다.
import type {ReactNode} from 'react';

export const OPERATOR = '팜브릿지(FarmBridge)';
export const CONTACT = 'mooncw@jbnu.ac.kr';
export const EFFECTIVE = '2026년 10월 31일';

export default function LegalPage({title, children}: {title: string; children: ReactNode}) {
  return <div className="legal">
    <a className="legal-back" href="/">← 애플트랙으로 돌아가기</a>
    <h1>{title}</h1>
    <p className="legal-meta">운영: {OPERATOR} · 시행일: {EFFECTIVE}</p>
    {children}
    <p className="legal-meta">문의: <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    <nav className="legal-nav"><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></nav>
  </div>;
}
