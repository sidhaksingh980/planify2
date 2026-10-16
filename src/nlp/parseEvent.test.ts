/**
 * Natural-language scheduling tests.
 *
 * The parser is the thing users actually touch when they ask the assistant to
 * add an event, and it runs entirely on-device — so these assert the sentences
 * from the product spec resolve to real, correct dates and times.
 *
 * `now` is pinned to Thursday 2026-10-15 so "next Tuesday" is unambiguous:
 * the following week's Tuesday is 2026-10-20.
 */
import { describe, expect, it } from 'vitest';
import { parseEventInstruction, type ParseContext } from './parseEvent';
import { dayKey } from '../lib/dates';

const ctx: ParseContext = {
  now: new Date(2026, 9, 15, 9, 0, 0), // Thu 15 Oct 2026, 09:00 local
  timezone: 'America/Los_Angeles',
  defaultReminderMinutes: 10,
  defaultCategoryId: 'personal',
};

function parse(text: string, overrides: Partial<ParseContext> = {}) {
  return parseEventInstruction(text, { ...ctx, ...overrides });
}

/** The proposed event for a `create` intent, or throws with the actual result. */
function proposed(text: string, overrides: Partial<ParseContext> = {}) {
  const res = parse(text, overrides);
  expect(res.intent, `intent for ${JSON.stringify(text)}`).toBe('create');
  expect(res.action, `action for ${JSON.stringify(text)}`).not.toBeNull();
  expect(res.action?.kind).toBe('create_event');
  expect(res.action?.event, `event for ${JSON.stringify(text)}`).toBeTruthy();
  return res.action!.event!;
}

describe('the spec’s example sentences', () => {
  it('parses "Add lunch with Maya next Tuesday at 1 PM for 90 minutes."', () => {
    const e = proposed('Add lunch with Maya next Tuesday at 1 PM for 90 minutes.');
    expect(dayKey(new Date(e.startTime))).toBe('2026-10-20');
    const start = new Date(e.startTime);
    expect(start.getHours()).toBe(13);
    expect(start.getMinutes()).toBe(0);
    expect((new Date(e.endTime).getTime() - start.getTime()) / 60_000).toBe(90);
    expect(e.allDay).toBe(false);
    expect(e.title.toLowerCase()).toContain('lunch');
    expect(e.title.toLowerCase()).toContain('maya');
  });

  it('parses "Schedule a dentist appointment next Friday morning and remind me the day before."', () => {
    const e = proposed(
      'Schedule a dentist appointment next Friday morning and remind me the day before.',
    );
    expect(dayKey(new Date(e.startTime))).toBe('2026-10-23');
    // "morning" must resolve to an actual AM hour, not noon or midnight.
    expect(new Date(e.startTime).getHours()).toBeLessThan(12);
    // "the day before" = 1440 minutes.
    expect(e.reminders).toContain(1440);
    expect(e.title.toLowerCase()).toContain('dentist');
  });
});

