// 산지 정보는 이 파일 한 곳에만 적습니다. 다른 파일은 모두 여기서 가져다 씁니다.
//
// 새 산지를 추가하는 방법
//  1) REGION_KEYS 에 영문 키를 넣습니다(저장 기록에 그대로 남으므로 한번 정하면 바꾸지 않습니다).
//  2) REGIONS 에 한 덩어리를 넣습니다. 관측지점·기간은 회귀식 작성자가 확인한 값만 씁니다.
//  3) 회귀식이 있는 품종의 목록(FUJI_REGION_KEYS / HONGRO_REGION_KEYS)에 키를 넣습니다.
//  4) 회귀식 계수를 넣습니다: 후지는 lib/initial-quality.ts 의 regions, 홍로는 lib/hongro.ts 의 HONGRO_REGRESSIONS.
//     계수는 원본 엑셀과 대조하는 테스트(tests/fixtures)를 함께 추가합니다.
//  tests/regions.test.ts 가 위 네 곳이 서로 맞는지 확인합니다. 하나라도 빠지면 테스트가 실패합니다.
//
// 이 파일은 다른 파일을 가져오지 않습니다(어디서 가져다 써도 순환 참조가 생기지 않게).

export const REGION_KEYS = ['geochang', 'cheongsong', 'jangsu', 'yeongju', 'chungju', 'gunwi', 'pocheon', 'hwaseong'] as const;
export type RegionKey = typeof REGION_KEYS[number];

/** 후지 회귀식이 있는 산지(화면에 보이는 순서). */
export const FUJI_REGION_KEYS = ['cheongsong', 'jangsu', 'yeongju', 'chungju', 'gunwi', 'pocheon', 'hwaseong'] as const;
/** 홍로 회귀식이 있는 산지(화면에 보이는 순서). */
export const HONGRO_REGION_KEYS = ['geochang', 'chungju', 'gunwi', 'pocheon', 'hwaseong', 'jangsu'] as const;
export type FujiRegionKey = typeof FUJI_REGION_KEYS[number];
export type HongroRegionKey = typeof HONGRO_REGION_KEYS[number];

export type RegionDef = {
  /** 화면에 쓰는 짧은 이름 */
  label: string;
  /** 시·군 */
  area: string;
  /** 회귀식을 만들 때 쓴 농업날씨365 관측지점 이름(작성자 확인: 기존 2026-10-31, 충주·군위·포천·화성 2026-11-22) */
  station: string;
  /** 관측지점 코드(확인된 곳만) */
  stationCode: string | null;
  /** 최저기온 평균 기간의 끝 달: 4 = 4월만, 5 = 4~5월 */
  minTo: 4 | 5;
  /** 강수 변수의 달 */
  rainMonth: 8 | 9;
  /** 새 사과 지도 위 점 위치(@svg-maps/south-korea 좌표, 시·군청 위경도를 맞춘 대략 위치). left: 이름표를 왼쪽에 */
  map: {x: number; y: number; left?: boolean};
};

export const REGIONS: Record<RegionKey, RegionDef> = {
  geochang: {label: '거창', area: '경남 거창군', station: '거창군 거창읍', stationCode: '670807A001', minTo: 4, rainMonth: 9, map: {x: 237, y: 348}},
  cheongsong: {label: '청송', area: '경북 청송군', station: '청송군 청송읍', stationCode: null, minTo: 4, rainMonth: 9, map: {x: 342, y: 263}},
  jangsu: {label: '장수', area: '전북 장수군', station: '장수군 장수읍', stationCode: null, minTo: 4, rainMonth: 9, map: {x: 202, y: 352, left: true}},
  yeongju: {label: '영주', area: '경북 영주시', station: '영주시 봉현면', stationCode: null, minTo: 4, rainMonth: 9, map: {x: 302, y: 219}},
  chungju: {label: '충주', area: '충북 충주시', station: '충주시 안림동', stationCode: null, minTo: 5, rainMonth: 8, map: {x: 238.5, y: 197}},
  gunwi: {label: '군위', area: '대구 군위군', station: '군위군 소보면', stationCode: null, minTo: 5, rainMonth: 8, map: {x: 297.5, y: 284.5}},
  pocheon: {label: '포천', area: '경기 포천시', station: '포천시 영북면', stationCode: null, minTo: 4, rainMonth: 8, map: {x: 172, y: 91}},
  hwaseong: {label: '화성', area: '경기 화성시', station: '화성시 마도면', stationCode: null, minTo: 4, rainMonth: 8, map: {x: 138.5, y: 171, left: true}},
};

export const isRegionKey = (v: unknown): v is RegionKey => typeof v === 'string' && (REGION_KEYS as readonly string[]).includes(v);
export const isFujiRegionKey = (v: unknown): v is FujiRegionKey => typeof v === 'string' && (FUJI_REGION_KEYS as readonly string[]).includes(v);
export const isHongroRegionKey = (v: unknown): v is HongroRegionKey => typeof v === 'string' && (HONGRO_REGION_KEYS as readonly string[]).includes(v);

/** 그 산지에 회귀식이 있는 품종(화면 표시용). */
export function regionCultivars(k: RegionKey): ('후지' | '홍로')[] {
  return [...(isFujiRegionKey(k) ? ['후지' as const] : []), ...(isHongroRegionKey(k) ? ['홍로' as const] : [])];
}
export const regionLabel = (k: string | null | undefined) => (isRegionKey(k) ? REGIONS[k].label : null);
