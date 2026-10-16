/**
 * Natural-language date/time parsing.
 *
 * A deterministic, dependency-free English parser. It resolves the expressions
 * people actually type into a calendar assistant — "next Tuesday at 1 PM",
 * "tomorrow morning", "the day after tomorrow at 3:30pm", "in 3 weeks",
 * "every weekday", "last day of the month" — into concrete local Dates.
 *
 * Design rule: **never invent**. If a component can't be resolved it is left
 * `undefined` and reported in `missing`, so the assistant asks instead of
 * guessing.
 */
import { addDays, addMonths, addWeeks, addYears, startOfDay, startOfWeek } from '../lib/dates';
import type { Recurrence, Weekday } from '../types';

const WEEKDAYS: Record<string, Weekday> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fortyfive: 45, 'forty-five': 45, sixty: 60, couple: 2, few: 3, half: 0.5,
  an: 1, a: 1,
};

export interface ParsedTime {
  hours: number;
  minutes: number;
  /** Which phrase produced this, so the caller can strip it from the title. */
  matched: string;
  /** True when the hour came from a daypart word ("morning") rather than a clock. */
  fromDaypart?: boolean;
}

export interface ParsedDate {
  date: Date;
  matched: string;
  /** True when only a date was found, no clock time. */
  allDayHint?: boolean;
}

export function num(word: string): number | undefined {
  const n = Number(word);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[word.toLowerCase()];
}

