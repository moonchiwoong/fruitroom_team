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

export type MarketAuctionDay = {trades: MarketAuctionTrade[]; incompleteOrigins: string[]};

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
const TIMEOUT_MS = 20_000;
const RESULT_CODES = new Set(['0', '00', '000', '01', '02', '03', '04', '05', '10', '11', '12', '20', '21', '22', '23', '29', '30', '31', '32', '33', '99']);
// aT 공영도매시장 API 15141808의 selectable은 쉼표로 구분한 응답 컬럼을 받습니다.
const WHOLESALE_FIELDS = [
  'scsbd_dt', 'whsl_mrkt_cd', 'whsl_mrkt_nm', 'plor_nm',
  'gds_mclsf_nm', 'gds_lclsf_cd', 'gds_mclsf_cd', 'gds_sclsf_nm', 'corp_gds_item_nm', 'corp_gds_vrty_nm',
  'trd_se', 'grd_nm', 'pkg_nm', 'sz_nm', 'unit_nm', 'unit_qty', 'unit_tot_qty', 'qty', 'scsbd_prc', 'totprc',
].join(',');

type SourceFailure = {
  stage: 'configuration' | 'network' | 'timeout' | 'http' | 'gateway' | 'shape' | 'pagination' | 'normalization';
  page?: number;
  httpStatus?: number;
  resultCode?: string;
  envelope?: 'response' | 'header-body' | 'gateway' | 'unknown';
  fields?: string[];
};

