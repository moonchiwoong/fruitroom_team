// 홍로 초기 품질 식의 날씨 변수를 농촌진흥청 농업기상 관측 일자료로 계산합니다.
// 정의(회귀식 작성자 확인, 2026-10-30):
//  - 관측소: 농업날씨365(weather.rda.go.kr) 거창군 거창읍
//  - chang_min4: 4/1~4/30 일최저기온의 평균
//  - chang_LC56: 5/1~6/30 날마다 (일평균기온 − 5℃)의 합. 5℃ 미만인 날도 음수 그대로 더함
//  - chang_LC78: 7/1~8/31, LC56과 같은 방식
//  - chang_9rain: 9/1~9/30 강수량 합계
// 빠진 날이 있으면 값을 채우거나 추정하지 않고 계산하지 않습니다.

export const RDA_DAILY_URL = 'https://apis.data.go.kr/1390802/AgriWeather/WeatherObsrInfo/V4/InsttWeather/getWeatherMonDayList4';
export const GEOCHANG_EUP = {code: '670807A001', name: '거창군 거창읍'} as const;
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
export function parseDailyXml(xml: string, spotCode: string = GEOCHANG_EUP.code): {rows: DailyObs[]; total: number} {
  const code = tag(xml, 'result_Code') ?? tag(xml, 'returnReasonCode');
  if (code !== '200') throw new RdaError(tag(xml, 'result_Msg') ?? tag(xml, 'returnAuthMsg') ?? '농업기상 자료를 받지 못했어요.', code ?? undefined);
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const rows: DailyObs[] = [];
  for (const it of items) {
    if (tag(it, 'obsr_Spot_Cd') !== spotCode) continue;
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
export function computeHongroWeather(year: number, rows: DailyObs[], today?: string): WeatherVar[] {
  const byDate = new Map(rows.map(r => [r.date, r]));
  const spec: [WeatherKey, number, number, (r: DailyObs) => number | null, (vals: number[]) => number][] = [
    ['chang_min4', 4, 4, r => r.min, v => v.reduce((a, b) => a + b, 0) / v.length],
    ['chang_LC56', 5, 6, r => r.mean === null ? null : r.mean - GDD_BASE, v => v.reduce((a, b) => a + b, 0)],
    ['chang_LC78', 7, 8, r => r.mean === null ? null : r.mean - GDD_BASE, v => v.reduce((a, b) => a + b, 0)],
    ['chang_9rain', 9, 9, r => r.rain, v => v.reduce((a, b) => a + b, 0)],
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
