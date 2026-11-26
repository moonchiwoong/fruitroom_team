'use client';

import {useEffect, useId, useMemo, useState} from 'react';
import {requestJson} from '@/components/lot-forms';
import {APPLE_AUCTION_PARTS, type AppleAuctionGroup, type AppleAuctionsResponse, type GradedAuctionGroup, type GradedAuctionsResponse} from '@/lib/apple-auction-types';
import {settlementMarketCode} from '@/lib/settlement-markets';
import {mergeAppleAuctionGroups} from '@/lib/apple-auctions';
import {isRegionKey, REGION_KEYS, REGIONS, type RegionKey} from '@/lib/regions';
import {todayKST} from '@/lib/tracker';
import GarakSummary from '@/components/health/garak-summary';
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
  // 실시간 자료에서 이 산지 사과가 거래된 도매시장(물량 많은 순 8곳)만 정산정보로 조회합니다.
  const marketCodes = useMemo(() => {
    const kg = new Map<string, number>();
    for (const g of groups) {
      const code = g.source === 'wholesale' ? settlementMarketCode(g.marketName) : undefined;
      if (code) kg.set(code, (kg.get(code) ?? 0) + g.days.reduce((n, d) => n + d.totalWeightKg, 0));
    }
    return [...kg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code]) => code).sort().join(',');
  }, [groups]);
  const gradedKey = JSON.stringify([region, attempt, marketCodes, current?.checkedThrough]);
  const [graded, setGraded] = useState<{key: string; data: GradedAuctionsResponse | null; failed: boolean} | null>(null);
  useEffect(() => {
    if (loading || !marketCodes || !current) return;
    const controller = new AbortController();
    const params = new URLSearchParams({region, markets: marketCodes, asOf: current.checkedThrough});
    requestJson<GradedAuctionsResponse>(`/api/market/apple-auctions/graded?${params}`, {signal: controller.signal})
      .then(data => { if (data.region === region) setGraded({key: gradedKey, data, failed: false}); })
      .catch(() => { if (!controller.signal.aborted) setGraded({key: gradedKey, data: null, failed: true}); });
    return () => controller.abort();
  }, [gradedKey, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const gradedNow = graded?.key === gradedKey ? graded : null;

  return <section className="hs-card apple-auction" aria-labelledby={title}>
    <h2 className="apple-auction__title" id={title}>사과 경매가</h2>
    <GarakSummary variety={variety} />
    <div className="apple-auction__heading apple-auction__local">
      <h3>내 산지 경매가</h3>
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
    {hasGroups && <AuctionResults key={JSON.stringify([region, attempt])} region={region} groups={groups} variety={variety}
      graded={gradedNow ? {groups: gradedNow.data?.groups ?? [], failed: gradedNow.failed || gradedNow.data?.status === 'unavailable', partial: !!gradedNow.data?.partial} : loading ? null : marketCodes ? null : {groups: [], failed: false, partial: false}} />}
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

type GradedState = {groups: GradedAuctionGroup[]; failed: boolean; partial: boolean} | null;

const GRADED_SOURCE = 'https://www.data.go.kr/data/15141809/openapi.do';
const md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const perKg = (price: number, kg: number) => kg > 0 ? `${priceFormat.format(Math.round(price / kg))}원/kg` : '';
/** 같은 등급인데 최고가가 최저가의 3배 이상이면 평균만 보고 판단하기 어렵다고 알려 줍니다(표시 기준, 판정 아님). */
const WIDE_SPREAD = 3;

/** 실시간 묶음 중, 등급별 정산 자료가 있는 시장·품종을 먼저 고릅니다(내 품종 → 정산 물량 많은 순). */
function preferredGroup(groups: AppleAuctionGroup[], graded: GradedAuctionGroup[], variety?: string | null) {
  const boxes = (g: GradedAuctionGroup) => g.grades.reduce((n, r) => n + (r.days[0]?.boxes ?? 0), 0);
  const ranked = [...graded].sort((a, b) => Number(b.variety === variety) - Number(a.variety === variety) || boxes(b) - boxes(a));
  for (const g of ranked) {
    const hit = groups.find(x => x.source === 'wholesale' && x.marketName === g.marketName && x.variety === g.variety);
    if (hit) return groups.filter(x => x.marketName === hit.marketName && x.variety === hit.variety).find(x => x.unitWeightKg === g.unitWeightKg) ?? hit;
  }
  return initialGroup(groups, variety);
}

function AuctionResults({region, groups, variety, graded}: {region: RegionKey; groups: AppleAuctionGroup[]; variety?: string | null; graded: GradedState}) {
  const filters = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickPack, setPickPack] = useState<string | null>(null);
  const selected = groups.find(group => group.id === selectedId) ?? preferredGroup(groups, graded?.groups ?? [], variety);
  const markets = [...new Map(groups.map(group => [marketKey(group), group])).values()];
  const market = marketKey(selected);
  const marketGroups = groups.filter(group => marketKey(group) === market);
  const varieties = [...new Set(marketGroups.map(group => group.variety))];
  const comparableGroups = marketGroups.filter(group => group.variety === selected.variety);
  const days = selected.days.slice(0, 5);
  const latest = days[0];
  const priceBasis = [weightLabel(selected.unitWeightKg), selected.packageName || (selected.unit === 'kg' ? '' : selected.unit)].filter(Boolean).join(' ');

  // 등급별 정산가: 고른 시장·품종의 포장별 묶음
  const packs = (graded?.groups ?? []).filter(g => g.marketName === selected.marketName && g.variety === selected.variety);
  const pack = packs.find(g => g.id === pickPack) ?? packs.find(g => g.unitWeightKg === selected.unitWeightKg) ?? packs[0];
  const settledOn = pack?.grades.flatMap(r => r.days.map(d => d.date)).sort().at(-1);
  const rows = pack && settledOn ? pack.grades.flatMap(r => { const d = r.days.find(x => x.date === settledOn); return d ? [{key: r.grade + r.size, grade: r.grade, size: r.size, d}] : []; }) : [];
  const lo = Math.min(...rows.map(r => r.d.lowPrice)), hi = Math.max(...rows.map(r => r.d.highPrice));
  const pos = (v: number) => hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50;
  const packLabel = (g: GradedAuctionGroup) => [weightLabel(g.unitWeightKg), g.packageName].filter(Boolean).join(' ');

  function changeMarket(key: string) {
    const options = groups.filter(group => marketKey(group) === key);
    if (options.length) { setPickPack(null); setSelectedId(initialGroup(options, selected.variety).id); }
  }
  function changeVariety(name: string) {
    const first = marketGroups.find(group => group.variety === name);
    if (first) { setPickPack(null); setSelectedId(first.id); }
  }

  const realtime = <div className="aa-live">
    <p className="aa-live-head"><b>오늘 실시간 경매</b><span>등급 합산</span></p>
    <p className="aa-live-val"><b className="hs-num">{priceFormat.format(latest.averagePrice)}</b>원<small>/{priceBasis} · {perKg(latest.averagePrice, selected.unitWeightKg)} · {weightLabel(latest.totalWeightKg)} · <time dateTime={latest.date}>{md(latest.date)}</time></small></p>
    <p className="apple-auction__note">실시간 자료에는 등급·크기 정보가 없어 모든 등급을 합친 평균이에요.</p>
    {comparableGroups.length > 1 && <div className="apple-auction__filter">
      <label htmlFor={`${filters}-spec`}>실시간 규격</label>
      <select id={`${filters}-spec`} value={selected.id} onChange={event => setSelectedId(event.currentTarget.value)}>
        {comparableGroups.map(group => <option key={group.id} value={group.id}>{specification(group)}</option>)}
      </select>
    </div>}
    <details className="apple-auction__history" key={selected.id}>
      <summary>최근 {days.length}거래일 추이</summary>
      <table aria-label="거래일별 평균 낙찰가와 거래량">
        <thead><tr><th scope="col">거래일</th><th scope="col">평균 낙찰가<small>원/{priceBasis}</small></th><th scope="col">거래량<small>kg</small></th></tr></thead>
        <tbody>{days.map(day => <tr key={day.date}>
          <td><time dateTime={day.date}>{md(day.date)}</time></td>
          <td>{priceFormat.format(day.averagePrice)}</td>
          <td>{weightFormat.format(day.totalWeightKg)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </div>;

  const hasGraded = rows.length > 0;
  return <>
    <p className="aa-context">
      {hasGraded ? <><b>{md(settledOn!)} 정산</b> · </> : null}
      <b>{selected.variety}</b> · {selected.marketName}{hasGraded ? <> · {packLabel(pack!)}</> : null}
      <span className="aa-context-sub">{REGIONS[region].label}산</span>
    </p>
    {graded === null ? <p className="apple-auction__notice" role="status">등급별 정산가를 확인하고 있어요…</p>
      : hasGraded ? <ul className="aa-grades" aria-label={`${md(settledOn!)} 등급별 정산가, 원/${packLabel(pack!)}`}>
        {rows.map(r => {
          const wide = r.d.lowPrice > 0 && r.d.highPrice / r.d.lowPrice >= WIDE_SPREAD;
          return <li key={r.key} className="aa-grade">
            <span className="aa-chip" data-grade={r.grade}>{gradeLabel(r.grade)}</span>
            <div className="aa-grade-main">
              <p className="aa-price"><b className="hs-num">{priceFormat.format(r.d.averagePrice)}</b>원 <small>{perKg(r.d.averagePrice, pack!.unitWeightKg)}</small></p>
              <div className="aa-range" aria-hidden="true">
                <i style={{left: `${pos(r.d.lowPrice)}%`, width: `${Math.max(2, pos(r.d.highPrice) - pos(r.d.lowPrice))}%`}} />
                <em style={{left: `${pos(r.d.averagePrice)}%`}} />
              </div>
              <p className="aa-sub">{priceFormat.format(r.d.lowPrice)}~{priceFormat.format(r.d.highPrice)}원{r.size ? ` · ${r.size}` : ''}{wide ? <span className="aa-wide"> · 가격 차이가 커요</span> : null}</p>
            </div>
            <span className="aa-boxes"><b>{weightFormat.format(r.d.boxes)}</b>{pack!.packageName || '개'}</span>
          </li>;
        })}
      </ul>
      : <p className="apple-auction__notice" role="status">{graded.failed ? '등급별 정산가를 불러오지 못했어요.' : `가장 최근 정산 자료에 ${selected.marketName} 시장의 ${selected.variety} 거래가 없어요.`} 아래에서 오늘 실시간 값이나 다른 시장을 볼 수 있어요.</p>}
    {hasGraded && <p className="apple-auction__note">평균은 그날 정산이 끝난 경매 거래의 총 정산금액 ÷ 물량이에요. 막대는 최저~최고, 점은 평균이에요.{graded?.partial ? ' 일부 시장·날짜 자료는 불러오지 못했어요.' : ''}</p>}
    <details className="aa-more" open={!hasGraded && graded !== null}>
      <summary>다른 시장·포장 · 오늘 실시간 보기</summary>
      <div className="aa-more-body">
        {markets.length > 1 && <div className="apple-auction__filter">
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
          {packs.length > 1 && <div className="apple-auction__filter">
            <label htmlFor={`${filters}-pack`}>정산가 포장</label>
            <select id={`${filters}-pack`} value={pack!.id} onChange={e => setPickPack(e.currentTarget.value)}>
              {packs.map(g => <option key={g.id} value={g.id}>{packLabel(g)}</option>)}
            </select>
          </div>}
        </div>
        {realtime}
      </div>
    </details>
    <p className="apple-auction__note">수수료·운송비 차감 전 가격 · 출처 aT <a href={GRADED_SOURCE} target="_blank" rel="noreferrer">정산정보</a> · <a href={sourceLink[selected.source]} target="_blank" rel="noreferrer">{sourceLabel[selected.source]} 경매</a></p>
  </>;
}
