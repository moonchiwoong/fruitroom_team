import assert from 'node:assert/strict';
import test from 'node:test';
import {refFor, varietyRef} from '../lib/variety-reference';

test('품종 평균 참고선: 공개 자료 값 그대로, 정확한 품종 이름만', () => {
  assert.deepEqual([refFor('후지', 'brix')?.lo, refFor('후지', 'brix')?.hi], [14, 15]);
  assert.deepEqual([refFor('부사', 'acidity')?.lo, refFor('후지(부사)', 'acidity')?.hi], [0.4, 0.4]);
  assert.deepEqual([refFor('홍로', 'brix')?.lo, refFor('홍로', 'brix')?.hi], [14.5, 14.5]);
  assert.deepEqual([refFor('홍로', 'acidity')?.lo, refFor('홍로', 'acidity')?.hi], [0.25, 0.31]);
  assert.equal(refFor('홍로', 'firmness'), null); assert.equal(refFor('후지', 'loss'), null);
  assert.equal(varietyRef('미얀마후지'), null); assert.equal(varietyRef('감홍'), null); assert.equal(varietyRef(''), null);
});
