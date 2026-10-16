/**
 * Recurrence engine tests.
 *
 * These cover the parts most likely to be silently wrong: BYDAY expansion,
 * month-end clamping (Jan 31 + 1 month), COUNT/UNTIL termination, EXDATE
 * handling and window culling.
 */
import { describe, expect, it } from 'vitest';
import { describeRecurrence, expandAll, expandEvent, fromRRule, toRRule } from './recurrence';
import { addDays, dayKey, fromDayKey } from './dates';
import type { CalEvent, Recurrence } from '../types';

function event(overrides: Partial<CalEvent> & { startTime: string; endTime: string }): CalEvent {
  return {
    id: overrides.id ?? 'e1',
    userId: 'u1',
    title: overrides.title ?? 'Test',
    description: '',
    allDay: false,
    timezone: 'UTC',
    location: '',
    categoryId: 'personal',
    reminders: [],
    recurrence: null,
    exceptions: [],
    createdAt: iso('2026-01-01', 0, 0),
    updatedAt: iso('2026-01-01', 0, 0),
    deleted: false,
    version: 1,
    ...overrides,
  };
}

const window = (from: string, to: string) => ({ from: fromDayKey(from), to: fromDayKey(to) });

/**
 * Build a timed `startTime`/`endTime` in local wall-clock time, returned as an
 * ISO string — the format the app stores timed events in. Local (not UTC) keeps
 * these tests valid in any timezone, because the recurrence engine deliberately
 * expands in local wall-clock time so a 9am standup stays at 9am across DST.
 */
function iso(day: string, h = 0, m = 0): string {
  const d = fromDayKey(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

describe('non-recurring events', () => {
  it('returns the single occurrence when it overlaps the window', () => {
    const e = event({ startTime: iso('2026-03-14', 9, 0), endTime: iso('2026-03-14', 10, 0) });
    const occ = expandEvent(e, window('2026-03-01', '2026-03-31'));
    expect(occ).toHaveLength(1);
    expect(occ[0].seriesId).toBe('e1');
    expect(occ[0].isRecurring).toBe(false);
  });

  it('returns nothing when the event is outside the window', () => {
    const e = event({ startTime: iso('2026-06-14', 9, 0), endTime: iso('2026-06-14', 10, 0) });
    expect(expandEvent(e, window('2026-03-01', '2026-03-31'))).toHaveLength(0);
  });

  it('skips soft-deleted events entirely', () => {
    const e = event({
      startTime: iso('2026-03-14', 9, 0),
      endTime: iso('2026-03-14', 10, 0),
      deleted: true,
    });
    expect(expandEvent(e, window('2026-03-01', '2026-03-31'))).toHaveLength(0);
  });

  it('includes an event that spans the window boundary', () => {
    const e = event({ startTime: iso('2026-03-30', 22, 0), endTime: iso('2026-04-02', 2, 0) });
    expect(expandEvent(e, window('2026-03-01', '2026-03-31'))).toHaveLength(1);
  });
});

describe('daily recurrence', () => {
  it('expands every day in the window', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 9, 30),
      recurrence: { freq: 'daily', interval: 1 } satisfies Recurrence,
    });
    const occ = expandEvent(e, window('2026-03-01', '2026-03-10'));
    expect(occ).toHaveLength(10);
    expect(occ.map((o) => dayKey(o.start))).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
    ]);
  });

  it('honours interval > 1', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 10, 0),
      recurrence: { freq: 'daily', interval: 3 },
    });
    expect(expandEvent(e, window('2026-03-01', '2026-03-10')).map((o) => dayKey(o.start))).toEqual([
      '2026-03-01', '2026-03-04', '2026-03-07', '2026-03-10',
    ]);
  });

  it('stops at COUNT', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1, count: 4 },
    });
    // A wide window must still yield exactly 4.
    expect(expandEvent(e, window('2026-01-01', '2027-12-31'))).toHaveLength(4);
  });

  it('stops at UNTIL', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1, until: '2026-03-05' },
    });
    expect(expandEvent(e, window('2026-03-01', '2026-03-31'))).toHaveLength(5);
  });
});

