import {REGION_KEYS, REGIONS, regionCultivars, type RegionKey} from './regions';
// 가입·내 정보의 ‘주 산지’ 선택지. 산지마다 회귀식이 있는 품종을 함께 적습니다(산지 목록은 lib/regions.ts).
export type ProfileRegion = RegionKey;
export const PROFILE_REGIONS: {id: ProfileRegion; name: string; area: string}[] = REGION_KEYS.map(id => ({id, name: REGIONS[id].label, area: `${REGIONS[id].area} · ${regionCultivars(id).join('·')}`}));
