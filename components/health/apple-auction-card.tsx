'use client';

import {useEffect, useId, useState} from 'react';
import {requestJson} from '@/components/lot-forms';
import {APPLE_AUCTION_PARTS, type AppleAuctionGroup, type AppleAuctionsResponse} from '@/lib/apple-auction-types';
import {mergeAppleAuctionGroups} from '@/lib/apple-auctions';
import {isRegionKey, REGION_KEYS, REGIONS, type RegionKey} from '@/lib/regions';
import {todayKST} from '@/lib/tracker';
import './apple-auction-card.css';

type Props = {region?: RegionKey | null; variety?: string | null};
type RequestResult = {
  region: RegionKey;
  attempt: number;
  groups: AppleAuctionGroup[];
  checkedThrough: string;
  complete: boolean;
  partial: boolean;
};

const priceFormat = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 0});
const weightFormat = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 3});
const sourceLabel = {'origin-hall': '산지공판장', wholesale: '공영도매시장'};
const sourceLink = {
  'origin-hall': 'https://www.data.go.kr/data/15156054/openapi.do',
  wholesale: 'https://www.data.go.kr/data/15141808/openapi.do',
};

const marketKey = (group: AppleAuctionGroup) => JSON.stringify([group.source, group.marketName]);
const weightLabel = (weightKg: number) => `${weightFormat.format(weightKg)}kg`;
const gradeLabel = (grade: string) => grade === '없음' || !grade ? '등급 미기재' : grade;

function specification(group: AppleAuctionGroup) {
  return [...new Set([weightLabel(group.unitWeightKg), group.packageName, group.size, group.unit].filter(Boolean))].join(' · ');
}

function initialGroup(groups: AppleAuctionGroup[], preferred?: string | null) {
  const variety = preferred?.trim();
  // `후지`와 `후지(부사)`는 초기 선택에서만 연결하고 실제 경매 품종명과 집계는 그대로 표시합니다.
  const fujiLabels = ['후지', '부사', '후지(부사)'];
  const preferFuji = variety !== undefined && fujiLabels.includes(variety);
  return groups.find(group => group.variety === variety || (preferFuji && fujiLabels.includes(group.variety))) ?? groups[0];
}

export default function AppleAuctionCard({region, variety}: Props) {
  const defaultRegion = region ?? REGION_KEYS[0];
  return <AuctionCard key={JSON.stringify([defaultRegion, variety])} defaultRegion={defaultRegion} variety={variety} />;
}

function AuctionCard({defaultRegion, variety}: {defaultRegion: RegionKey; variety?: string | null}) {
  const title = useId();
  const [region, setRegion] = useState(defaultRegion);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<RequestResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const {signal} = controller;
    const checkedThrough = todayKST();
    const sources: AppleAuctionGroup['source'][] = ['wholesale'];
    if (region === 'geochang' || region === 'yeongju') sources.unshift('origin-hall');
    let groups: AppleAuctionGroup[] = [];
    let partial = false;
    let remaining = sources.length * APPLE_AUCTION_PARTS;

    async function loadSource(source: AppleAuctionGroup['source']) {
      for (let part = 0; part < APPLE_AUCTION_PARTS; part++) {
        if (signal.aborted) return;
        const params = new URLSearchParams({region, source, part: String(part), asOf: checkedThrough});
        try {
          const data = await requestJson<AppleAuctionsResponse>(`/api/market/apple-auctions?${params}`, {signal});
          if (data.region !== region || data.checkedThrough !== checkedThrough || data.groups.some(group => group.source !== source)) {
            throw new Error('Unexpected auction response');
          }
          if (data.status === 'ready') groups = mergeAppleAuctionGroups(groups, data.groups.filter(group => group.days.length));
          partial ||= data.partial || data.status === 'unavailable';
        } catch {
          partial = true;
        }
        if (signal.aborted) return;
        remaining--;
        setResult({region, attempt, groups, checkedThrough, partial, complete: remaining === 0});
      }
    }
    for (const source of sources) void loadSource(source);
    return () => controller.abort();
  }, [region, attempt]);

  const current = result?.region === region && result.attempt === attempt ? result : null;
  const groups = current?.groups ?? [];
  const loading = !current?.complete;
  const hasGroups = groups.length > 0;

  return <section className="hs-card apple-auction" aria-labelledby={title}>
    <div className="apple-auction__heading">
      <h2 id={title}>사과 경매가</h2>
      <div className="apple-auction__filter">
        <label htmlFor={`${title}-region`}>산지</label>
        <select id={`${title}-region`} value={region} onChange={event => {
          const nextRegion = event.currentTarget.value;
          if (isRegionKey(nextRegion)) {
            setResult(null);
            setRegion(nextRegion);
          }
        }}>
          {REGION_KEYS.map(key => <option key={key} value={key}>{REGIONS[key].label}</option>)}
        </select>
      </div>
    </div>
    {hasGroups && <AuctionResults key={JSON.stringify([region, attempt])} region={region} groups={groups} variety={variety} />}
    {loading ? <p className="apple-auction__notice" role="status">{hasGroups ? '다른 시장과 이전 거래일 자료를 확인하고 있어요…' : '경매 자료를 불러오는 중이에요…'}</p>
      : current?.partial ? <div className="apple-auction__retry">
        <p className="apple-auction__notice" role="status">{hasGroups ? '일부 시장 또는 거래일의 자료를 불러오지 못했어요.' : '조회 자료를 불러오지 못했어요.'}</p>
        <button className="hs-link" type="button" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button>
      </div>
      : !hasGroups && <p className="apple-auction__notice" role="status">
        {REGIONS[region].label}산 사과의 최근 경매 자료를 확인하지 못했어요.
        {current?.checkedThrough && <> 조회 기준일 <time dateTime={current.checkedThrough}>{current.checkedThrough}</time></>}
      </p>}
  </section>;
}