describe('weekly recurrence with BYDAY', () => {
  it('expands only the named weekdays', () => {
    // 2026-03-02 is a Monday.
    const e = event({
      startTime: iso('2026-03-02', 9, 0),
      endTime: iso('2026-03-02', 9, 45),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] },
    });
    const occ = expandEvent(e, window('2026-03-02', '2026-03-15'));
    const days = occ.map((o) => o.start.getDay());
    expect(days.every((d) => [1, 3, 5].includes(d))).toBe(true);
    expect(occ.map((o) => dayKey(o.start))).toEqual([
      '2026-03-02', '2026-03-04', '2026-03-06',
      '2026-03-09', '2026-03-11', '2026-03-13',
    ]);
  });

  it('skips whole weeks when interval is 2', () => {
    const e = event({
      startTime: iso('2026-03-02', 9, 0),
      endTime: iso('2026-03-02', 10, 0),
      recurrence: { freq: 'weekly', interval: 2, byWeekday: [1] },
    });
    expect(expandEvent(e, window('2026-03-02', '2026-04-30')).map((o) => dayKey(o.start))).toEqual([
      '2026-03-02', '2026-03-16', '2026-03-30', '2026-04-13', '2026-04-27',
    ]);
    // The off-cycle Mondays in between must never appear.
    expect(expandEvent(e, window('2026-03-02', '2026-04-30')).map((o) => dayKey(o.start)))
      .not.toContain('2026-03-09');
  });

  it('preserves the wall-clock time across every occurrence', () => {
    const e = event({
      startTime: iso('2026-03-02', 14, 30),
      endTime: iso('2026-03-02', 15, 0),
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 4] },
    });
    for (const o of expandEvent(e, window('2026-03-02', '2026-04-02'))) {
      expect(o.start.getHours()).toBe(14);
      expect(o.start.getMinutes()).toBe(30);
      expect((o.end.getTime() - o.start.getTime()) / 60_000).toBe(30);
    }
  });
});

describe('monthly recurrence', () => {
  it('clamps instead of overflowing on short months', () => {
    // Jan 31 monthly must not become Mar 2/3 via overflow.
    const e = event({
      startTime: iso('2026-01-31', 10, 0),
      endTime: iso('2026-01-31', 11, 0),
      recurrence: { freq: 'monthly', interval: 1, byMonthDay: [31] },
    });
    const occ = expandEvent(e, window('2026-01-01', '2026-08-31'));
    expect(occ.map((o) => dayKey(o.start))).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31',
    ]);
    // No occurrence may land in a month that has no 31st.
    expect(occ.some((o) => ['2026-02', '2026-04', '2026-06'].includes(dayKey(o.start).slice(0, 7)))).toBe(false);
  });

  it('expands the start date’s day-of-month by default', () => {
    const e = event({
      startTime: iso('2026-03-15', 9, 0),
      endTime: iso('2026-03-15', 10, 0),
      recurrence: { freq: 'monthly', interval: 1 },
    });
    expect(expandEvent(e, window('2026-03-01', '2026-06-30')).map((o) => o.start.getDate())).toEqual([
      15, 15, 15, 15,
    ]);
  });
});

describe('yearly recurrence', () => {
  it('lands on the same month and day each year', () => {
    const e = event({
      startTime: iso('2026-07-04', 9, 0),
      endTime: iso('2026-07-04', 18, 0),
      recurrence: { freq: 'yearly', interval: 1, byMonth: [7], byMonthDay: [4] },
    });
    const occ = expandEvent(e, window('2026-01-01', '2030-12-31'));
    expect(occ.map((o) => dayKey(o.start))).toEqual([
      '2026-07-04', '2027-07-04', '2028-07-04', '2029-07-04', '2030-07-04',
    ]);
  });

  it('skips Feb 29 in non-leap years', () => {
    const e = event({
      startTime: iso('2024-02-29', 9, 0),
      endTime: iso('2024-02-29', 10, 0),
      recurrence: { freq: 'yearly', interval: 1, byMonth: [2], byMonthDay: [29] },
    });
    const occ = expandEvent(e, window('2024-01-01', '2032-12-31'));
    expect(occ.map((o) => dayKey(o.start))).toEqual(['2024-02-29', '2028-02-29', '2032-02-29']);
  });
});

describe('exceptions (EXDATE)', () => {
  it('omits cancelled occurrences', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1 },
      exceptions: ['2026-03-04', '2026-03-05'],
    });
    const days = expandEvent(e, window('2026-03-01', '2026-03-07')).map((o) => dayKey(o.start));
    expect(days).not.toContain('2026-03-04');
    expect(days).not.toContain('2026-03-05');
    expect(days).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-06', '2026-03-07']);
  });
});

