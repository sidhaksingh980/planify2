/**
 * Recurrence engine — an RFC 5545 RRULE subset, implemented locally so there is
 * no runtime dependency and no network round-trip to expand a series.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (weekly),
 * BYMONTHDAY (monthly), BYMONTH (yearly), COUNT, UNTIL, plus EXDATE via the
 * `exceptions` array on the event.
 *
 * All expansion happens in *local* wall-clock time, which is what users expect:
 * a 9am daily standup stays at 9am even across a DST boundary.
 */
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  parseISO,
  startOfDay,
  startOfWeek,
} from './dates';
import { WEEKDAY_LABELS_MIN, dayKey, fromDayKey } from './dates';

/**
 * `until` is a date-only key in the local calendar, so parse it as one. Reading
 * it with `parseISO` treats 'YYYY-MM-DD' as UTC midnight, which silently drops
 * the last occurrence for users west of Greenwich.
 */
function parseUntil(until: string): Date {
  const key = until.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return fromDayKey(key);
  return parseISO(until);
}
import type { CalEvent, Occurrence, Recurrence, Weekday } from '../types';

/** Hard cap so a pathological rule can never hang the UI thread. */
const MAX_OCCURRENCES = 2000;

export function hasRecurrence(e: Pick<CalEvent, 'recurrence'>): boolean {
  return !!e.recurrence;
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                               */
/* -------------------------------------------------------------------------- */

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** `Recurrence` → canonical RRULE string (used for export and debugging). */
export function toRRule(r: Recurrence | null): string | null {
  if (!r) return null;
  const parts: string[] = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval && r.interval !== 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.byWeekday?.length) {
    parts.push(`BYDAY=${r.byWeekday.map((d) => DAY_CODES[d]).join(',')}`);
  }
  if (r.freq === 'monthly' && r.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  }
  if (r.freq === 'yearly') {
    if (r.byMonth?.length) parts.push(`BYMONTH=${r.byMonth.join(',')}`);
    if (r.byMonthDay?.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
  }
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${r.until.replace(/[-:]/g, '').split('.')[0]}Z`);
  return parts.join(';');
}

/** Canonical RRULE string → `Recurrence`. Returns null if unparseable. */
export function fromRRule(rrule: string | null | undefined): Recurrence | null {
  if (!rrule) return null;
  const body = rrule.replace(/^RRULE:/i, '');
  const out: Recurrence = { freq: 'weekly', interval: 1 };
  for (const raw of body.split(';')) {
    const [k, v] = raw.split('=');
    if (!k || v === undefined) continue;
    const key = k.trim().toUpperCase();
    const val = v.trim();
    switch (key) {
      case 'FREQ': {
        const f = val.toLowerCase();
        if (f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'yearly') {
          out.freq = f;
        }
        break;
      }
      case 'INTERVAL':
        out.interval = Math.max(1, Number(val) || 1);
        break;
      case 'BYDAY':
        out.byWeekday = val
          .split(',')
          .map((d) => DAY_CODES.indexOf(d.trim().toUpperCase().slice(-2)) as Weekday)
          .filter((d) => d >= 0) as Weekday[];
        break;
      case 'BYMONTHDAY':
        out.byMonthDay = val
          .split(',')
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);
        break;
      case 'BYMONTH':
        out.byMonth = val
          .split(',')
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);
        break;
      case 'COUNT':
        out.count = Math.max(1, Number(val) || 1);
        break;
      case 'UNTIL': {
        const iso = /^(\d{4})(\d{2})(\d{2})/.exec(val);
        if (iso) out.until = `${iso[1]}-${iso[2]}-${iso[3]}`;
        break;
      }
      default:
        break;
    }
  }
  if (out.freq === 'weekly' && !out.byWeekday?.length) out.byWeekday = undefined;
  return out;
}

/** "Every 2 weeks on Mo, We" — for the UI's repeat summary line. */
export function describeRecurrence(r: Recurrence | null, dtstart?: Date): string {
  if (!r) return 'Does not repeat';
  const n = r.interval && r.interval > 1 ? r.interval : 0;
  const unit =
    r.freq === 'daily' ? 'day' : r.freq === 'weekly' ? 'week' : r.freq === 'monthly' ? 'month' : 'year';
  const every = n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;

  let detail = '';
  if (r.freq === 'weekly') {
    const days = (r.byWeekday?.length ? r.byWeekday : dtstart ? [dtstart.getDay() as Weekday] : [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_LABELS_MIN[d]);
    if (days.length) detail = ` on ${days.join(', ')}`;
  } else if (r.freq === 'monthly') {
    const doms = r.byMonthDay?.length ? r.byMonthDay : dtstart ? [dtstart.getDate()] : [];
    if (doms.length === 1) detail = ` on day ${doms[0]}`;
    else if (doms.length > 1) detail = ` on days ${doms.join(', ')}`;
  }

  const tail = r.count ? `, ${r.count} time${r.count > 1 ? 's' : ''}` : r.until ? `, until ${parseUntil(r.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  return `${every}${detail}${tail}`;
}

/* -------------------------------------------------------------------------- */
/* Expansion                                                                   */
/* -------------------------------------------------------------------------- */

interface ExpandOptions {
  /** Inclusive lower bound of the window (local). */
  from: Date;
  /** Inclusive upper bound of the window (local). */
  to: Date;
  /** Extra safety cap. */
  limit?: number;
}

/**
 * Step to the next candidate start *after* `cursor`, honouring freq + interval +
 * BY* rules. Returns null when the series is exhausted.
 */
function nextCandidate(dtstart: Date, r: Recurrence, cursor: Date, emitted: number): Date | null {
  const interval = Math.max(1, r.interval || 1);

  if (r.count && emitted >= r.count) return null;
  if (r.until) {
    const until = parseISO(r.until);
    if (cursor.getTime() > until.getTime()) return null;
  }

  switch (r.freq) {
    case 'daily':
      return addDays(cursor, interval);

    case 'weekly': {
      const days = (r.byWeekday?.length
        ? [...new Set(r.byWeekday)].sort((a, b) => a - b)
        : [dtstart.getDay() as Weekday]) as Weekday[];

      // Weeks are counted from the week containing DTSTART, and only every
      // INTERVAL-th such week belongs to the series. Anchoring here (rather than
      // stepping from the previous occurrence) is what keeps the phase: without
      // it, "every 2 weeks on Monday" quietly becomes "every Monday" as soon as
      // the cursor lands in an off-cycle week.
      const anchorWeek = startOfWeek(dtstart);
      const time = {
        h: dtstart.getHours(),
        m: dtstart.getMinutes(),
        s: dtstart.getSeconds(),
      };

      // Walk aligned weeks only, skipping ahead when the cursor has run past the
      // anchor. The 2000-step guard means a pathological rule can never hang.
      const weeksElapsed = Math.max(
        0,
        Math.floor(differenceInCalendarDays(startOfWeek(cursor), anchorWeek) / (7 * interval)),
      );
      for (let step = weeksElapsed; step < weeksElapsed + 2000; step += 1) {
        const week = addWeeks(anchorWeek, step * interval);
        for (const dow of days) {
          const candidate = addDays(week, dow);
          candidate.setHours(time.h, time.m, time.s, 0);
          if (candidate.getTime() > cursor.getTime()) return candidate;
        }
      }
      return null;
    }

    case 'monthly': {
      const doms = (r.byMonthDay?.length
        ? [...new Set(r.byMonthDay)].sort((a, b) => a - b)
        : [dtstart.getDate()]) as number[];

      if (doms.length <= 1) {
        const dom = doms[0] ?? dtstart.getDate();
        // A month without that day (Feb 31) is skipped, not fatal — keep
        // walking forward until one exists. RFC 5545 does the same.
        let probe = cursor;
        for (let i = 0; i < 48; i += 1) {
          const next = addMonthsSafe(probe, interval, dom);
          if (next) return next;
          probe = addMonths(probe, interval);
        }
        return null;
      }

      const cursorDom = cursor.getDate();
      const laterThisMonth = doms.find((d) => d > cursorDom);
      if (laterThisMonth !== undefined) {
        const candidate = setDayOfMonth(cursor, laterThisMonth);
        if (candidate) return candidate;
      }
      // Roll to the first matching day of the next interval-month, skipping
      // months that don't contain it.
      let probe = cursor;
      for (let i = 0; i < 48; i += 1) {
        probe = addMonths(probe, interval);
        for (const dom of doms) {
          const candidate = setDayOfMonth(probe, dom);
          if (candidate && candidate.getTime() > cursor.getTime()) return candidate;
        }
      }
      return null;
    }

    case 'yearly': {
      const months = r.byMonth?.length
        ? [...new Set(r.byMonth)].sort((a, b) => a - b)
        : [dtstart.getMonth() + 1];
      // BYMONTHDAY is optional for yearly; without it the anniversary falls on
      // the same day-of-month as the first occurrence.
      const dom = r.byMonthDay?.length
        ? [...new Set(r.byMonthDay)].sort((a, b) => a - b)[0]
        : dtstart.getDate();
      const cursorMonth = cursor.getMonth() + 1;

      if (months.length === 1) {
        // Feb 29 only exists in leap years; step years until it does.
        let probe = cursor;
        for (let i = 0; i < 16; i += 1) {
          probe = addYears(probe, interval);
          const candidate = setMonthAndDay(probe, months[0], dom);
          if (candidate) return candidate;
        }
        return null;
      }

      const nextMonth = months.find((m) => m > cursorMonth);
      if (nextMonth !== undefined) {
        const candidate = setMonthAndDay(cursor, nextMonth, dom);
        if (candidate) return candidate;
      }
      let probe = cursor;
      for (let i = 0; i < 16; i += 1) {
        probe = addYears(probe, interval);
        for (const m of months) {
          const candidate = setMonthAndDay(probe, m, dom);
          if (candidate && candidate.getTime() > cursor.getTime()) return candidate;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/** `addMonths` that never overflows (Jan 31 + 1 month → Feb 28/29, skipped). */
function addMonthsSafe(d: Date, months: number, targetDom: number): Date | null {
  const next = addMonths(d, months);
  const candidate = setDayOfMonth(next, targetDom);
  return candidate;
}

/** Set day-of-month, returning null when that day doesn't exist (e.g. Feb 30). */
function setDayOfMonth(d: Date, dom: number): Date | null {
  const probe = new Date(d.getFullYear(), d.getMonth(), 1, d.getHours(), d.getMinutes(), d.getSeconds(), 0);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (dom > daysInMonth) return null;
  probe.setDate(dom);
  return probe;
}

function setMonthAndDay(d: Date, month: number, dom: number): Date | null {
  const probe = new Date(d.getFullYear(), month - 1, 1, d.getHours(), d.getMinutes(), d.getSeconds(), 0);
  const daysInMonth = new Date(probe.getFullYear(), month, 0).getDate();
  if (dom > daysInMonth) return null;
  probe.setDate(dom);
  return probe;
}

function durationMs(event: CalEvent): number {
  const s = parseStart(event);
  const e = parseEnd(event);
  return Math.max(0, e.getTime() - s.getTime());
}

function parseStart(event: CalEvent): Date {
  return event.allDay ? fromDayKey(event.startTime.slice(0, 10)) : parseISO(event.startTime);
}

function parseEnd(event: CalEvent): Date {
  if (event.allDay) {
    // All-day `endTime` is stored exclusive, matching Google Calendar.
    return fromDayKey(event.endTime.slice(0, 10));
  }
  return parseISO(event.endTime);
}

/**
 * Expand one event into the occurrences that intersect `[from, to]`.
 *
 * Non-recurring events are returned as-is when they overlap the window. The
 * recurring path first computes the series' overall span and skips entirely
 * when the window doesn't intersect it — that keeps a 10-year daily series
 * cheap to render in a single-month view.
 */
export function expandEvent(event: CalEvent, opts: ExpandOptions): Occurrence[] {
  if (event.deleted) return [];
  const { from, to } = opts;
  const limit = Math.min(opts.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const winStart = startOfDay(from).getTime();
  const winEnd = endOfDay(to).getTime();
  const out: Occurrence[] = [];

  const dtstart = parseStart(event);
  const dur = durationMs(event);
  const exceptionKeys = new Set(event.exceptions ?? []);

  if (!event.recurrence) {
    const end = parseEnd(event);
    if (end.getTime() >= winStart && dtstart.getTime() <= winEnd) {
      if (!exceptionKeys.has(dayKey(dtstart))) out.push(makeOccurrence(event, dtstart, end, 0));
    }
    return out;
  }

  const r = event.recurrence;

  // Fast path: is the whole series before/after the window?
  const until = r.until ? endOfDay(parseUntil(r.until)).getTime() : Infinity;
  if (r.count && r.count <= 0) return [];
  if (dtstart.getTime() > winEnd) return [];
  if (until < winStart) return [];

  let cursor = new Date(dtstart);
  let emitted = 0;
  let guard = 0;

  // For weekly BYDAY, align the first cursor to a matching weekday.
  if (r.freq === 'weekly' && r.byWeekday?.length && !r.byWeekday.includes(cursor.getDay() as Weekday)) {
    const target = [...r.byWeekday].sort((a, b) => a - b).find((d) => d > cursor.getDay());
    cursor = addDays(cursor, target !== undefined ? target - cursor.getDay() : 7 - cursor.getDay() + r.byWeekday[0]);
  }

  while (guard++ < limit * 4) {
    if (cursor.getTime() > winEnd) break;
    if (r.count && emitted >= r.count) break;
    if (r.until && cursor.getTime() > endOfDay(parseUntil(r.until)).getTime()) break;

    const end = new Date(cursor.getTime() + dur);
    if (end.getTime() >= winStart) {
      const key = dayKey(cursor);
      if (!exceptionKeys.has(key)) {
        out.push(makeOccurrence(event, new Date(cursor), end, emitted));
        if (out.length >= limit) break;
      }
    }
    emitted += 1;

    const next = nextCandidate(dtstart, r, cursor, emitted);
    if (!next) break;
    if (next.getTime() <= cursor.getTime()) break; // never go backwards
    cursor = next;
  }

  return out;
}

function makeOccurrence(event: CalEvent, start: Date, end: Date, index: number): Occurrence {
  const allDay = event.allDay;
  return {
    id: `${event.id}${index > 0 ? `:${index}` : ''}`,
    seriesId: event.id,
    event,
    start,
    end,
    startKey: allDay ? dayKey(start) : start.toISOString(),
    endKey: allDay ? dayKey(end) : end.toISOString(),
    allDay,
    index,
    isRecurring: !!event.recurrence,
  };
}

/** Expand many events, sorted by start then by title. */
export function expandAll(events: CalEvent[], from: Date, to: Date): Occurrence[] {
  const all: Occurrence[] = [];
  for (const e of events) {
    const occ = expandEvent(e, { from, to });
    for (const o of occ) all.push(o);
  }
  all.sort((a, b) => {
    const d = a.start.getTime() - b.start.getTime();
    if (d !== 0) return d;
    return a.event.title.localeCompare(b.event.title);
  });
  return all;
}

/** Bucket occurrences by local day key. */
export function bucketByDay(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const span = allDaySpan(o);
    for (const key of span) {
      const arr = map.get(key);
      if (arr) arr.push(o);
      else map.set(key, [o]);
    }
  }
  return map;
}

/** Every day key an occurrence touches (multi-day all-day events span several). */
export function allDaySpan(o: Occurrence): string[] {
  if (!o.allDay) return [dayKey(o.start)];
  const days = Math.max(1, differenceInCalendarDays(o.end, o.start));
  return Array.from({ length: days }, (_, i) => dayKey(addDays(o.start, i)));
}

/**
 * Compute the next occurrence strictly after `now` — used for reminders and
 * for the "upcoming" filter.
 */
export function nextOccurrenceAfter(event: CalEvent, now: Date): Occurrence | null {
  const occ = expandEvent(event, { from: now, to: addYears(now, 3), limit: 2 });
  for (const o of occ) {
    if (o.end.getTime() >= now.getTime()) return o;
  }
  return occ[0] ?? null;
}

export function recurrenceEnd(event: CalEvent): Date | null {
  if (!event.recurrence) return null;
  if (event.recurrence.until) return parseISO(event.recurrence.until);
  if (event.recurrence.count) {
    const occ = expandEvent(event, {
      from: parseStart(event),
      to: addYears(parseStart(event), 30),
      limit: event.recurrence.count,
    });
    return occ.length ? occ[occ.length - 1].end : null;
  }
  return null;
}
