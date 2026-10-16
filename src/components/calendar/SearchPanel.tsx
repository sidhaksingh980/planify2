/**
 * SearchPanel — search across title, location, notes and dates, plus filters by
 * category, source calendar and time window.
 *
 * Results are the user's real events, ordered soonest-first. When a search
 * returns nothing the panel says so plainly and offers to clear the filters —
 * it never substitutes filler content.
 */
import { memo, useMemo } from 'react';
import { cx } from '../../lib/utils';
import { dayKey, formatTime, fromDayKey } from '../../lib/dates';
import { matchesQuery, sortEventsForList, type EventFilters } from '../../lib/calendarEngine';
import { nextOccurrenceAfter } from '../../lib/recurrence';
import { CATEGORIES, getCategory, type CalEvent, type ResolvedTheme, type TimeFormat } from '../../types';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { chipStyle } from './EventChip';

export interface SearchPanelProps {
  open: boolean;
  query: string;
  filters: EventFilters;
  onChange: (next: EventFilters) => void;
  onClear: () => void;
  events: CalEvent[];
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  hiddenCategoryIds: string[];
  onToggleCategoryVisibility: (id: string) => void;
  onOpenEvent: (event: CalEvent) => void;
  onClose: () => void;
}

const WHEN_OPTIONS: Array<{ value: EventFilters['when']; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'past', label: 'Past' },
];

