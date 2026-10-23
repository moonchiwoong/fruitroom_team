'use client';
import dynamic from 'next/dynamic';

// 비회원 체험 화면. 로그인 없이 예시 데이터와 계산만 사용합니다.
const GuestTry = dynamic(() => import('@/components/guest-try'), {ssr: false, loading: () => <div className="loading-strip">체험 화면을 준비하고 있어요…</div>});

export default function TryPage() {
  return <GuestTry />;
}
