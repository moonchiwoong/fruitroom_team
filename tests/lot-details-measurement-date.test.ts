import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanDetails} from '../lib/lot-server';

test('측정일 연결 선택과 산도 미측정을 기록에 보존한다', () => {
  assert.deepEqual(cleanDetails({initial_same_start: true, not_measured: ['acidity', 'firmness', 'acidity']}), {
    initial_same_start: true,
    not_measured: ['acidity', 'firmness'],
  });
  assert.deepEqual(cleanDetails({initial_same_start: false, not_measured: []}), {
    initial_same_start: false,
    not_measured: [],
  });
});

test('기존 기록은 값이 없는 채로 유지하고 잘못된 선택값을 거부한다', () => {
  assert.deepEqual(cleanDetails({}), {});
  assert.throws(() => cleanDetails({initial_same_start: 'true'}));
  assert.throws(() => cleanDetails({not_measured: ['other']}));
});
