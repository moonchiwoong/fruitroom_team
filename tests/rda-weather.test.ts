import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDailyXml, computeHongroWeather, GEOCHANG_EUP, type DailyObs} from '../lib/rda-weather';

const item = (code: string, date: string, mean: string, min: string, rn: string) => `<item><obsr_Spot_Cd>${code}</obsr_Spot_Cd><obsr_Spot_Nm>x</obsr_Spot_Nm><date_Time>${date}</date_Time><tmprt_150>${mean}</tmprt_150><tmprt_150Top>1</tmprt_150Top><tmprt_150Lwet>${min}</tmprt_150Lwet><rn>${rn}</rn></item>`;

test('XML 파싱: 지정 관측소 행만, 빈 값은 null', () => {
  const xml = `<response><header><result_Code>200</result_Code><result_Msg>정상</result_Msg></header><body><total_Count>2</total_Count><items>${item(GEOCHANG_EUP.code, '2026-04-01', '12.7', '9.2', '0.5')}${item('OTHER', '2026-04-01', '1', '1', '1')}${item(GEOCHANG_EUP.code, '2026-04-02', '', '-', '0.0')}</items></body></response>`;
  const {rows} = parseDailyXml(xml);
  assert.deepEqual(rows, [{date: '2026-04-01', mean: 12.7, min: 9.2, rain: 0.5}, {date: '2026-04-02', mean: null, min: null, rain: 0}]);
});

test('XML 오류 응답은 예외', () => {
  assert.throws(() => parseDailyXml('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'), /등록되지 않은 서비스키/);
});

function fullYear(y: number, f: (d: string) => DailyObs) {
  const out: DailyObs[] = [];
  for (let m = 4; m <= 9; m++) { const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); for (let d = 1; d <= n; d++) out.push(f(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)); }
  return out;
}

test('정의대로 계산: 최저 평균, (평균−5) 합(음수 포함), 9월 강수 합', () => {
  const rows = fullYear(2025, d => ({date: d, mean: d.startsWith('2025-05-01') ? 3 : 20, min: 6, rain: d.startsWith('2025-09') ? 2 : 0}));
  const v = Object.fromEntries(computeHongroWeather(2025, rows, '2026-10-30').map(x => [x.key, x.value]));
  assert.equal(v.chang_min4, 6);
  assert.equal(v.chang_LC56, 60 * 15 + (3 - 5)); // 5/1은 −2로 더함
  assert.equal(v.chang_LC78, 62 * 15);
  assert.equal(v.chang_9rain, 60);
});

test('빠진 날이 있으면 채우지 않고 계산하지 않음', () => {
  const rows = fullYear(2025, d => ({date: d, mean: 20, min: 6, rain: 1})).filter(r => r.date !== '2025-07-15');
  const lc78 = computeHongroWeather(2025, rows, '2026-10-30').find(x => x.key === 'chang_LC78')!;
  assert.equal(lc78.value, null);
  assert.deepEqual(lc78.missing, ['2025-07-15']);
});

test('9월이 끝나기 전에는 9월 강수량을 계산하지 않음', () => {
  const rows = fullYear(2026, d => ({date: d, mean: 20, min: 6, rain: 1})).filter(r => r.date <= '2026-09-12');
  const r = computeHongroWeather(2026, rows, '2026-09-13').find(x => x.key === 'chang_9rain')!;
  assert.equal(r.value, null);
  assert.match(r.reason!, /09\/30까지/);
});
