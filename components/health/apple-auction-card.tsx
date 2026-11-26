'use client';

import {useId} from 'react';
import GarakSummary from '@/components/health/garak-summary';
import type {RegionKey} from '@/lib/regions';
import './apple-auction-card.css';

/** 요약 화면의 사과 경매가 카드: 서울가락 시세 요약만 보여 줍니다(내 산지 경매가는 2026-11-26에 뺌). */
export default function AppleAuctionCard({variety}: {region?: RegionKey | null; variety?: string | null}) {
  const title = useId();
  return <section className="hs-card apple-auction" aria-labelledby={title}>
    <h2 className="apple-auction__title" id={title}>사과 경매가</h2>
    <GarakSummary variety={variety} />
  </section>;
}
