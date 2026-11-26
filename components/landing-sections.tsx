'use client';
// 로그인 전 첫 화면 아래의 소개 구역. 숫자는 모두 사이트 코드에 실제로 있는 값(산지 수·계산 범위)이나
// 예시 데이터로 기존 식을 돌린 결과입니다. 지어낸 통계·후기는 넣지 않습니다.
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {exampleForm, payloadFromForm} from '@/lib/tracker-form';
import {lotPredictor} from '@/lib/lot-predict';
import type {Lot} from '@/lib/lot-types';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import MiniCharts from '@/components/mini-charts';
import RegionMapPicker, {MAP_PINS, type MapRegion} from '@/components/region-map-picker';

/** 화면에 들어오면 아래에서 떠오르게(움직임 줄이기 설정이면 바로 보임). */
function Reveal({children, className = '', delay = 0}: {children: ReactNode; className?: string; delay?: number}) {
  const ref = useRef<HTMLDivElement>(null), [on, setOn] = useState(false);
  useEffect(() => onEnter(ref.current, 0.92, () => setOn(true)), []);
  return <div ref={ref} className={`lx-rev ${on ? 'in' : ''} ${className}`} style={{transitionDelay: `${delay}ms`}}>{children}</div>;
}

/** 요소 윗변이 화면 높이의 k 지점보다 위로 오면 한 번 실행. 글자 크게(zoom)에서도 맞도록 IntersectionObserver 대신 스크롤로 확인. */
function onEnter(el: HTMLElement | null, k: number, fn: () => void) {
  if (!el) return;
  let raf = 0, done = false;
  const check = () => { raf = 0; if (done) return; const r = el.getBoundingClientRect(); if (r.top < innerHeight * k && r.bottom > 0) { done = true; off(); fn(); } };
  const on = () => { if (!raf) raf = requestAnimationFrame(check); };
  const off = () => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); };
  addEventListener('scroll', on, {passive: true}); addEventListener('resize', on); check();
  return off;
}

/** 제목을 한 글자씩 떠오르게(부모 .lx-rev 가 .in 이 될 때). 줄은 배열로 나눔. */
function Chars({lines}: {lines: string[]}) {
  let i = 0;
  return <span className="lx-chars" aria-label={lines.join(' ')}>{lines.map((l, li) => <span key={li} aria-hidden="true">{li > 0 && <br />}{[...l].map((c, ci) => <span key={ci} className="ch" style={{['--i' as string]: i++}}>{c === ' ' ? '\u00A0' : c}</span>)}</span>)}</span>;
}

/** 스크롤하면 사과가 커지다가 연한 분홍 배경으로 바뀌는 구간. */
function AppleZoom() {
  const ref = useRef<HTMLDivElement>(null), [done, setDone] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.style.setProperty('--p', '1'); setDone(true); return; }
    let raf = 0;
    const upd = () => { raf = 0; const r = el.getBoundingClientRect(), span = r.height - innerHeight; const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1; el.style.setProperty('--p', p.toFixed(3)); setDone(p > 0.62); };
    const on = () => { if (!raf) raf = requestAnimationFrame(upd); };
    upd(); addEventListener('scroll', on, {passive: true}); addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  return <section ref={ref} className="lx-zoom" aria-label="소개">
    <div className="lx-zoom-pin">
      <div className="lx-zoom-bg" />
      <div className="lx-zoom-frame"><img className="lx-zoom-photo" src="/assets/photos/orchard-apple.webp" alt="파란 하늘 아래 빨간 사과가 달린 사과나무" /></div>
      <div className={`lx-zoom-msg lx-rev ${done ? 'in' : ''}`}><h2><Chars lines={['날씨가 다르면,', '사과도 달라요']} /></h2><p>산지마다 그 해 관측 날씨로 처음 품질을 추정해요.</p></div>
    </div>
  </section>;
}

