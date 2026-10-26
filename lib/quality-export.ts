import {rowsToCsv} from './csv';
import {addDays, metricIds, metricMeta, type Anchor, type MetricId, type MeasuredPoint, type Series} from './tracker';
import type {StorageId} from './initial-quality';
import type {TrackerForm} from './tracker-form';
import type {PredictionResult} from './quality-models';

/** Shared pure export contract; no component, DOM or duplicated model formulas. */
export type QualityExportInput = {
  mode:'real'|'example';lotName:string;form:TrackerForm;
  startDate:string;selDate:string;selDay:number;asOf:string;asOfDay:number;
  futureLabel:string;futureId:StorageId|'same';
  baseline:{label:string;createdAt:string;conditionLabel:string;asOf:string;form:TrackerForm;series:Record<MetricId,Series>}|null;
  series:Record<MetricId,Series>;modelResults:Record<MetricId,PredictionResult>;
  measured:Record<MetricId,MeasuredPoint[]>;anchors:Record<MetricId,Anchor|null>;
};

/** Exports the very same selected results and plotted points supplied to the UI. */
export function buildQualityExportRows(o:QualityExportInput):(string|number)[][] {
  const rows:(string|number)[][]=[['애플트랙 품질 결과'],['물량',o.lotName],['입력 모드',o.mode==='example'?'예시 데이터':'사용자 입력'],['품종',o.form.variety],['저장 방식',o.form.storage],['온도',o.form.temperature || '미기록','℃'],['1-MCP',o.form.mcp],['수확일',o.form.harvest_date],['저장 시작일',o.startDate],['초기 측정일',o.form.initial_measured_on || '저장 시작일 가정'],['선택 날짜',o.selDate],['저장일수',o.selDay],['분석 기준일 / 조건 전환일',o.asOf],['조건 전환 저장일수',o.asOfDay],['분석 기준일까지 기록 조건',`${o.form.storage} · 1-MCP ${o.form.mcp}`],['분석 기준일 이후 선택 조건',o.futureLabel],['조건 변경 시나리오',o.futureId==='same'?'조건 유지':'저장 방식 전환 효과 미검증'],['후지 기반 참고 추정 선택',String(o.form.loss_reference)],[],['지표','계산 가능','계산값','단위','데이터 종류','모델 ID','모델 버전','출처','표시 범위','검증 상태','계산 불가 이유','수식','경고·미확인 조건']];
  for(const m of metricIds){const r=o.modelResults[m];rows.push([metricMeta[m].label,String(r.ok),r.value===null?'null':r.value,r.unit,r.kind,r.modelId||'',r.modelVersion||'',r.source.join(' / '),r.range?`${r.range.min}~${r.range.max}`:'',r.validation,r.reason||'',r.formula||'',r.warnings.join(' / ')]);}
  rows.push([],['그래프와 동일한 날짜별 계산','날짜','지표','계산값','단위','종류','모델','버전','출처','검증 상태','경고·미확인 조건']);
  for(const m of metricIds){const s=o.series[m];if(s.ok)for(const p of s.points){const r=p.result || o.modelResults[m];rows.push([p.day,addDays(o.startDate,p.day),metricMeta[m].label,p.value,r.unit,r.kind,r.modelId||'',r.modelVersion||'',r.source.join(' / '),r.validation,r.warnings.join(' / ')]);}}
  if(o.baseline){rows.push([],['고정 비교 기준',o.baseline.label],['고정 시각',o.baseline.createdAt],['고정 조건',o.baseline.conditionLabel],['고정 분석일',o.baseline.asOf],['고정 입력',JSON.stringify(o.baseline.form)],['비교 기준 날짜','지표','값','단위']);for(const m of metricIds){const s=o.baseline.series[m];if(s.ok)for(const p of s.points)rows.push([addDays(o.startDate,p.day),metricMeta[m].label,p.value,metricMeta[m].unit]);}}
  rows.push([],['실측 기록 — 모델 계산과 별도','날짜','저장일수','값','단위','종류','표본 기록 ID']);
  for(const m of metricIds)for(const p of o.measured[m])rows.push([metricMeta[m].label,p.date,p.day,p.value,metricMeta[m].unit,p.kind,p.id]);
  rows.push([],['실측 감모율 공식','100 × (초기 중량 − 후속 중량) / 초기 중량'],['한계','표시 범위는 상품성 유지 기간이나 안전 보관 기간이 아닙니다. 참고 추정과 외관 변형은 홍로 실측자료로 검증되지 않았습니다.']);
  return rows;
}

/** UTF-8 BOM preserves Korean labels in spreadsheet applications. */
export function buildQualityExportCsv(o:QualityExportInput):string {
  return '\uFEFF'+rowsToCsv(buildQualityExportRows(o));
}
