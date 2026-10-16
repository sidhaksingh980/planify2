/**
 * Calendar engine: view-range resolution, occurrence lookup, search/filter, and
 * the column layout algorithm that stops overlapping events from stacking on
 * top of each other in the time grid.
 */
import {
  addDays,
  dayKey,
  differenceInMinutes,
  endOfMonth,
  fmtMinutes,
  formatTime,
  monthGridDays,
  startOfDay,
  startOfMonth,
  weekDays,
} from './dates';
import { bucketByDay, expandAll } from './recurrence';
import { getCategory, type CalEvent, type CalendarViewMode, type Occurrence } from '../types';

/* -------------------------------------------------------------------------- */
/* View ranges                                                                 */
/* -------------------------------------------------------------------------- */

export interface ViewRange {
  /** First visible day (local, midnight). */
  start: Date;
  /** Last visible day (local, midnight). */
  end: Date;
  /** Every day cell in the range, in display order. */
  days: Date[];
  /** True when the range shows days outside the anchor month. */
  hasOutsideDays: boolean;
}

export function resolveRange(
  view: CalendarViewMode,
  anchor: Date,
  firstDayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6,
  weekCount: 5 | 7 = 7,
): ViewRange {
  switch (view) {
    case 'month': {
      const days = monthGridDays(anchor, firstDayOfWeek);
      return {
        start: days[0],
        end: days[days.length - 1],
        days,
        hasOutsideDays: true,
      };
    }
    case 'week': {
      const days = weekDays(anchor, firstDayOfWeek, weekCount);
      return { start: days[0], end: days[days.length - 1], days, hasOutsideDays: false };
    }
    case 'day':
      return {
        start: startOfDay(anchor),
        end: startOfDay(anchor),
        days: [startOfDay(anchor)],
        hasOutsideDays: false,
      };
    case 'agenda': {
      // 60 days forward from the anchor, or the whole anchor month if that's wider.
      const start = startOfDay(view === 'agenda' ? anchor : anchor);
      const end = addDays(start, 59);
      const days: Date[] = [];
      for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) days.push(d);
      return { start, end, days, hasOutsideDays: false };
    }
    default: {
      const days = monthGridDays(anchor, firstDayOfWeek);
      return { start: days[0], end: days[days.length - 1], days, hasOutsideDays: false };
    }
  }
}

export function monthLabel(anchor: Date): string {
  return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** For agenda we group by month; this gives the ordered month headings. */
export function monthsInRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cursor = startOfMonth(start);
  const last = startOfMonth(end);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return out;
}

export { endOfMonth };

/* -------------------------------------------------------------------------- */
/* Occurrences                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * All occurrences in the visible range, expanded once and reused by every view.
 * `expandAll` already sorts by start time.
 */
export function occurrencesFor(events: CalEvent[], range: ViewRange): Occurrence[] {
  return expandAll(
    events.filter((e) => !e.deleted),
    range.start,
    range.end,
  );
}

export interface DayBucket {
  /** Occurrences that render in the timed portion of the grid. */
  timed: Occurrence[];
  /** Occurrences that render in the all-day strip. */
  allDay: Occurrence[];
}

export function bucketForDay(buckets: Map<string, Occurrence[]>, key: string): DayBucket {
  const list = buckets.get(key) ?? [];
  return {
    timed: list.filter((o) => !o.allDay),
    allDay: list.filter((o) => o.allDay),
  };
}

export function bucketsFor(occurrences: Occurrence[]): Map<string, Occurrence[]> {
  return bucketByDay(occurrences);
}

/* -------------------------------------------------------------------------- */
/* Search & filter                                                             */
/* -------------------------------------------------------------------------- */

export interface EventFilters {
  query: string;
  categoryIds: string[];
  /** 'all' | 'upcoming' | 'today' | 'past' */
  when: 'all' | 'upcoming' | 'today' | 'past';
  /** Hide Google-Calendar-imported events. */
  hideImported: boolean;
}

export const EMPTY_FILTERS: EventFilters = {
  query: '',
  categoryIds: [],
  when: 'all',
  hideImported: false,
};

export function isFilterActive(f: EventFilters): boolean {
  return (
    f.query.trim().length > 0 ||
    f.categoryIds.length > 0 ||
    f.when !== 'all' ||
    f.hideImported
  );
}

