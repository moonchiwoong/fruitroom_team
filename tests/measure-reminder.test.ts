import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextMeasureDate} from '../lib/measure-reminder';

test('다음 측정일 = 기준일 + 간격, 이미 지났으면 내일', () => {
  assert.deepEqual(nextMeasureDate('2026-11-01', 21, '2026-11-10'), {date: '2026-11-22', overdue: false});
  assert.deepEqual(nextMeasureDate('2026-10-01', 21, '2026-11-22'), {date: '2026-11-23', overdue: true});
  assert.equal(nextMeasureDate(null, 21, '2026-11-22'), null);
});
