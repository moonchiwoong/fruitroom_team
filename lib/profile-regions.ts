import type {RegionId} from './initial-quality';
// 가입·내 정보의 ‘주 산지’ 선택지. 산지마다 회귀식이 있는 품종을 함께 적습니다(2026-11-22 충주·군위·포천·화성·장수 홍로 추가).
export type ProfileRegion = RegionId | 'geochang';
export const PROFILE_REGIONS: {id: ProfileRegion; name: string; area: string}[] = [
  {id: 'geochang', name: '거창', area: '경남 거창군 · 홍로'},
  {id: 'cheongsong', name: '청송', area: '경북 청송군 · 후지'},
  {id: 'jangsu', name: '장수', area: '전북 장수군 · 후지·홍로'},
  {id: 'yeongju', name: '영주', area: '경북 영주시 · 후지'},
  {id: 'chungju', name: '충주', area: '충북 충주시 · 후지·홍로'},
  {id: 'gunwi', name: '군위', area: '대구 군위군 · 후지·홍로'},
  {id: 'pocheon', name: '포천', area: '경기 포천시 · 후지·홍로'},
  {id: 'hwaseong', name: '화성', area: '경기 화성시 · 후지·홍로'},
];
