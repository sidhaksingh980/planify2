/**
 * Calendar shell state: which view, which anchor date, search/filter, selection
 * and the sheets that float over the grid.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayKey, fromDayKey, isSameDay, shiftAnchor, startOfDay } from '../lib/dates';
import { applyFilters, EMPTY_FILTERS, occurrencesFor, resolveRange, type EventFilters, type ViewRange } from '../lib/calendarEngine';
import { useAppStore } from '../store/AppStore';
import type { CalEvent, CalendarViewMode, Occurrence, UserSettings, Weekday } from '../types';

export interface EditorTarget {
  /** Existing event being edited, or null for a new one. */
  event: CalEvent | null;
  /** Pre-filled draft values for a new event. */
  draft?: Partial<CalEvent>;
  /** When editing a recurring series, which occurrence the user tapped. */
  occurrence?: Occurrence | null;
}

export interface CalendarShell {
  view: CalendarViewMode;
  setView: (v: CalendarViewMode) => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  goToday: () => void;
  step: (delta: number) => void;
  selectedDay: Date;
  selectDay: (d: Date) => void;
  range: ViewRange;
  visibleEvents: CalEvent[];
  occurrences: Occurrence[];
  filters: EventFilters;
  setFilters: React.Dispatch<React.SetStateAction<EventFilters>>;
  clearFilters: () => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  editor: EditorTarget | null;
  openEditor: (t: EditorTarget) => void;
  closeEditor: () => void;
  detail: Occurrence | null;
  openDetail: (o: Occurrence) => void;
  closeDetail: () => void;
  aiOpen: boolean;
  setAiOpen: (v: boolean) => void;
  settings: UserSettings;
}

const VIEW_STORAGE_KEY = 'planify:view';

export function useCalendarShell(settings: UserSettings): CalendarShell {
  const { events } = useAppStore();

  const [view, setViewState] = useState<CalendarViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY) as CalendarViewMode | null;
      if (saved && ['month', 'week', 'day', 'agenda'].includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    // Phones default to a list of what's coming; wide screens to the month.
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'agenda' : 'month';
  });

  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const setView = useCallback((v: CalendarViewMode) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, []);

  const goToday = useCallback(() => {
    const today = startOfDay(new Date());
    setAnchor(today);
    setSelectedDay(today);
  }, []);

  const step = useCallback(
    (delta: number) => {
      setAnchor((prev) => {
        const next = shiftAnchor(prev, view === 'agenda' ? 'month' : view, delta);
        setSelectedDay(next);
        return next;
      });
    },
    [view],
  );

  const selectDay = useCallback((d: Date) => {
    const day = startOfDay(d);
    setSelectedDay(day);
    setAnchor(day);
  }, []);

  const range = useMemo(
    () =>
      resolveRange(
        view,
        anchor,
        settings.firstDayOfWeek as Weekday,
        settings.weekViewDays,
      ),
    [view, anchor, settings.firstDayOfWeek, settings.weekViewDays],
  );

  const visibleEvents = useMemo(
    () => applyFilters(events, filters),
    [events, filters],
  );

  const occurrences = useMemo(
    () => occurrencesFor(visibleEvents, range),
    [visibleEvents, range],
  );

  // Keep the anchor on the same month/week when the view changes so the
  // transition feels continuous rather than jumping back to today.
  useEffect(() => {
    if (view === 'day' && !isSameDay(anchor, selectedDay)) {
      setAnchor(selectedDay);
    }
  }, [view, anchor, selectedDay]);

  const openEditor = useCallback((t: EditorTarget) => {
    setDetail(null);
    setEditor(t);
  }, []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const openDetail = useCallback((o: Occurrence) => {
    setEditor(null);
    setDetail(o);
  }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  return {
    view,
    setView,
    anchor,
    setAnchor,
    goToday,
    step,
    selectedDay,
    selectDay,
    range,
    visibleEvents,
    occurrences,
    filters,
    setFilters,
    clearFilters,
    searchOpen,
    setSearchOpen,
    editor,
    openEditor,
    closeEditor,
    detail,
    openDetail,
    closeDetail,
    aiOpen,
    setAiOpen,
    settings,
  };
}

export { dayKey, fromDayKey };
