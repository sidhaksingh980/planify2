/**
 * TimeGrid — the shared engine behind Day and Week views.
 *
 * Structure:
 *   ┌──────────────┬────────────────────────────────────────┐
 *   │  (corner)    │  all-day strip, one cell per day       │
 *   ├──────────────┼────────────────────────────────────────┤
 *   │ hour gutter  │  day columns, events absolutely placed │
 *   └──────────────┴────────────────────────────────────────┘
 *
 * The grid itself sits on an opaque surface with crisp hairlines — the brief is
 * explicit that the calendar content must not be blurred or overly transparent.
 * Only the surrounding chrome is glass.
 *
 * Tapping empty space creates an event at that time; dragging an existing one
 * reschedules it (snapped to 15 minutes, with day changes across columns).
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { cx } from '../../lib/utils';
import {
  addDays,
  atTime,
  dayKey,
  formatTimeCompact,
  isToday,
} from '../../lib/dates';
import { bucketForDay, hourTicks, layoutDay, type DayWindow } from '../../lib/calendarEngine';
import type { Occurrence, ResolvedTheme, TimeFormat } from '../../types';
import { EventCard } from './EventCard';
import { EventChip } from './EventChip';

export interface TimeGridProps {
  days: Date[];
  occurrences: Occurrence[];
  window: DayWindow;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  now: Date;
  compact?: boolean;
  /** Called when the user taps empty space in a day column. */
  onCreateAt: (start: Date, end: Date) => void;
  onCreateAllDay: (day: Date) => void;
  onOpen: (o: Occurrence) => void;
  onEventPointerDown: (e: React.PointerEvent<HTMLElement>, o: Occurrence) => void;
  /** Occurrence id currently being dragged, for the lift effect. */
  draggingId?: string | null;
  onGridScrollTop?: (el: HTMLDivElement) => void;
  hourHeight?: number;
}

