// aT 전국 공영도매시장 정산정보(공공데이터 15141809, katSale/trades)에서 사과 등급별 정산가를 읽습니다.
// 실시간 경매정보에는 등급·크기가 없어서, 어제 이전 거래는 이 자료로 등급별 가격을 보여 줍니다.
import type {GradedAuctionGroup} from './apple-auction-types';
import {auctionOriginRegion} from './apple-auctions';
import type {RegionKey} from './regions';
import {isDate} from './tracker';
import {SETTLEMENT_MARKETS} from './settlement-markets';
export {SETTLEMENT_MARKETS};

const URL_BASE = 'https://apis.data.go.kr/B552845/katSale/trades';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;


export type SettlementRow = {
  date: string; marketCode: string; marketName: string; origin: string; variety: string;
  grade: string; size: string; packageName: string; unitWeightKg: number;
  boxes: number; amount: number; low: number; high: number;
};

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const label = (v: unknown) => { const s = str(v); return s === '.' || s === '-' ? '' : s; };
const num = (v: unknown) => { const s = str(v); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };

/** 원자료 한 줄 → 정산 행. 사과 경매 거래이고 물량·가격이 서로 맞는 줄만 씁니다. */
export function settlementRow(raw: Record<string, unknown>, date: string): SettlementRow | null {
  if (label(raw.gds_mclsf_nm) && label(raw.gds_mclsf_nm) !== '사과') return null;
  if (!/^(?:경매|0?1)$/.test(str(raw.trd_se))) return null;
  if (str(raw.trd_clcln_ymd) && str(raw.trd_clcln_ymd) !== date) return null;
  const unitQty = num(raw.unit_qty), totalQty = num(raw.unit_tot_qty), amount = num(raw.totprc);
  const low = num(raw.lwprc), high = num(raw.hgprc), unit = str(raw.unit_nm).toLowerCase();
  if (unit !== 'kg' || !unitQty || unitQty <= 0 || !totalQty || totalQty <= 0 || !amount || amount <= 0 || low === null || high === null || low <= 0 || high < low) return null;
  const boxes = totalQty / unitQty;
  // 원자료의 평균가(avgprc)는 상자 수 가중 평균이 아니어서 쓰지 않고, 총가격 ÷ 상자 수를 씁니다.
  // 그 값이 최저가~최고가 밖이면 단위가 섞인 줄로 보고 뺍니다.
  const perBox = amount / boxes;
  if (perBox < low - 1 || perBox > high + 1) return null;
  const marketName = label(raw.whsl_mrkt_nm), variety = label(raw.gds_sclsf_nm);
  if (!marketName || !variety) return null;
  return {date, marketCode: str(raw.whsl_mrkt_cd), marketName, origin: label(raw.plor_nm), variety,
    grade: label(raw.grd_nm), size: label(raw.sz_nm), packageName: label(raw.pkg_nm), unitWeightKg: unitQty,
    boxes, amount, low, high};
}

const GRADE_ORDER = ['특', '상', '중', '하', '보통', '등외'];
const gradeRank = (g: string) => { const i = GRADE_ORDER.indexOf(g); return i < 0 ? GRADE_ORDER.length : i; };

