import type {RegionId} from './initial-quality';
// 가입·내 정보의 ‘주 산지’ 선택지. 거창은 홍로 식, 청송·장수·영주는 후지 식 산지입니다.
export type ProfileRegion = RegionId | 'geochang';
export const PROFILE_REGIONS: {id: ProfileRegion; name: string; area: string}[] = [
  {id: 'geochang', name: '거창', area: '경남 거창군 · 홍로'},
  {id: 'cheongsong', name: '청송', area: '경북 청송군 · 후지'},
  {id: 'jangsu', name: '장수', area: '전북 장수군 · 후지'},
  {id: 'yeongju', name: '영주', area: '경북 영주시 · 후지'},
];