export class MarketAuctionSourceError extends Error {
  constructor(readonly failure: SourceFailure) {
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

function resultCode(value: unknown): string | undefined {
  const code = text(value);
  return RESULT_CODES.has(code) ? code : undefined;
}

function fieldNames(row?: RecordFields | null): string[] | undefined {
  return row ? Object.keys(row).filter(key => /^[a-z][a-z0-9_]{0,39}$/.test(key)).slice(0, 48) : undefined;
}

function parsePage(content: unknown, page: number, httpStatus: number): AuctionPage {
  const envelope = record(content);
  const wrapped = record(envelope?.response);
  const response = wrapped ?? envelope;
  const gateway = record(record(envelope?.OpenAPI_ServiceResponse)?.cmmMsgHeader);
  const status = resultCode(record(response?.header)?.resultCode ?? gateway?.returnReasonCode);
  const shape = wrapped ? 'response' : gateway ? 'gateway' : response?.header ? 'header-body' : 'unknown';
  const metadata = {page, httpStatus, resultCode: status, envelope: shape} as const;
  if (httpStatus < 200 || httpStatus >= 300) throw new MarketAuctionSourceError({stage: 'http', ...metadata});
  // 공공데이터포털 공통 응답 코드 03은 NODATA_ERROR입니다.
  if (status === '03') return {rows: [], total: 0, pageSize: PAGE_SIZE};
  if (status && !/^(?:0|00|000)$/.test(status)) throw new MarketAuctionSourceError({stage: 'gateway', ...metadata});
  const body = record(response?.body);
  const total = number(body?.totalCount);
  if (!status || !body || total === null || !Number.isSafeInteger(total) || total < 0) throw new MarketAuctionSourceError({stage: 'shape', ...metadata});
  const pageSize = number(body.numOfRows) ?? PAGE_SIZE;
  const returnedPage = number(body.pageNo);
  const items = record(body.items)?.item ?? body.items;
  const rawRows = Array.isArray(items) ? items : record(items) ? [items] : [];
  const rows = rawRows.map(record);
  const invalidPage = !Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE || (returnedPage !== null && returnedPage !== page);
  const expectedLength = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
  if (invalidPage || rows.some(row => row === null) || rows.length !== expectedLength) {
    throw new MarketAuctionSourceError({stage: 'pagination', ...metadata, fields: page === 1 ? fieldNames(rows[0]) : undefined});
  }
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
  if (query.source === 'wholesale') url.searchParams.set('selectable', WHOLESALE_FIELDS);
  return url;
}

async function fetchPage(base: URL, page: number, signal: AbortSignal): Promise<AuctionPage> {
  const url = new URL(base);
  url.searchParams.set('pageNo', String(page));
  let httpStatus: number | undefined;
  try {
    const response = await fetch(url, {cache: 'no-store', redirect: 'error', signal});
    httpStatus = response.status;
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const code = resultCode(/<(?:returnReasonCode|resultCode|errCode)>\s*(\d{1,3})\s*</.exec(raw.slice(0, 4_096))?.[1]);
      if (response.ok && code === '03') return {rows: [], total: 0, pageSize: PAGE_SIZE};
      throw new MarketAuctionSourceError({stage: code ? 'gateway' : response.ok ? 'shape' : 'http', page, httpStatus, resultCode: code});
    }
    return parsePage(parsed, page, httpStatus);
  } catch (error) {
    if (error instanceof MarketAuctionSourceError) throw error;
    // 네트워크 오류에는 인증키가 포함된 URL이나 응답 원문이 있을 수 있습니다.
    throw new MarketAuctionSourceError({stage: signal.aborted ? 'timeout' : 'network', page, httpStatus});
  }
}

async function loadMarketAuctionDay(query: DayQuery): Promise<MarketAuctionDay> {
  if (!isDate(query.date) || !query.serviceKey.trim() || (query.source === 'origin-hall' && !query.marketCode)) {
    throw new MarketAuctionSourceError({stage: 'configuration'});
  }

  let url: URL;
  try {
    url = endpoint(query);
  } catch {
    throw new MarketAuctionSourceError({stage: 'configuration'});
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = query.signal ? AbortSignal.any([query.signal, timeout]) : timeout;
  const first = await fetchPage(url, 1, signal);
  const pages = Math.ceil(first.total / first.pageSize);
  if (pages > MAX_PAGES) throw new MarketAuctionSourceError({stage: 'pagination', page: 1, fields: fieldNames(first.rows[0])});

  const rows = first.rows;
  for (let start = 2; start <= pages; start += PAGE_CONCURRENCY) {
    const batch = Array.from({length: Math.min(PAGE_CONCURRENCY, pages - start + 1)}, (_, i) => fetchPage(url, start + i, signal));
    for (const [index, page] of (await Promise.all(batch)).entries()) {
      if (page.total !== first.total || page.pageSize !== first.pageSize) throw new MarketAuctionSourceError({stage: 'pagination', page: start + index});
      rows.push(...page.rows);
    }
  }
  if (rows.length !== first.total) throw new MarketAuctionSourceError({stage: 'pagination'});
  if (rows.length === 0) return {trades: [], incompleteOrigins: []};

  const apples = rows.filter(isApple);
  if (!apples.length || apples.every(row => !text(row.trd_se))) throw new MarketAuctionSourceError({stage: 'normalization', page: 1, fields: fieldNames(rows[0])});
  const trades: MarketAuctionTrade[] = [];
  const incompleteOrigins = new Set<string>();
  let auctionRows = 0;
  for (const row of apples) {
    const method = text(row.trd_se);
    if (!method) incompleteOrigins.add(cleanLabel(row.plor_nm));
    if (!isAuction(method)) continue;
    auctionRows++;
    const normalized = trade(row, query);
    if (normalized) trades.push(normalized);
    else incompleteOrigins.add(cleanLabel(row.plor_nm));
  }
  if (auctionRows && !trades.length) throw new MarketAuctionSourceError({stage: 'normalization', page: 1, fields: fieldNames(rows[0])});
  return {trades, incompleteOrigins: [...incompleteOrigins].filter(Boolean)};
}

/** 정산일로 자료를 조회하되 반환 날짜에는 확인된 낙찰일만 사용합니다. 서버 라우트에서 호출합니다. */
export async function fetchMarketAuctionDay(query: DayQuery): Promise<MarketAuctionDay> {
  try {
    const result = await loadMarketAuctionDay(query);
    if (query.source === 'origin-hall' && result.trades.length) {
      console.info('aT origin hall auction day available', {source: query.source, date: query.date, count: result.trades.length});
    }
    return result;
  } catch (caught) {
    const error = caught instanceof MarketAuctionSourceError ? caught : new MarketAuctionSourceError({stage: 'normalization'});
    console.warn('aT apple auction day unavailable', {source: query.source, date: isDate(query.date) ? query.date : undefined, ...error.failure});
    throw error;
  }
}
