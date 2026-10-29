import {z} from 'zod';
import type {Lot, Observation, Stats} from '../lot-types';
import type {TrackerForm} from '../tracker-form';
import {emptyHongroForm} from '../hongro-tracker';
import {isDate, MODEL_VERSION, type MetricId} from '../tracker';
import type {StorageId} from '../initial-quality';

const text = z.string().max(1000), date = z.string().refine(isDate, '날짜 형식을 확인해 주세요.');
const form = z.object({
  name:text,variety:text,harvest_date:text,intake_date:text,sameStart:z.boolean(),storage_start_date:text,initialSameStart:z.boolean().default(false),initial_measured_on:text,initial_sample_count:text,
  firmness:text,brix:text,acidity:text,weight:text,packaging:text,location:text,sensor_id:text,
  storage:z.enum(['일반 저온','CA','기타']),mcp:z.enum(['미처리','처리','미확인']),mcpSelected:z.boolean().default(false),temperature:text.default(''),loss_reference:z.boolean().default(false),team_shared:z.boolean(),
  name_auto:z.boolean().default(false),legacyHongro:z.boolean().default(false),firmness_unit:z.enum(['N','kgf']).default('N'),missing:z.object({firmness:z.boolean(),brix:z.boolean(),acidity:z.boolean().default(false)}).strict().default({firmness:false,brix:false,acidity:false}),
  measure:z.object({probe_mm:text,peeled:z.enum(['','껍질 제거','껍질 포함']),position:text,fruit_temp:text,instrument:text}).strict(),
  mcpd:z.object({treated_on:text,product:text,concentration:text,hours:text,temp:text}).strict(),
  ca:z.object({from:text,to:text,o2:text,co2:text}).strict(),
  tracked:z.object({count:text,initial_weight:text,sample_id:text}).strict(),
  hongro:z.object({
    source:z.enum(['measured','weather']),storage:z.enum(['cold0','cold4']),
    initial:z.object({firmness:text,brix:text,acidity:text,weight:text,diameter:text}).strict(),
    weather:z.object({chang_min4:text,chang_LC56:text,chang_LC78:text,chang_9rain:text}).strict(),
  }).strict().default(emptyHongroForm),
}).strict();
const storage = z.enum(['cold','mcp','ca']);
const lotId = z.string().min(1).max(100);
const basic = z.object({mode:z.literal('real'),scope:z.enum(['all','lot']),lotId:lotId.nullish()}).strict().refine(v=>v.scope!=='lot'||!!v.lotId,'선택 물량이 필요합니다.');
const prediction = z.object({
  mode:z.enum(['real','example']),scope:z.literal('prediction'),lotId:lotId.nullable(),metric:z.enum(['firmness','brix','acidity','loss']),
  selectedDate:date,asOf:date,form,future:z.union([storage,z.literal('same')]),useLatest:z.boolean(),modelVersion:z.literal(MODEL_VERSION),
  baseline:z.object({label:text,conditionLabel:text,createdAt:z.string().datetime(),asOf:date,modelVersion:z.literal(MODEL_VERSION),future:storage.nullable(),form,useLatest:z.boolean(),observationsFingerprint:z.string().max(128)}).strict().nullable(),
}).strict().refine(v=>v.mode!=='example'||v.lotId===null,'예시 범위에는 실제 물량을 포함할 수 없습니다.');
export const contextSchema = z.union([basic,prediction]);
export const chatSchema = z.object({question:z.string().trim().min(1).max(2000),requestId:z.string().uuid(),context:contextSchema}).strict();
export type AIContext = z.infer<typeof contextSchema>;
export type ChatRequest = z.infer<typeof chatSchema>;
export type Actor = {id:string;isTeam:boolean};
export type Analysis = {lot:Lot;observations:Observation[];stats:Stats|null};
export interface DataAccess {
  authenticate():Promise<Actor>;
  listLots():Promise<Lot[]>;
  getLot(id:string):Promise<Lot|null>;
  getAnalysis(id:string,asOf:string):Promise<Analysis>;
}
export type EvidenceField = {label:string;value:string|number|null;unit?:string;date?:string;kind?:string;verification?:string};
export type Evidence = {tool:string;title:string;summary:string;data:Record<string,unknown>;fields?:EvidenceField[]};
export type ChatResponse = {answer:string;retrievedAt:string;scopeLabel:string;evidence:Evidence[];links:{label:string;lotId?:string;page:'track'|'lots'|'model'}[];provider:{model:string;protocol:'openai-compatible'}};
export class AIError extends Error {
  constructor(public code:string,message:string,public status=400,public settingsRequired?:string[]){super(message);}
}
export type PredictionInput = {form:TrackerForm;mode:'real'|'example';observations:Observation[];asOf:string;selectedDate:string;metric:MetricId;future:StorageId|'same'|null;useLatest:boolean};
