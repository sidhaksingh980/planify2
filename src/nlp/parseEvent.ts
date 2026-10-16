/**
 * Turn a plain-English instruction into a concrete, reviewable event proposal.
 *
 * Pipeline:
 *   1. detect intent (create / reschedule / query / summarise)
 *   2. pull out clock time, day phrase, duration, recurrence, reminders, location
 *   3. whatever text survives is the title
 *   4. classify the title into a category and score confidence
 *
 * The parser never fabricates a required field. If the day is missing it says
 * so in `missing` and the assistant asks a follow-up question rather than
 * silently picking today.
 */
import {
  addDays,
  atTime,
  dayKey,
  startOfDay,
  tzAbbrev,
  LOCAL_TZ,
} from '../lib/dates';
import {
  parseDatePhrase,
  parseDaypart,
  parseDuration,
  parseEndTime,
  parseLocation,
  parseRecurrence,
  parseRecurrenceEnd,
  parseReminders,
  parseTime,
} from './parseDate';
import { suggestCategory } from './suggest';
import type { ProposedAction, ProposedEvent, Recurrence } from '../types';

export type Intent =
  | 'create'
  | 'reschedule'
  | 'move'
  | 'delete'
  | 'find_slots'
  | 'summarise'
  | 'search'
  | 'unknown';

export interface ParseContext {
  now: Date;
  timezone: string;
  defaultReminderMinutes: number;
  defaultCategoryId: string;
  /** Title of the event currently being discussed, for "reschedule it". */
  focusEventId?: string | null;
  focusEventTitle?: string | null;
}

export interface ParseResult {
  intent: Intent;
  action: ProposedAction | null;
  /** The user's message with all recognised fragments removed → the title. */
  titleGuess: string;
  confidence: number;
  missing: string[];
  warnings: string[];
  /** Everything the parser extracted, for the confirmation card. */
  extracted: {
    date?: string;
    time?: string;
    endTime?: string;
    durationMinutes?: number;
    recurrence?: Recurrence;
    reminders?: number[];
    location?: string;
    allDay?: boolean;
  };
}

const CREATE_VERBS =
  /\b(add|create|schedule|book|set up|setup|make|plan|put|arrange|new|reserve|log|block|block off|block out)\b/i;
const RESCHEDULE_VERBS = /\b(reschedule|move|shift|push|postpone|bring forward|change)\b/i;
const DELETE_VERBS = /\b(delete|remove|cancel|drop|clear)\b/i;
const SLOT_VERBS =
  /\b(find|suggest|show|recommend|what|when|where|any|free|available|open|gap|slot|slots|time to|room for|fit in)\b/i;
// Also covers the ways people actually ask: "what do I have on tomorrow",
// "what's my day look like", "show me next week". Without these, a question
// fell through to the create-intent fallback and proposed a junk event.
const SUMMARY_VERBS =
  /\b(summarize|summarise|summary|recap|overview|what(?:'s| is) on|how does|agenda|what am i doing|what (?:do|does) (?:i|my)\b|what(?:'s| is) (?:on )?my|what (?:is|are) my|show me|list (?:my|the|all)|how (?:is|does) my|what(?:'s| is) happening|what(?:'s| is) coming up|my (?:day|week|schedule) look)\b/i;

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (SUMMARY_VERBS.test(t)) return 'summarise';
  if (/\b(?:free|available|open)\s+(?:time|slot|slots)|\bfind (?:me )?(?:a |some )?(?:time|slot)|when (?:am i|can i|is)\b/i.test(t)) {
    return 'find_slots';
  }
  if (RESCHEDULE_VERBS.test(t)) return 'reschedule';
  if (DELETE_VERBS.test(t) && /(event|appointment|meeting|it|this|that|from (?:my )?calendar)/i.test(t)) {
    return 'delete';
  }
  if (CREATE_VERBS.test(t)) return 'create';
  // No verb, but it looks like an event with a time → treat as create.
  if (parseDatePhrase(t) || parseTime(t)) return 'create';
  if (SLOT_VERBS.test(t)) return 'find_slots';
  return 'unknown';
}

