/**
 * AgendaView — a chronological list, the most useful view on a phone.
 *
 * Grouped by month, then by day. Days with nothing are omitted entirely so the
 * list only ever shows real events; when there are none at all the parent renders
 * the empty state instead of this component.
 */
import { memo, useMemo } from 'react';
import { cx } from '../../lib/utils';
import {
  addDays,
  dayKey,
  differenceInCalendarDays,
  differenceInMinutes,
  fmtMinutes,
  formatTime,
  isSameDay,
  isToday,
} from '../../lib/dates';
import type { Occurrence, ResolvedTheme, TimeFormat } from '../../types';
import { getCategory } from '../../types';
import { Icon } from '../ui/Icon';
import { chipStyle } from './EventChip';

export interface AgendaViewProps {
  occurrences: Occurrence[];
  now: Date;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  /** First day the list covers, used for the "N days from now" gutter. */
  rangeStart: Date;
  onOpen: (o: Occurrence) => void;
  onCreateOn: (d: Date) => void;
  onEventPointerDown: (e: React.PointerEvent<HTMLElement>, o: Occurrence) => void;
  draggingId?: string | null;
  dropDayKey?: string | null;
  query?: string;
}

interface DayGroup {
  key: string;
  date: Date;
  items: Occurrence[];
  isToday: boolean;
  isPast: boolean;
}

