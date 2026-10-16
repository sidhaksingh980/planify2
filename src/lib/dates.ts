/**
 * Date + time helpers.
 *
 * Everything the UI renders goes through here so that (a) events are stored as
 * absolute UTC instants and (b) they are always displayed in the viewer's local
 * zone — which is what makes an event created on a laptop in New York show up
 * correctly on a phone in San Jose.
 */
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
  areIntervalsOverlapping,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format as fnsFormat,
  isSameDay,
  isSameMonth,
  isToday,
  isWithinInterval,
  max as fnsMax,
  min as fnsMin,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';
import type { TimeFormat, Weekday } from '../types';

export {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
  areIntervalsOverlapping,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  isSameDay,
  isSameMonth,
  isToday,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
};

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` in the *local* zone. The canonical bucket key for a day. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a `YYYY-MM-DD` into a local midnight Date. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
}

export function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** Safe `toISOString` for all-day date-only values. */
export function toISO(d: Date): string {
  return d.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatTime(d: Date, tf: TimeFormat): string {
  return fnsFormat(d, tf === '24h' ? 'HH:mm' : 'h:mm a');
}

/** "9:00 AM" → "9 AM" when the minutes are zero (Apple Calendar behaviour). */
export function formatTimeCompact(d: Date, tf: TimeFormat): string {
  if (d.getMinutes() === 0) {
    return fnsFormat(d, tf === '24h' ? 'HH:00' : 'h a');
  }
  return formatTime(d, tf);
}

export function formatDayHeading(d: Date): string {
  if (isToday(d)) return 'Today';
  if (isSameDay(d, addDays(new Date(), 1))) return 'Tomorrow';
  if (isSameDay(d, subDays(new Date(), 1))) return 'Yesterday';
  return fnsFormat(d, 'EEEE, MMMM d');
}

export function formatMonthTitle(d: Date): string {
  return fnsFormat(d, 'MMMM yyyy');
}

export function formatRangeTitle(start: Date, end: Date): string {
  if (isSameDay(start, end)) return fnsFormat(start, 'EEEE, MMMM d, yyyy');
  if (isSameMonth(start, end)) {
    return `${fnsFormat(start, 'MMM d')} – ${fnsFormat(end, 'd, yyyy')}`;
  }
  return `${fnsFormat(start, 'MMM d, yyyy')} – ${fnsFormat(end, 'MMM d, yyyy')}`;
}

export function formatAbsolute(d: Date, tf: TimeFormat): string {
  return `${fnsFormat(d, 'EEE, MMM d, yyyy')} · ${formatTime(d, tf)}`;
}

export function formatShortDate(d: Date): string {
  return fnsFormat(d, 'MMM d');
}

export function formatFullDate(d: Date): string {
  return fnsFormat(d, 'EEEE, MMMM d, yyyy');
}

/** "in 3 days", "2 hours ago" — used in agenda and AI summaries. */
export function formatRelative(d: Date, now: Date = new Date()): string {
  const mins = differenceInMinutes(d, now);
  const abs = Math.abs(mins);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(mins), 'minute');
  if (abs < 60 * 24) return rtf.format(Math.round(mins / 60), 'hour');
  if (abs < 60 * 24 * 7) return rtf.format(Math.round(mins / (60 * 24)), 'day');
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(mins / (60 * 24 * 7)), 'week');
  if (abs < 60 * 24 * 365) return rtf.format(Math.round(mins / (60 * 24 * 30)), 'month');
  return rtf.format(Math.round(mins / (60 * 24 * 365)), 'year');
}

/** "90 min" / "1 h 30 m" / "All day" */
export function formatDuration(start: Date, end: Date, allDay: boolean): string {
  if (allDay) {
    const days = Math.max(1, differenceInCalendarDays(end, start) + 1);
    return days === 1 ? 'All day' : `${days} days`;
  }
  const mins = Math.max(0, differenceInMinutes(end, start));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h} hr ${m} min`;
}