/** 산지에 맞는 정산 행을 시장·품종·포장·무게별로 묶고, 그 안에서 등급·크기별 날짜 값을 만듭니다(상자 수 가중 평균). */
export function groupGraded(rows: readonly SettlementRow[], region: RegionKey): GradedAuctionGroup[] {
  type Acc = {boxes: number; amount: number; low: number; high: number};
  const groups = new Map<string, {g: Omit<GradedAuctionGroup, 'grades'>; grades: Map<string, {grade: string; size: string; days: Map<string, Acc>}>}>();
  for (const r of rows) {
    if (auctionOriginRegion(r.origin) !== region) continue;
    const id = JSON.stringify([r.marketCode, r.variety, r.packageName, r.unitWeightKg]);
    let e = groups.get(id);
    if (!e) { e = {g: {id, marketCode: r.marketCode, marketName: r.marketName, variety: r.variety, packageName: r.packageName, unitWeightKg: r.unitWeightKg}, grades: new Map()}; groups.set(id, e); }
    const gk = JSON.stringify([r.grade, r.size]);
    let gr = e.grades.get(gk);
    if (!gr) { gr = {grade: r.grade, size: r.size, days: new Map()}; e.grades.set(gk, gr); }
    const d = gr.days.get(r.date) ?? {boxes: 0, amount: 0, low: Infinity, high: 0};
    d.boxes += r.boxes; d.amount += r.amount; d.low = Math.min(d.low, r.low); d.high = Math.max(d.high, r.high);
    gr.days.set(r.date, d);
  }
  return [...groups.values()].map(({g, grades}) => ({...g, grades: [...grades.values()]
    .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.size.localeCompare(b.size, 'ko'))
    .map(({grade, size, days}) => ({grade, size, days: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 5)
      .map(([date, d]) => ({date, averagePrice: Math.round(d.amount / d.boxes), lowPrice: d.low, highPrice: d.high,
        boxes: Math.round(d.boxes * 100) / 100, totalWeightKg: Math.round(d.boxes * g.unitWeightKg * 1000) / 1000}))}))}))
    .sort((a, b) => a.marketName.localeCompare(b.marketName, 'ko') || a.variety.localeCompare(b.variety, 'ko') || a.unitWeightKg - b.unitWeightKg);
}

/** 한 시장·한 정산일의 사과 정산 자료를 모두 받습니다. 키가 담긴 주소나 응답 원문은 오류에 남기지 않습니다. */
export async function fetchSettlementDay({serviceKey, marketCode, date, signal}: {serviceKey: string; marketCode: string; date: string; signal?: AbortSignal}): Promise<SettlementRow[]> {
  if (!isDate(date) || !(marketCode in SETTLEMENT_MARKETS) || !serviceKey.trim()) throw new Error('settlement configuration');
  const key = serviceKey.trim();
  const rows: SettlementRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(URL_BASE);
    url.searchParams.set('serviceKey', /%[\da-f]{2}/i.test(key) ? decodeURIComponent(key) : key);
    url.searchParams.set('returnType', 'json');
    url.searchParams.set('numOfRows', String(PAGE_SIZE));
    url.searchParams.set('pageNo', String(page));
    url.searchParams.set('cond[whsl_mrkt_cd::EQ]', marketCode);
    url.searchParams.set('cond[gds_lclsf_cd::EQ]', '06');
    url.searchParams.set('cond[gds_mclsf_cd::EQ]', '01');
    url.searchParams.set('cond[trd_clcln_ymd::EQ]', date);
    let body: Record<string, unknown> | null = null;
    try {
      const res = await fetch(url, {cache: 'no-store', redirect: 'error', signal});
      if (!res.ok) throw new Error(`settlement http ${res.status}`);
      const json = await res.json() as {response?: {header?: {resultCode?: string}; body?: Record<string, unknown>}};
      const code = str(json.response?.header?.resultCode);
      if (code === '03') return rows;
      if (!/^0{1,3}$/.test(code)) throw new Error(`settlement result ${code || 'unknown'}`);
      body = json.response?.body ?? null;
    } catch (e) {
      throw new Error(e instanceof Error && /^settlement /.test(e.message) ? e.message : 'settlement network');
    }
    const total = num(body?.totalCount) ?? 0;
    const items = (body?.items as {item?: unknown} | undefined)?.item ?? [];
    const list = (Array.isArray(items) ? items : [items]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    for (const raw of list) { const r = settlementRow(raw, date); if (r) rows.push(r); }
    if (page * PAGE_SIZE >= total) return rows;
  }
  throw new Error('settlement pagination');
}
