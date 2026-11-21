'use client';
// 로그인 전 첫 화면 아래의 소개 구역. 숫자는 모두 사이트 코드에 실제로 있는 값(산지 수·계산 범위)이나
// 예시 데이터로 기존 식을 돌린 결과입니다. 지어낸 통계·후기는 넣지 않습니다.
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {exampleForm, payloadFromForm} from '@/lib/tracker-form';
import {lotPredictor} from '@/lib/lot-predict';
import type {Lot} from '@/lib/lot-types';
import {compareShipping} from '@/lib/ship-compare';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import MiniCharts from '@/components/mini-charts';
import RegionMapPicker, {MAP_PINS, type MapRegion} from '@/components/region-map-picker';

/** 화면에 들어오면 아래에서 떠오르게(움직임 줄이기 설정이면 바로 보임). */
function Reveal({children, className = '', delay = 0}: {children: ReactNode; className?: string; delay?: number}) {
  const ref = useRef<HTMLDivElement>(null), [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { setOn(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setOn(true); io.disconnect(); } }, {threshold: 0.18});
    io.observe(el); return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`lx-rev ${on ? 'in' : ''} ${className}`} style={{transitionDelay: `${delay}ms`}}>{children}</div>;
}

/** 숫자가 0부터 올라감(화면에 들어올 때 한 번). */
function Count({to, suffix = ''}: {to: number; suffix?: string}) {
  const ref = useRef<HTMLSpanElement>(null), [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { setN(to); return; }
    const io = new IntersectionObserver(es => { if (!es.some(e => e.isIntersecting)) return; io.disconnect();
      const t0 = performance.now(); const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setN(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, {threshold: 0.5});
    io.observe(el); return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{n.toLocaleString('ko-KR')}{suffix}</span>;
}

const STEPS = [
  {n: '1', t: '사과를 등록해요', d: '품종·산지·수확일·저장고 온도만 고르면 돼요. 잰 값이 없으면 그 해 농업기상 자료로 처음 품질을 추정해요.'},
  {n: '2', t: '저장 중 변화를 봐요', d: '단단함·단맛·신맛·무게 감소를 저장 일수별로 계산해 한 화면에 보여 줘요.'},
  {n: '3', t: '재면 더 정확해져요', d: '당도나 단단함을 재서 넣으면, 그 값부터 다시 이어서 계산해요.'},
];

export default function LandingSections({onStart}: {onStart: () => void}) {
  const example = useMemo(() => {
    try { const lot = {id: 'example', ...payloadFromForm(exampleForm(), 'real'), latest_observation: null} as unknown as Lot; return {p: lotPredictor(lot, []), lot}; } catch { return null; }
  }, []);
  const ship = compareShipping({nowKg: '1000', nowPrice: '3000', laterKg: '980', cost: '120000', laterPrice: '3300'});
  const [region, setRegion] = useState<MapRegion | ''>('gunwi');
  const regionCount = Object.keys(MAP_PINS).length;
  return <div className="lx">
    <section className="lx-stats" aria-label="애플트랙 한눈에">
      {[{v: regionCount, s: '곳', l: '예측식이 있는 산지'}, {v: 2, s: '품종', l: '홍로 · 후지'}, {v: 120, s: '일', l: '홍로 계산 범위'}, {v: 300, s: '일', l: '후지 계산 범위'}].map((x, i) =>
        <Reveal key={x.l} delay={i * 80} className="lx-stat"><b><Count to={x.v} />{x.s}</b><span>{x.l}</span></Reveal>)}
    </section>

    <section className="lx-sec" id="how"><Reveal><p className="lx-kick">이렇게 써요</p><h2>세 단계면 충분해요</h2></Reveal>
      <div className="lx-steps">{STEPS.map((s, i) => <Reveal key={s.n} delay={i * 120} className="lx-step"><span className="lx-n">{s.n}</span><b>{s.t}</b><p>{s.d}</p></Reveal>)}</div>
    </section>

    <section className="lx-sec lx-split" id="regions">
      <Reveal className="lx-copy"><p className="lx-kick">산지별 회귀식</p><h2>내 산지 날씨로<br />처음 품질을 추정해요</h2>
        <p>농촌진흥청 농업기상 관측(농업날씨365) 일자료로 그 해 최저기온·생장도일·강수량을 계산해, 산지마다 만든 식에 넣어요.</p>
        {region && <dl className="lx-region"><div><dt>산지</dt><dd>{WEATHER_STATIONS[region].label}</dd></div><div><dt>관측지점</dt><dd>{WEATHER_STATIONS[region].name}</dd></div><div><dt>예측식</dt><dd>{MAP_PINS[region].cultivars.join(' · ')}</dd></div></dl>}
      </Reveal>
      <Reveal delay={120} className="lx-map"><RegionMapPicker value={region} onPick={setRegion} /></Reveal>
    </section>

    {example && <section className="lx-sec" id="dashboard"><Reveal><p className="lx-kick">한눈에 보는 대시보드</p><h2>항목마다 자기 단위로, 저장 일수별 변화</h2>
      <p className="lx-sub">아래는 <b>예시 데이터(후지)</b>로 기존 계산식을 그대로 돌린 화면이에요. 실제 기록이 아니에요.</p></Reveal>
      <Reveal delay={120} className="lx-dash"><MiniCharts p={example.p} obs={[]} sel={60} maxDay={200} /></Reveal>
    </section>}

    {ship.ok && <section className="lx-sec lx-split" id="ship">
      <Reveal className="lx-copy"><p className="lx-kick">출하 조건 비교</p><h2>지금 팔까,<br />30일 더 저장할까</h2>
        <p>지금 물량·가격과 30일 뒤 물량·저장비를 넣으면, 30일 뒤 kg당 얼마에 팔아야 같은 수입이 되는지 계산해요. 시세는 예측하지 않고 넣은 값으로만 계산해요.</p></Reveal>
      <Reveal delay={120} className="lx-ship"><p className="lx-ship-in">예시 · 1,000kg × 3,000원 · 30일 뒤 980kg · 저장비 12만 원</p>
        <div className="lx-ship-row"><span>30일 뒤 기준 가격</span><b><Count to={ship.breakEven} />원/kg</b></div>
        {ship.diff !== null && <div className="lx-ship-row up"><span>30일 뒤 3,300원에 팔면</span><b>{ship.diff.toLocaleString('ko-KR')}원 유리</b></div>}
      </Reveal>
    </section>}

    <section className="lx-sec" id="trust"><Reveal><p className="lx-kick">숨기지 않아요</p><h2>근거와 한계를 같이 보여 줘요</h2></Reveal>
      <div className="lx-trust">
        <Reveal className="lx-card"><b>계산 근거 공개</b><p>홍로 저장식은 유진기 외(2018) 홍로 저장 실험을 바탕으로 한 팀 근사식이에요. 산지별 회귀식의 결정계수(R²)도 함께 보여 줘요.</p><a href="https://doi.org/10.11002/kjfp.2018.25.7.779" target="_blank" rel="noreferrer">논문 보기 (DOI)</a></Reveal>
        <Reveal delay={100} className="lx-card"><b>실측이 먼저</b><p>직접 잰 값이 있으면 날씨 추정보다 그 값을 우선해 이어서 계산해요. 재는 날이 늘수록 계산이 실제에 가까워져요.</p></Reveal>
        <Reveal delay={200} className="lx-card"><b>판정은 하지 않아요</b><p>정확도 검증 전 시연용 계산이에요. 출하 시점이나 안전한 보관 기간을 판정하지 않아요.</p></Reveal>
      </div>
    </section>

    <section className="lx-cta"><Reveal><h2>내 저장고 사과, 지금 기록해 보세요</h2><p>가입하지 않고 체험부터 해도 돼요.</p>
      <div className="lx-cta-btns"><button type="button" className="hs-btn" onClick={onStart}>로그인 · 가입하기</button><a className="lx-ghost" href="/try">로그인 없이 체험하기</a></div></Reveal></section>
  </div>;
}
