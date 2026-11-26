// 소비자 선호 당도와 지금 품질 대조, ‘오늘부터 30일 뒤 → 60일 뒤’ 비교 문구(규칙 기반, 생성형 AI 없음).
import {isHongroVariety} from './cultivar';
import {fmtNum, metricMeta} from './tracker';

export type SugarRef = {value: number; label: string; source: string; url: string};

/** 소비자 선호 당도 범위: Kim 외(2023) Food Chemistry: X 17:100641, Kajikawa(1998) 인용 ‘13–16 °Brix’. */
export const CONSUMER_BRIX = {min: 13, max: 16, source: 'Kim 외 2023, Food Chemistry: X (Kajikawa 1998 인용)', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10053392/'};

/** 품종 기준값. 품종명이 정확히 후지(부사)·홍로일 때만(로얄후지·미얀마 등 다른 이름에는 붙이지 않음). */
export function sugarRef(variety: string | null | undefined): SugarRef | null {
  const v = (variety ?? '').normalize('NFKC').replace(/\s+/g, '');
  if (v === '후지' || v === '부사' || v === '후지(부사)') return {value: 14, label: '후지 특 등급 당도 기준', source: '정희연·김상숙 2014, 한국식품저장유통학회지 21(5) (농산물 표준규격 인용, 2014년 당시)', url: 'https://www.ekosfop.or.kr/archive/view_article?pid=kjfp-21-5-618'};
  if (isHongroVariety(v)) return {value: 13.6, label: '홍로 수확 가능 최소 당도', source: '이슬기 외 2025, 생물환경조절학회지 34(1)', url: 'https://www.koreascience.kr/article/JAKO202513432402879.page'};
  return null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** 당도 한 값과 선호 범위·품종 기준 비교 문구(소수 첫째 자리 표시값 기준). */
/** 카드 배지·짧은 기준 문구(소수 첫째 자리 표시값 기준). */
export function sugarBadge(brix: number): {kind: 'in' | 'low' | 'high'; text: string} {
  const b = r1(brix);
  return b < CONSUMER_BRIX.min ? {kind: 'low', text: '선호보다 낮음'} : b > CONSUMER_BRIX.max ? {kind: 'high', text: '선호보다 높음'} : {kind: 'in', text: '선호 범위 안'};
}
export function sugarRefShort(brix: number, variety: string | null | undefined): string | null {
  const ref = sugarRef(variety); if (!ref) return null;
  const d = r1(r1(brix) - ref.value), name = ref.value === 14 ? '특 등급 기준' : '수확 최소 당도';
  return `${name} ${fmtNum(ref.value, 1)} · ${d === 0 ? '같음' : `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d), 1)}`}`;
}

export function sugarNotes(brix: number, variety: string | null | undefined): {range: string; ref: string | null} {
  const b = r1(brix);
  const range = b < CONSUMER_BRIX.min ? `소비자 선호 범위(${CONSUMER_BRIX.min}~${CONSUMER_BRIX.max} °Brix)보다 낮아요`
    : b > CONSUMER_BRIX.max ? `소비자 선호 범위(${CONSUMER_BRIX.min}~${CONSUMER_BRIX.max} °Brix)보다 높아요`
    : `소비자 선호 범위(${CONSUMER_BRIX.min}~${CONSUMER_BRIX.max} °Brix) 안이에요`;
  const ref = sugarRef(variety);
  if (!ref) return {range, ref: null};
  const d = r1(b - ref.value);
  return {range, ref: d === 0 ? `표시값 기준으로 ${ref.label}(${fmtNum(ref.value, 1)} °Brix)과 같아요`
    : `${ref.label} ${fmtNum(ref.value, 1)} °Brix보다 ${fmtNum(Math.abs(d), 1)} °Brix ${d > 0 ? '높아요' : '낮아요'}`};
}

type Pt = {ok: true; value: number} | {ok: false; reason?: string};
export type Dir = 'up' | 'down' | 'same';
export type CompareRow = {metric: 'brix' | 'acidity' | 'loss'; a: number | null; b: number | null; dir: Dir | null; diffText: string | null};

