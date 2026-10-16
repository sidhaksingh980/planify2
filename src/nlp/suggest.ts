/**
 * Suggestion engine — categories, free slots, conflicts, titles, reminders.
 *
 * Every suggestion is computed from the user's *real* stored events. There is no
 * canned, seeded or demo content anywhere in this file: an empty calendar
 * produces an empty result, and the caller says so.
 */
import {
  addDays,
  addMinutes,
  atTime,
  dayKey,
  differenceInMinutes,
  fmtMinutes,
  startOfDay,
} from '../lib/dates';
import { expandAll } from '../lib/recurrence';
import type { CalEvent, Occurrence, TimeSlot } from '../types';

/* -------------------------------------------------------------------------- */
/* Category classification                                                     */
/* -------------------------------------------------------------------------- */

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  [
    'health',
    /\b(dentist|dental|doctor|gp|physio|physical therapy|therapy|therapist|counsell?or|psycholog|psychiat|clinic|hospital|checkup|check-up|vaccin|blood test|lab work|dermatolog|optometrist|eye exam|chiropract|acupuncture|medication|prescription|surgery|procedure|screening|mammogram|colonoscopy)\b/gi,
  ],
  [
    'focus',
    /\b(deep work|focus(?: time| block)?|writing|draft|study|studying|revision|research|reading|practice|rehearsal|prep(?:are|aration)?|homework|essay|thesis|dissertation|design sprint|no meetings)\b/gi,
  ],
  [
    'work',
    /\b(meeting|standup|stand-up|sync|retro|retrospective|sprint|planning|review|1:?1|one[- ]on[- ]one|demo|presentation|pitch|client|customer|stakeholder|board|interview|onboard|onboarding|training|workshop|seminar|conference|deadline|submit|ship|deploy|release|launch|kickoff|kick-off|all[- ]hands|town hall|okr|kpi|report|invoice|contract|negotiat|zoom|teams|google meet)\b/gi,
  ],
  [
    'travel',
    /\b(flight|fly|flying|airport|boarding|check-?in|hotel|airbnb|train|tram|metro|subway|bus|ferry|road trip|drive to|driving|departure|arrival|layover|connection|visa|passport|luggage|baggage|terminal|itinerary|trip|vacation|holiday|travel)\b/gi,
  ],
  [
    'social',
    /\b(lunch|dinner|brunch|breakfast|coffee|drinks|happy hour|cocktail|party|birthday|anniversary|date night|catch ?up|hangout|hang out|get together|reunion|celebrat|toast|rsvp|picnic|barbecue|bbq|meet ?up)\b/gi,
  ],
  [
    'family',
    /\b(kids?|children|child|son|daughter|school run|daycare|nursery|parent[- ]teacher|recital|soccer|football practice|swim(?:ming)? lesson|piano lesson|babysitter|nanny|grandma|grandpa|grandparents|mom|dad|mum|family)\b/gi,
  ],
  [
    'personal',
    /\b(gym|workout|run|running|yoga|pilates|meditat|haircut|barber|salon|manicure|massage|spa|cleaning|laundry|groceries|shopping|errand|bank|post office|car service|oil change|dog walk|vet|water plants|journal|walk)\b/gi,
  ],
];

export function suggestCategory(title: string, location = ''): string {
  const hay = `${title} ${location}`;
  let best = 'personal';
  let bestScore = 0;
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    re.lastIndex = 0;
    const hits = hay.match(re)?.length ?? 0;
    if (hits > bestScore) {
      bestScore = hits;
      best = cat;
    }
  }
  return bestScore > 0 ? best : 'personal';
}

/* -------------------------------------------------------------------------- */
/* Free-slot discovery                                                         */
/* -------------------------------------------------------------------------- */

export interface SlotRequest {
  /** Minutes the event needs. */
  durationMinutes: number;
  /** Earliest acceptable start (local). */
  from: Date;
  /** Latest acceptable end (local). */
  to: Date;
  /** Working window per day, e.g. 9–17. */
  dayStartHour: number;
  dayEndHour: number;
  /** Skip Saturday/Sunday. */
  workdaysOnly: boolean;
  /** How many to return. */
  count: number;
}

