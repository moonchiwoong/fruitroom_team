import assert from 'node:assert/strict';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createLot, listLots} from '../lib/lot-server';
import type {Lot, LotPage} from '../lib/lot-types';

const origin = 'https://fixture.supabase.co';
const owner = 'farmer-a';
const privateLot = {id: 'private', name: '다른 농가의 개인 기록', owner_id: 'farmer-b', created_at: '2024-11-01T00:00:00.000Z'};
const sharedLot = {...privateLot, id: 'shared', name: '공유 기록', team_shared: true};
const url = (params: Record<string, string> = {}) => new Request(`http://localhost/api/lots?${new URLSearchParams(params)}`);
type FixtureLot = Partial<Lot> & Pick<Lot, 'id' | 'owner_id' | 'created_at'>;

function fixture(rows: FixtureLot[], isTeam = false) {
  const limits: number[] = [];
  const db = createClient(origin, 'fixture-key', {auth: {persistSession: false, autoRefreshToken: false}, global: {fetch: async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url);
    if (!path.pathname.endsWith('/lots')) {
      assert.match(path.pathname, /\/(environment|observations|files)$/);
      return request.method === 'HEAD' ? new Response(null, {headers: {'content-range': '*/0'}}) : Response.json([]);
    }
    if (request.method === 'POST') {
      rows.push({...await request.json(), owner_id: owner});
      return new Response(null, {status: 201});
    }
    const visible = rows.filter(lot => lot.owner_id === owner || (isTeam && lot.team_shared));
    for (const field of ['id', 'created_at'] as const) {
      const filter = path.searchParams.get(field);
      if (!filter) continue;
      const op = filter.slice(0, 3), value = filter.slice(3);
      assert.ok(op === 'eq.' || op === 'lt.');
      for (let index = visible.length - 1; index >= 0; index--) {
        if (op === 'eq.' ? visible[index][field] !== value : visible[index][field] >= value) visible.splice(index, 1);
      }
    }
    if (path.searchParams.has('order')) {
      assert.equal(path.searchParams.get('order'), 'created_at.desc,id.desc');
      visible.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    }
    const limit = path.searchParams.get('limit');
    if (limit) { limits.push(Number(limit)); visible.splice(Number(limit)); }
    if (request.method === 'HEAD') return new Response(null, {headers: {'content-range': `*/${visible.length}`}});
    return Response.json(request.headers.get('accept')?.includes('vnd.pgrst.object') ? visible[0] : visible);
  }}});
  return {readClient: async () => db, limits};
}

test('등록 99·100·101건 이후에도 묶음별로 읽고, 같은 등록 시각의 물량을 빠짐없이 조회한다', async () => {
  const rows: FixtureLot[] = Array.from({length: 98}, (_, index) => ({
    id: `lot-${String(index).padStart(3, '0')}`, owner_id: owner, created_at: '2024-11-01T00:00:00.000Z',
    details: {archived_on: '2025-01-01'},
  }));
  const {readClient, limits} = fixture(rows);
  for (const count of [99, 100, 101]) {
    const response = await createLot(new Request('http://localhost/api/lots', {method: 'POST', body: JSON.stringify({
      name: `후지 ${count}`, variety: '후지', harvest_date: '2024-11-01', intake_date: '2024-11-01', storage: '일반 저온', mcp: '미처리',
    })}), readClient);
    assert.equal(response.status, 201);
    assert.equal(rows.length, count);
  }
  let page: LotPage = await (await listLots(url(), readClient)).json();
  assert.equal(page.lots.length, 30);
  const ids = page.lots.map(lot => lot.id);
  while (page.nextCursor) {
    page = await (await listLots(url({cursor: page.nextCursor}), readClient)).json();
    ids.push(...page.lots.map(lot => lot.id));
  }
  assert.equal(ids.length, 101);
  assert.deepEqual(new Set(ids), new Set(rows.map(lot => lot.id)));
  assert.ok(limits.every(limit => limit <= 31));
  const record = await listLots(url({id: 'lot-000'}), readClient);
  const {lot} = await record.json();
  assert.equal(lot.id, 'lot-000');
  assert.equal(lot.details.archived_on, '2025-01-01');
});

test('단건과 목록 모두 사용자에게 조회 가능한 기록만 반환한다', async () => {
  for (const isTeam of [false, true]) {
    const {readClient} = fixture([privateLot, sharedLot], isTeam);
    const {lots} = await (await listLots(url(), readClient)).json() as LotPage;
    assert.deepEqual(lots.map(lot => lot.id), isTeam ? ['shared'] : []);
    assert.equal((await listLots(url({id: privateLot.id}), readClient)).status, 404);
    assert.equal((await listLots(url({id: sharedLot.id}), readClient)).status, isTeam ? 200 : 404);
  }
});
