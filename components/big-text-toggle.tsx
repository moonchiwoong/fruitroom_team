'use client';
// 글자 크게: 로그인과 상관없이 누를 수 있습니다. 이 기기(브라우저)에만 기억합니다.
import {useEffect, useState} from 'react';

export default function BigTextToggle({className = 'nav-util'}: {className?: string}) {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(document.documentElement.classList.contains('big-text')); }, []);
  const toggle = () => { const next = !on; setOn(next); document.documentElement.classList.toggle('big-text', next); try { localStorage.setItem('appletrack:bigtext', next ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에는 적용 */ } };
  return <button type="button" className={className + ' big-text-toggle' + (on ? ' on' : '')} aria-pressed={on} onClick={toggle} title={on ? '글자 보통으로' : '글자 크게'}><span className="btt-ga" aria-hidden>가</span><span className="btt-t">{on ? '글자 보통' : '글자 크게'}</span></button>;
}
