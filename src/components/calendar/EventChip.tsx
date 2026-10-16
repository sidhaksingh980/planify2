/**
 * EventChip — one event, rendered for a month cell or an agenda row.
 *
 * Legibility first: the chip sits on a *solid* category tint (never on blur),
 * with a saturated rail on the left and text whose contrast against that tint is
 * computed at runtime rather than assumed.
 */
import { memo } from 'react';
import { cx } from '../../lib/utils';
import { getCategory, CATEGORIES_LIGHT, type Occurrence, type ResolvedTheme, type TimeFormat } from '../../types';
import { formatTimeCompact } from '../../lib/dates';
import { Icon } from '../ui/Icon';

export interface EventChipProps {
  occurrence: Occurrence;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  onOpen: (o: Occurrence) => void;
  /** Dense mode for month cells. */
  dense?: boolean;
  /** Show the query match highlight. */
  query?: string;
  selected?: boolean;
  /** Rendered inside a drag ghost. */
  ghost?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function chipStyle(categoryId: string, theme: ResolvedTheme): { bg: string; fg: string; solid: string } {
  const cat = getCategory(categoryId);
  if (theme === 'light') {
    const light = CATEGORIES_LIGHT[cat.id] ?? { bg: '#E4E6EA', fg: '#3D424B' };
    return { ...light, solid: cat.solid };
  }
  return { bg: cat.bg, fg: cat.fg, solid: cat.solid };
}

export const EventChip = memo(function EventChip({
  occurrence,
  theme,
  timeFormat,
  onOpen,
  dense = false,
  selected = false,
  ghost = false,
  onPointerDown,
  style,
  className,
}: EventChipProps) {
  const { event, allDay, start } = occurrence;
  const { bg, fg, solid } = chipStyle(event.categoryId, theme);

  return (
    <div
      role="button"
      tabIndex={ghost ? -1 : 0}
      aria-label={`${event.title}${allDay ? ', all day' : `, ${formatTimeCompact(start, timeFormat)}`}${
        event.location ? `, at ${event.location}` : ''
      }`}
      onPointerDown={ghost ? undefined : onPointerDown}
      onClick={(e) => {
        if (ghost) return;
        e.stopPropagation();
        onOpen(occurrence);
      }}
      onKeyDown={(e) => {
        if (ghost) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpen(occurrence);
        }
      }}
      style={{ backgroundColor: bg, color: fg, ...style }}
      className={cx(
        'group/chip relative flex w-full items-center gap-1.5 overflow-hidden rounded-[7px] text-left',
        'transition-[transform,box-shadow,filter] duration-150 ease-out',
        dense ? 'h-[19px] px-1.5' : 'min-h-[26px] px-2 py-1',
        !ghost && 'cursor-pointer hover:brightness-[1.12] active:scale-[0.985]',
        !ghost && 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        selected && 'ring-2 ring-[rgb(var(--c-ink)/0.55)]',
        ghost && 'opacity-90 shadow-float',
        className,
      )}
    >
      {/* Category rail */}
      <span
        aria-hidden="true"
        className={cx('shrink-0 rounded-full', dense ? 'h-[6px] w-[6px]' : 'h-[7px] w-[7px]')}
        style={{ backgroundColor: solid }}
      />

      {dense ? (
        <span className={cx('min-w-0 flex-1 truncate font-medium', 'text-[11.5px] leading-none')}>
          {!allDay && (
            <span className="tnum mr-1 opacity-85">{formatTimeCompact(start, timeFormat)}</span>
          )}
          {event.title}
        </span>
      ) : (
        <>
          <span className="tnum shrink-0 text-[11.5px] font-semibold leading-none opacity-90">
            {allDay ? 'All day' : formatTimeCompact(start, timeFormat)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-tight">
            {event.title}
          </span>
          {event.recurrence ? (
            <Icon name="repeat" size={11} weight={2.2} className="shrink-0 opacity-70" />
          ) : null}
        </>
      )}
    </div>
  );
});
