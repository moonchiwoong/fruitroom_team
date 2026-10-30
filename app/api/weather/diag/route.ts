// 임시 진단용: 농업기상 API 응답 형태(필드 이름·지점 코드)를 확인하기 위한 경로입니다. 미리보기 사이트에서만 동작하며 확인 후 삭제합니다.
// 인증키는 응답에 포함하지 않습니다.
export const dynamic = 'force-dynamic';

const BASE = 'https://apis.data.go.kr/1390802/AgriWeather/WeatherObsrInfo';
const V4 = `${BASE}/V4/InsttWeather`;
const candidates: [string, string, Record<string, string>][] = [
  ['day-geochang-eup-2026-04', `${V4}/getWeatherMonDayList4`, {Page_No: '1', Page_Size: '1', search_Year: '2026', search_Month: '04', obsr_Spot_Cd: '670807A001'}],
  ['day-name-geochang-eup-2025-09', `${V4}/getWeatherMonDayList4`, {Page_No: '1', Page_Size: '1', search_Year: '2025', search_Month: '09', obsr_Spot_Nm: '거창군 거창읍'}],
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
      out[name] = {status: r.status, body: scrub(text).slice(0, 6000)};
    } catch (e) {
      out[name] = {error: e instanceof Error ? e.name + ': ' + e.message : 'fetch failed'};
    }
  }
  return Response.json(out, {headers: {'cache-control': 'no-store'}});
}
