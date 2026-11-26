import {isDate} from './tracker';

export type MarketAuctionSource = 'origin-hall' | 'wholesale';

/** 한 건의 낙찰 자료. 산지와 실제 거래 시장, 포장 단위와 중량을 따로 보관합니다. */
export type MarketAuctionTrade = {
  date: string;
  marketName: string;
  origin: string;
  variety: string;
  grade: string;
  packageName: string;
  size: string;
  unit: 'kg';
  unitWeightKg: number;
  quantity: number;
  unitPrice: number;
};

type DayQuery = {
  source: MarketAuctionSource;
  date: string;
  serviceKey: string;
  marketCode?: string;
  signal?: AbortSignal;
};

type RecordFields = Record<string, unknown>;
type AuctionPage = {rows: RecordFields[]; total: number; pageSize: number};

const SOURCES = {
  'origin-hall': {
    url: 'https://apis.data.go.kr/B552845/originTrialHall/dealings',
    dateField: 'clcln_ymd',
    marketField: 'trhl_cd',
  },
  wholesale: {
    url: 'https://apis.data.go.kr/B552845/katRealTime2/trades2',
    dateField: 'trd_clcln_ymd',
    marketField: 'whsl_mrkt_cd',
  },
} as const;

const PAGE_SIZE = 1_000;
const MAX_PAGES = 30;
const PAGE_CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;

export class MarketAuctionSourceError extends Error {
  constructor() {
    super('aT 경매 원자료를 확인하지 못했어요.');
    this.name = 'MarketAuctionSourceError';
  }
}

function record(value: unknown): RecordFields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordFields
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function number(value: unknown): number | null {
  const candidate = text(value).replaceAll(',', '');
  if (!candidate) return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanLabel(value: unknown): string {
  const label = text(value);
  return label === '.' || label === '-' ? '' : label;
}

function bidDate(value: unknown): string | null {
  const stamp = text(value);
  if (/[T ]\d\d:\d\d.*(?:Z|[+-]\d\d:?\d\d)$/i.test(stamp)) {
    const time = Date.parse(stamp);
    return Number.isFinite(time) ? new Date(time + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10) : null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ]\d{2}:\d{2})/.exec(stamp)
    ?? /^(\d{4})(\d{2})(\d{2})(?:$|\d{6}$)/.exec(stamp);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isDate(date) ? date : null;
}

function isApple(row: RecordFields): boolean {
  const itemName = cleanLabel(row.gds_mclsf_nm);
  if (itemName) return itemName === '사과';
  if (Number(row.gds_lclsf_cd) === 6 && Number(row.gds_mclsf_cd) === 1) return true;
  return cleanLabel(row.corp_gds_item_nm) === '사과';
}

function isAuction(method: string): boolean {
  return /^(?:0?1|경매|일반경매|전자경매|온라인경매(?:\((?:응찰식|입찰식)\))?)$/.test(method.replaceAll(/\s/g, ''));
}

function trade(row: RecordFields, query: DayQuery): MarketAuctionTrade | null {
  const date = bidDate(row.scsbd_dt);
  const marketName = cleanLabel(row.whsl_mrkt_nm);
  const variety = cleanLabel(row.gds_sclsf_nm) || cleanLabel(row.corp_gds_vrty_nm);
  const quantity = number(row.qty);
  const unitPrice = number(row.scsbd_prc);
  const sourceUnit = text(row.unit_nm).toLowerCase();
  const kilograms = /^(?:kg|킬로그램|㎏)$/.test(sourceUnit) ? 1 : /^(?:g|그램)$/.test(sourceUnit) ? 0.001 : null;
  const expectedMarketCode = query.marketCode;
  const marketCode = text(row[SOURCES[query.source].marketField]);
  if (!date || date > query.date || !marketName || !variety || quantity === null || quantity <= 0 || unitPrice === null || unitPrice <= 0 || kilograms === null) {
    return null;
  }
  if (expectedMarketCode && marketCode !== expectedMarketCode) return null;

  const totalQuantity = number(row.unit_tot_qty);
  const reportedWeight = number(row.unit_wght) ?? number(row.unit_qty);
  const weight = reportedWeight ?? (totalQuantity === null ? null : totalQuantity / quantity);
  const totalPrice = number(row.totprc);
  // 낙찰가와 물량은 같은 포장 단위를 기준으로 해야 가중 평균을 계산할 수 있습니다.
  if (weight === null || weight <= 0 || (totalPrice !== null && Math.abs(totalPrice - unitPrice * quantity) > 1)) return null;
  if (totalQuantity !== null && Math.abs(totalQuantity - weight * quantity) > 0.01) return null;

  return {
    date,
    marketName,
    origin: cleanLabel(row.plor_nm),
    variety,
    grade: cleanLabel(row.grd_nm),
    packageName: cleanLabel(row.pkg_nm),
    size: cleanLabel(row.sz_nm),
    unit: 'kg',
    unitWeightKg: weight * kilograms,
    quantity,
    unitPrice,
  };
}

