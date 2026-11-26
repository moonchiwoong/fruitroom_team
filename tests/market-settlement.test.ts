import test from 'node:test';
import assert from 'node:assert/strict';
import {groupGraded, settlementRow} from '../lib/market-settlement';
import {settlementMarketCode} from '../lib/settlement-markets';

// 2026-11-25 안동 정산 원자료와 같은 모양의 행(값은 검증용)
const raw = (o: Record<string, string>) => ({gds_mclsf_nm: '사과', trd_se: '경매', trd_clcln_ymd: '2026-11-25', whsl_mrkt_cd: '370401', whsl_mrkt_nm: '안동',
  gds_sclsf_nm: '후지', plor_nm: '경상북도 청송군', grd_nm: '특', sz_nm: '.', pkg_nm: '상자', unit_nm: 'kg', unit_qty: '20.000', ...o});

test('정산 행: 경매만, 평균은 총가격÷상자 수, 최저~최고 밖이면 제외, 크기 "."은 빈칸', () => {
  const r = settlementRow(raw({unit_tot_qty: '140.000', totprc: '580000', avgprc: '80000', lwprc: '70000', hgprc: '90000'}), '2026-11-25');
  assert.ok(r); assert.equal(r!.boxes, 7); assert.equal(r!.amount, 580000); assert.equal(r!.size, '');
  assert.equal(settlementRow(raw({trd_se: '정가수의', unit_tot_qty: '20', totprc: '1', lwprc: '1', hgprc: '1'}), '2026-11-25'), null);
  assert.equal(settlementRow(raw({unit_tot_qty: '20.000', totprc: '500000', lwprc: '10000', hgprc: '20000'}), '2026-11-25'), null);
  assert.equal(settlementRow(raw({unit_tot_qty: '20.000', totprc: '15000', lwprc: '15000', hgprc: '15000', trd_clcln_ymd: '2026-11-24'}), '2026-11-25'), null);
});

test('등급별 묶기: 산지만 남기고, 같은 등급은 상자 수 가중 평균·최저·최고, 등급 순서 특→상→중→등외', () => {
  const rows = [
    raw({grd_nm: '상', unit_tot_qty: '200', totprc: '400000', lwprc: '30000', hgprc: '50000'}),
    raw({grd_nm: '특', unit_tot_qty: '100', totprc: '300000', lwprc: '55000', hgprc: '65000'}),
    raw({grd_nm: '특', unit_tot_qty: '300', totprc: '1050000', lwprc: '60000', hgprc: '80000'}),
    raw({grd_nm: '등외', unit_tot_qty: '20', totprc: '15000', lwprc: '15000', hgprc: '15000'}),
    raw({grd_nm: '특', plor_nm: '충청북도 제천시', unit_tot_qty: '20', totprc: '99000', lwprc: '99000', hgprc: '99000'}),
  ].map(x => settlementRow(x, '2026-11-25')!);
  const g = groupGraded(rows, 'cheongsong');
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].grades.map(x => x.grade), ['특', '상', '등외']);
  const top = g[0].grades[0].days[0];
  assert.deepEqual({avg: top.averagePrice, low: top.lowPrice, high: top.highPrice, boxes: top.boxes, kg: top.totalWeightKg}, {avg: 67500, low: 55000, high: 80000, boxes: 20, kg: 400});
  assert.equal(groupGraded(rows, 'geochang').length, 0);
});

test('시장 이름 → 정산정보 시장 코드', () => {
  assert.equal(settlementMarketCode('안동'), '370401');
  assert.equal(settlementMarketCode('서울가락'), '110001');
  assert.equal(settlementMarketCode('없는시장'), undefined);
});

test('후지·홍로만: 미얀마·감홍 등 다른 품종 이름은 등급별 정산가에서 뺌', () => {
  const rows = ['후지', '홍로', '미얀마', '감홍'].map(v => settlementRow(raw({gds_sclsf_nm: v, unit_tot_qty: '20', totprc: '30000', lwprc: '30000', hgprc: '30000'}), '2026-11-25')!);
  assert.deepEqual(groupGraded(rows, 'cheongsong').map(g => g.variety).sort(), ['홍로', '후지'].sort());
});