/**
 * Search across title, location and notes. Dates are matched too, so "march 4"
 * or "4/3" finds events on that day. Matching is case- and accent-insensitive.
 */
export function matchesQuery(event: CalEvent, rawQuery: string, now: Date = new Date()): boolean {
  const q = normalize(rawQuery);
  if (!q) return true;

  const hay = normalize(
    [event.title, event.location, event.description, categoryNameOf(event.categoryId)].join(' \u0001 '),
  );
  if (hay.includes(q)) return true;

  // Every word must appear somewhere (AND semantics) — feels more predictable
  // than OR when searching notes.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => hay.includes(w))) return true;

  // Date matching.
  const start = event.allDay ? new Date(`${event.startTime.slice(0, 10)}T12:00:00`) : new Date(event.startTime);
  if (Number.isNaN(start.getTime())) return false;

  const dateStrings = [
    dayKey(start),
    start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    start.toLocaleDateString(undefined, { weekday: 'long' }),
    `${start.getMonth() + 1}/${start.getDate()}`,
    `${start.getDate()}/${start.getMonth() + 1}`,
  ].map(normalize);

  if (dateStrings.some((d) => d.includes(q))) return true;

  // Relative phrases people actually type into a search box.
  const todayKey = dayKey(now);
  if ((q === 'today' || q === 'todays') && dayKey(start) === todayKey) return true;
  if ((q === 'tomorrow' || q === 'tmrw') && dayKey(start) === dayKey(addDays(now, 1))) return true;
  if (/^(this week|week)$/.test(q)) {
    const diff = Math.abs(differenceInMinutes(start, now)) / 1440;
    return diff <= 7;
  }
  if (/^(repeating|recurring|repeat)$/.test(q)) return !!event.recurrence;
  if (/^(all day|all-day|allday)$/.test(q)) return event.allDay;

  return false;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function categoryNameOf(id: string): string {
  return getCategory(id).name;
}

export function applyFilters(
  events: CalEvent[],
  filters: EventFilters,
  now: Date = new Date(),
): CalEvent[] {
  const q = filters.query.trim();
  const todayKey = dayKey(now);

  return events.filter((e) => {
    if (e.deleted) return false;
    if (filters.hideImported && e.googleEventId) return false;
    if (filters.categoryIds.length && !filters.categoryIds.includes(e.categoryId)) return false;
    if (!matchesQuery(e, q, now)) return false;

    if (filters.when !== 'all') {
      const start = e.allDay ? new Date(`${e.startTime.slice(0, 10)}T00:00:00`) : new Date(e.startTime);
      if (Number.isNaN(start.getTime())) return false;
      if (filters.when === 'today' && dayKey(start) !== todayKey) return false;
      if (filters.when === 'upcoming' && start.getTime() < now.getTime() - 3_600_000) return false;
      if (filters.when === 'past' && start.getTime() > now.getTime()) return false;
    }
    return true;
  });
}

/** Sort for the agenda/search list: soonest first, then title. */
export function sortEventsForList(events: CalEvent[], now: Date): CalEvent[] {
  return [...events].sort((a, b) => {
    const as = startOf(a);
    const bs = startOf(b);
    // Upcoming first (ascending), then past events most-recent-first.
    const aFuture = as >= now.getTime();
    const bFuture = bs >= now.getTime();
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    if (aFuture) return as - bs || a.title.localeCompare(b.title);
    return bs - as || a.title.localeCompare(b.title);
  });
}

function startOf(e: CalEvent): number {
  const d = e.allDay ? new Date(`${e.startTime.slice(0, 10)}T00:00:00`) : new Date(e.startTime);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

/* -------------------------------------------------------------------------- */
/* Time-grid layout                                                            */
/* -------------------------------------------------------------------------- */

/** The visible hours of a day/week column, e.g. 07:00 → 22:00. */
export interface DayWindow {
  dayStartHour: number;
  dayEndHour: number;
}

/** Hour labels for the gutter, inclusive of both ends. */
export function hourTicks(window: DayWindow): number[] {
  const out: number[] = [];
  for (let h = window.dayStartHour; h <= window.dayEndHour; h += 1) out.push(((h % 24) + 24) % 24);
  return out;
}

export interface LaidOutOccurrence {
  occurrence: Occurrence;
  /** Percentage down the column (0–100). */
  top: number;
  /** Percentage of the column height. */
  height: number;
  /** Fraction of the column width, and the left offset within it. */
  width: number;
  left: number;
  /** Column index within its cluster. */
  column: number;
  columns: number;
  /** True when the event is visually narrowed by a neighbour. */
  overlapsOthers: boolean;
  /** True when the event started before the visible window and is clipped. */
  clippedTop: boolean;
  /** True when it runs past the visible window and is clipped. */
  clippedBottom: boolean;
}

interface Item {
  o: Occurrence;
  start: number;
  end: number;
}

/**
 * Lay out one day's timed occurrences into non-overlapping columns.
 *
 * Interval partitioning: sort by start, group into clusters of mutually
 * overlapping events, then greedily assign each event to the first column whose
 * previous event has already ended. Widths split evenly across the cluster's
 * columns with a small overhang so a partially hidden card stays grabbable.
 *
 * Occurrences that cross midnight are clipped to the day window and flagged, so
 * the card can show "until 1:00 AM" rather than stretching into tomorrow.
 */
export function layoutDay(occurrences: Occurrence[], day: Date, opts: DayWindow): LaidOutOccurrence[] {
  const totalMinutes = Math.max(60, (opts.dayEndHour - opts.dayStartHour) * 60);
  const windowStart = startOfDay(day).getTime() + opts.dayStartHour * 3_600_000;
  const windowEnd = startOfDay(day).getTime() + opts.dayEndHour * 3_600_000;

  const items: Item[] = [];
  for (const o of occurrences) {
    if (o.allDay) continue;
    const rawStart = o.start.getTime();
    const rawEnd = o.end.getTime();
    if (rawEnd <= windowStart || rawStart >= windowEnd) continue;

    const startMin = clampMin((Math.max(rawStart, windowStart) - windowStart) / 60_000, totalMinutes);
    const endMin = clampMin((Math.min(rawEnd, windowEnd) - windowStart) / 60_000, totalMinutes);
    items.push({ o, start: startMin, end: Math.max(endMin, startMin + MIN_VISIBLE_MINUTES) });
  }

  items.sort((a, b) => a.start - b.start || b.end - a.end);

  // Group into clusters of mutually overlapping events.
  const clusters: Item[][] = [];
  let current: Item[] = [];
  let clusterEnd = -Infinity;
  for (const item of items) {
    if (current.length && item.start >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (current.length) clusters.push(current);

  const out: LaidOutOccurrence[] = [];
  for (const cluster of clusters) {
    const columnEnds: number[] = [];
    const assigned: Array<{ item: Item; col: number }> = [];

    for (const item of cluster) {
      let col = columnEnds.findIndex((end) => end <= item.start + 0.5);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.end);
      } else {
        columnEnds[col] = item.end;
      }
      assigned.push({ item, col });
    }

    const columns = Math.max(1, columnEnds.length);
    const slot = 1 / columns;
    for (const { item, col } of assigned) {
      out.push({
        occurrence: item.o,
        top: (item.start / totalMinutes) * 100,
        height: Math.max(MIN_VISIBLE_PCT, ((item.end - item.start) / totalMinutes) * 100),
        width: columns === 1 ? 1 : slot * 0.92,
        left: col * slot,
        column: col,
        columns,
        overlapsOthers: columns > 1,
        clippedTop: item.o.start.getTime() < windowStart,
        clippedBottom: item.o.end.getTime() > windowEnd,
      });
    }
  }
  return out;
}

/** Minimum tap target: 22px at a typical row height. */
const MIN_VISIBLE_MINUTES = 20;
const MIN_VISIBLE_PCT = 2.2;

function clampMin(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

/** "9:00 – 10:30 AM" style compact range for a card. */
export function timeRangeLabel(o: Occurrence, timeFormat: '12h' | '24h'): string {
  if (o.allDay) return 'All day';
  return `${formatTime(o.start, timeFormat)} – ${formatTime(o.end, timeFormat)}`;
}

export function durationLabel(o: Occurrence): string {
  if (o.allDay) return 'All day';
  return fmtMinutes(Math.max(0, differenceInMinutes(o.end, o.start)));
}
