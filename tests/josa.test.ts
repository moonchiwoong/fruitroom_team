import test from 'node:test';
import assert from 'node:assert/strict';
import {josa} from '../lib/josa';
test('받침에 따라 조사를 고름', () => {
  assert.equal(josa('공동 출하', '은는'), '공동 출하는');
  assert.equal(josa('단단함', '은는'), '단단함은');
  assert.equal(josa('홍로 선별 물량', '을를'), '홍로 선별 물량을');
  assert.equal(josa('후지 1차', '을를'), '후지 1차를');
  assert.equal(josa('L-01', '은는'), 'L-01은(는)');
});
