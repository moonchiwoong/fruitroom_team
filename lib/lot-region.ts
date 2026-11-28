// 사과(로트)의 생산지 이름. 홍로는 details.hongro.region, 후지는 details.fuji_weather.region 에 저장됩니다.
import {isHongroRegionKey, isRegionKey, regionLabel, type RegionKey} from '@/lib/regions';
import type {Lot} from '@/lib/lot-types';

export function lotRegionId(lot: Pick<Lot, 'details'>): RegionKey | null {
  const d = lot.details;
  const saved = isRegionKey(d?.region) ? d.region : null;
  const hongro = d?.hongro;
  if (hongro?.source === 'weather') return isHongroRegionKey(hongro.region) ? hongro.region : null;
  if (hongro?.source === 'measured') {
    if (d?.region === null || d?.region_confirmed) return saved;
    // 예전 홍로 실측 기록에는 산지를 선택하지 않아도 거창이 저장됐습니다.
    if (isHongroRegionKey(hongro.region) && hongro.region !== 'geochang') return hongro.region;
    return saved === 'geochang' ? null : saved;
  }
  return isRegionKey(d?.fuji_weather?.region) ? d.fuji_weather.region : saved;
}
export const lotRegionLabel = (lot: Pick<Lot, 'details'>) => regionLabel(lotRegionId(lot));