/** Strip a matched fragment from the working title string. */
function cut(haystack: string, fragment: string): string {
  if (!fragment) return haystack;
  const idx = haystack.toLowerCase().indexOf(fragment.toLowerCase());
  if (idx < 0) return haystack;
  return (haystack.slice(0, idx) + ' ' + haystack.slice(idx + fragment.length)).replace(/\s+/g, ' ');
}

export function parseEventInstruction(
  raw: string,
  ctx: ParseContext,
): ParseResult {
  const input = raw.trim().replace(/\s+/g, ' ');
  const intent = detectIntent(input);
  const missing: string[] = [];
  const warnings: string[] = [];
  const matchedFragments: string[] = [];

  let working = input;

  /* ---- 1. Drop the leading verb phrase ---------------------------------- */
  const verb = new RegExp(
    `^\\s*(?:please\\s+|can you\\s+|could you\\s+|i (?:want|need) to\\s+|i'd like to\\s+|let's\\s+|hey\\s+|hi\\s+)*(?:${CREATE_VERBS.source.replace(/\\b\(([^)]*)\)\\b/g, '$1')})\\s+(?:me\\s+)?(?:an?\\s+|the\\s+|some\\s+)?`,
    'i',
  );
  const verbMatch = verb.exec(working);
  if (verbMatch) working = working.slice(verbMatch[0].length);

  /* ---- 2. Reminders (before time, so "remind me an hour before" isn't
             mistaken for the event time) ----------------------------------- */
  const reminders = parseReminders(input);
  for (const r of reminders) {
    matchedFragments.push(r.matched);
    working = cut(working, r.matched);
  }
  const reminderMinutes = reminders.some((r) => r.minutes === -1)
    ? []
    : reminders.filter((r) => r.minutes > 0).map((r) => r.minutes);
  // "remind me the day before" also implies the day phrase is the event day.
  const hasExplicitReminder = reminders.length > 0;

  /* ---- 3. Recurrence ---------------------------------------------------- */
  const rec = parseRecurrence(input);
  let recurrence: Recurrence | null = null;
  if (rec) {
    recurrence = parseRecurrenceEnd(input, rec.recurrence, ctx.now);
    matchedFragments.push(rec.matched);
    working = cut(working, rec.matched);
  }

  /* ---- 4. Duration & end time ------------------------------------------- */
  const duration = parseDuration(input);
  if (duration) {
    matchedFragments.push(duration.matched);
    working = cut(working, duration.matched);
  }

  /* ---- 5. Clock time ---------------------------------------------------- */
  const clock = parseTime(input);
  const daypart = clock ? null : parseDaypart(input);
  const timeSource = clock ?? daypart;
  if (timeSource) {
    matchedFragments.push(timeSource.matched);
    working = cut(working, timeSource.matched);
  }

  // "at 1 PM" — the preposition is part of the noise, remove it too.
  const prepositionTime = new RegExp(`\\b(at|@|from|by|around|about|starting|starts?)\\s+${escapeFragment(timeSource?.matched ?? '')}\\b`, 'i');
  const preMatch = prepositionTime.exec(input);
  if (preMatch) working = cut(working, preMatch[0]);

  const endTimeParsed = parseEndTime(input, timeSource);
  if (endTimeParsed) {
    matchedFragments.push(endTimeParsed.matched);
    working = cut(working, endTimeParsed.matched);
  }

  /* ---- 6. Day phrase ---------------------------------------------------- */
  const datePhrase = parseDatePhrase(input, ctx.now);
  if (datePhrase) {
    matchedFragments.push(datePhrase.matched);
    working = cut(working, datePhrase.matched);
  }

  /* ---- 7. Location (after times, so "at 1pm" is never a place) ---------- */
  const loc = parseLocation(input, matchedFragments);
  if (loc) {
    matchedFragments.push(loc.matched);
    working = cut(working, loc.matched);
  }

  /* ---- 8. Title --------------------------------------------------------- */
  let title = cleanTitle(working, input);
  if (!title) {
    title = loc ? titleFromLocation(loc.location) : '';
  }
  if (!title) {
    missing.push('title');
    title = '';
  }

  /* ---- 9. Assemble the times -------------------------------------------- */
  const day = datePhrase?.date ? startOfDay(datePhrase.date) : null;

  if (!day && intent === 'create') {
    // Only default to today when the message clearly means "now-ish".
    if (/\b(today|tonight|now|asap|right away|immediately)\b/i.test(input)) {
      // handled by parseDatePhrase already
    } else {
      missing.push('date');
    }
  }

  const isAllDay = !timeSource && !!/all[- ]day|whole day|entire day|\boda\b/i.test(input);
  if (!timeSource && day && !isAllDay) {
    // A date with no clock time: all-day is the honest reading, but flag it so
    // the confirmation card makes the assumption visible.
    warnings.push('No time was specified, so this is set as an all-day event. Tell me a time if you want one.');
  }

  let start: Date;
  let end: Date;

  if (!day) {
    start = ctx.now;
    end = addDays(ctx.now, 1);
  } else if (isAllDay || (!timeSource && !missing.includes('date'))) {
    start = atTime(day, 0, 0);
    end = addDays(start, 1); // exclusive end, matching Google Calendar
  } else {
    const hours = timeSource?.hours ?? 9;
    const minutes = timeSource?.minutes ?? 0;
    start = atTime(day, hours, minutes);
    if (endTimeParsed) {
      end = atTime(day, endTimeParsed.time.hours, endTimeParsed.time.minutes);
      if (end.getTime() <= start.getTime()) end = addDays(end, 1);
    } else if (duration) {
      end = new Date(start.getTime() + duration.minutes * 60_000);
    } else if (timeSource?.fromDaypart) {
      // A daypart with no duration: 60 minutes is the conventional default,
      // and we say so rather than hiding it.
      end = new Date(start.getTime() + 60 * 60_000);
      warnings.push('No duration was given, so I set it to 1 hour.');
    } else {
      end = new Date(start.getTime() + 60 * 60_000);
      warnings.push('No duration was given, so I set it to 1 hour.');
    }
  }

  /* ---- 10. Category ------------------------------------------------------ */
  const categoryId = title ? suggestCategory(title, loc?.location ?? '') : ctx.defaultCategoryId;

  /* ---- 11. Final reminder default ---------------------------------------- */
  const finalReminders = hasExplicitReminder
    ? reminderMinutes
    : isAllDay || !day
      ? []
      : [ctx.defaultReminderMinutes].filter((m) => m > 0);

  const allDayFinal = isAllDay || (!timeSource && !!day);

  const event: ProposedEvent = {
    title: title || 'Untitled event',
    description: '',
    startTime: allDayFinal ? dayKey(start) : start.toISOString(),
    endTime: allDayFinal ? dayKey(end) : end.toISOString(),
    allDay: allDayFinal,
    timezone: ctx.timezone || LOCAL_TZ,
    location: loc?.location ?? '',
    categoryId,
    reminders: finalReminders,
    recurrence,
    exceptions: [],
  };

  /* ---- 12. Confidence ---------------------------------------------------- */
  let confidence = 0.35;
  if (title) confidence += 0.25;
  if (day) confidence += 0.2;
  if (timeSource && !timeSource.fromDaypart) confidence += 0.12;
  else if (timeSource) confidence += 0.05;
  if (duration || endTimeParsed) confidence += 0.08;
  confidence = Math.min(0.99, confidence);
  if (missing.length) confidence = Math.min(confidence, 0.45);

  const extracted: ParseResult['extracted'] = {
    date: day ? dayKey(day) : undefined,
    time: timeSource ? `${timeSource.hours}:${String(timeSource.minutes).padStart(2, '0')}` : undefined,
    endTime: endTimeParsed
      ? `${endTimeParsed.time.hours}:${String(endTimeParsed.time.minutes).padStart(2, '0')}`
      : undefined,
    durationMinutes: duration?.minutes,
    recurrence: recurrence ?? undefined,
    reminders: finalReminders,
    location: loc?.location,
    allDay: allDayFinal,
  };

  const summary = describeProposal(event, ctx);

  return {
    intent,
    action:
      intent === 'create' || intent === 'reschedule'
        ? {
            kind: intent === 'create' ? 'create_event' : 'reschedule_event',
            summary,
            event,
            missing,
            warnings,
            confidence,
          }
        : null,
    titleGuess: title,
    confidence,
    missing,
    warnings,
    extracted,
  };
}