/** Extract a clock time: "1pm", "1:30 pm", "13:00", "noon", "half past nine". */
export function parseTime(text: string): ParsedTime | null {
  const t = text.toLowerCase();

  const specials: Array<[RegExp, number, number]> = [
    [/\bnoon\b/, 12, 0],
    [/\bmidday\b/, 12, 0],
    [/\bmidnight\b/, 0, 0],
  ];
  for (const [re, h, m] of specials) {
    const match = re.exec(t);
    if (match) return { hours: h, minutes: m, matched: match[0] };
  }

  // half past nine / quarter to five
  const relative =
    /\b(?:half past|halfpast)\s+([a-z]+)\b|\bquarter (?:past|after|to|before)\s+([a-z]+)\b/.exec(t);
  if (relative) {
    const word = (relative[1] ?? relative[2] ?? '').toLowerCase();
    const base = NUMBER_WORDS[word] ?? Number(word);
    if (Number.isFinite(base) && base >= 1 && base <= 23) {
      const isTo = /to|before/.test(relative[0]);
      let hours = base;
      let minutes = relative[0].includes('half') ? 30 : 15;
      if (isTo) {
        hours = base - 1;
        minutes = 60 - minutes;
      }
      return { hours: normaliseHour(hours, t, relative[0]), minutes, matched: relative[0] };
    }
  }

  // 1:30pm, 1.30 pm, 13:00, 1 pm, 4:00 in the afternoon
  const clock =
    /\b(\d{1,2})(?::(\d{2})|\.(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.|in the morning|in the afternoon|in the evening|at night|tonight)?\b/.exec(
      t,
    );
  if (clock) {
    const rawHour = Number(clock[1]);
    const minutes = Number(clock[2] ?? clock[3] ?? 0);
    if (rawHour >= 1 && rawHour <= 24 && minutes <= 59) {
      const meridiem = (clock[4] ?? '').replace(/\./g, '');
      // Reject bare numbers that are really durations/quantities, e.g. "for 90".
      const isBare = !meridiem && !clock[2] && !clock[3];
      const nearTimeWord = /(at|from|by|around|about|@)\s*$/.test(t.slice(0, clock.index));
      if (!isBare || nearTimeWord || rawHour > 12) {
        return {
          hours: resolveHour(rawHour, meridiem, t),
          minutes,
          matched: clock[0].trim(),
        };
      }
    }
  }

  // "at 1 o'clock"
  const oclock = /\b(\d{1,2})\s*o'?clock\s*(am|pm)?\b/.exec(t);
  if (oclock) {
    return {
      hours: resolveHour(Number(oclock[1]), oclock[2] ?? '', t),
      minutes: 0,
      matched: oclock[0],
    };
  }

  return null;
}

function normaliseHour(hour: number, fullText: string, _match: string): number {
  return resolveHour(hour, /pm|evening|afternoon|night/.test(fullText) ? 'pm' : '', fullText);
}

function resolveHour(rawHour: number, meridiem: string, fullText: string): number {
  const m = meridiem.toLowerCase();
  if (m.startsWith('pm') || m === 'tonight') {
    return rawHour === 12 ? 12 : rawHour + 12;
  }
  if (m.startsWith('am') || m === 'in the morning') {
    return rawHour === 12 ? 0 : rawHour;
  }
  // No meridiem: infer from context, defaulting to a working-hours reading.
  if (/(afternoon|evening|at night|tonight)/.test(fullText)) {
    return rawHour < 12 ? rawHour + 12 : rawHour;
  }
  if (rawHour > 12) return rawHour; // 24h input
  // A bare evening hour is PM: "dinner at 7" is never 07:00. Only applied when
  // the user gave no meridiem and no daypart, so "meeting at 9" stays 09:00.
  if (/\b(?:dinner|supper|drinks|party|date night|evening|tonight|sunset|cocktails?)\b/.test(fullText)) {
    return rawHour < 12 ? rawHour + 12 : rawHour;
  }
  return rawHour;
}

/** Coarse daypart → a specific, stated default hour. */
export function parseDaypart(text: string): ParsedTime | null {
  const t = text.toLowerCase();
  const table: Array<[RegExp, number, string]> = [
    [/\bearly morning\b/, 7, 'early morning'],
    [/\bmorning\b/, 9, 'morning'],
    [/\bmidday\b|\bnoon(time)?\b/, 12, 'midday'],
    [/\bafternoon\b/, 14, 'afternoon'],
    [/\blate afternoon\b/, 16, 'late afternoon'],
    [/\bearly evening\b/, 17, 'early evening'],
    [/\bevening\b/, 18, 'evening'],
    [/\bnight\b|\btonight\b/, 20, 'night'],
  ];
  for (const [re, hours, matched] of table) {
    if (re.test(t)) return { hours, minutes: 0, matched, fromDaypart: true };
  }
  return null;
}

/** Resolve the calendar day a phrase points at. */
export function parseDatePhrase(text: string, now: Date = new Date()): ParsedDate | null {
  const t = text.toLowerCase();
  const today = startOfDay(now);

  const named: Array<[RegExp, () => Date]> = [
    [/\btoday\b|\btonight\b/, () => today],
    [/\btomorrow\b|\btmrw\b|\btmr\b/, () => addDays(today, 1)],
    [/\bday after tomorrow\b/, () => addDays(today, 2)],
    [/\byesterday\b/, () => addDays(today, -1)],
  ];
  for (const [re, fn] of named) {
    const m = re.exec(t);
    if (m) return { date: fn(), matched: m[0] };
  }

  // "in 3 days / weeks / months"
  const inN = /\bin\s+(an|a|\d+|[a-z]+)\s+(day|days|week|weeks|month|months|year|years|weekday|weekdays)\b/.exec(
    t,
  );
  if (inN) {
    const n = num(inN[1]) ?? 1;
    const unit = inN[2].replace(/s$/, '');
    const date =
      unit === 'day'
        ? addDays(today, n)
        : unit === 'week'
          ? addWeeks(today, n)
          : unit === 'month'
            ? addMonths(today, n)
            : unit === 'year'
              ? addYears(today, n)
              : addBusinessDays(today, n);
    return { date, matched: inN[0] };
  }

  // "next Tuesday" / "this Friday" / "coming Monday"
  const nextDay =
    /\b(next|this|coming|upcoming|on|this coming)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/.exec(
      t,
    );
  if (nextDay) {
    const dow = WEEKDAYS[nextDay[2]];
    if (dow !== undefined) {
      const qualifier = nextDay[1];
      return { date: resolveWeekday(today, dow, qualifier), matched: nextDay[0].trim() };
    }
  }

  // "Friday next week"
  const dayNextWeek =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s+next\s+week\b/.exec(
      t,
    );
  if (dayNextWeek) {
    const dow = WEEKDAYS[dayNextWeek[1]];
    return { date: addDays(addWeeks(startOfWeek(today), 1), dow), matched: dayNextWeek[0] };
  }

  // Bare "next week" (no weekday named) → the Monday of the following week.
  // Monday rather than the calendar's first day because the parser has no
  // access to the user's firstDayOfWeek setting, and nobody means Sunday.
  const bareNextWeek = /\b(?:next|the following|the coming)\s+week\b/.exec(t);
  if (bareNextWeek) {
    const monday = addDays(addWeeks(startOfWeek(today), 1), 1);
    return { date: monday, matched: bareNextWeek[0], allDayHint: true };
  }

  // "the weekend" / "this weekend" → upcoming Saturday
  const weekend = /\b(this|next|the)?\s*weekend\b/.exec(t);
  if (weekend) {
    const sat = resolveWeekday(today, 6, weekend[1] === 'next' ? 'next' : 'this');
    return { date: sat, matched: weekend[0].trim() };
  }

  // "March 14" / "14 March" / "March 14 2027"
  const monthDay =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/.exec(
      t,
    );
  if (monthDay) {
    const month = MONTHS[monthDay[1]];
    const day = Number(monthDay[2]);
    if (month && day >= 1 && day <= 31) {
      let year = monthDay[3] ? Number(monthDay[3]) : today.getFullYear();
      let candidate = safeDate(year, month, day);
      if (candidate && !monthDay[3] && candidate.getTime() < today.getTime() - 1) {
        year += 1;
        candidate = safeDate(year, month, day);
      }
      if (candidate) return { date: candidate, matched: monthDay[0] };
    }
  }

  const dayMonth =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\b/.exec(
      t,
    );
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS[dayMonth[2]];
    if (month && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      let candidate = safeDate(year, month, day);
      if (candidate && candidate.getTime() < today.getTime() - 1) {
        year += 1;
        candidate = safeDate(year, month, day);
      }
      if (candidate) return { date: candidate, matched: dayMonth[0] };
    }
  }

  // ISO-ish "2027-03-14" or "3/14/2027"
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) {
    const d = safeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (d) return { date: d, matched: iso[0] };
  }
  const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(t);
  if (us) {
    const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    const d = safeDate(year, Number(us[1]), Number(us[2]));
    if (d) return { date: d, matched: us[0] };
  }

  // "end of month", "first Monday of next month"
  const eom = /\b(?:end|last day) of (?:the )?month\b/.exec(t);
  if (eom) {
    return { date: new Date(today.getFullYear(), today.getMonth() + 1, 0), matched: eom[0] };
  }

  return null;
}

function safeDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * Weekday resolution. The rule that matches how people actually talk:
 *
 *   – unqualified ("Tuesday") or "this Tuesday": the soonest occurrence, which
 *     is today when today already is that weekday.
 *   – "next Tuesday": the Tuesday of the *following* week. On Thursday, "next
 *     Friday" is the Friday after tomorrow's, not tomorrow — booking a week
 *     early is the one mistake a calendar assistant cannot make quietly.
 *   – "this coming Tuesday" / "upcoming Tuesday": the soonest one strictly in
 *     the future, never today.
 *   – "last Tuesday": the most recent past occurrence.
 */
export function resolveWeekday(today: Date, dow: Weekday, qualifier?: string | null): Date {
  const current = today.getDay() as Weekday;
  const ahead = (dow - current + 7) % 7;

  if (qualifier === 'last' || qualifier === 'previous') {
    return ahead === 0 ? addDays(today, -7) : addDays(today, ahead - 7);
  }
  if (qualifier === 'next') {
    // The named day in the week after the current one.
    return addDays(startOfWeek(today), 7 + dow);
  }
  if (qualifier === 'coming' || qualifier === 'upcoming') {
    // Soonest strictly-future occurrence.
    return ahead === 0 ? addDays(today, 7) : addDays(today, ahead);
  }
  return ahead === 0 ? today : addDays(today, ahead);
}

