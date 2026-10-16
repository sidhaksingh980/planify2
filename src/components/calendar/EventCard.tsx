/**
 * EventCard — an event positioned inside the day/week time grid.
 *
 * Height and left/width come from `layoutDay`, so overlapping events sit side by
 * side instead of stacking opaquely. The card keeps a solid category tint and a
 * 3px accent rail; text stays at AA contrast over it. Very short events collapse
 * to a single line so the time is still readable.
 */
import { memo } from 'react';
import { cx } from '../../lib/utils';
import { differenceInMinutes, formatTime, formatTimeCompact } from '../../lib/dates';
import type { Occurrence, ResolvedTheme, TimeFormat } from '../../types';
import { Icon } from '../ui/Icon';
import { chipStyle } from './EventChip';

export interface EventCardProps {
  occurrence: Occurrence;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  top: number;
  height: number;
  left: number;
  width: number;
  compact: boolean;
  dragging?: boolean;
  clippedTop?: boolean;
  clippedBottom?: boolean;
  onOpen: (o: Occurrence) => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const EventCard = memo(function EventCard({
  occurrence,
  theme,
  timeFormat,
  top,
  height,
  left,
  width,
  compact,
  dragging = false,
  clippedTop = false,
  clippedBottom = false,
  onOpen,
  onPointerDown,
}: EventCardProps) {
  const { event, start, end } = occurrence;
  const { bg, fg, solid } = chipStyle(event.categoryId, theme);
  const minutes = differenceInMinutes(end, start);
  const single = minutes <= 34;

  const label = `${event.title}, ${formatTime(start, timeFormat)} to ${formatTime(end, timeFormat)}${
    event.location ? `, at ${event.location}` : ''
  }${event.recurrence ? ', repeats' : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(occurrence);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpen(occurrence);
        }
      }}
      className={cx(
        'absolute overflow-hidden rounded-[9px] border text-left',
        'transition-[transform,box-shadow,filter] duration-150 ease-out',
        'cursor-pointer select-none hover:brightness-[1.1]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
        dragging ? 'z-30 shadow-float brightness-[1.14]' : 'z-10',
        single ? 'flex items-center gap-1.5 py-0' : 'py-1',
      )}
      style={{
        top: `${top}%`,
        height: `${height}%`,
        left: `calc(${left * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
        backgroundColor: bg,
        color: fg,
        borderColor: solid,
        borderLeftWidth: 3,
        borderLeftColor: solid,
      }}
    >
      <div className={cx('flex min-w-0 flex-col', single ? 'flex-row items-center gap-1.5' : 'gap-0.5', 'px-1.5')}>
        <span
          className={cx(
            'tnum shrink-0 font-semibold',
            single ? 'text-[10.5px] leading-none opacity-90' : 'text-[10.5px] leading-tight opacity-85',
          )}
        >
          {clippedTop
            ? `until ${formatTimeCompact(end, timeFormat)}`
            : clippedBottom
              ? `${formatTimeCompact(start, timeFormat)}–`
              : formatTimeCompact(start, timeFormat)}
        </span>
        <span
          className={cx(
            'min-w-0 truncate font-medium leading-tight',
            single ? 'text-[11.5px]' : compact ? 'text-[11.5px]' : 'text-[12.5px]',
          )}
        >
          {event.title}
        </span>
        {!single && !compact && event.location ? (
          <span className="flex min-w-0 items-center gap-1 text-[10.5px] leading-tight opacity-80">
            <Icon name="pin" size={9} weight={2.2} className="shrink-0" />
            <span className="truncate">{event.location}</span>
          </span>
        ) : null}
        {!single && event.recurrence ? (
          <span className="flex items-center gap-1 text-[10px] leading-tight opacity-75">
            <Icon name="repeat" size={9} weight={2.3} />
            Repeats
          </span>
        ) : null}
      </div>
    </div>
  );
});
