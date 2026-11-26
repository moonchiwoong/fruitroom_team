// 목표 저장일을 휴대폰·PC 캘린더에 넣는 .ics 파일 만들기.
import {addDays, daysBetween, isDate} from '@/lib/tracker';

export const TARGET_PRESETS = [30, 60, 90, 120] as const;

/** 목표 저장일 검사: 저장 시작일 이후, 오늘보다 뒤, 계산 범위(maxDay일) 안. 통과하면 저장 일수, 아니면 안내 문구. */
export function checkTargetDate(start: string | null, date: string, today: string, maxDay: number): {ok: true; day: number} | {ok: false; reason: string} {
  if (!start || !isDate(start)) return {ok: false, reason: '저장 시작일이 없어 목표 저장일을 정할 수 없어요.'};
  if (!isDate(date)) return {ok: false, reason: '목표 저장일을 골라 주세요.'};
  if (date <= today) return {ok: false, reason: '오늘 이후 날짜를 골라 주세요.'};
  const day = daysBetween(start, date);
  if (day < 1) return {ok: false, reason: '저장 시작일 뒤의 날짜를 골라 주세요.'};
  if (day > maxDay) return {ok: false, reason: `계산 범위는 저장 ${maxDay}일째(${addDays(start, maxDay)})까지예요.`};
  return {ok: true, day};
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** RFC 5545: 한 줄은 75바이트 이하. 넘으면 줄을 나누고 다음 줄은 공백으로 시작(한글이 깨지지 않게 글자 단위로 자름). */
function fold(line: string): string {
  const enc = new TextEncoder(), out: string[] = []; let cur = '', n = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n ');
}
const ymd = (d: string) => d.replace(/-/g, '');

/**
 * 목표 저장일 오전 9시(한국 시간) 30분 일정 + 시작할 때 알림.
 * UID는 사과별로 고정해 목표일을 바꿔 다시 넣으면 같은 일정이 바뀌도록 합니다(캘린더 앱이 지원할 때).
 * quality: 등록하는 시점의 계산값 문구(없으면 생략). 이후 측정으로 바뀔 수 있다는 점을 함께 적습니다.
 */
export function targetIcs({lotId, lotName, date, day, quality, url, now = new Date()}: {lotId: string; lotName: string; date: string; day: number; quality?: string; url?: string; now?: Date}): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const title = `목표 저장일: ${lotName} (저장 ${day}일째)`;
  const desc = [`애플트랙에서 정한 '${lotName}'의 목표 저장일이에요. 오늘 사과 상태를 확인해 주세요.`,
    quality ? `등록할 때 애플트랙이 계산한 이날 값: ${quality} (그 뒤 측정에 따라 달라질 수 있어요)` : '', url ?? ''].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AppleTrack//Target Storage Date//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:appletrack-target-${lotId}@trackap`, `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Seoul:${ymd(date)}T090000`, `DTEND;TZID=Asia/Seoul:${ymd(date)}T093000`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