export function addBusinessDays(from: Date, n: number): Date {
  let d = new Date(from);
  let added = 0;
  while (added < n) {
    d = addDays(d, 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d;
}

/* -------------------------------------------------------------------------- */
/* Duration                                                                    */
/* -------------------------------------------------------------------------- */

export interface ParsedDuration {
  minutes: number;
  matched: string;
}

/** "for 90 minutes", "1.5 hours", "half an hour", "30 mins", "until 3pm". */
export function parseDuration(text: string): ParsedDuration | null {
  const t = text.toLowerCase();

  const forN =
    /\b(?:for|lasting|duration(?: of)?|takes?)\s+(an|a|half an|\d+(?:\.\d+)?|[a-z-]+)\s*(hour|hours|hr|hrs|minute|minutes|min|mins|day|days|week|weeks)?\b/.exec(
      t,
    );
  if (forN) {
    const n = forN[1] === 'half an' ? 0.5 : (num(forN[1]) ?? 1);
    const unit = (forN[2] ?? 'minute').replace(/s$/, '');
    const minutes =
      unit.startsWith('hour') || unit.startsWith('hr')
        ? Math.round(n * 60)
        : unit.startsWith('day')
          ? Math.round(n * 1440)
          : unit.startsWith('week')
            ? Math.round(n * 10080)
            : Math.round(n);
    if (minutes > 0) return { minutes, matched: forN[0] };
  }

  const bare = /\b(\d+(?:\.\d+)?|an|a|half an)\s*(hours?|hrs?|minutes?|mins?)\b/.exec(t);
  if (bare) {
    const n = bare[1] === 'half an' ? 0.5 : (num(bare[1]) ?? 1);
    const unit = bare[2];
    const minutes = /hour|hr/.test(unit) ? Math.round(n * 60) : Math.round(n);
    if (minutes > 0) return { minutes, matched: bare[0] };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Recurrence                                                                  */
/* -------------------------------------------------------------------------- */

export interface ParsedRecurrence {
  recurrence: Recurrence;
  matched: string;
}

export function parseRecurrence(text: string): ParsedRecurrence | null {
  const t = text.toLowerCase();

  const every =
    /\b(?:every|each|recurring|repeats?|repeat(?:s|ing)?)\s+(?:(\d+|[a-z-]+)\s+)?(day|days|week|weeks|month|months|year|years|weekday|weekdays|weekend|weekends|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|tue|wed|weds|thu|thur|thurs|fri|sat|sun)(?:\s*(?:and|,|&)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|tue|wed|weds|thu|thur|thurs|fri|sat|sun))*\b/;
  const m = every.exec(t);
  if (!m) {
    const daily = /\b(?:every day|daily|each day)\b/.exec(t);
    if (daily) return { recurrence: { freq: 'daily', interval: 1 }, matched: daily[0] };
    const weekly = /\b(?:every week|weekly|each week)\b/.exec(t);
    if (weekly) return { recurrence: { freq: 'weekly', interval: 1 }, matched: weekly[0] };
    const monthly = /\b(?:every month|monthly|each month)\b/.exec(t);
    if (monthly) return { recurrence: { freq: 'monthly', interval: 1 }, matched: monthly[0] };
    const yearly = /\b(?:every year|yearly|annually|each year)\b/.exec(t);
    if (yearly) return { recurrence: { freq: 'yearly', interval: 1 }, matched: yearly[0] };
    return null;
  }

  const interval = m[1] ? (num(m[1]) ?? 1) : 1;
  const unit = m[2];

  if (unit === 'weekday' || unit === 'weekdays') {
    return {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
      matched: m[0],
    };
  }
  if (unit === 'weekend' || unit === 'weekends') {
    return {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [0, 6] },
      matched: m[0],
    };
  }

  const dow = WEEKDAYS[unit];
  if (dow !== undefined) {
    const days = new Set<Weekday>([dow]);
    if (m[3]) {
      const extra = WEEKDAYS[m[3]];
      if (extra !== undefined) days.add(extra);
    }
    // Also catch "Monday, Wednesday and Friday"
    const list = /\b(?:every|each)\s+([a-z,\s&and]+?)(?=\s+(?:at|from|for|until|starting|beginning|remind|$))/i.exec(
      t,
    );
    if (list) {
      for (const part of list[1].split(/,|\band\b|&/)) {
        const w = WEEKDAYS[part.trim().toLowerCase()];
        if (w !== undefined) days.add(w);
      }
    }
    return {
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [...days].sort((a, b) => a - b) },
      matched: m[0],
    };
  }

  const freq =
    unit.startsWith('day')
      ? 'daily'
      : unit.startsWith('week')
        ? 'weekly'
        : unit.startsWith('month')
          ? 'monthly'
          : 'yearly';
  return { recurrence: { freq, interval: Math.max(1, interval) }, matched: m[0] };
}

/** "until December" / "for 10 occurrences" → count/until on a recurrence. */
export function parseRecurrenceEnd(text: string, base: Recurrence, now = new Date()): Recurrence {
  const t = text.toLowerCase();
  const times = /\b(?:for|over)\s+(\d+|[a-z]+)\s+(?:times|occurrences|weeks|months)\b/.exec(t);
  if (times) {
    const n = num(times[1]) ?? 1;
    const unit = times[2];
    if (unit === 'times' || unit === 'occurrences') return { ...base, count: n };
    if (unit === 'weeks') return { ...base, until: addWeeks(now, n).toISOString().slice(0, 10) };
    if (unit === 'months') return { ...base, until: addMonths(now, n).toISOString().slice(0, 10) };
  }
  const until = /\b(?:until|through|till|up to|ending)\s+(?:the end of\s+)?([a-z]+)(?:\s+(\d{4}))?\b/.exec(t);
  if (until && MONTHS[until[1]]) {
    const month = MONTHS[until[1]];
    const year = until[2] ? Number(until[2]) : now.getFullYear();
    const end = new Date(year, month, 0, 23, 59, 59);
    if (end.getTime() < now.getTime()) end.setFullYear(year + 1);
    return { ...base, until: end.toISOString().slice(0, 10) };
  }
  return base;
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

export interface ParsedReminder {
  minutes: number;
  matched: string;
}

export function parseReminders(text: string): ParsedReminder[] {
  const t = text.toLowerCase();
  const out: ParsedReminder[] = [];

  const patterns: RegExp[] = [
    /\bremind me\s+(?:an?\s+)?(\d+|[a-z-]+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)?\s*(?:before|ahead|prior|early)?\b/g,
    /\b(?:an?\s+)?(\d+|[a-z-]+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks)\s*(?:before|ahead|prior|early)\b/g,
    /\bremind me\s+(the day before|a day before|the day ahead|the week before|an hour before|day before)\b/g,
    /\b(?:with a|set a|add a)?\s*reminder\s*(?:for|at|of)?\s*(the day before|a day before|the week before|an hour before)?\b/g,
    /\bno reminder\b|\bwithout a reminder\b|\bdon'?t remind me\b/g,
  ];

  const seen = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const matched = m[0];
      if (seen.has(matched)) continue;
      seen.add(matched);

      if (/no reminder|without a reminder|don'?t remind/.test(matched)) {
        out.push({ minutes: -1, matched });
        continue;
      }
      const phrase = (m[1] ?? '').toLowerCase();
      if (/the day before|a day before|day before|the day ahead/.test(matched)) {
        out.push({ minutes: 1440, matched });
        continue;
      }
      if (/the week before/.test(matched)) {
        out.push({ minutes: 10080, matched });
        continue;
      }
      if (/an hour before/.test(matched)) {
        out.push({ minutes: 60, matched });
        continue;
      }
      const n = num(phrase) ?? 1;
      const unit = (m[2] ?? 'minute').toLowerCase();
      const minutes = /hour|hr/.test(unit)
        ? n * 60
        : /day/.test(unit)
          ? n * 1440
          : /week/.test(unit)
            ? n * 10080
            : n;
      out.push({ minutes: Math.round(minutes), matched });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Location                                                                    */
/* -------------------------------------------------------------------------- */

// Phrases that follow "at"/"in" but are never a place. Note `the office` is
// deliberately absent — it is a real location and is whitelisted below.
const NON_LOCATION = /^(?:\d|one|two|three|the\s+(?:time|same|morning|afternoon|evening)|noon|midnight|am|pm|least|most|first|last|home|work$)/;

export interface ParsedLocation {
  location: string;
  matched: string;
}

export function parseLocation(text: string, timeMatches: string[]): ParsedLocation | null {
  // `g` but not `i`: the alternation already lists both cases, and keeping the
  // original casing is what lets proper-noun detection below work.
  //
  // The lookahead is the important part. It ends the captured span at the next
  // word that begins a *time* phrase (a preposition, a clock, a daypart, a
  // weekday, a relative day, a duration or a recurrence). Without the clock and
  // weekday alternatives, "at Blue Bottle tomorrow" would swallow "tomorrow".
  const re = new RegExp(
    '\\b(?:[Aa][Tt]|@|[Ii][Nn]|[Nn][Ee][Aa][Rr]|[Ff][Rr][Oo][Mm])\\s+' +
      '([^,.;:!?\\n]+?)' +
      '(?=\\s+(?:at|in|on|near|from|by|to|until|till|for|remind|and remind|every|each|daily|weekly|monthly|yearly' +
      '|with a reminder|with|starting|starts?|ends?|ending' +
      '|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?' +
      '|noon|midday|midnight|morning|afternoon|evening|night|tonight|sharp' +
      '|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun' +
      '|today|tomorrow|tmrw|yesterday|weekend|next|this|last' +
      '|minutes?|mins?|hours?|hrs?|days?|weeks?)' +
      '|[,.;!?]|$)',
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].trim().replace(/\s+/g, ' ');
    if (!candidate) continue;
    // A pure clock reading is never a place. Checked before timeMatches so a
    // span that merely *contains* a time can still be a valid location.
    if (/^(?:\d+\s*(?:am|pm|a\.m\.|p\.m\.|min|mins|minutes|hours?|hrs?)?)$/i.test(candidate)) continue;
    if (timeMatches.some((tm) => candidate.toLowerCase().includes(tm.toLowerCase()))) continue;
    if (NON_LOCATION.test(candidate.toLowerCase())) continue;
    if (candidate.split(' ').length > 6) continue;
    if (/^(?:home|work|the office|my place|their place)$/i.test(candidate)) {
      return { location: candidate.replace(/^\w/, (c) => c.toUpperCase()), matched: m[0] };
    }
    // Require it to look like a place: capitalised word, or contains a place hint.
    const placeHint = /\b(office|room|hall|cafe|café|restaurant|hotel|park|gym|studio|clinic|hospital|airport|station|library|lab|center|centre|building|floor|suite|street|st\.|road|rd\.|avenue|ave\.|blvd|drive|dr\.|lane|ln\.|way|plaza|mall|store|shop|bar|club|theater|theatre|stadium|arena|school|college|campus|branch|hq|headquarters|zoom|meet|teams|online|home|work)\b/i;
    if (placeHint.test(candidate) || /^[A-Z]/.test(candidate)) {
      return { location: candidate, matched: m[0] };
    }
    // A run of capitalised words is a proper noun — a place or a person's
    // venue ("in San Francisco", "at Googleplex"). Sentence-initial capitals
    // are excluded by requiring the match to start after "at"/"in".
    const words = candidate.split(/\s+/);
    if (words.length >= 1 && words.every((w) => /^[A-Z][\w'-]*$/.test(w))) {
      return { location: candidate, matched: m[0] };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* End time                                                                    */
/* -------------------------------------------------------------------------- */

/** "from 2 to 4", "1pm-3pm", "until 5pm", "ends at 6". */
export function parseEndTime(
  text: string,
  start: ParsedTime | null,
): { time: ParsedTime; matched: string } | null {
  const t = text.toLowerCase();

  const range =
    /\b(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to|until|till|through)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/.exec(
      t,
    );
  if (range) {
    const end = parseTime(range[2]);
    if (end) return { time: end, matched: range[0] };
  }

  const endsAt = /\b(?:ends?|ending|finish(?:es)?|till|until|to)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\b/.exec(
    t,
  );
  if (endsAt) {
    const end = parseTime(endsAt[1]);
    if (end && (!start || end.hours * 60 + end.minutes > start.hours * 60 + start.minutes)) {
      return { time: end, matched: endsAt[0] };
    }
    if (end && start) {
      // "from 11 to 1" → 1 means 1 PM
      const startMins = start.hours * 60 + start.minutes;
      const endMins = end.hours * 60 + end.minutes;
      if (endMins <= startMins) {
        return { time: { ...end, hours: (end.hours + 12) % 24 }, matched: endsAt[0] };
      }
    }
  }
  return null;
}
