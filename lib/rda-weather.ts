// 홍로 초기 품질 식의 날씨 변수를 농촌진흥청 농업기상 관측 일자료로 계산합니다.
// 정의(회귀식 작성자 확인, 2026-10-30):
//  - 관측소: 농업날씨365(weather.rda.go.kr) 지역별 지점(WEATHER_STATIONS)
//  - chang_min4: 4/1~4/30 일최저기온의 평균. 충주·군위 회귀식은 4/1~5/31 평균(작성자 확인, 2026-11-22)
//  - chang_LC56: 5/1~6/30 날마다 (일평균기온 − 5℃)의 합. 5℃ 미만인 날도 음수 그대로 더함
//  - chang_LC78: 7/1~8/31, LC56과 같은 방식
//  - chang_9rain: 그 지역 회귀식의 강수 변수. 거창·청송·장수·영주는 9월, 충주·군위·포천·화성은 8월 강수량 합계
//    (키 이름은 기존 저장 기록과 맞추려고 그대로 둡니다. 몇 월인지는 WEATHER_STATIONS[지역].rainMonth)
//  - 생장도일 기준 5℃: 농업날씨365 생장도일(일반작물 5℃)과 같은 기준(작성자 확인, 2026-11-22)
// 빠진 날이 있으면 값을 채우거나 추정하지 않고 계산하지 않습니다.

import {REGION_KEYS, REGIONS, regionCultivars, type RegionKey} from './regions';

export const RDA_DAILY_URL = 'https://apis.data.go.kr/1390802/AgriWeather/WeatherObsrInfo/V4/InsttWeather/getWeatherMonDayList4';
export const GEOCHANG_EUP = {code: '670807A001', name: '거창군 거창읍'} as const;
/** 지역별 회귀식을 만들 때 쓴 농업날씨365 관측소(작성자 확인: 기존 2026-10-31, 충주·군위·포천·화성 2026-11-22).
 *  minTo: 최저기온 평균 기간의 끝 달(4=4월만, 5=4~5월). rainMonth: 강수 변수의 달. 홍로·후지는 같은 지역이면 같은 지점. */
export const WEATHER_STATIONS = Object.fromEntries(REGION_KEYS.map(k => {
  const r = REGIONS[k];
  return [k, {name: r.station, code: r.stationCode, label: r.label, cultivar: regionCultivars(k).join('·'), minTo: r.minTo, rainMonth: r.rainMonth}];
})) as Record<RegionKey, {name: string; code: string | null; label: string; cultivar: string; minTo: 4 | 5; rainMonth: 8 | 9}>;
/** 화면에 보여 줄 날씨 변수 이름(지역마다 기간이 다릅니다). */
export function weatherLabels(region: keyof typeof WEATHER_STATIONS) {
  const s = WEATHER_STATIONS[region];
  return {chang_min4: s.minTo === 5 ? '4~5월 일최저기온 평균' : '4월 일최저기온 평균', chang_LC56: '5~6월 누적 생장도일', chang_LC78: '7~8월 누적 생장도일', chang_9rain: `${s.rainMonth}월 누적 강수량`};
}
export type WeatherRegion = RegionKey;
export const GDD_BASE = 5;

export type DailyObs = {date: string; mean: number | null; min: number | null; rain: number | null};
export type WeatherKey = 'chang_min4' | 'chang_LC56' | 'chang_LC78' | 'chang_9rain';
export type WeatherVar = {key: WeatherKey; value: number | null; period: [string, string]; days: number; expectedDays: number; missing: string[]; reason?: string};

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
};
const toNum = (s: string | null) => {
  if (s === null || s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export class RdaError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

/** getWeatherMonDayList4 XML 응답을 일자료로 바꿉니다. 지정한 관측소 코드가 아닌 행은 버립니다. */
export function parseDailyXml(xml: string, spot: string | {code?: string | null; name?: string} = GEOCHANG_EUP.code): {rows: DailyObs[]; total: number} {
  const match = typeof spot === 'string' ? {code: spot} : spot;
  const code = tag(xml, 'result_Code') ?? tag(xml, 'returnReasonCode');
  if (code !== '200') throw new RdaError(tag(xml, 'result_Msg') ?? tag(xml, 'returnAuthMsg') ?? '농업기상 자료를 받지 못했어요.', code ?? undefined);
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const rows: DailyObs[] = [];
  for (const it of items) {
    if (match.code ? tag(it, 'obsr_Spot_Cd') !== match.code : tag(it, 'obsr_Spot_Nm') !== match.name) continue;
    const date = tag(it, 'date_Time') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    rows.push({date, mean: toNum(tag(it, 'tmprt_150')), min: toNum(tag(it, 'tmprt_150Lwet')), rain: toNum(tag(it, 'rn'))});
  }
  return {rows, total: Number(tag(xml, 'total_Count') ?? rows.length) || rows.length};
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function datesBetween(y: number, m1: number, m2: number) {
  const out: string[] = [];
  for (let m = m1; m <= m2; m++) for (let d = 1; d <= daysIn(y, m); d++) out.push(`${y}-${pad(m)}-${pad(d)}`);
  return out;
}

/** 4~9월 일자료로 네 변수를 계산합니다. 필요한 날의 값이 하나라도 없으면 그 변수는 null입니다. */
export function computeHongroWeather(year: number, rows: DailyObs[], today?: string, opt: {minTo: number; rainMonth: number} = {minTo: 4, rainMonth: 9}): WeatherVar[] {
  const byDate = new Map(rows.map(r => [r.date, r]));
  const spec: [WeatherKey, number, number, (r: DailyObs) => number | null, (vals: number[]) => number][] = [
    ['chang_min4', 4, opt.minTo, r => r.min, v => v.reduce((a, b) => a + b, 0) / v.length],
    ['chang_LC56', 5, 6, r => r.mean === null ? null : r.mean - GDD_BASE, v => v.reduce((a, b) => a + b, 0)],
    ['chang_LC78', 7, 8, r => r.mean === null ? null : r.mean - GDD_BASE, v => v.reduce((a, b) => a + b, 0)],
    ['chang_9rain', opt.rainMonth, opt.rainMonth, r => r.rain, v => v.reduce((a, b) => a + b, 0)],
  ];
  return spec.map(([key, m1, m2, pick, agg]) => {
    const dates = datesBetween(year, m1, m2);
    const period: [string, string] = [dates[0], dates[dates.length - 1]];
    const vals: number[] = [], missing: string[] = [];
    for (const d of dates) { const r = byDate.get(d); const v = r ? pick(r) : null; if (v === null) missing.push(d); else vals.push(v); }
    const base = {key, period, days: vals.length, expectedDays: dates.length, missing};
    if (today && period[1] >= today) return {...base, value: null, reason: `${period[1].slice(5).replace('-', '/')}까지의 관측이 끝나야 계산할 수 있어요. 지금까지 ${vals.length}일치가 있어요.`};
    if (missing.length) return {...base, value: null, reason: `관측값이 빠진 날이 ${missing.length}일 있어 계산하지 않아요 (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' 등' : ''}).`};
    return {...base, value: Math.round(agg(vals) * 100) / 100};
  });
}