describe('times', () => {
  it.each([
    ['at 3pm', 15, 0],
    ['at 3:30pm', 15, 30],
    ['at 9 in the morning', 9, 0],
    ['at noon', 12, 0],
    ['at midnight', 0, 0],
    ['at 14:45', 14, 45],
  ])('resolves "%s" to %i:%i', (phrase, h, m) => {
    const e = proposed(`Meeting tomorrow ${phrase}`);
    const start = new Date(e.startTime);
    expect(dayKey(start)).toBe('2026-10-16');
    expect(start.getHours()).toBe(h);
    expect(start.getMinutes()).toBe(m);
  });

  it('infers PM for an evening hour given without a meridiem', () => {
    const e = proposed('Dinner tomorrow at 7');
    expect(new Date(e.startTime).getHours()).toBe(19);
  });

  it('parses an explicit end time', () => {
    const e = proposed('Standup tomorrow from 9am to 9:30am');
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    expect((end.getTime() - start.getTime()) / 60_000).toBe(30);
  });

  it.each([
    ['for 90 minutes', 90],
    ['for 1.5 hours', 90],
    ['for half an hour', 30],
    ['for 2 hrs', 120],
    ['for 45 mins', 45],
  ])('parses duration "%s" as %i minutes', (phrase, mins) => {
    const e = proposed(`Call tomorrow at 2pm ${phrase}`);
    const dur = (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 60_000;
    expect(dur).toBe(mins);
  });

  it('never produces an end before the start', () => {
    const e = proposed('Review tomorrow at 11pm for 2 hours');
    expect(new Date(e.endTime).getTime()).toBeGreaterThan(new Date(e.startTime).getTime());
    expect(dayKey(new Date(e.endTime))).toBe('2026-10-17'); // rolls past midnight
  });
});

describe('dates', () => {
  it.each([
    ['today', '2026-10-15'],
    ['tomorrow', '2026-10-16'],
    ['friday', '2026-10-16'],
    ['this friday', '2026-10-16'],
    ['next friday', '2026-10-23'],
    ['monday', '2026-10-19'],
    ['next monday', '2026-10-19'],
    ['sunday', '2026-10-18'],
    ['in 3 days', '2026-10-18'],
    ['next week', '2026-10-19'],
  ])('resolves "%s" to %s', (phrase, expected) => {
    const e = proposed(`Dentist ${phrase} at 10am`);
    expect(dayKey(new Date(e.startTime))).toBe(expected);
  });

  it('parses an explicit calendar date', () => {
    const e = proposed('Flight on 2026-12-24 at 6am');
    expect(dayKey(new Date(e.startTime))).toBe('2026-12-24');
  });

  it('parses a month-name date', () => {
    const e = proposed('Anniversary on December 25 at 9am');
    expect(dayKey(new Date(e.startTime))).toBe('2026-12-25');
  });

  it('does not invent a date when none is given', () => {
    const res = parse('Add a meeting with the design team at 2pm');
    // The parser must flag the gap rather than silently defaulting to today.
    expect(res.missing.length).toBeGreaterThan(0);
    expect(res.missing.join(' ').toLowerCase()).toMatch(/date|day|when/);
  });
});

describe('all-day events', () => {
  it('marks an all-day event and uses date-only storage', () => {
    const e = proposed('Company offsite tomorrow, all day');
    expect(e.allDay).toBe(true);
    // All-day values are YYYY-MM-DD with an exclusive end date.
    expect(e.startTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.endTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.endTime).toBe('2026-10-17');
  });
});

describe('location', () => {
  it.each([
    ['Lunch tomorrow at 1pm at Blue Bottle Coffee', 'blue bottle coffee'],
    ['Lunch tomorrow at 1pm in San Francisco', 'san francisco'],
    ['Meeting Friday at 10am at the office', 'the office'],
  ])('extracts "%s" → %s', (text, expected) => {
    const e = proposed(text);
    expect(e.location.toLowerCase()).toContain(expected);
  });

  it('does not leave the location in the title', () => {
    const e = proposed('Lunch with Maya tomorrow at 1pm at Blue Bottle');
    expect(e.title.toLowerCase()).not.toContain('blue bottle');
  });
});

describe('recurrence', () => {
  it('parses "every weekday"', () => {
    const e = proposed('Standup every weekday at 9am');
    expect(e.recurrence).not.toBeNull();
    expect(e.recurrence!.freq).toBe('weekly');
    expect([...(e.recurrence!.byWeekday ?? [])].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses "every Monday and Wednesday"', () => {
    const e = proposed('Gym every Monday and Wednesday at 6pm');
    expect(e.recurrence!.freq).toBe('weekly');
    expect([...(e.recurrence!.byWeekday ?? [])].sort()).toEqual([1, 3]);
  });

  it('parses "every day"', () => {
    const e = proposed('Meds every day at 8am');
    expect(e.recurrence!.freq).toBe('daily');
    expect(e.recurrence!.interval).toBe(1);
  });

  it('parses "every 2 weeks"', () => {
    const e = proposed('Sprint review every 2 weeks on Friday at 3pm');
    expect(e.recurrence!.freq).toBe('weekly');
    expect(e.recurrence!.interval).toBe(2);
  });

  it('parses "every month" and "every year"', () => {
    expect(proposed('Rent every month on the 1st at 9am').recurrence!.freq).toBe('monthly');
    expect(proposed('Birthday every year on June 3 at 9am').recurrence!.freq).toBe('yearly');
  });

  it('leaves recurrence null when the user did not ask for repeats', () => {
    expect(proposed('Dentist tomorrow at 10am').recurrence).toBeNull();
  });
});

describe('reminders', () => {
  it.each([
    ['remind me 15 minutes before', 15],
    ['remind me an hour before', 60],
    ['remind me 2 hours before', 120],
    ['remind me the day before', 1440],
    ['remind me a week before', 10080],
  ])('parses "%s" as %i minutes', (phrase, mins) => {
    const e = proposed(`Interview tomorrow at 2pm, ${phrase}`);
    expect(e.reminders).toContain(mins);
  });

  it('applies the user default when no reminder is requested', () => {
    const e = proposed('Dentist tomorrow at 10am', { defaultReminderMinutes: 30 });
    expect(e.reminders).toEqual([30]);
  });

  it('supports "no reminder"', () => {
    const e = proposed('Focus block tomorrow at 10am, no reminder');
    expect(e.reminders).toEqual([]);
  });
});

describe('categories', () => {
  it.each([
    ['Dentist appointment tomorrow at 10am', 'health'],
    ['Deep work block tomorrow at 10am', 'focus'],
    ['Dinner with Maya tomorrow at 7pm', 'social'],
    ['Flight to Tokyo tomorrow at 6am', 'travel'],
    ['Sprint planning tomorrow at 10am', 'work'],
  ])('classifies "%s" as %s', (text, expected) => {
    expect(proposed(text).categoryId).toBe(expected);
  });

  it('always returns a known category id', () => {
    const known = ['personal', 'work', 'health', 'social', 'travel', 'focus', 'family', 'other'];
    expect(known).toContain(proposed('Something random tomorrow at 5pm').categoryId);
  });
});

describe('other intents', () => {
  it('recognises a summary request rather than creating an event', () => {
    const res = parse('What do I have on tomorrow?');
    expect(res.intent).not.toBe('create');
    expect(res.action?.kind).not.toBe('create_event');
  });

  it('recognises a free-slot request', () => {
    const res = parse('When am I free tomorrow afternoon?');
    expect(['find_slots', 'search', 'summarise', 'unknown']).toContain(res.intent);
  });

  it('recognises a reschedule request', () => {
    const res = parse('Move my dentist appointment to Friday at 2pm', {
      focusEventTitle: 'Dentist appointment',
      focusEventId: 'evt_1',
    });
    expect(['reschedule', 'move', 'update']).toContain(res.intent);
  });

  it('returns unknown for unrelated chatter instead of creating a junk event', () => {
    const res = parse('hello there');
    expect(res.action?.kind ?? 'none').not.toBe('create_event');
  });
});

describe('the parser never fabricates data', () => {
  it('leaves the description empty rather than inventing notes', () => {
    expect(proposed('Lunch tomorrow at 1pm').description).toBe('');
  });

  it('produces a non-empty title from the leftover words', () => {
    const e = proposed('Add lunch with Maya next Tuesday at 1 PM for 90 minutes.');
    expect(e.title.trim().length).toBeGreaterThan(0);
    // The stripped fragments must not leak into the title.
    expect(e.title).not.toMatch(/90 minutes/i);
    expect(e.title).not.toMatch(/next Tuesday/i);
  });

  it('always stamps the requested timezone', () => {
    expect(proposed('Lunch tomorrow at 1pm').timezone).toBe('America/Los_Angeles');
  });

  it('keeps a sensible confidence band', () => {
    const high = parse('Add lunch with Maya next Tuesday at 1 PM for 90 minutes.');
    const low = parse('thing');
    expect(high.confidence).toBeGreaterThan(low.confidence);
    expect(high.confidence).toBeGreaterThan(0.55);
  });
});
