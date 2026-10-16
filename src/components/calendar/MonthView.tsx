/**
 * MonthView — a 6-row grid (or 5 when the month fits) with real hairlines.
 *
 * Readability choices:
 *   • Cells are opaque; only the surrounding chrome is glass.
 *   • Today gets a filled accent date pill and a faint tinted cell.
 *   • The selected day gets a ring, distinct from today so both states are
 *     visible at once.
 *   • Out-of-month days are dimmed but fully interactive.
 *   • Overflow becomes a "+N more" affordance rather than clipped text.
 *
 * Keyboard: arrow keys move the selected day across the grid, Enter opens it,
 * and `data-daykey` makes every cell a drop target for drag-to-reschedule.
 */
import { memo, useCallback, useMemo } from 'react';
import { cx } from '../../lib/utils';
import { addDays, dayKey, isSameDay, isSameMonth, isToday, weekdayLabels } from '../../lib/dates';
import { bucketForDay } from '../../lib/calendarEngine';
import type { Occurrence, ResolvedTheme, TimeFormat, Weekday } from '../../types';
import { EventChip } from './EventChip';

export interface MonthViewProps {
  days: Date[];
  anchor: Date;
  occurrences: Occurrence[];
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  firstDayOfWeek: Weekday;
  selectedDay: Date;
  compact: boolean;
  draggingId?: string | null;
  dropDayKey?: string | null;
  onSelectDay: (d: Date) => void;
  onOpenDay: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
  onCreateOn: (d: Date) => void;
  onEventPointerDown: (e: React.PointerEvent<HTMLElement>, o: Occurrence) => void;
  /** Active search query, forwarded for future match highlighting. */
  query?: string;
}

export const MonthView = memo(function MonthView({
  days,
  anchor,
  occurrences,
  theme,
  timeFormat,
  firstDayOfWeek,
  selectedDay,
  compact,
  draggingId,
  dropDayKey,
  onSelectDay,
  onOpenDay,
  onOpen,
  onCreateOn,
  onEventPointerDown,
}: MonthViewProps) {
  const buckets = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      const span = o.allDay
        ? Math.max(1, Math.round((o.end.getTime() - o.start.getTime()) / 86_400_000))
        : 1;
      for (let i = 0; i < span; i += 1) {
        const k = dayKey(addDays(o.start, i));
        const arr = map.get(k);
        if (arr) arr.push(o);
        else map.set(k, [o]);
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        // All-day events first, then by start time — the Apple Calendar order.
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.getTime() - b.start.getTime();
      });
    }
    return map;
  }, [occurrences]);

  const labels = useMemo(() => weekdayLabels(firstDayOfWeek, false), [firstDayOfWeek]);
  const rows = days.length / 7;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, day: Date) => {
      const moves: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
      };
      if (e.key in moves) {
        e.preventDefault();
        const next = addDays(day, moves[e.key]);
        onSelectDay(next);
        // Move DOM focus with the selection so screen readers track it.
        const el = document.querySelector<HTMLElement>(`[data-daykey="${dayKey(next)}"] .daycell-focus`);
        el?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onOpenDay(day);
      }
    },
    [onSelectDay, onOpenDay],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Weekday header */}
      <div
        className="grid shrink-0 grid-cols-7 border-b border-[rgb(var(--c-line)/var(--line-alpha))]"
        role="row"
      >
        {labels.map((l, i) => (
          <div
            key={`${l}-${i}`}
            role="columnheader"
            aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
              (i + firstDayOfWeek) % 7
            ]}
            className="py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3"
          >
            <span className={cx(compact ? '' : 'hidden sm:inline')}>{l}</span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div
        className={cx('grid min-h-0 flex-1 grid-cols-7', rows === 6 ? 'grid-rows-6' : 'grid-rows-5')}
        role="grid"
        aria-label="Month view"
      >
        {days.map((d) => {
          const key = dayKey(d);
          const { timed, allDay } = bucketForDay(buckets, key);
          const list = [...allDay, ...timed];
          const outside = !isSameMonth(d, anchor);
          const today = isToday(d);
          const selected = isSameDay(d, selectedDay);
          const isDropTarget = draggingId && dropDayKey === key;

          const maxVisible = compact ? 2 : 3;
          const shown = list.slice(0, maxVisible);
          const extra = list.length - shown.length;

          return (
            <div
              key={key}
              {...{ 'data-daykey': key }}
              role="gridcell"
              aria-selected={selected}
              aria-label={d.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              tabIndex={-1}
              onKeyDown={(e) => onKeyDown(e, d)}
              onDoubleClick={() => onCreateOn(d)}
              className={cx(
                'group relative min-h-0 overflow-hidden border-b border-r border-[rgb(var(--c-line)/var(--line-alpha))]',
                'transition-colors duration-150',
                outside && 'bg-[var(--outside-month)]',
                today && !outside && 'bg-[var(--today-tint)]',
                isDropTarget && 'drop-target',
                !compact && 'p-1',
                compact && 'p-[3px]',
              )}
            >
              {/* Date number */}
              <div className="mb-1 flex items-start justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onSelectDay(d)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onOpenDay(d);
                  }}
                  aria-label={`Select ${d.toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                  })}`}
                  className={cx(
                    'daycell-focus pressable daynum grid place-items-center rounded-full font-semibold transition-colors',
                    compact ? 'h-5 w-5 text-[11.5px]' : 'h-6 min-w-6 px-1 text-[12.5px]',
                    today
                      ? 'bg-accent text-[rgb(var(--c-accent-ink))]'
                      : selected
                        ? 'bg-[rgb(var(--c-line)/0.16)] text-ink'
                        : outside
                          ? 'text-ink3/60 hover:text-ink2'
                          : 'text-ink hover:bg-[rgb(var(--c-line)/0.1)]',
                  )}
                >
                  {d.getDate() === 1 && !compact
                    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : d.getDate()}
                </button>

                {list.length > 0 && !compact ? (
                  <span className="sr-only">{`${list.length} events`}</span>
                ) : null}

                {/* Quick-add on hover / focus (desktop only) */}
                {!compact ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Add an event on ${d.toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                    })}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateOn(d);
                    }}
                    className={cx(
                      'pressable grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink3',
                      'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100',
                      'hover:bg-[rgb(var(--c-line)/0.12)] hover:text-ink',
                    )}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                ) : null}
              </div>

              {/* Events */}
              <div className={cx('space-y-[3px]', compact && 'space-y-[2px]')}>
                {shown.map((o) => (
                  <EventChip
                    key={o.id}
                    occurrence={o}
                    theme={theme}
                    timeFormat={timeFormat}
                    onOpen={onOpen}
                    dense={compact}
                    onPointerDown={(e) => onEventPointerDown(e, o)}
                    className={cx(draggingId === o.id && 'opacity-30')}
                  />
                ))}
                {extra > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDay(d);
                    }}
                    className={cx(
                      'pressable w-full rounded-[6px] px-1.5 text-left font-semibold text-accent hover:bg-accent/12',
                      compact ? 'py-0 text-[10.5px]' : 'py-0.5 text-[11px]',
                    )}
                  >
                    +{extra} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