const BUFFER_MINUTES = 10;

/**
 * Find genuinely free windows in [from, to] based on the user's real events.
 *
 * Expands every occurrence in range, buckets by day, walks each day's working
 * window and collects gaps of at least `durationMinutes`. Candidates are scored
 * (mid-morning and mid-afternoon preferred, lunch hour and day edges penalised,
 * earlier in the range preferred) and the best N returned, at most two per day.
 */
export function findFreeSlots(events: CalEvent[], req: SlotRequest): TimeSlot[] {
  const live = events.filter((e) => !e.deleted);
  const occurrences = expandAll(live, startOfDay(req.from), addDays(startOfDay(req.to), 1));

  const byDay = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    for (const k of spannedDays(o)) {
      const arr = byDay.get(k) ?? [];
      arr.push(o);
      byDay.set(k, arr);
    }
  }

  const slots: TimeSlot[] = [];

  for (let d = startOfDay(req.from); d.getTime() <= req.to.getTime(); d = addDays(d, 1)) {
    const dow = d.getDay();
    if (req.workdaysOnly && (dow === 0 || dow === 6)) continue;

    const dayEvents = byDay.get(dayKey(d)) ?? [];
    // An all-day event blocks the day entirely.
    if (dayEvents.some((o) => o.allDay)) continue;

    const winStart = new Date(
      Math.max(atTime(d, req.dayStartHour, 0).getTime(), req.from.getTime()),
    );
    const winEnd = new Date(Math.min(atTime(d, req.dayEndHour, 0).getTime(), req.to.getTime()));
    if (winEnd.getTime() <= winStart.getTime()) continue;

    const busy = dayEvents
      .filter((o) => o.end > winStart && o.start < winEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = winStart;
    for (const o of busy) {
      slots.push(...gapBetween(cursor, o.start, req.durationMinutes));
      if (o.end.getTime() > cursor.getTime()) cursor = o.end;
    }
    slots.push(...gapBetween(cursor, winEnd, req.durationMinutes));
  }

  const scored = slots
    .map((s) => ({ ...s, score: scoreSlot(new Date(s.startTime), req) }))
    .sort((a, b) => b.score - a.score);

  const perDay = new Map<string, number>();
  const out: TimeSlot[] = [];
  for (const s of scored) {
    const k = dayKey(new Date(s.startTime));
    const n = perDay.get(k) ?? 0;
    if (n >= 2) continue;
    perDay.set(k, n + 1);
    out.push(s);
    if (out.length >= req.count) break;
  }
  return out.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

function spannedDays(o: Occurrence): string[] {
  if (!o.allDay) return [dayKey(o.start)];
  const days = Math.max(1, Math.round((o.end.getTime() - o.start.getTime()) / 86_400_000));
  return Array.from({ length: days }, (_, i) => dayKey(addDays(o.start, i)));
}

function gapBetween(from: Date, to: Date, needMinutes: number): TimeSlot[] {
  // Trim a little breathing room off both sides so suggestions aren't
  // back-to-back against an existing event.
  const start = new Date(from.getTime() + BUFFER_MINUTES * 60_000);
  const end = new Date(to.getTime() - BUFFER_MINUTES * 60_000);
  const snapped = snapForward(start, 15);
  const finish = addMinutes(snapped, needMinutes);
  if (finish.getTime() > end.getTime()) return [];
  if (finish.getTime() <= snapped.getTime()) return [];
  return [
    {
      startTime: snapped.toISOString(),
      endTime: finish.toISOString(),
      reason: '',
      score: 0,
    },
  ];
}

function snapForward(d: Date, step: number): Date {
  const n = new Date(d);
  n.setSeconds(0, 0);
  const m = n.getMinutes();
  const next = Math.ceil(m / step) * step;
  if (next >= 60) {
    n.setHours(n.getHours() + 1, 0, 0, 0);
  } else {
    n.setMinutes(next, 0, 0);
  }
  return n;
}

function scoreSlot(start: Date, req: SlotRequest): number {
  const hour = start.getHours() + start.getMinutes() / 60;
  let score = 100;

  if (hour >= 9.5 && hour <= 11.5) score += 22;
  else if (hour >= 14 && hour <= 16) score += 16;
  if (hour >= 12 && hour < 13.5) score -= 26;
  if (hour < req.dayStartHour + 0.5) score -= 14;
  if (hour > req.dayEndHour - 1.5) score -= 14;

  const daysOut = differenceInMinutes(start, req.from) / 1440;
  score -= Math.min(24, daysOut * 2.2);

  const dow = start.getDay();
  if (!req.workdaysOnly && (dow === 0 || dow === 6)) score -= 18;

  return score;
}

/** Attach a plain-language reason that references the user's actual neighbours. */
export function explainSlot(
  slot: TimeSlot,
  events: CalEvent[],
  dayStartHour: number,
  dayEndHour: number,
): TimeSlot {
  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  const occ = expandAll(events.filter((e) => !e.deleted), addDays(startOfDay(start), -1), addDays(startOfDay(end), 1));

  const before = occ
    .filter((o) => !o.allDay && o.end <= start && differenceInMinutes(start, o.end) <= 240)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const after = occ
    .filter((o) => !o.allDay && o.start >= end && differenceInMinutes(o.start, end) <= 240)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  const mins = differenceInMinutes(end, start);
  const parts: string[] = [`${mins} min free`];
  if (before) parts.push(`${fmtMinutes(differenceInMinutes(start, before.end))} after “${before.event.title}”`);
  if (after) parts.push(`${fmtMinutes(differenceInMinutes(after.start, end))} before “${after.event.title}”`);
  if (!before && start.getHours() <= dayStartHour + 1) parts.push('first thing in your working day');
  if (!after && end.getHours() >= dayEndHour - 1) parts.push('nothing scheduled after it');

  const label = start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return { ...slot, reason: `${label} — ${parts.join(', ')}` };
}

/* -------------------------------------------------------------------------- */
/* Conflict detection                                                          */
/* -------------------------------------------------------------------------- */

export interface Conflict {
  occurrence: Occurrence;
  /** Minutes of overlap with the proposed window. */
  overlapMinutes: number;
}

/**
 * Occurrences that overlap [start, end]. `ignoreEventId` excludes the series
 * being edited so an event never conflicts with itself.
 */
export function findConflicts(
  events: CalEvent[],
  start: Date,
  end: Date,
  ignoreEventId?: string,
): Conflict[] {
  const occ = expandAll(
    events.filter((e) => !e.deleted && e.id !== ignoreEventId),
    addDays(startOfDay(start), -1),
    addDays(startOfDay(end), 2),
  );
  const out: Conflict[] = [];
  for (const o of occ) {
    const oEnd = o.allDay ? addDays(startOfDay(o.start), 1) : o.end;
    const oStart = o.allDay ? startOfDay(o.start) : o.start;
    const s = Math.max(oStart.getTime(), start.getTime());
    const e = Math.min(oEnd.getTime(), end.getTime());
    if (e > s) out.push({ occurrence: o, overlapMinutes: Math.round((e - s) / 60_000) });
  }
  return out.sort((a, b) => b.overlapMinutes - a.overlapMinutes);
}

/* -------------------------------------------------------------------------- */
/* Titles, reminders, follow-ups                                               */
/* -------------------------------------------------------------------------- */

/** Normalise a raw title and offer a couple of tidy variants. */
export function suggestTitle(raw: string): string[] {
  const base = raw.trim().replace(/\s+/g, ' ');
  if (!base) return [];
  const out = new Set<string>();
  out.add(base[0].toUpperCase() + base.slice(1));
  const m = /^(meet|call|chat|sync|catch ?up)\s+(?:with\s+)?(.+)$/i.exec(base);
  if (m) {
    const who = m[2][0].toUpperCase() + m[2].slice(1);
    out.add(`${m[1][0].toUpperCase()}${m[1].slice(1)} with ${who}`);
  }
  return [...out].slice(0, 3);
}

/**
 * Sensible default reminder, based on what the event is and how far away it is.
 * Returned in minutes before start; 0 means "at the start".
 */
export function suggestReminder(event: CalEvent, now: Date = new Date()): number {
  const start = event.allDay
    ? new Date(`${event.startTime.slice(0, 10)}T09:00:00`)
    : new Date(event.startTime);
  const daysOut = differenceInMinutes(start, now) / 1440;
  const hay = `${event.title} ${event.location}`;

  if (/airport|flight|boarding|departure|train station/i.test(hay)) {
    return daysOut > 1 ? 1620 : 180; // day before + 3 hours
  }
  if (/dentist|doctor|clinic|hospital|checkup|interview/i.test(hay)) {
    return daysOut > 1 ? 1440 : 60;
  }
  if (event.allDay) return daysOut > 1 ? 1440 : 0;
  if (daysOut > 7) return 1440;
  if (daysOut > 1) return 180;
  return 10;
}

/** Follow-ups implied by an event — offered to the user, never auto-created. */
export function suggestFollowUps(event: Pick<CalEvent, 'title' | 'description' | 'location'>): string[] {
  const t = `${event.title} ${event.description} ${event.location}`.toLowerCase();
  const out: string[] = [];
  if (/\b(interview|candidate|hire)\b/.test(t)) out.push('Send interview feedback');
  if (/\b(client|customer|pitch|proposal)\b/.test(t)) out.push('Send the follow-up email');
  if (/\b(meeting|sync|1:?1|standup|retro)\b/.test(t)) out.push('Write up action items');
  if (/\b(dentist|doctor|clinic|checkup)\b/.test(t)) out.push('Book the next appointment');
  if (/\b(flight|trip|travel|hotel)\b/.test(t)) out.push('Check in and pack');
  if (/\b(birthday|anniversary|party)\b/.test(t)) out.push('Get a card or gift');
  if (/\b(dinner|lunch|brunch|restaurant)\b/.test(t)) out.push('Confirm the reservation');
  return out.slice(0, 3);
}

/**
 * Best-effort rescheduling advice for two clashing occurrences: which one to
 * keep, which to move, and real free slots for the one that moves.
 */
export function adviseReschedule(
  events: CalEvent[],
  a: Occurrence,
  b: Occurrence,
  req: Omit<SlotRequest, 'from' | 'to'> & { keep?: Occurrence },
): {
  conflictSummary: string;
  keepEventId: string;
  moveEventId: string;
  slots: TimeSlot[];
} {
  const score = (o: Occurrence) => {
    let s = 0;
    if (o.event.recurrence) s += 40;
    if (o.event.location) s += 8;
    if (o.event.reminders.length) s += 6;
    s += Math.min(20, differenceInMinutes(o.start, new Date()) / 1440);
    return s;
  };

  const keep = req.keep ?? (score(a) >= score(b) ? a : b);
  const move = keep === a ? b : a;

  const overlap = Math.max(
    0,
    Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()),
  );

  const slots = findFreeSlots(events, {
    ...req,
    from: move.start,
    to: addDays(move.start, 7),
    count: 4,
  }).map((s) => explainSlot(s, events, req.dayStartHour, req.dayEndHour));

  return {
    conflictSummary: `“${a.event.title}” and “${b.event.title}” overlap by ${fmtMinutes(
      Math.round(overlap / 60_000),
    )}. I'd keep “${keep.event.title}” where it is${
      keep.event.recurrence ? ' (it repeats)' : ''
    } and move “${move.event.title}”.`,
    keepEventId: keep.seriesId,
    moveEventId: move.seriesId,
    slots,
  };
}
