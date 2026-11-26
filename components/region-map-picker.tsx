'use client';
// 새 사과 ‘지역으로 시작’: 남한 지도에서 산지를 고릅니다. 고르면 그 산지 쪽으로 살짝 확대됩니다.
// 지도 도형: @svg-maps/south-korea (CC BY 4.0, https://github.com/VictorCazanave/svg-maps)
// 점 위치는 시·군청 위경도를 이 지도 좌표에 맞춘 대략적인 위치입니다(관측지점 위치가 아님).
import {useEffect, useRef, useState} from 'react';
import southKoreaRaw from '@svg-maps/south-korea';
import {WEATHER_STATIONS} from '@/lib/rda-weather';
import {REGION_KEYS, REGIONS, regionCultivars, type RegionKey} from '@/lib/regions';

const southKorea = southKoreaRaw as unknown as {viewBox: string; locations: {id: string; name: string; path: string}[]};
export type MapRegion = RegionKey;
export const MAP_PINS = Object.fromEntries(REGION_KEYS.map(k => [k, {...REGIONS[k].map, cultivars: regionCultivars(k)}])) as Record<MapRegion, {x: number; y: number; cultivars: ('후지' | '홍로')[]; left?: boolean}>;
const FULL = [0, 40, 524, 520];

export const MAP_CREDIT = '지도: svg-maps (CC BY 4.0) · 점은 대략적인 위치';

export default function RegionMapPicker({value, onPick, credit = true}: {value: MapRegion | ''; onPick: (r: MapRegion) => void; credit?: boolean}) {
  const target = value ? [MAP_PINS[value].x - 150, MAP_PINS[value].y - 130, 300, 260] : FULL;
  const [box, setBox] = useState<number[]>(target), cur = useRef<number[]>(target);
  useEffect(() => {
    const from = cur.current, to = target;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { cur.current = to; setBox(to); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 450), e = 1 - (1 - k) ** 3; const b = from.map((v, i) => v + (to[i] - v) * e); cur.current = b; setBox(b); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = box[2] / 524;
  return <div className="rmp">
    <svg viewBox={box.map(v => v.toFixed(1)).join(' ')} role="group" aria-label="산지 지도">
      {southKorea.locations.map(l => <path key={l.id} d={l.path} className="rmp-prov" />)}
      {(Object.keys(MAP_PINS) as MapRegion[]).map(r => { const p = MAP_PINS[r], on = value === r;
        return <g key={r} className={'rmp-pin' + (on ? ' on' : '')} role="button" tabIndex={0} aria-pressed={on} aria-label={`${WEATHER_STATIONS[r].label} (${p.cultivars.join('·')})`}
          onClick={() => onPick(r)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r); } }}>
          <circle cx={p.x} cy={p.y} r={30 * s} className="rmp-hit" />
          <circle cx={p.x} cy={p.y} r={(on ? 12 : 9) * s} strokeWidth={3.5 * s} className="rmp-dot" />
          <text x={p.left ? p.x - 14 * s : p.x + 14 * s} y={p.y + 7 * s} fontSize={20 * s} textAnchor={p.left ? 'end' : 'start'}>{WEATHER_STATIONS[r].label}</text>
        </g>; })}
    </svg>
    <div className="rmp-chips">{(Object.keys(MAP_PINS) as MapRegion[]).map(r => <button key={r} type="button" className={value === r ? 'on' : ''} aria-pressed={value === r} onClick={() => onPick(r)}>{WEATHER_STATIONS[r].label}<small>{MAP_PINS[r].cultivars.join('·')}</small></button>)}</div>
    {credit && <p className="rmp-credit">{MAP_CREDIT}</p>}
  </div>;
}
