// 수확한 해의 거창읍 농업기상 일자료로 홍로 날씨 변수 4개를 계산해 돌려줍니다.
// 인증키는 서버 환경변수(RDA_SERVICE_KEY)에서만 읽으며 응답에 넣지 않습니다. 공개 관측자료만 다룹니다.
import {RDA_DAILY_URL, GEOCHANG_EUP, parseDailyXml, computeHongroWeather, RdaError, type DailyObs} from '@/lib/rda-weather';

export const dynamic = 'force-dynamic';

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export async function GET(req: Request) {
  const key = process.env.RDA_SERVICE_KEY;
  if (!key) return Response.json({error: '날씨 자동 조회가 아직 설정되지 않았어요. 날씨를 직접 골라 주세요.'}, {status: 503});
  const today = kstToday(), thisYear = Number(today.slice(0, 4));
  const year = Number(new URL(req.url).searchParams.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > thisYear) return Response.json({error: '조회할 연도를 확인해 주세요.'}, {status: 400});
  const scrub = (t: string) => [key, encodeURIComponent(key)].reduce((s, k) => s.split(k).join(''), t);
  const rows: DailyObs[] = [];
  try {
    for (let m = 4; m <= 9; m++) {
      if (year === thisYear && `${year}-${String(m).padStart(2, '0')}-01` > today) break;
      const q = new URLSearchParams({serviceKey: key, Page_No: '1', Page_Size: '31', search_Year: String(year), search_Month: String(m).padStart(2, '0'), obsr_Spot_Cd: GEOCHANG_EUP.code});
      const r = await fetch(`${RDA_DAILY_URL}?${q}`, {signal: AbortSignal.timeout(12000), next: {revalidate: year < thisYear ? 7 * 86400 : 3 * 3600}});
      rows.push(...parseDailyXml(await r.text()).rows);
    }
  } catch (e) {
    const msg = e instanceof RdaError ? `농업기상 자료를 받지 못했어요: ${scrub(e.message)}` : '농업기상 서버에 연결하지 못했어요. 잠시 뒤 다시 시도하거나 날씨를 직접 골라 주세요.';
    return Response.json({error: msg}, {status: 502});
  }
  const vars = computeHongroWeather(year, rows, today);
  return Response.json({
    year, station: GEOCHANG_EUP, source: '농촌진흥청 국립농업과학원 농업기상 관측(농업날씨365) 일자료', fetchedAt: new Date().toISOString(),
    variables: vars.map(v => ({key: v.key, value: v.value, period: v.period, days: v.days, expectedDays: v.expectedDays, reason: v.reason ?? null})),
  }, {headers: {'cache-control': 'private, max-age=600'}});
}
