/**
 * Summaries and rescheduling advice, generated from the user's real events.
 *
 * If a range is empty the output says so plainly — it never pads the summary
 * with invented activity.
 */
import {
  addDays,
  dayKey,
  differenceInCalendarDays,
  differenceInMinutes,
  fmtMinutes,
  formatTime,
  startOfDay,
  startOfWeek,
  WEEKDAY_LABELS_LONG,
} from '../lib/dates';
import { expandAll } from '../lib/recurrence';
import { adviseReschedule, findConflicts, type SlotRequest } from './suggest';
import {
  CATEGORIES,
  getCategory,
  type CalEvent,
  type Occurrence,
  type TimeFormat,
  type Weekday,
} from '../types';

export type SummaryRange = 'today' | 'tomorrow' | 'week' | 'next-week' | 'month' | 'upcoming';

export interface SummaryResult {
  heading: string;
  /** Markdown-lite: the renderer turns `**bold**` and `- ` into real markup. */
  body: string;
  occurrences: Occurrence[];
  busyMinutes: number;
  freeMinutes: number;
}

function rangeFor(
  scope: SummaryRange,
  now: Date,
  firstDayOfWeek: Weekday,
): [Date, Date] {
  const today = startOfDay(now);
  switch (scope) {
    case 'today':
      return [today, today];
    case 'tomorrow':
      return [addDays(today, 1), addDays(today, 1)];
    case 'week': {
      const ws = startOfWeek(today, { weekStartsOn: firstDayOfWeek });
      return [ws, addDays(ws, 6)];
    }
    case 'next-week': {
      const ws = startOfWeek(today, { weekStartsOn: firstDayOfWeek });
      return [addDays(ws, 7), addDays(ws, 13)];
    }
    case 'month':
      return [today, addDays(today, 29)];
    case 'upcoming':
    default:
      return [today, addDays(today, 13)];
  }
}

const HEADINGS: Record<SummaryRange, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  'next-week': 'Next week',
  month: 'The next 30 days',
  upcoming: 'Coming up',
};

