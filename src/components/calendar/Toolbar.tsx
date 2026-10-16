/**
 * Toolbar — the floating glass control bar above the grid.
 *
 * Holds: title for the visible range, previous/today/next, the view switcher and
 * search. On phones it collapses to a compact rail so the grid keeps the screen.
 */
import { memo } from 'react';
import { cx } from '../../lib/utils';
import { formatMonthTitle, formatRangeTitle } from '../../lib/dates';
import type { CalendarViewMode } from '../../types';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { Segmented } from '../ui/Controls';

export interface ToolbarProps {
  view: CalendarViewMode;
  onViewChange: (v: CalendarViewMode) => void;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onToggleSearch: () => void;
  searchActive: boolean;
  isMobile: boolean;
  /** e.g. "March 2027" vs a range — computed by the parent. */
  subtitle?: string;
}

const VIEW_OPTIONS: Array<{ value: CalendarViewMode; label: string; icon: IconName; short: string }> = [
  { value: 'month', label: 'Month', icon: 'grid', short: 'M' },
  { value: 'week', label: 'Week', icon: 'columns', short: 'W' },
  { value: 'day', label: 'Day', icon: 'square', short: 'D' },
  { value: 'agenda', label: 'Agenda', icon: 'list', short: 'A' },
];

export const Toolbar = memo(function Toolbar({
  view,
  onViewChange,
  title,
  onPrev,
  onNext,
  onToday,
  onToggleSearch,
  searchActive,
  isMobile,
  subtitle,
}: ToolbarProps) {
  return (
    <div className="shrink-0 px-2 pb-2 pt-2 sm:px-4 sm:pt-3">
      <div className="glass flex items-center gap-1.5 rounded-[18px] px-1.5 py-1.5 sm:gap-2 sm:px-2.5 sm:py-2">
        {/* Title + navigation */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="min-w-0 px-1.5">
            <h1
              className="truncate font-display text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[17px]"
              aria-live="polite"
            >
              {title}
            </h1>
            {subtitle && !isMobile ? (
              <p className="truncate text-[11px] leading-tight text-ink3">{subtitle}</p>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1 sm:ml-1">
            <IconButton
              icon="today"
              label="Go to today"
              size="sm"
              variant="ghost"
              onClick={onToday}
              className="hidden sm:inline-flex"
            />
            <IconButton icon="chevronLeft" label="Previous" size="sm" variant="ghost" onClick={onPrev} />
            <IconButton icon="chevronRight" label="Next" size="sm" variant="ghost" onClick={onNext} />
            {isMobile ? (
              <IconButton
                icon="today"
                label="Go to today"
                size="sm"
                variant="ghost"
                onClick={onToday}
              />
            ) : null}
          </div>
        </div>

        {/* Search */}
        <IconButton
          icon="search"
          label={searchActive ? 'Close search' : 'Search events'}
          size="sm"
          variant="ghost"
          active={searchActive}
          onClick={onToggleSearch}
        />

        {/* View switcher */}
        {isMobile ? (
          <MobileViewSwitch value={view} onChange={onViewChange} />
        ) : (
          <Segmented
            value={view}
            onChange={onViewChange}
            ariaLabel="Calendar view"
            size="sm"
            options={VIEW_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))}
            className="ml-0.5"
          />
        )}
      </div>
    </div>
  );
});

/**
 * On phones a 4-way segmented control is too wide next to the title, so the
 * switcher becomes a single button that cycles the views — with the current view
 * named, and a long-press-free second path via the bottom nav.
 */
function MobileViewSwitch({
  value,
  onChange,
}: {
  value: CalendarViewMode;
  onChange: (v: CalendarViewMode) => void;
}) {
  const current = VIEW_OPTIONS.find((o) => o.value === value) ?? VIEW_OPTIONS[0];
  const next = () => {
    const i = VIEW_OPTIONS.findIndex((o) => o.value === value);
    onChange(VIEW_OPTIONS[(i + 1) % VIEW_OPTIONS.length].value);
  };

  return (
    <button
      type="button"
      onClick={next}
      aria-label={`View: ${current.label}. Tap to change view.`}
      className={cx(
        'pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[11px]',
        'bg-[rgb(var(--c-raised))] px-2.5 text-[12.5px] font-semibold text-ink',
        'shadow-[0_1px_2px_rgb(0_0_0/0.25),inset_0_1px_0_rgb(255_255_255/0.08)]',
      )}
    >
      <Icon name={current.icon} size={14} weight={1.9} />
      {current.label}
    </button>
  );
}

export { VIEW_OPTIONS, formatMonthTitle, formatRangeTitle };