function AuctionResults({region, groups, variety}: {region: RegionKey; groups: AppleAuctionGroup[]; variety?: string | null}) {
  const filters = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = groups.find(group => group.id === selectedId) ?? initialGroup(groups, variety);
  const markets = [...new Map(groups.map(group => [marketKey(group), group])).values()];
  const market = marketKey(selected);
  const marketGroups = groups.filter(group => marketKey(group) === market);
  const varieties = [...new Set(marketGroups.map(group => group.variety))];
  const comparableGroups = marketGroups.filter(group => group.variety === selected.variety);
  const days = selected.days.slice(0, 5);
  const latest = days[0];
  const priceBasis = [weightLabel(selected.unitWeightKg), selected.packageName || (selected.unit === 'kg' ? '' : selected.unit)].filter(Boolean).join(' ');

  function changeMarket(key: string) {
    const options = groups.filter(group => marketKey(group) === key);
    if (options.length) setSelectedId(initialGroup(options, selected.variety).id);
  }

  function changeVariety(name: string) {
    const first = marketGroups.find(group => group.variety === name);
    if (first) setSelectedId(first.id);
  }

  return <>
    {markets.length > 1 && <div className="apple-auction__filter apple-auction__market-filter">
      <label htmlFor={`${filters}-market`}>거래 시장</label>
      <select id={`${filters}-market`} value={market} onChange={event => changeMarket(event.currentTarget.value)}>
        {markets.map(group => <option key={marketKey(group)} value={marketKey(group)}>{group.marketName} · {sourceLabel[group.source]}</option>)}
      </select>
    </div>}
    <div className="apple-auction__filters">
      <div className="apple-auction__filter">
        <label htmlFor={`${filters}-variety`}>품종</label>
        <select id={`${filters}-variety`} value={selected.variety} onChange={event => changeVariety(event.currentTarget.value)}>
          {varieties.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="apple-auction__filter">
        <label htmlFor={`${filters}-spec`}>등급·규격</label>
        <select id={`${filters}-spec`} value={selected.id} onChange={event => setSelectedId(event.currentTarget.value)}>
          {comparableGroups.map(group => <option key={group.id} value={group.id}>{gradeLabel(group.grade)} · {specification(group)}</option>)}
        </select>
      </div>
    </div>
    <p className="apple-auction__venue"><strong>{selected.marketName}</strong> · {sourceLabel[selected.source]}</p>
    <p className="apple-auction__meta">{REGIONS[region].label}산 · 최근 거래일 <time dateTime={latest.date}>{latest.date}</time></p>
    <dl className="apple-auction__metrics">
      <div>
        <dt>평균 낙찰가</dt>
        <dd><strong>{priceFormat.format(latest.averagePrice)}원</strong><small>{priceBasis} 기준</small></dd>
      </div>
      <div>
        <dt>거래량</dt>
        <dd><strong>{weightLabel(latest.totalWeightKg)}</strong></dd>
      </div>
    </dl>
    <details className="apple-auction__history" key={selected.id}>
      <summary>최근 {days.length}거래일 추이</summary>
      <table aria-label="거래일별 평균 낙찰가와 거래량">
        <thead><tr><th scope="col">거래일</th><th scope="col">평균 낙찰가<small>원/{priceBasis}</small></th><th scope="col">거래량<small>kg</small></th></tr></thead>
        <tbody>{days.map(day => <tr key={day.date}>
          <td><time dateTime={day.date}>{day.date}</time></td>
          <td>{priceFormat.format(day.averagePrice)}</td>
          <td>{weightFormat.format(day.totalWeightKg)}</td>
        </tr>)}</tbody>
      </table>
    </details>
    <p className="apple-auction__note">수수료·운송비 차감 전 낙찰가 · <a href={sourceLink[selected.source]} target="_blank" rel="noreferrer">출처 aT</a></p>
  </>;
}
