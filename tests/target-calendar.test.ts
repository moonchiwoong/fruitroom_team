import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTargetDate, targetIcs} from '../lib/target-calendar';

test('목표 저장일 검사: 오늘 이후·저장 시작일 이후·계산 범위 안만 통과', () => {
  assert.deepEqual(checkTargetDate('2026-11-01', '2026-12-31', '2026-11-26', 120), {ok: true, day: 60});
  assert.match((checkTargetDate('2026-11-01', '2026-11-26', '2026-11-26', 120) as {reason: string}).reason, /오늘 이후/);
  assert.match((checkTargetDate('2026-11-01', '2027-03-02', '2026-11-26', 120) as {reason: string}).reason, /120일째\(2027-03-01\)까지/);
  assert.equal(checkTargetDate('2026-11-01', '2027-03-01', '2026-11-26', 120).ok, true);
  assert.match((checkTargetDate('2026-12-10', '2026-12-05', '2026-11-26', 120) as {reason: string}).reason, /저장 시작일 뒤/);
  assert.equal(checkTargetDate(null, '2026-12-31', '2026-11-26', 120).ok, false);
  assert.equal(checkTargetDate('2026-11-01', '', '2026-11-26', 120).ok, false);
});

test('캘린더 파일: 목표일 오전 9시 KST, 알림, 사과별 고정 UID, 계산값 문구, 75바이트 줄 접기', () => {
  const ics = targetIcs({lotId: 'abc', lotName: '1번 저장고, 후지', date: '2026-12-31', day: 60, quality: '단단함 54.6 N · 단맛 13.5 °Brix', url: 'https://trackap.netlify.app/#lot/abc', now: new Date('2026-11-26T06:00:00Z')});
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261231T090000/);
  assert.match(ics, /UID:appletrack-target-abc@trackap/);
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:-PT0M/);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:목표 저장일: 1번 저장고\\, 후지 \(저장 60일째\)/);
  assert.match(unfolded, /단단함 54\.6 N · 단맛 13\.5 °Brix \(그 뒤 측정에 따라 달라질 수 있어요\)/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(targetIcs({lotId: 'x', lotName: 'a', date: '2026-12-31', day: 60}).replace(/\r\n /g, ''), /계산한 이날 값/);
});
