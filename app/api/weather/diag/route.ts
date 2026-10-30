// 임시 진단용: 농업기상 API 응답 형태(필드 이름·지점 코드)를 확인하기 위한 경로입니다. 미리보기 사이트에서만 동작하며 확인 후 삭제합니다.
// 인증키는 응답에 포함하지 않습니다.
export const dynamic = 'force-dynamic';

const BASE = 'https://apis.data.go.kr/1390802/AgriWeather/WeatherObsrInfo';
const V4 = `${BASE}/V4/InsttWeather`;
const P = {Page_No: '1', Page_Size: '2', date: '2026-04-01', search_Year: '2026', search_Month: '04', obsr_Spot_Nm: '거창'};
const candidates: [string, string, Record<string, string>][] = [
  ['v4-base', `${V4}`, P],
  ['v4-getWeatherTenMinList', `${V4}/getWeatherTenMinList`, P],
  ['v4-getWeatherTenMinList4', `${V4}/getWeatherTenMinList4`, P],
  ['v4-getWeatherTimeList', `${V4}/getWeatherTimeList`, P],
  ['v4-getWeatherTimeList4', `${V4}/getWeatherTimeList4`, P],
  ['v4-getWeatherDayList', `${V4}/getWeatherDayList`, P],
  ['v4-getWeatherDayList4', `${V4}/getWeatherDayList4`, P],
  ['v4-getWeatherMonDayList', `${V4}/getWeatherMonDayList`, P],
  ['v4-getWeatherMonDayList4', `${V4}/getWeatherMonDayList4`, P],
  ['v4-getWeatherList', `${V4}/getWeatherList`, P],
  ['v4-getWeatherList4', `${V4}/getWeatherList4`, P],
  ['v4-getInsttWeatherList', `${V4}/getInsttWeatherList`, P],
  ['v4-getWeatherTenMinList3', `${V4}/getWeatherTenMinList3`, P],
];

export async function GET(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  if (!host.startsWith('deploy-preview-') && process.env.CONTEXT !== 'deploy-preview') return Response.json({error: 'not available'}, {status: 404});
  const key = process.env.RDA_SERVICE_KEY;
  if (!key) return Response.json({key: false});
  const scrub = (t: string) => [key, encodeURIComponent(key)].reduce((s, k) => s.split(k).join('[KEY]'), t);
  const out: Record<string, unknown> = {key: true};
  for (const [name, url, params] of candidates) {
    const q = new URLSearchParams({serviceKey: key, ...params});
    try {
      const r = await fetch(`${url}?${q}`, {signal: AbortSignal.timeout(10000), cache: 'no-store'});
      const text = await r.text();
      out[name] = {status: r.status, body: scrub(text).slice(0, 700)};
    } catch (e) {
      out[name] = {error: e instanceof Error ? e.name + ': ' + e.message : 'fetch failed'};
    }
  }
  return Response.json(out, {headers: {'cache-control': 'no-store'}});
}