function parsePage(content: unknown, page: number): AuctionPage {
  const response = record(record(content)?.response);
  const status = text(record(response?.header)?.resultCode);
  // 공공데이터포털 공통 응답 코드 03은 NODATA_ERROR입니다.
  if (status === '03') return {rows: [], total: 0, pageSize: PAGE_SIZE};
  const body = record(response?.body);
  const total = number(body?.totalCount);
  if (!/^(?:0|00|000)$/.test(status) || !body || total === null || !Number.isSafeInteger(total) || total < 0) {
    throw new MarketAuctionSourceError();
  }

  const pageSize = number(body.numOfRows) ?? PAGE_SIZE;
  const returnedPage = number(body.pageNo);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE || (returnedPage !== null && returnedPage !== page)) {
    throw new MarketAuctionSourceError();
  }
  const items = record(body.items)?.item ?? body.items;
  const rawRows = Array.isArray(items) ? items : record(items) ? [items] : [];
  const rows = rawRows.map(record);
  const expectedLength = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
  if (rows.some(row => row === null) || rows.length !== expectedLength) throw new MarketAuctionSourceError();
  return {rows: rows as RecordFields[], total, pageSize};
}

function endpoint(query: DayQuery): URL {
  const source = SOURCES[query.source];
  const url = new URL(source.url);
  const key = query.serviceKey.trim();
  // 포털에서 제공하는 인코딩 키와 디코딩 키를 모두 받되 요청에는 한 번만 인코딩합니다.
  url.searchParams.set('serviceKey', /%[\da-f]{2}/i.test(key) ? decodeURIComponent(key) : key);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('numOfRows', String(PAGE_SIZE));
  url.searchParams.set('cond[gds_lclsf_cd::EQ]', '06');
  url.searchParams.set('cond[gds_mclsf_cd::EQ]', '01');
  url.searchParams.set(`cond[${source.dateField}::EQ]`, query.source === 'origin-hall' ? query.date.replaceAll('-', '') : query.date);
  if (query.marketCode) url.searchParams.set(`cond[${source.marketField}::EQ]`, query.marketCode);
  return url;
}

async function fetchPage(base: URL, page: number, signal: AbortSignal): Promise<AuctionPage> {
  const url = new URL(base);
  url.searchParams.set('pageNo', String(page));
  try {
    const response = await fetch(url, {cache: 'no-store', redirect: 'error', signal});
    if (!response.ok) throw new MarketAuctionSourceError();
    return parsePage(await response.json(), page);
  } catch {
    // 네트워크 오류에는 인증키가 포함된 URL이나 응답 원문이 있을 수 있습니다.
    throw new MarketAuctionSourceError();
  }
}

/** 정산일로 자료를 조회하되 반환 날짜에는 확인된 낙찰일만 사용합니다. 서버 라우트에서 호출합니다. */
export async function fetchMarketAuctionDay(query: DayQuery): Promise<MarketAuctionTrade[]> {
  if (!isDate(query.date) || !query.serviceKey.trim() || (query.source === 'origin-hall' && !query.marketCode)) {
    throw new MarketAuctionSourceError();
  }

  let url: URL;
  try {
    url = endpoint(query);
  } catch {
    throw new MarketAuctionSourceError();
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = query.signal ? AbortSignal.any([query.signal, timeout]) : timeout;
  const first = await fetchPage(url, 1, signal);
  const pages = Math.ceil(first.total / first.pageSize);
  if (pages > MAX_PAGES) throw new MarketAuctionSourceError();

  const rows = first.rows;
  for (let start = 2; start <= pages; start += PAGE_CONCURRENCY) {
    const batch = Array.from({length: Math.min(PAGE_CONCURRENCY, pages - start + 1)}, (_, i) => fetchPage(url, start + i, signal));
    for (const page of await Promise.all(batch)) {
      if (page.total !== first.total || page.pageSize !== first.pageSize) throw new MarketAuctionSourceError();
      rows.push(...page.rows);
    }
  }
  if (rows.length !== first.total) throw new MarketAuctionSourceError();
  if (rows.length === 0) return [];

  const apples = rows.filter(isApple);
  if (!apples.length || apples.every(row => !text(row.trd_se))) throw new MarketAuctionSourceError();
  const auctions = apples.filter(row => isAuction(text(row.trd_se)));
  const verified = auctions.map(row => trade(row, query)).filter((row): row is MarketAuctionTrade => row !== null);
  if (auctions.length && !verified.length) throw new MarketAuctionSourceError();
  return verified;
}