export const AgendaView = memo(function AgendaView({
  occurrences,
  now,
  theme,
  timeFormat,
  rangeStart,
  onOpen,
  onCreateOn,
  onEventPointerDown,
  draggingId,
  dropDayKey,
}: AgendaViewProps) {
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, Occurrence[]>();
    for (const o of occurrences) {
      const k = dayKey(o.start);
      const arr = map.get(k);
      if (arr) arr.push(o);
      else map.set(k, [o]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, items]) => {
        const date = new Date(`${k}T12:00:00`);
        return {
          key: k,
          date,
          items: items.sort((a, b) => {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return a.start.getTime() - b.start.getTime();
          }),
          isToday: isToday(date),
          isPast: endOf(items) < now.getTime(),
        };
      });
  }, [occurrences, now]);

  const months = useMemo(() => {
    const set = new Map<string, DayGroup[]>();
    for (const g of groups) {
      const mk = `${g.date.getFullYear()}-${g.date.getMonth()}`;
      const arr = set.get(mk) ?? [];
      arr.push(g);
      set.set(mk, arr);
    }
    return [...set.entries()];
  }, [groups]);

  void rangeStart;

  if (!groups.length) {
    return (
      <div className="px-4 py-10 text-center text-[13.5px] text-ink2">
        Nothing scheduled in this range.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-24 pt-2 sm:px-4">
      {months.map(([monthKey, monthGroups]) => {
        const first = monthGroups[0].date;
        return (
          <section key={monthKey} className="mb-1">
            <h2 className="sticky top-0 z-10 -mx-2 mb-1 bg-[rgb(var(--c-base)/0.86)] px-3 py-2 font-display text-[13px] font-semibold uppercase tracking-[0.07em] text-ink2 backdrop-blur-md sm:-mx-4 sm:px-4">
              {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h2>

            <div className="space-y-1">
              {monthGroups.map((g) => {
                const daysAway = differenceInCalendarDays(g.date, now);
                const totalMinutes = g.items.reduce(
                  (sum, o) => sum + (o.allDay ? 0 : Math.max(0, differenceInMinutes(o.end, o.start))),
                  0,
                );

                return (
                  <div key={g.key} {...{ 'data-daykey': g.key }}>
                    <div className="flex items-baseline gap-2 px-1 pb-1 pt-2">
                      <span
                        className={cx(
                          'text-[13px] font-semibold tracking-[-0.01em]',
                          g.isToday ? 'text-accent' : g.isPast ? 'text-ink3' : 'text-ink',
                        )}
                      >
                        {g.isToday
                          ? 'Today'
                          : daysAway === 1
                            ? 'Tomorrow'
                            : daysAway === -1
                              ? 'Yesterday'
                              : g.date.toLocaleDateString(undefined, {
                                  weekday: 'long',
                                  month: 'short',
                                  day: 'numeric',
                                })}
                      </span>
                      <span className="text-[11.5px] text-ink3">
                        {g.items.length} event{g.items.length > 1 ? 's' : ''}
                        {totalMinutes > 0 ? ` · ${fmtMinutes(totalMinutes)}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => onCreateOn(g.date)}
                        className="pressable ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-accent opacity-0 transition-opacity hover:bg-accent/12 focus-visible:opacity-100 sm:group-hover:opacity-100"
                        aria-label={`Add an event on ${g.date.toLocaleDateString(undefined, {
                          month: 'long',
                          day: 'numeric',
                        })}`}
                      >
                        <Icon name="plus" size={11} weight={2.4} />
                        Add
                      </button>
                    </div>

                    <ul className="space-y-1">
                      {g.items.map((o) => (
                        <AgendaRow
                          key={o.id}
                          occurrence={o}
                          theme={theme}
                          timeFormat={timeFormat}
                          now={now}
                          past={g.isPast}
                          dragging={draggingId === o.id}
                          isDropTarget={!!draggingId && dropDayKey === g.key}
                          onOpen={onOpen}
                          onPointerDown={(e) => onEventPointerDown(e, o)}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* A quiet tail so the last row clears the floating "+" on mobile. */}
      <div className="h-6" aria-hidden="true" />
      <p className="px-2 pb-2 text-center text-[11.5px] text-ink3">
        Showing {occurrences.length} event{occurrences.length === 1 ? '' : 's'} from{' '}
        {rangeStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </p>
    </div>
  );
});

/* -------------------------------------------------------------------------- */

function AgendaRow({
  occurrence,
  theme,
  timeFormat,
  now,
  past,
  dragging,
  isDropTarget,
  onOpen,
  onPointerDown,
}: {
  occurrence: Occurrence;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  now: Date;
  past: boolean;
  dragging: boolean;
  isDropTarget: boolean;
  onOpen: (o: Occurrence) => void;
  onPointerDown: (e: React.PointerEvent<HTMLLIElement>) => void;
}) {
  const { event, allDay, start, end } = occurrence;
  const cat = getCategory(event.categoryId);
  const { bg, fg, solid } = chipStyle(event.categoryId, theme);
  const isLive = !allDay && start <= now && end > now;
  const minsAway = differenceInMinutes(start, now);

  return (
    <li
      role="button"
      tabIndex={0}
      aria-label={`${event.title}, ${allDay ? 'all day' : `${formatTime(start, timeFormat)} to ${formatTime(end, timeFormat)}`}${
        event.location ? `, at ${event.location}` : ''
      }, ${cat.name}`}
      onPointerDown={onPointerDown}
      onClick={() => onOpen(occurrence)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(occurrence);
        }
      }}
      className={cx(
        'pressable relative flex w-full items-stretch gap-3 overflow-hidden rounded-[13px] border p-2.5 text-left',
        'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.92)]',
        'hover:border-[rgb(var(--c-line)/var(--line-strong-alpha))] hover:bg-[rgb(var(--c-raised)/0.9)]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        past && 'opacity-60',
        dragging && 'dragging',
        isDropTarget && 'drop-target',
      )}
    >
      {/* Time column */}
      <div className="w-[68px] shrink-0 pt-0.5 text-right">
        {allDay ? (
          <span className="block text-[11px] font-semibold uppercase tracking-[0.05em] text-ink3">
            All day
          </span>
        ) : (
          <>
            <span className={cx('tnum block text-[12.5px] font-semibold', isLive ? 'text-accent' : 'text-ink')}>
              {formatTime(start, timeFormat)}
            </span>
            <span className="tnum block text-[11px] text-ink3">{formatTime(end, timeFormat)}</span>
          </>
        )}
      </div>

      {/* Category rail */}
      <span
        aria-hidden="true"
        className="w-[3px] shrink-0 rounded-full"
        style={{ backgroundColor: solid }}
      />

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
            {event.title}
          </span>
          {isLive ? (
            <span className="shrink-0 rounded-full bg-accent/18 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-accent">
              Now
            </span>
          ) : !past && minsAway > 0 && minsAway <= 120 ? (
            <span className="shrink-0 rounded-full bg-[rgb(var(--c-line)/0.1)] px-2 py-0.5 text-[10.5px] font-semibold text-ink2">
              in {fmtMinutes(minsAway)}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink2">
          {!allDay ? (
            <span className="inline-flex items-center gap-1 tnum">
              <Icon name="clock" size={11} weight={2} />
              {fmtMinutes(Math.max(0, differenceInMinutes(end, start)))}
            </span>
          ) : null}
          {event.location ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Icon name="pin" size={11} weight={2} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : null}
          {event.recurrence ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="repeat" size={11} weight={2} />
              Repeats
            </span>
          ) : null}
          {event.reminders.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="bell" size={11} weight={2} />
              {event.reminders.length}
            </span>
          ) : null}
          <span
            className="inline-flex items-center rounded-full px-1.5 py-px text-[10.5px] font-semibold"
            style={{ backgroundColor: bg, color: fg }}
          >
            {cat.name}
          </span>
        </div>

        {event.description ? (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink3">{event.description}</p>
        ) : null}
      </div>
    </li>
  );
}

function endOf(items: Occurrence[]): number {
  return items.reduce((m, o) => Math.max(m, o.end.getTime()), 0);
}

export function nextDayWithEvents(groups: DayGroup[], from: Date): Date | null {
  for (const g of groups) {
    if (g.date.getTime() >= from.getTime() && !isSameDay(g.date, addDays(from, -1))) return g.date;
  }
  return null;
}