function escapeFragment(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TITLE_NOISE =
  /^(?:to|for|on|at|and|the|a|an|my|our|with|from|by|in|it|this|that|please|then|also|remind me)\b[\s,]*/i;

function cleanTitle(working: string, original: string): string {
  let t = working
    .replace(/^[,;:\-\s]+/, '')
    .replace(/[,;:\-\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Peel leading noise words a couple of times.
  for (let i = 0; i < 4; i += 1) {
    const before = t;
    t = t.replace(TITLE_NOISE, '').trim();
    if (t === before) break;
  }

  // Drop a trailing "at <time>" leftover.
  t = t.replace(/\s+\b(?:at|@)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\.?$/i, '').trim();

  if (!t) return '';
  if (t.length > 120) t = t.slice(0, 120).trim();

  // Sentence-case it, preserving acronyms and existing capitals.
  const first = t[0];
  if (first && first === first.toLowerCase() && !/^[A-Z]{2,}/.test(original)) {
    t = first.toUpperCase() + t.slice(1);
  }
  return t;
}

function titleFromLocation(location: string): string {
  return location;
}

/** Plain-English statement of exactly what will be written. Shown pre-confirm. */
export function describeProposal(event: ProposedEvent, ctx: ParseContext): string {
  const start = event.allDay
    ? new Date(`${event.startTime}T00:00:00`)
    : new Date(event.startTime);
  const end = event.allDay ? new Date(`${event.endTime}T00:00:00`) : new Date(event.endTime);
  const tz = tzAbbrev(start, ctx.timezone || LOCAL_TZ);

  const datePart = start.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: start.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });

  let timePart: string;
  if (event.allDay) {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
    timePart = days === 1 ? 'All day' : `All day · ${days} days`;
  } else {
    const fmt = (d: Date) =>
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
    const mins = Math.round((end.getTime() - start.getTime()) / 60_000);
    const dur = mins < 60 ? `${mins} min` : mins % 60 === 0 ? `${mins / 60} hr` : `${Math.floor(mins / 60)} hr ${mins % 60} min`;
    timePart = `${fmt(start)} – ${fmt(end)} (${dur})`;
  }

  const bits = [`Create “${event.title}”`, `${datePart}`, timePart];
  if (event.location) bits.push(`at ${event.location}`);
  if (event.recurrence) bits.push(repeatPhrase(event.recurrence, start));
  if (event.reminders.length) {
    bits.push(
      `reminder${event.reminders.length > 1 ? 's' : ''} ${event.reminders
        .map(reminderPhrase)
        .join(' and ')}`,
    );
  }
  return `${bits.join(' · ')} · ${tz}`;
}

export function reminderPhrase(minutes: number): string {
  if (minutes <= 0) return 'at the start';
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return Number.isInteger(h) ? `${h} hour${h > 1 ? 's' : ''} before` : `${h.toFixed(1)} hours before`;
  }
  const d = minutes / 1440;
  if (Number.isInteger(d)) return d === 1 ? 'the day before' : `${d} days before`;
  const w = minutes / 10080;
  return Number.isInteger(w) ? `${w} week${w > 1 ? 's' : ''} before` : `${minutes} min before`;
}

export function repeatPhrase(r: Recurrence, start: Date): string {
  const n = r.interval && r.interval > 1 ? r.interval : 0;
  const unit = r.freq === 'daily' ? 'day' : r.freq === 'weekly' ? 'week' : r.freq === 'monthly' ? 'month' : 'year';
  const base = n > 1 ? `repeats every ${n} ${unit}s` : `repeats ${r.freq === 'daily' ? 'daily' : r.freq === 'weekly' ? 'weekly' : r.freq === 'monthly' ? 'monthly' : 'yearly'}`;
  if (r.freq === 'weekly' && r.byWeekday?.length) {
    const names = r.byWeekday.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]);
    return `${base} on ${names.join(', ')}`;
  }
  if (r.freq === 'monthly') {
    const doms = r.byMonthDay?.length ? r.byMonthDay : [start.getDate()];
    return `${base} on day ${doms.join(', ')}`;
  }
  return base;
}
