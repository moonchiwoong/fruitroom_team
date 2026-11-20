'use client';
import dynamic from 'next/dynamic';

// 새 화면 시안(미리보기): 지역 → 내 저장고 → 사과 중심 결과. 기존 화면(/)은 그대로 둡니다.
const V2Flow = dynamic(() => import('@/components/v2-flow'), {ssr: false, loading: () => <div className="loading-strip">화면을 준비하고 있어요…</div>});

export default function V2Page() {
  return <V2Flow />;
}