export function detectSummaryRange(text: string): SummaryRange | null {
  const t = text.toLowerCase();
  if (/\btoday\b|\btonight\b|rest of (?:the )?day/.test(t)) return 'today';
  if (/\btomorrow\b/.test(t)) return 'tomorrow';
  if (/\bnext week\b|\bweek ahead\b/.test(t)) return 'next-week';
  if (/\bthis week\b|\bmy week\b|\bweek\b/.test(t)) return 'week';
  if (/\bthis month\b|\bnext 30 days\b|\bmonth ahead\b/.test(t)) return 'month';
  if (/\bupcoming\b|\bcoming up\b|\bnext few days\b|\bwhat(?:'s| is) on\b|\bagenda\b|\brecap\b|\bsummar/.test(t)) {
    return 'upcoming';
  }
  return null;
}

export interface SummaryOptions {
  now: Date;
  timeFormat: TimeFormat;
  firstDayOfWeek: Weekday;
  dayStartHour: number;
  dayEndHour: number;
}

export function summarize(
  events: CalEvent[],
  scope: SummaryRange,
  opts: SummaryOptions,
): SummaryResult {
  const { now, timeFormat, firstDayOfWeek, dayStartHour, dayEndHour } = opts;
  const [from, to] = rangeFor(scope, now, firstDayOfWeek);
  const occ = expandAll(events.filter((e) => !e.deleted), from, addDays(to, 1)).filter((o) => {
    const k = dayKey(o.start);
    return k >= dayKey(from) && k <= dayKey(to);
  });

  const heading = HEADINGS[scope];
  const lines: string[] = [];
  let busyMinutes = 0;
  const capacity = workingMinutes(from, to, dayStartHour, dayEndHour);

  if (!occ.length) {
    return {
      heading,
      body: `**${heading} is completely clear.** Nothing scheduled.\n\nTell me what to add and I'll draft it for your approval.`,
      occurrences: [],
      busyMinutes: 0,
      freeMinutes: capacity,
    };
  }

  const multiDay = differenceInCalendarDays(to, from) > 0;

  if (multiDay) {
    const buckets = new Map<string, Occurrence[]>();
    for (const o of occ) {
      const k = dayKey(o.start);
      const arr = buckets.get(k) ?? [];
      arr.push(o);
      buckets.set(k, arr);
    }
    for (const k of [...buckets.keys()].sort()) {
      const dayOcc = buckets.get(k)!;
      const d = new Date(`${k}T12:00:00`);
      const label =
        k === dayKey(now)
          ? 'Today'
          : k === dayKey(addDays(now, 1))
            ? 'Tomorrow'
            : `${WEEKDAY_LABELS_LONG[d.getDay()]} ${d.getDate()}`;
      lines.push(`**${label}** — ${dayOcc.length} event${dayOcc.length > 1 ? 's' : ''}`);
      for (const o of dayOcc) {
        lines.push(`- ${lineFor(o, timeFormat)}`);
        if (!o.allDay) busyMinutes += differenceInMinutes(o.end, o.start);
      }
    }
  } else {
    for (const o of occ) {
      lines.push(`- ${lineFor(o, timeFormat)}`);
      if (!o.allDay) busyMinutes += differenceInMinutes(o.end, o.start);
    }
  }

  // Category mix — only when there is something worth saying.
  const counts = new Map<string, number>();
  for (const o of occ) counts.set(o.event.categoryId, (counts.get(o.event.categoryId) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (top.length > 1) {
    const mix = top
      .slice(0, 3)
      .map(([id, n]) => `${getCategory(id).name.toLowerCase()} ×${n}`)
      .join(', ');
    lines.push('', `Mostly ${mix}.`);
  }

  // Real overlaps only.
  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const o of occ) {
    if (o.allDay) continue;
    for (const hit of findConflicts(events, o.start, o.end, o.seriesId)) {
      if (hit.occurrence.seriesId === o.seriesId) continue;
      const key = [o.id, hit.occurrence.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push(
        `⚠️ “${o.event.title}” overlaps “${hit.occurrence.event.title}” by ${fmtMinutes(hit.overlapMinutes)}.`,
      );
    }
  }
  if (conflicts.length) lines.push('', ...conflicts.slice(0, 3));

  const totalDays = differenceInCalendarDays(to, from) + 1;
  const free = Math.max(0, capacity - busyMinutes);

  if (multiDay) {
    lines.unshift(
      `**${occ.length} events across ${totalDays} days · ${fmtMinutes(busyMinutes)} booked.**`,
    );
  } else {
    lines.unshift(`**${occ.length} event${occ.length > 1 ? 's' : ''} · ${fmtMinutes(busyMinutes)} booked.**`);
    lines.push('', `${fmtMinutes(free)} of your ${dayStartHour}:00–${dayEndHour}:00 window is still free.`);
  }

  return { heading, body: lines.join('\n'), occurrences: occ, busyMinutes, freeMinutes: free };
}

/** Capacity of the user's stated working window across [from, to], weekdays only. */
function workingMinutes(from: Date, to: Date, dayStartHour: number, dayEndHour: number): number {
  const perDay = Math.max(0, dayEndHour - dayStartHour) * 60;
  const days = differenceInCalendarDays(to, from) + 1;
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    const dow = addDays(from, i).getDay();
    if (dow === 0 || dow === 6) continue;
    total += perDay;
  }
  return total;
}

function lineFor(o: Occurrence, tf: TimeFormat): string {
  const cat = getCategory(o.event.categoryId);
  if (o.allDay) {
    return `All day — ${o.event.title}${o.event.location ? ` · ${o.event.location}` : ''} · ${cat.name}`;
  }
  const dur = fmtMinutes(differenceInMinutes(o.end, o.start));
  return `${formatTime(o.start, tf)}–${formatTime(o.end, tf)} (${dur}) — ${o.event.title}${
    o.event.location ? ` · ${o.event.location}` : ''
  }`;
}

/* -------------------------------------------------------------------------- */
/* Rescheduling advice                                                         */
/* -------------------------------------------------------------------------- */

export interface RescheduleAdvice {
  conflictSummary: string;
  keepEventId: string | null;
  moveEventId: string | null;
}

/**
 * Given two clashing occurrences, decide which one is cheaper to move.
 * Priority signals: recurrence (a series is disruptive to move), a location
 * (usually means a fixed booking), reminders, and distance in the future.
 */
export function whichToMove(a: Occurrence, b: Occurrence, now: Date): { keep: Occurrence; move: Occurrence } {
  const score = (o: Occurrence) => {
    let s = 0;
    if (o.event.recurrence) s += 40;
    if (o.event.location) s += 8;
    if (o.event.reminders.length) s += 6;
    s += Math.min(20, differenceInMinutes(o.start, now) / 1440);
    return s;
  };
  return score(a) >= score(b) ? { keep: a, move: b } : { keep: b, move: a };
}

/** Named day-parts for "find me time this afternoon" style requests. */
export function dayPartWindow(text: string, now: Date): { from: Date; to: Date } | null {
  const t = text.toLowerCase();
  const today = startOfDay(now);
  const hour = (h: number) => today.getTime() + h * 3_600_000;
  const tomorrow = /\btomorrow\b/.test(t);
  const offset = tomorrow ? 86_400_000 : 0;

  if (/\bmorning\b/.test(t)) {
    return { from: new Date(Math.max(now.getTime(), hour(6) + offset)), to: new Date(hour(12) + offset) };
  }
  if (/\bafternoon\b/.test(t)) {
    return { from: new Date(Math.max(now.getTime(), hour(12) + offset)), to: new Date(hour(17) + offset) };
  }
  if (/\bevening\b|\btonight\b/.test(t)) {
    return { from: new Date(Math.max(now.getTime(), hour(17) + offset)), to: new Date(hour(22) + offset) };
  }
  if (tomorrow) {
    return { from: new Date(hour(8) + 86_400_000), to: new Date(hour(20) + 86_400_000) };
  }
  return null;
}

export function categoryLegend(): string {
  return CATEGORIES.map((c) => c.name).join(', ');
}

export type { SlotRequest };
export { adviseReschedule };