export const SearchPanel = memo(function SearchPanel({
  open,
  query,
  filters,
  onChange,
  onClear,
  events,
  theme,
  timeFormat,
  hiddenCategoryIds,
  onToggleCategoryVisibility,
  onOpenEvent,
  onClose,
}: SearchPanelProps) {
  const results = useMemo(() => {
    const visible = events.filter((e) => !e.deleted && !hiddenCategoryIds.includes(e.categoryId));
    const q = query.trim();
    const filtered = visible.filter((e) => {
      if (filters.categoryIds.length && !filters.categoryIds.includes(e.categoryId)) return false;
      if (filters.hideImported && e.googleEventId) return false;
      if (!matchesQuery(e, q)) return false;
      if (filters.when !== 'all') {
        const start = e.allDay ? fromDayKey(e.startTime.slice(0, 10)) : new Date(e.startTime);
        const now = new Date();
        if (filters.when === 'today' && dayKey(start) !== dayKey(now)) return false;
        if (filters.when === 'upcoming' && start.getTime() < now.getTime()) return false;
        if (filters.when === 'past' && start.getTime() >= now.getTime()) return false;
      }
      return true;
    });
    return sortEventsForList(filtered, new Date()).slice(0, 120);
  }, [events, query, filters, hiddenCategoryIds]);

  if (!open) return null;

  const activeFilters =
    filters.categoryIds.length > 0 || filters.when !== 'all' || filters.hideImported;

  return (
    <section
      aria-label="Search and filter events"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Query + when */}
      <div className="shrink-0 space-y-2.5 border-b border-[rgb(var(--c-line)/var(--line-alpha))] px-3 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3">
              <Icon name="search" size={15} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => onChange({ ...filters, query: e.target.value })}
              placeholder="Search title, location, notes or a date…"
              aria-label="Search events"
              className={cx(
                'h-10 w-full rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))]',
                'bg-[rgb(var(--c-surface)/0.9)] pl-9 pr-3 text-[14px] text-ink placeholder:text-ink3/75',
                'focus:border-accent/60 focus:outline-none focus-visible:shadow-focus',
                '[&::-webkit-search-cancel-button]:appearance-none',
              )}
            />
          </div>
          <Button variant="subtle" size="sm" icon="close" onClick={onClose} aria-label="Close search">
            <span className="sr-only sm:not-sr-only sm:hidden">Close</span>
          </Button>
        </div>

        {/* When */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="Filter by time">
          {WHEN_OPTIONS.map((o) => {
            const active = filters.when === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...filters, when: o.value })}
                className={cx(
                  'pressable shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold',
                  active
                    ? 'border-accent/45 bg-accent/16 text-accent'
                    : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.04)] text-ink2 hover:text-ink',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {/* Categories */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar" role="group" aria-label="Filter by category">
          <button
            type="button"
            aria-pressed={filters.categoryIds.length === 0}
            onClick={() => onChange({ ...filters, categoryIds: [] })}
            className={cx(
              'pressable shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold',
              filters.categoryIds.length === 0
                ? 'border-accent/45 bg-accent/16 text-accent'
                : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.04)] text-ink2 hover:text-ink',
            )}
          >
            All categories
          </button>
          {CATEGORIES.map((c) => {
            const active = filters.categoryIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    ...filters,
                    categoryIds: active
                      ? filters.categoryIds.filter((x) => x !== c.id)
                      : [...filters.categoryIds, c.id],
                  })
                }
                className={cx(
                  'pressable inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                  active
                    ? 'border-[rgb(var(--c-line)/var(--line-strong-alpha))] bg-[rgb(var(--c-line)/0.12)] text-ink'
                    : 'border-transparent bg-[rgb(var(--c-line)/0.05)] text-ink2 hover:bg-[rgb(var(--c-line)/0.1)]',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx('h-2 w-2 rounded-full transition-opacity', active ? 'opacity-100' : 'opacity-55')}
                  style={{ backgroundColor: c.solid }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result count / clear */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4">
        <p className="text-[12px] font-medium text-ink3" role="status">
          {results.length} {results.length === 1 ? 'event' : 'events'}
          {query.trim() ? ` matching “${query.trim()}”` : ''}
        </p>
        {activeFilters || query.trim() ? (
          <button
            type="button"
            onClick={onClear}
            className="pressable ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold text-accent hover:bg-accent/12"
          >
            <Icon name="close" size={11} weight={2.4} />
            Clear
          </button>
        ) : null}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-24 sm:px-3">
        {results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="glass grid h-12 w-12 place-items-center rounded-full text-ink3">
              <Icon name="search" size={20} weight={1.7} />
            </span>
            <p className="text-[14.5px] font-semibold text-ink">No matching events</p>
            <p className="max-w-xs text-[12.5px] leading-snug text-ink2">
              {events.filter((e) => !e.deleted).length === 0
                ? 'Your calendar is empty, so there is nothing to search yet.'
                : 'Try a different word, or clear the filters to see everything again.'}
            </p>
            {activeFilters || query.trim() ? (
              <Button size="sm" variant="subtle" className="mt-1" onClick={onClear}>
                Clear search and filters
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {results.map((e) => {
              const occ = nextOccurrenceAfter(e, new Date());
              const start = occ?.start ?? (e.allDay ? fromDayKey(e.startTime.slice(0, 10)) : new Date(e.startTime));
              const cat = getCategory(e.categoryId);
              const colors = chipStyle(e.categoryId, theme);
              const hidden = hiddenCategoryIds.includes(e.categoryId);

              return (
                <li key={e.id}>
                  <div
                    className={cx(
                      'pressable group flex w-full items-stretch gap-3 overflow-hidden rounded-[13px] border p-2.5 text-left',
                      'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.9)]',
                      'hover:border-[rgb(var(--c-line)/var(--line-strong-alpha))]',
                      hidden && 'opacity-45',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="w-[3px] shrink-0 rounded-full"
                      style={{ backgroundColor: colors.solid }}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenEvent(e)}
                        className="block w-full truncate text-left text-[14px] font-semibold tracking-[-0.01em] text-ink hover:underline"
                      >
                        {e.title}
                      </button>
                      <p className="mt-0.5 text-[12px] text-ink2 tnum">
                        {e.allDay
                          ? `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · All day`
                          : `${start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${formatTime(start, timeFormat)}`}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className="rounded-full px-1.5 py-px font-semibold"
                          style={{ backgroundColor: colors.bg, color: colors.fg }}
                        >
                          {cat.name}
                        </span>
                        {e.location ? (
                          <span className="inline-flex min-w-0 items-center gap-1 text-ink3">
                            <Icon name="pin" size={10} weight={2.1} />
                            <span className="max-w-[140px] truncate">{e.location}</span>
                          </span>
                        ) : null}
                        {e.recurrence ? (
                          <span className="inline-flex items-center gap-1 text-ink3">
                            <Icon name="repeat" size={10} weight={2.1} />
                            Repeats
                          </span>
                        ) : null}
                        {e.googleEventId ? (
                          <span className="inline-flex items-center gap-1 text-ink3">
                            <Icon name="link" size={10} weight={2.1} />
                            Google
                          </span>
                        ) : null}
                      </div>
                      {e.description ? (
                        <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-ink3">{e.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleCategoryVisibility(cat.id)}
                      aria-label={hidden ? `Show ${cat.name} events` : `Hide ${cat.name} events`}
                      title={hidden ? 'Show this category' : 'Hide this category'}
                      className="pressable mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink3 opacity-0 transition-opacity hover:bg-[rgb(var(--c-line)/0.1)] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Icon name={hidden ? 'eyeOff' : 'eye'} size={14} weight={1.9} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
});
