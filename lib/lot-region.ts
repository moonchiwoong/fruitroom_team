// 사과(로트)의 생산지 이름. 홍로는 details.hongro.region, 후지는 details.fuji_weather.region 에 저장됩니다.
import {WEATHER_STATIONS, type WeatherRegion} from '@/lib/rda-weather';
import type {Lot} from '@/lib/lot-types';

export function lotRegionId(lot: Pick<Lot, 'details'>): WeatherRegion | null {
  const d = lot.details;
  const id = d?.hongro?.source === 'weather' ? d.hongro.region ?? 'geochang' : d?.fuji_weather?.region ?? d?.region ?? null;
  return id && id in WEATHER_STATIONS ? id as WeatherRegion : null;
}
export const lotRegionLabel = (lot: Pick<Lot, 'details'>) => { const id = lotRegionId(lot); return id ? WEATHER_STATIONS[id].label : null; };