describe('all-day events', () => {
  it('uses date-only keys and spans multiple days', () => {
    const e = event({ startTime: '2026-03-10', endTime: '2026-03-13', allDay: true });
    const occ = expandEvent(e, window('2026-03-01', '2026-03-31'));
    expect(occ).toHaveLength(1);
    expect(occ[0].allDay).toBe(true);
    expect(occ[0].startKey).toBe('2026-03-10');
  });

  it('expands an all-day series', () => {
    const e = event({
      startTime: '2026-03-01',
      endTime: '2026-03-02',
      allDay: true,
      recurrence: { freq: 'weekly', interval: 1 },
    });
    expect(expandEvent(e, window('2026-03-01', '2026-03-31'))).toHaveLength(5);
  });
});

describe('window culling', () => {
  it('does not emit occurrences before the window', () => {
    const e = event({
      startTime: iso('2020-01-01', 9, 0),
      endTime: iso('2020-01-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1 },
    });
    const occ = expandEvent(e, window('2026-03-10', '2026-03-12'));
    expect(occ).toHaveLength(3);
    expect(occ.every((o) => o.start.getFullYear() === 2026)).toBe(true);
  });

  it('terminates for an unbounded daily series', () => {
    const e = event({
      startTime: iso('2026-01-01', 9, 0),
      endTime: iso('2026-01-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1 },
    });
    const occ = expandEvent(e, window('2026-03-01', '2026-03-31'));
    expect(occ).toHaveLength(31);
  });
});

describe('expandAll', () => {
  it('merges several events sorted by start time', () => {
    const a = event({ id: 'a', startTime: iso('2026-03-05', 15, 0), endTime: iso('2026-03-05', 16, 0) });
    const b = event({ id: 'b', startTime: iso('2026-03-05', 9, 0), endTime: iso('2026-03-05', 10, 0) });
    const occ = expandAll([a, b], fromDayKey('2026-03-01'), fromDayKey('2026-03-31'));
    expect(occ.map((o) => o.seriesId)).toEqual(['b', 'a']);
  });
});

describe('RRULE round-trip', () => {
  it('serialises and re-parses without loss', () => {
    const cases: Recurrence[] = [
      { freq: 'daily', interval: 1 },
      { freq: 'daily', interval: 3 },
      { freq: 'weekly', interval: 2, byWeekday: [1, 3, 5] },
      { freq: 'monthly', interval: 1, byMonthDay: [15] },
      { freq: 'yearly', interval: 1, byMonth: [7], byMonthDay: [4] },
      { freq: 'weekly', interval: 1, byWeekday: [2], count: 8 },
      { freq: 'daily', interval: 1, until: '2026-12-31' },
    ];
    for (const r of cases) {
      const parsed = fromRRule(toRRule(r));
      expect(parsed).toEqual(r);
    }
  });

  it('ignores a null rule', () => {
    expect(toRRule(null)).toBeNull();
    expect(fromRRule(null)).toBeNull();
    expect(fromRRule(undefined)).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('reads naturally for the common cases', () => {
    expect(describeRecurrence(null)).toBe('Does not repeat');
    expect(describeRecurrence({ freq: 'daily', interval: 1 })).toBe('Every day');
    expect(describeRecurrence({ freq: 'weekly', interval: 2, byWeekday: [1, 3] })).toBe(
      'Every 2 weeks on Mo, We',
    );
    expect(describeRecurrence({ freq: 'monthly', interval: 1, byMonthDay: [15] })).toBe(
      'Every month on day 15',
    );
    expect(describeRecurrence({ freq: 'daily', interval: 1, count: 5 })).toBe('Every day, 5 times');
  });
});

describe('occurrence ids are stable and unique', () => {
  it('suffixes the index for repeats but not for the first occurrence', () => {
    const e = event({
      startTime: iso('2026-03-01', 9, 0),
      endTime: iso('2026-03-01', 10, 0),
      recurrence: { freq: 'daily', interval: 1 },
    });
    const occ = expandEvent(e, window('2026-03-01', '2026-03-03'));
    expect(occ.map((o) => o.id)).toEqual(['e1', 'e1:1', 'e1:2']);
    expect(new Set(occ.map((o) => o.id)).size).toBe(3);
  });

  it('keeps addDays consistent with dayKey', () => {
    const d = fromDayKey('2026-03-31');
    expect(dayKey(addDays(d, 1))).toBe('2026-04-01');
  });
});