export const WEEKDAY_LABELS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_LABELS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const WEEKDAY_LABELS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Ordered weekday labels starting at the user's first day of week. */
export function weekdayLabels(firstDayOfWeek: Weekday, long = false): string[] {
  const src = long ? WEEKDAY_LABELS_LONG : WEEKDAY_LABELS_MIN;
  return Array.from({ length: 7 }, (_, i) => src[(i + firstDayOfWeek) % 7]);
}

/* -------------------------------------------------------------------------- */
/* Ranges                                                                      */
/* -------------------------------------------------------------------------- */

export function weekStart(d: Date, firstDayOfWeek: Weekday): Date {
  return startOfWeek(d, { weekStartsOn: firstDayOfWeek });
}

export function monthGridDays(anchor: Date, firstDayOfWeek: Weekday): Date[] {
  const start = weekStart(startOfMonth(anchor), firstDayOfWeek);
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: firstDayOfWeek });
  const days = differenceInCalendarDays(end, start) + 1;
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function weekDays(anchor: Date, firstDayOfWeek: Weekday, count: 5 | 7 = 7): Date[] {
  const start = weekStart(anchor, firstDayOfWeek);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function shiftAnchor(anchor: Date, view: 'month' | 'week' | 'day', delta: number): Date {
  if (view === 'month') return addMonths(anchor, delta);
  if (view === 'week') return addWeeks(anchor, delta);
  return addDays(anchor, delta);
}

export function clampDate(d: Date, lo: Date, hi: Date): Date {
  return fnsMax([fnsMin([d, hi]), lo]);
}

/* -------------------------------------------------------------------------- */
/* Building event times from user input                                        */
/* -------------------------------------------------------------------------- */

/** Combine a day + hours/minutes into a local Date. */
export function atTime(day: Date, hours: number, minutes = 0): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** `<input type="time">` value → hours/minutes. */
export function parseTimeInput(value: string): { hours: number; minutes: number } {
  const [h, m] = value.split(':').map(Number);
  return { hours: Number.isFinite(h) ? h : 0, minutes: Number.isFinite(m) ? m : 0 };
}

/** hours/minutes → `<input type="time">` value. */
export function toTimeInput(d: Date): string {
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

export function toDayInput(d: Date): string {
  return dayKey(d);
}

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function tzAbbrev(date: Date = new Date(), timeZone: string = LOCAL_TZ): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(
      date,
    );
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export function tzOffsetMinutes(date: Date, timeZone: string = LOCAL_TZ): number {
  // Offset of `timeZone` from UTC at the given instant, in minutes.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / MINUTE_MS);
}

/** Common timezones for the settings picker. */
export const COMMON_TIMEZONES = (() => {
  try {
    const all = Intl.supportedValuesOf('timeZone') as string[];
    const preferred = [
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'America/Sao_Paulo',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Paris',
      'Europe/Madrid',
      'Africa/Lagos',
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Singapore',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Pacific/Auckland',
      'UTC',
    ];
    const rest = all.filter((t) => !preferred.includes(t));
    return [...preferred.filter((t) => all.includes(t)), ...rest];
  } catch {
    return [LOCAL_TZ, 'UTC'];
  }
})();

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function startOfMinute(d: Date): Date {
  const n = new Date(d);
  n.setSeconds(0, 0);
  return n;
}

/** Snap to the nearest `step` minutes. */
export function snap(d: Date, step = 15): Date {
  const n = new Date(d);
  const m = n.getMinutes();
  n.setMinutes(Math.round(m / step) * step, 0, 0);
  return n;
}

/** Fraction (0–1) of a day elapsed — used to position events in the grid. */
export function dayFraction(d: Date): number {
  return (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) / 1440;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export { fnsFormat as format };

/** "90 min" → "1 hr 30 min". Used by summaries and duration labels. */
export function fmtMinutes(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} hr ${rest} min` : `${h} hr${h > 1 ? 's' : ''}`;
}