const digits = (m: 'brix' | 'acidity' | 'loss') => metricMeta[m].digits;
const disp = (m: 'brix' | 'acidity' | 'loss', v: number) => Number(v.toFixed(digits(m)));

/** 30일 뒤(a) → 60일 뒤(b) 행. 표시 정밀도로 반올림한 값끼리 방향을 정합니다. 값이 없으면 dir=null. */
export function compareRow(m: 'brix' | 'acidity' | 'loss', a: Pt, b: Pt): CompareRow {
  if (!a.ok || !b.ok) return {metric: m, a: a.ok ? a.value : null, b: b.ok ? b.value : null, dir: null, diffText: null};
  const da = disp(m, a.value), db = disp(m, b.value), diff = Number((db - da).toFixed(digits(m)));
  const dir: Dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
  const unit = m === 'acidity' ? '%p' : m === 'brix' ? ' °Brix' : '%p';
  const diffText = dir === 'same' ? '표시값이 같아요' : `${fmtNum(Math.abs(diff), digits(m))}${unit} ${dir === 'up' ? '증가' : '감소'}`;
  return {metric: m, a: da, b: db, dir, diffText};
}

/** 무게 감소(저장 시작 무게 대비 누적 %) → 처음 100kg당 kg. startKg가 있으면 그 물량으로도 환산. */
export function lossKg(row: CompareRow, startKg?: number | null) {
  if (row.metric !== 'loss' || row.a === null || row.b === null) return null;
  const d = digits('loss'), fx = (x: number) => Number(x.toFixed(d));
  const per100 = {a: row.a, b: row.b, extra: fx(row.b - row.a)};
  const mine = startKg && startKg > 0 ? {a: fx(startKg * row.a / 100), b: fx(startKg * row.b / 100), extra: fx(startKg * per100.extra / 100)} : null;
  return {per100, mine};
}

const NAME = {brix: '당도', acidity: '산도'} as const;
const VERB: Record<Dir, [string, string]> = {up: ['높아지고', '높아질 것으로 예상돼요'], down: ['낮아지고', '낮아질 것으로 예상돼요'], same: ['표시값이 같고', '표시값이 같아요']};

/** 한 줄 요약. 값이 없는 지표는 빼고, 지표마다 실제 방향대로 씁니다. */
export function summaryLine(rows: CompareRow[], startKg?: number | null): string | null {
  const clauses: [string, string][] = [];
  const ba = rows.filter((r): r is CompareRow & {metric: 'brix' | 'acidity'; dir: Dir} => (r.metric === 'brix' || r.metric === 'acidity') && r.dir !== null);
  if (ba.length === 2 && ba[0].dir === ba[1].dir) clauses.push([`당도와 산도는 ${VERB[ba[0].dir][0]}`, `당도와 산도는 ${VERB[ba[0].dir][1]}`]);
  else for (const r of ba) clauses.push([`${NAME[r.metric]}는 ${VERB[r.dir][0]}`, `${NAME[r.metric]}는 ${VERB[r.dir][1]}`]);
  const loss = rows.find(r => r.metric === 'loss' && r.dir !== null);
  if (loss) {
    const k = lossKg(loss, startKg)!;
    const amount = k.mine ? `처음 ${fmtNum(startKg!, 0)}kg 기준 약 ${fmtNum(k.mine.extra, digits('loss'))}kg` : `처음 100kg당 약 ${fmtNum(k.per100.extra, digits('loss'))}kg`;
    clauses.push(loss.dir === 'same' ? ['무게 감소는 표시값이 같고', '무게 감소는 표시값이 같아요']
      : loss.dir === 'up' ? [`무게는 ${amount} 더 줄어들고`, `무게는 ${amount} 더 줄어들 것으로 예상돼요`]
      : [`무게 감소 계산값이 줄어들고`, `무게 감소 계산값이 줄어들어요`]);
  }
  if (!clauses.length) return null;
  return clauses.map((c, i) => (i === clauses.length - 1 ? c[1] : c[0])).join(', ') + '.';
}
