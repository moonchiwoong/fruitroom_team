import {ZodError} from 'zod';
import {calculateHongro, HONGRO_MODEL_VERSION, HONGRO_DISCLAIMER, HONGRO_STORAGE_LABELS, HONGRO_WEATHER_FIELDS} from '@/lib/hongro';

export const runtime = 'nodejs';
const MAX_BYTES = 8192;
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});

export function GET() {
  return json({modelVersion:HONGRO_MODEL_VERSION,cultivar:'hongro',region:'geochang',storage:HONGRO_STORAGE_LABELS,days:{min:0,max:120},sources:['measured','weather'],weatherFields:HONGRO_WEATHER_FIELDS,disclaimer:HONGRO_DISCLAIMER,records:'읽거나 저장하지 않는 계산 API입니다. POST에 입력값을 전달하세요.'});
}

/** Stateless calculator: reads no account data and writes no records. */
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) return json({error: 'JSON 요청이 필요합니다.'}, 415);
  const origin = req.headers.get('origin');
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return json({error: '같은 사이트에서 요청해 주세요.'}, 403);
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return json({error: '요청 내용이 너무 큽니다.'}, 413);
  const reader = req.body?.getReader();
  if (!reader) return json({error: '입력값이 필요합니다.'}, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return json({error: '요청 내용이 너무 큽니다.'}, 413); }
      chunks.push(value);
    }
  } catch { return json({error: '요청 내용을 읽지 못했습니다.'}, 400); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({error: '올바른 JSON 형식이 필요합니다.'}, 400); }
  try { return json(calculateHongro(input)); }
  catch (error) {
    if (error instanceof ZodError) return json({error: '홍로·거창 입력값과 저장일수(0~120일)를 확인해 주세요.', issues: error.issues.map(i => ({path: i.path.join('.'), message: i.message}))}, 400);
    return json({error: error instanceof Error ? error.message : '홍로 계산 입력값을 확인해 주세요.'}, 400);
  }
}
