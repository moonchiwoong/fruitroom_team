// 다음 권장 측정일 계산.
import {addDays, isDate} from '@/lib/tracker';

export const REMINDER_GAPS = [14, 21, 30] as const;
export type ReminderGap = typeof REMINDER_GAPS[number];

/** 기준일(마지막으로 잰 날, 없으면 저장 시작일) + 간격. 그 날이 오늘보다 앞이면 내일로 잡습니다. */
export function nextMeasureDate(base: string | null, gap: number, today: string): {date: string; overdue: boolean} | null {
  if (!base || !isDate(base) || !isDate(today)) return null;
  const due = addDays(base, gap);
  return due <= today ? {date: addDays(today, 1), overdue: true} : {date: due, overdue: false};
}
