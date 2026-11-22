import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextMeasureDate, measureIcs} from '../lib/measure-reminder';

test('다음 측정일 = 기준일 + 간격, 이미 지났으면 내일', () => {
  assert.deepEqual(nextMeasureDate('2026-11-01', 21, '2026-11-10'), {date: '2026-11-22', overdue: false});
  assert.deepEqual(nextMeasureDate('2026-10-01', 21, '2026-11-22'), {date: '2026-11-23', overdue: true});
  assert.equal(nextMeasureDate(null, 21, '2026-11-22'), null);
});
test('ics: 한국 시간 오전 9시, 알림 포함, 특수문자 이스케이프', () => {
  const s = measureIcs({lotId: 'L1', lotName: '후지, 1차; 입고', date: '2026-12-13', now: new Date('2026-11-22T00:00:00Z')});
  assert.match(s, /DTSTART;TZID=Asia\/Seoul:20261213T090000/);
  assert.match(s, /BEGIN:VALARM/);
  assert.match(s, /SUMMARY:사과 측정: 후지\\, 1차\; 입고/);
  assert.match(s, /UID:appletrack-measure-L1-20261213@trackap/);
  assert.ok(s.endsWith('\r\n'));
});
test('ics: 긴 줄은 75바이트 이하로 접힌다', () => {
  const s = measureIcs({lotId: 'L1', lotName: '아주 긴 이름의 사과 물량 '.repeat(4), date: '2026-12-13', url: 'https://trackap.netlify.app'});
  for (const line of s.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(s.replace(/\r\n /g, ''), /SUMMARY:사과 측정: 아주 긴 이름/);
});