export const TimeGrid = memo(function TimeGrid({
  days,
  occurrences,
  window: win,
  theme,
  timeFormat,
  now,
  compact = false,
  onCreateAt,
  onCreateAllDay,
  onOpen,
  onEventPointerDown,
  draggingId,
  onGridScrollTop,
  hourHeight = 56,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const buckets = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      const keys = o.allDay ? allDayKeys(o, days) : [dayKey(o.start)];
      for (const k of keys) {
        const arr = map.get(k);
        if (arr) arr.push(o);
        else map.set(k, [o]);
      }
    }
    return map;
  }, [occurrences, days]);

  const ticks = useMemo(() => hourTicks(win), [win]);
  const totalHours = Math.max(1, win.dayEndHour - win.dayStartHour);
  const gridHeight = totalHours * hourHeight;
  const minutesPerPixel = 60 / hourHeight;

  const hasAllDay = useMemo(
    () => days.some((d) => (bucketForDay(buckets, dayKey(d)).allDay.length > 0)),
    [days, buckets],
  );

  // Scroll to a sensible position on mount: 45 min before now, or the window top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nowMinutes = now.getHours() * 60 + now.getMinutes() - win.dayStartHour * 60 - 45;
    const target = Math.max(0, Math.min(nowMinutes * (hourHeight / 60), el.scrollHeight - el.clientHeight));
    el.scrollTop = target;
    onGridScrollTop?.(el);
    // Deliberately runs once per mount/window change, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.dayStartHour, hourHeight]);

  const handleColumnPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, day: Date) => {
      // Only start a create gesture on a clean tap in empty space.
      if ((e.target as HTMLElement).closest('[data-event]')) return;
      const col = e.currentTarget;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const minutesFromTop = y * minutesPerPixel;
      const snapped = Math.floor(minutesFromTop / 30) * 30;
      const start = atTime(day, win.dayStartHour, 0);
      start.setMinutes(start.getMinutes() + snapped);
      const end = addMinutesLocal(start, 60);
      onCreateAt(start, end);
    },
    [minutesPerPixel, onCreateAt, win.dayStartHour],
  );

  const nowTop = useMemo(() => {
    const minutes = now.getHours() * 60 + now.getMinutes() - win.dayStartHour * 60;
    return (minutes / 60) * hourHeight;
  }, [now, win.dayStartHour, hourHeight]);
  const nowVisible = nowTop >= 0 && nowTop <= gridHeight;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ---- Header: weekday labels + all-day strip --------------------- */}
      <div className="shrink-0 border-b border-[rgb(var(--c-line)/var(--line-alpha))]">
        <div className="flex" style={{ paddingLeft: compact ? 44 : 58 }}>
          {days.map((d) => {
            const today = isToday(d);
            return (
              <div
                key={d.toISOString()}
                className="min-w-0 flex-1 px-1 pb-1.5 pt-2 text-center"
                aria-current={today ? 'date' : undefined}
              >
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink3">
                  {d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, compact ? 1 : 3)}
                </div>
                <div
                  className={cx(
                    'daynum mx-auto mt-0.5 grid h-7 place-items-center rounded-full text-[15px] font-semibold transition-colors',
                    today
                      ? 'bg-accent text-[rgb(var(--c-accent-ink))]'
                      : 'text-ink',
                    compact && 'h-6 text-[13px]',
                  )}
                  style={today ? { minWidth: '1.75rem' } : undefined}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {hasAllDay ? (
          <div className="flex border-t border-[rgb(var(--c-line)/var(--line-alpha))]">
            <div
              className="shrink-0 py-1 text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-ink3"
              style={{ width: compact ? 44 : 58 }}
              aria-hidden="true"
            >
              <span className="pr-1.5">All day</span>
            </div>
            {days.map((d) => {
              const { allDay } = bucketForDay(buckets, dayKey(d));
              return (
                <div
                  key={`allday-${d.toISOString()}`}
                  {...{ 'data-daykey': dayKey(d) }}
                  className="min-w-0 flex-1 space-y-[3px] border-l border-[rgb(var(--c-line)/var(--line-alpha))] px-1 py-1"
                  onDoubleClick={() => onCreateAllDay(d)}
                >
                  {allDay.map((o) => (
                    <EventChip
                      key={o.id}
                      occurrence={o}
                      theme={theme}
                      timeFormat={timeFormat}
                      onOpen={onOpen}
                      dense={compact}
                    />
                  ))}
                  {allDay.length === 0 ? <div className="h-[19px]" /> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ---- Scrollable body -------------------------------------------- */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex" style={{ height: gridHeight }}>
          {/* Hour gutter */}
          <div
            className="relative shrink-0"
            style={{ width: compact ? 44 : 58 }}
            aria-hidden="true"
          >
            {ticks.map((h, i) => (
              <div
                key={h}
                className="absolute right-0 -translate-y-1/2 pr-1.5 text-[10.5px] font-medium text-ink3 tnum"
                style={{ top: i * hourHeight }}
              >
                {i === 0 ? '' : formatTimeCompact(atTime(days[0] ?? now, h, 0), timeFormat)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="relative flex min-w-0 flex-1">
            {days.map((d) => {
              const key = dayKey(d);
              const { timed } = bucketForDay(buckets, key);
              const laid = layoutDay(timed, d, win);
              const today = isToday(d);
              return (
                <div
                  key={key}
                  {...{ 'data-daykey': key }}
                  className={cx(
                    'relative min-w-0 flex-1 border-l first:border-l-0',
                    'border-[rgb(var(--c-line)/var(--line-alpha))]',
                    today && 'bg-[var(--today-tint)]',
                  )}
                  onPointerDown={(e) => handleColumnPointerDown(e, d)}
                >
                  {/* Hour hairlines. Solid, 1px, low-contrast — readable, not noisy. */}
                  {ticks.map((_, i) => (
                    <div
                      key={i}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 border-t border-[var(--grid-line)]"
                      style={{ top: i * hourHeight }}
                    />
                  ))}
                  {/* Half-hour dashes */}
                  {ticks.slice(0, -1).map((_, i) => (
                    <div
                      key={`h-${i}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--grid-line)] opacity-60"
                      style={{ top: i * hourHeight + hourHeight / 2 }}
                    />
                  ))}

                  {laid.map((l) => (
                    <div
                      key={l.occurrence.id}
                      data-event="true"
                      className="pointer-events-none absolute inset-0"
                      aria-hidden="true"
                    >
                      <div className="pointer-events-auto relative h-full">
                        <EventCard
                          occurrence={l.occurrence}
                          theme={theme}
                          timeFormat={timeFormat}
                          top={l.top}
                          height={l.height}
                          left={l.left}
                          width={l.width}
                          compact={compact}
                          dragging={draggingId === l.occurrence.id}
                          clippedTop={l.clippedTop}
                          clippedBottom={l.clippedBottom}
                          onOpen={onOpen}
                          onPointerDown={(e) => onEventPointerDown(e, l.occurrence)}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Current-time indicator */}
                  {today && nowVisible ? <NowLine top={nowTop} timeFormat={timeFormat} now={now} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */

function NowLine({ top, now, timeFormat }: { top: number; now: Date; timeFormat: TimeFormat }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top }}
      aria-hidden="true"
      role="presentation"
    >
      <div className="relative h-px bg-[rgb(var(--now-line))]" style={{ boxShadow: '0 0 8px rgb(var(--now-line) / 0.5)' }}>
        <span
          className="absolute -left-[5px] -top-[4.5px] h-[10px] w-[10px] rounded-full bg-[rgb(var(--now-line))]"
          style={{ boxShadow: '0 0 0 2px rgb(var(--c-surface))' }}
        />
      </div>
      <span className="sr-only">Current time {formatTimeCompact(now, timeFormat)}</span>
    </div>
  );
}

function allDayKeys(o: Occurrence, days: Date[]): string[] {
  const keys: string[] = [];
  const span = Math.max(1, Math.round((o.end.getTime() - o.start.getTime()) / 86_400_000));
  for (let i = 0; i < span; i += 1) keys.push(dayKey(addDays(o.start, i)));
  void days;
  return keys;
}

function addMinutesLocal(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
