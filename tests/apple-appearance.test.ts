import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appleAppearance, positionChecksum, wrinkleApplePoint} from '../lib/apple-appearance';
import {predictQuality} from '../lib/quality-models';

test('missing loss is unavailable, not an asserted zero-loss result', () => {
  const unknown = appleAppearance(null);
  assert.equal(unknown.available, false);
  assert.equal(unknown.lossPercent, null);
  assert.deepEqual(wrinkleApplePoint(0.8, 0.2, 0.3, unknown), [0.8, 0.2, 0.3]);
  for (const bad of [NaN, Infinity, -1]) assert.equal(appleAppearance(bad).available, false);
});

test('zero loss preserves exact original shape and distinguishes available zero', () => {
  const atZero = appleAppearance(0);
  assert.equal(atZero.available, true); assert.equal(atZero.lengthScale, 1); assert.equal(atZero.wrinkleAmplitude, 0);
  assert.deepEqual(wrinkleApplePoint(0.8, 0.2, 0.3, atZero), [0.8, 0.2, 0.3]);
});

test('percent loss drives cube-root volume assumption, never direct length percentage', () => {
  const one = appleAppearance(1);
  assert.ok(Math.abs(one.lengthScale - Math.cbrt(0.99)) < 1e-12);
  assert.notEqual(one.lengthScale, 0.99);
  assert.equal(one.lossPercent, 1);
});

test('date-dependent loss changes real coordinates continuously, without accumulating mutations', () => {
  const source = [0.8, 0.2, 0.3] as const;
  const before = wrinkleApplePoint(...source, appleAppearance(1));
  const after = wrinkleApplePoint(...source, appleAppearance(2));
  assert.notDeepEqual(before, after); assert.notEqual(positionChecksum(before), positionChecksum(after));
  assert.ok(after[0] < before[0]);
  const near = wrinkleApplePoint(...source, appleAppearance(1.000001));
  assert.ok(Math.abs(near[0] - before[0]) < 1e-7);
  assert.deepEqual(wrinkleApplePoint(...source, appleAppearance(1)), before);
  assert.deepEqual(wrinkleApplePoint(...source, appleAppearance(null)), source);
});

test('visual saturation does not change supplied loss value', () => {
  const large = appleAppearance(70);
  assert.equal(large.lossPercent, 70); assert.equal(large.visualLossPercent, 35); assert.equal(large.visuallyCapped, true);
  assert.ok(large.lengthScale > 0);
});

test('provided GLB vertices change at day 120, reset at day 0, and remain unavailable without reference opt-in', context => {
  const bytes = readFileSync(new URL('../public/models/hongro-apple.glb', import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const body = gltf.meshes.find((mesh: {name:string}) => mesh.name === 'Hongro_Apple_Body');
  assert.ok(body); assert.equal(body.primitives[0].targets, undefined);
  assert.ok(gltf.images.every((image:{bufferView?:number;uri?:string}) => typeof image.bufferView === 'number' && !image.uri));
  const accessor = gltf.accessors[body.primitives[0].attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5126); assert.ok(accessor.count > 1000);
  const binaryStart = 20 + jsonLength + 8;
  const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const input = {cultivar:'hongro',storage:'cold' as const,temperature:0,mcp:'untreated' as const,metric:'loss' as const};
  const baseline = appleAppearance(predictQuality({...input,day:0,allowFujiReference:true}).value);
  const later = appleAppearance(predictQuality({...input,day:120,allowFujiReference:true}).value);
  const missing = appleAppearance(predictQuality({...input,day:120,allowFujiReference:false}).value);
  const original:number[] = [], changed:number[] = [], restored:number[] = [], unknown:number[] = [];
  const centre = accessor.min.map((value:number, i:number) => (value + accessor.max[i]) / 2);
  const radius = Math.max(...accessor.max.map((value:number, i:number) => value - accessor.min[i])) / 2;
  for (let i = 0; i < accessor.count; i++) {
    const point = [0,1,2].map(axis => (bytes.readFloatLE(start + i * stride + axis * 4) - centre[axis]) / radius) as [number,number,number];
    original.push(...point); changed.push(...wrinkleApplePoint(...point, later));
    restored.push(...wrinkleApplePoint(...point, baseline)); unknown.push(...wrinkleApplePoint(...point, missing));
  }
  assert.notEqual(positionChecksum(changed), positionChecksum(original));
  assert.ok(changed.every(Number.isFinite));
  assert.equal(positionChecksum(restored),positionChecksum(original));
  assert.equal(positionChecksum(unknown),positionChecksum(original));
  assert.equal(missing.available,false); assert.equal(missing.lossPercent,null);
  assert.equal(later.lossPercent,1.62084); assert.ok(later.lengthScale<baseline.lengthScale);
  context.diagnostic(`GLB body vertices=${accessor.count}; checksum day0=${positionChecksum(original)}; day120=${positionChecksum(changed)}; reset=${positionChecksum(restored)}; lengthScale120=${later.lengthScale}`);
});
