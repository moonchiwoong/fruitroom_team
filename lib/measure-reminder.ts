// 다음 측정일 캘린더 일정(.ics). 서버 없이 이 기기에서 파일을 만들어 휴대폰·PC 캘린더에 넣습니다.
import {addDays, isDate} from '@/lib/tracker';

export const REMINDER_GAPS = [14, 21, 30] as const;
export type ReminderGap = typeof REMINDER_GAPS[number];

/** 기준일(마지막으로 잰 날, 없으면 저장 시작일) + 간격. 그 날이 오늘보다 앞이면 내일로 잡습니다. */
export function nextMeasureDate(base: string | null, gap: number, today: string): {date: string; overdue: boolean} | null {
  if (!base || !isDate(base) || !isDate(today)) return null;
  const due = addDays(base, gap);
  return due <= today ? {date: addDays(today, 1), overdue: true} : {date: due, overdue: false};
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** RFC 5545: 한 줄은 75바이트 이하. 넘으면 줄을 나누고 다음 줄은 공백으로 시작(한글이 깨지지 않게 글자 단위로 자름). */
function fold(line: string): string {
  const enc = new TextEncoder(), out: string[] = []; let cur = '', n = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n ');
}
const ymd = (d: string) => d.replace(/-/g, '');

/** 오전 9시(한국 시간) 30분 일정, 시작할 때 알림 1개. UID는 사과·날짜로 고정해 같은 일정을 다시 넣으면 덮어쓰도록 합니다. */
export function measureIcs({lotId, lotName, date, url, now = new Date()}: {lotId: string; lotName: string; date: string; url?: string; now?: Date}): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AppleTrack//Measure Reminder//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:appletrack-measure-${lotId}-${ymd(date)}@trackap`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Seoul:${ymd(date)}T090000`, `DTEND;TZID=Asia/Seoul:${ymd(date)}T093000`,
    `SUMMARY:${esc(`사과 측정: ${lotName}`)}`,
    `DESCRIPTION:${esc(`애플트랙에서 '${lotName}'의 당도·단단함을 재서 '측정 추가'로 넣어 주세요.${url ? `\n${url}` : ''}`)}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`사과 측정: ${lotName}`)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
