/**
 * CalendarSurface — owns the drag gesture and swaps between the four views.
 *
 * Drag semantics, resolved in one place so every view behaves identically:
 *   • Time grid: vertical movement changes the time (snapped to 15 min);
 *     horizontal movement across columns changes the day.
 *   • Month grid: the day under the pointer wins; the clock time is preserved.
 * A drop writes through `updateEvent`, which persists immediately and syncs.
 */
import { useCallback, useMemo } from 'react';
import {
  addDays,
  atTime,
  dayKey,
  differenceInCalendarDays,
  fromDayKey,
} from '../../lib/dates';
import type { DayWindow } from '../../lib/calendarEngine';
import { useDrag } from '../../hooks/useDrag';
import { useAppStore } from '../../store/AppStore';
import { useViewport } from '../../hooks/useViewport';
import type {
  CalEvent,
  CalendarViewMode,
  Occurrence,
  ResolvedTheme,
  UserSettings,
  Weekday,
} from '../../types';
import { MonthView } from './MonthView';
import { TimeGrid } from './TimeGrid';
import { AgendaView } from './AgendaView';

export interface CalendarSurfaceProps {
  view: CalendarViewMode;
  days: Date[];
  anchor: Date;
  rangeStart: Date;
  occurrences: Occurrence[];
  settings: UserSettings;
  theme: ResolvedTheme;
  now: Date;
  selectedDay: Date;
  query?: string;
  onSelectDay: (d: Date) => void;
  onOpenDay: (d: Date) => void;
  onOpen: (o: Occurrence) => void;
  onCreateAt: (start: Date, end: Date) => void;
  onCreateOn: (day: Date) => void;
  /** Which occurrence the AI panel should treat as "this one". */
  onFocusEvent: (e: CalEvent | null) => void;
}

const HOUR_HEIGHT_DESKTOP = 58;
const HOUR_HEIGHT_MOBILE = 52;

export function CalendarSurface({
  view,
  days,
  anchor,
  rangeStart,
  occurrences,
  settings,
  theme,
  now,
  selectedDay,
  query,
  onSelectDay,
  onOpenDay,
  onOpen,
  onCreateAt,
  onCreateOn,
  onFocusEvent,
}: CalendarSurfaceProps) {
  const { updateEvent, events } = useAppStore();
  const { isMobile } = useViewport();

  const window: DayWindow = useMemo(
    () => ({
      dayStartHour: settings.dayStartHour,
      dayEndHour: Math.min(24, settings.dayStartHour + (view === 'day' ? 16 : 15)),
    }),
    [settings.dayStartHour, view],
  );

  const hourHeight = isMobile ? HOUR_HEIGHT_MOBILE : HOUR_HEIGHT_DESKTOP;
  const minutesPerPixel = 60 / hourHeight;

  const handleCommit = useCallback(
    (result: { seriesId: string; deltaMinutes: number; overDayKey: string | null }) => {
      const source = events.find((e) => e.id === result.seriesId);
      if (!source) return;

      const start = source.allDay
        ? fromDayKey(source.startTime.slice(0, 10))
        : new Date(source.startTime);
      const end = source.allDay
        ? fromDayKey(source.endTime.slice(0, 10))
        : new Date(source.endTime);
      const durationMs = end.getTime() - start.getTime();

      // Day change from the drop target (month grid, or moving across columns).
      let nextStart = new Date(start.getTime() + result.deltaMinutes * 60_000);
      if (result.overDayKey) {
        const targetDay = fromDayKey(result.overDayKey);
        const dayShift = differenceInCalendarDays(targetDay, start);
        if (dayShift !== 0) nextStart = addDays(nextStart, dayShift);
      }

      // No-op drop: nothing to write, so nothing is written.
      if (nextStart.getTime() === start.getTime()) return;

      const nextEnd = new Date(nextStart.getTime() + durationMs);
      onFocusEvent(source);

      void updateEvent(source.id, {
        startTime: source.allDay ? dayKey(nextStart) : nextStart.toISOString(),
        endTime: source.allDay ? dayKey(nextEnd) : nextEnd.toISOString(),
      });
    },
    [events, updateEvent, onFocusEvent],
  );

  const { drag, beginDrag } = useDrag({
    minutesPerPixel,
    snapMinutes: 15,
    onCommit: handleCommit,
  });

  const onEventPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, o: Occurrence) => {
      beginDrag(e, o.id, o.seriesId);
    },
    [beginDrag],
  );

  // While a drag is live, mirror the target day for the drop highlight.
  const activeDropKey = drag?.active ? drag.overDayKey : null;

  const shared = {
    occurrences,
    theme,
    timeFormat: settings.timeFormat,
    onOpen,
    onEventPointerDown,
    draggingId: drag?.active ? drag.occurrenceId : null,
    dropDayKey: activeDropKey,
  };

  if (view === 'month') {
    return (
      <MonthView
        {...shared}
        days={days}
        anchor={anchor}
        firstDayOfWeek={settings.firstDayOfWeek as Weekday}
        selectedDay={selectedDay}
        compact={isMobile}
        onSelectDay={onSelectDay}
        onOpenDay={onOpenDay}
        onCreateOn={onCreateOn}
        query={query}
      />
    );
  }

  if (view === 'week') {
    return (
      <TimeGrid
        {...shared}
        days={days}
        window={window}
        now={now}
        compact={isMobile}
        hourHeight={hourHeight}
        onCreateAt={onCreateAt}
        onCreateAllDay={onCreateOn}
      />
    );
  }

  if (view === 'day') {
    return (
      <TimeGrid
        {...shared}
        days={[selectedDay]}
        window={{ dayStartHour: settings.dayStartHour, dayEndHour: Math.min(24, settings.dayStartHour + 16) }}
        now={now}
        compact={false}
        hourHeight={hourHeight + 8}
        onCreateAt={onCreateAt}
        onCreateAllDay={onCreateOn}
      />
    );
  }

  return (
    <AgendaView
      {...shared}
      now={now}
      rangeStart={rangeStart}
      onCreateOn={onCreateOn}
      query={query}
    />
  );
}

/**
 * Build the start/end for a "tap empty space at this hour" create gesture.
 * Exported for the day/week gutters and the FAB.
 */
export function slotForTap(day: Date, hour: number, minutes = 0, durationMinutes = 60) {
  const start = atTime(day, hour, minutes);
  return { start, end: new Date(start.getTime() + durationMinutes * 60_000) };
}
