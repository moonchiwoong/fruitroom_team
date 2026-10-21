'use client';
import {supabaseBrowser} from './supabase-browser';
import type {Inputs, MetricKey, RegionId} from './initial-quality';

export type SavedPrediction = {id: string; region: RegionId; title: string; inputs: Inputs; result: Record<MetricKey, number>; created_at: string};

const FAIL = '예측 기록을 불러오거나 저장하지 못했어요. 잠시 후 다시 시도해 주세요.';

export async function listPredictions(limit = 50): Promise<SavedPrediction[]> {
  const r = await supabaseBrowser().from('quality_predictions').select('id,region,title,inputs,result,created_at').order('created_at', {ascending: false}).limit(limit);
  if (r.error) throw new Error(FAIL);
  return (r.data ?? []) as SavedPrediction[];
}

export async function countPredictions(): Promise<number | null> {
  const r = await supabaseBrowser().from('quality_predictions').select('id', {count: 'exact', head: true});
  return r.error ? null : r.count ?? 0;
}

export async function savePrediction(p: {region: RegionId; title: string; inputs: Inputs; result: Record<MetricKey, number>}): Promise<SavedPrediction> {
  const r = await supabaseBrowser().from('quality_predictions').insert({region: p.region, title: p.title.slice(0, 80), inputs: p.inputs, result: p.result}).select('id,region,title,inputs,result,created_at').single();
  if (r.error) throw new Error(FAIL);
  return r.data as SavedPrediction;
}

export async function deletePrediction(id: string) {
  const r = await supabaseBrowser().from('quality_predictions').delete().eq('id', id);
  if (r.error) throw new Error(FAIL);
}