/** 숫자가 0부터 올라감(화면에 들어올 때 한 번). */
function Count({to, suffix = ''}: {to: number; suffix?: string}) {
  const ref = useRef<HTMLSpanElement>(null), [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    return onEnter(ref.current, 0.85, () => { const t0 = performance.now(); const tick = (t: number) => { const k = Math.min(1, (t - t0) / 900); setN(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  }, [to]);
  return <span ref={ref}>{n.toLocaleString('ko-KR')}{suffix}</span>;
}

const STEPS = [
  {n: '1', t: '사과를 등록해요', d: '품종·산지·수확일과 저장 조건(후지는 저장 방식·1-MCP, 홍로는 저장고 온도)만 고르면 돼요. 잰 값이 없으면 그 해 농업기상 자료로 처음 품질을 추정해요.'},
  {n: '2', t: '저장 중 변화를 봐요', d: '단단함·단맛·신맛·무게 감소를 저장 일수별로 계산해 한 화면에 보여 줘요.'},
  {n: '3', t: '재면 더 정확해져요', d: '당도나 단단함을 재서 넣으면, 그 값부터 다시 이어서 계산해요.'},
];

export default function LandingSections({onStart}: {onStart: () => void}) {
  const example = useMemo(() => {
    try { const lot = {id: 'example', ...payloadFromForm(exampleForm(), 'real'), latest_observation: null} as unknown as Lot; return {p: lotPredictor(lot, []), lot}; } catch { return null; }
  }, []);
  const [region, setRegion] = useState<MapRegion | ''>('gunwi');
  const regionCount = Object.keys(MAP_PINS).length;
  return <div className="lx-outer"><AppleZoom /><div className="lx">
    <section className="lx-stats" aria-label="애플트랙 한눈에">
      {[{v: regionCount, s: '곳', l: '예측식이 있는 산지'}, {v: 2, s: '품종', l: '홍로 · 후지'}, {v: 120, s: '일', l: '홍로 계산 범위'}, {v: 300, s: '일', l: '후지 계산 범위'}].map((x, i) =>
        <Reveal key={x.l} delay={i * 80} className="lx-stat"><b><Count to={x.v} />{x.s}</b><span>{x.l}</span></Reveal>)}
    </section>

    <section className="lx-sec" id="how"><Reveal><p className="lx-kick">이렇게 써요</p><h2><Chars lines={['세 단계면 충분해요']} /></h2></Reveal>
      <div className="lx-steps">{STEPS.map((s, i) => <Reveal key={s.n} delay={i * 120} className="lx-step"><span className="lx-n">{s.n}</span><b>{s.t}</b><p>{s.d}</p></Reveal>)}</div>
    </section>

    <section className="lx-sec lx-split" id="regions">
      <Reveal className="lx-copy"><p className="lx-kick">산지 {regionCount}곳</p><h2><Chars lines={['내 산지를 누르면', '관측지점이 보여요']} /></h2>
        <p>농촌진흥청 농업기상 관측(농업날씨365) 일자료로 그 해 최저기온·생장도일·강수량을 계산해, 산지마다 만든 식에 넣어요.</p>
        {region && <dl className="lx-region"><div><dt>산지</dt><dd>{WEATHER_STATIONS[region].label}</dd></div><div><dt>관측지점</dt><dd>{WEATHER_STATIONS[region].name}</dd></div><div><dt>예측식</dt><dd>{MAP_PINS[region].cultivars.join(' · ')}</dd></div></dl>}
      </Reveal>
      <Reveal delay={120} className="lx-map"><RegionMapPicker value={region} onPick={setRegion} /></Reveal>
    </section>

    {example && <section className="lx-sec" id="dashboard"><Reveal><p className="lx-kick">한눈에 보는 대시보드</p><h2><Chars lines={['항목마다 자기 단위로,', '저장 일수별 변화']} /></h2>
      <p className="lx-sub">예시 데이터 · 후지</p></Reveal>
      <Reveal delay={120} className="lx-dash"><MiniCharts p={example.p} obs={[]} sel={60} maxDay={200} /></Reveal>
    </section>}

    <section className="lx-sec" id="trust"><Reveal><p className="lx-kick">숨기지 않아요</p><h2><Chars lines={['근거와 한계를', '같이 보여 줘요']} /></h2></Reveal>
      <div className="lx-trust">
        <Reveal className="lx-card"><b>계산 근거 공개</b><p>홍로 저장식은 유진기 외(2018) 홍로 저장 실험을 바탕으로 한 팀 근사식이에요. 산지별 회귀식의 결정계수(R²)도 함께 보여 줘요.</p><a href="https://doi.org/10.11002/kjfp.2018.25.7.779" target="_blank" rel="noreferrer">논문 보기 (DOI)</a></Reveal>
        <Reveal delay={100} className="lx-card"><b>실측이 먼저</b><p>직접 잰 값이 있으면 날씨 추정보다 그 값을 우선해 이어서 계산해요. 재는 날이 늘수록 계산이 실제에 가까워져요.</p></Reveal>
        <Reveal delay={200} className="lx-card"><b>판정은 하지 않아요</b><p>정확도 검증 전 시연용 계산이에요. 출하 시점이나 안전한 보관 기간을 판정하지 않아요.</p></Reveal>
      </div>
    </section>

    <section className="lx-cta"><Reveal><h2><Chars lines={['내 저장고 사과,', '지금 기록해 보세요']} /></h2><p>가입하지 않고 체험부터 해도 돼요.</p>
      <div className="lx-cta-btns"><button type="button" className="hs-btn" onClick={onStart}>로그인 · 가입하기</button><a className="lx-ghost" href="/try">로그인 없이 체험하기</a></div></Reveal></section>
  </div></div>;
}
