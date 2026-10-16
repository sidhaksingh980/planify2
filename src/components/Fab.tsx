/**
 * Floating actions.
 *
 * `Fab` is the glass "+" for quick event creation, lifted above the bottom nav
 * on phones and clear of the sidebar on desktop. `AiFab` is the assistant
 * bubble, visually distinct (accent + sparkles) so the two never get confused.
 */
import { memo } from 'react';
import { cx } from '../lib/utils';
import { Icon } from './ui/Icon';

export interface FabProps {
  onClick: () => void;
  label?: string;
  /** Shift up to clear the mobile bottom nav. */
  aboveNav?: boolean;
  className?: string;
  /** Pulse once on first run to draw the eye to the empty calendar. */
  attention?: boolean;
}

export const Fab = memo(function Fab({
  onClick,
  label = 'Add event',
  aboveNav = false,
  className,
  attention = false,
}: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        'pressable fab fixed z-40 grid h-14 w-14 place-items-center rounded-full',
        'bg-accent text-[rgb(var(--c-accent-ink))]',
        'ring-1 ring-inset ring-[rgb(255_255_255/0.22)]',
        aboveNav ? 'bottom-[86px] right-4 sm:right-6' : 'bottom-5 right-4 sm:bottom-6 sm:right-6',
        'lg:bottom-7 lg:right-7',
        attention && 'animate-breathe',
        className,
      )}
    >
      <Icon name="plus" size={26} weight={2.3} />
    </button>
  );
});

export interface AiFabProps {
  onClick: () => void;
  open: boolean;
  label?: string;
  aboveNav?: boolean;
}

export const AiFab = memo(function AiFab({
  onClick,
  open,
  label = 'Open the AI assistant',
  aboveNav = false,
}: AiFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? 'Close the AI assistant' : label}
      aria-expanded={open}
      title={open ? 'Close assistant' : 'AI assistant'}
      className={cx(
        'pressable glass glass-strong fixed z-40 grid h-12 w-12 place-items-center rounded-full',
        'text-accent ring-1 ring-inset ring-accent/35',
        aboveNav ? 'bottom-[86px] right-4 sm:right-6' : 'bottom-5 right-4 sm:bottom-6 sm:right-6',
        // On desktop the "+" lives bottom-right, so the assistant sits above it.
        'lg:bottom-24 lg:right-7',
      )}
    >
      {open ? <Icon name="close" size={19} weight={2.2} /> : <Icon name="sparkles" size={20} weight={1.9} />}
    </button>
  );
});
