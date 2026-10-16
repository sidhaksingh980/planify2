/**
 * Sheet + Modal + Popover.
 *
 * One component, two presentations chosen by viewport:
 *   • mobile  → a bottom sheet that slides up, with an iOS grabber, rounded top
 *               corners and safe-area padding.
 *   • desktop → a centred glass modal that scales in.
 *
 * Both are real dialogs: `role="dialog"`, `aria-modal`, a focus trap, Escape to
 * dismiss, scroll lock while open, and focus restored to the trigger on close.
 * A blurred scrim sits behind them.
 */
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/utils';
import { useDialogBehaviour, useScrollLock, useViewport } from '../../hooks/useViewport';
import { IconButton } from './Button';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Width cap on desktop. */
  maxWidth?: number;
  hideClose?: boolean;
  closeOnScrim?: boolean;
  /** Extra height headroom for tall forms on desktop. */
  tall?: boolean;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 620,
  hideClose = false,
  closeOnScrim = true,
  tall = false,
}: SheetProps) {
  const { isMobile } = useViewport();
  useScrollLock(open);
  const dialogRef = useDialogBehaviour(open, onClose);
  const uid = useId().replace(/:/g, '');
  const titleId = `sheet-title-${uid}`;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex">
      <div
        className="absolute inset-0 animate-fade-in bg-[rgb(4_4_6/0.55)] backdrop-blur-[3px]"
        onClick={closeOnScrim ? onClose : undefined}
        aria-hidden="true"
      />

      <div
        className={cx('relative m-auto w-full', isMobile ? 'mb-0 mt-auto' : 'p-4')}
        style={!isMobile ? { maxWidth } : undefined}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={typeof title === 'string' ? titleId : undefined}
          className={cx(
            'glass glass-strong relative flex flex-col overflow-hidden',
            isMobile ? 'max-h-[92dvh] rounded-t-sheet border-b-0 pb-safe' : 'rounded-glass',
            isMobile ? 'animate-sheet-up' : 'animate-pop-in',
          )}
          style={
            !isMobile
              ? { maxWidth, maxHeight: tall ? '92dvh' : '88dvh' }
              : undefined
          }
        >
          {(title || subtitle || !hideClose) && (
            <header className="relative shrink-0 px-4 pb-2 pt-3 sm:px-5 sm:pt-4">
              {isMobile && (
                <div className="mb-3 flex justify-center" aria-hidden="true">
                  <div className="grabber" />
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {title ? (
                    <h2
                      id={titleId}
                      className="font-display text-[17px] font-semibold leading-tight tracking-[-0.02em] text-ink"
                    >
                      {title}
                    </h2>
                  ) : null}
                  {subtitle ? (
                    <p className="mt-1 text-[13px] leading-snug text-ink2">{subtitle}</p>
                  ) : null}
                </div>
                {!hideClose && (
                  <IconButton
                    icon="close"
                    label="Close"
                    variant="subtle"
                    size="sm"
                    onClick={onClose}
                    className="-mr-1 -mt-1 shrink-0"
                  />
                )}
              </div>
            </header>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 sm:px-5">
            {children}
          </div>

          {footer ? (
            <footer className="glass relative shrink-0 border-t border-[var(--glass-border-soft)] px-4 py-3 sm:px-5">
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                     */
/* -------------------------------------------------------------------------- */

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  width?: number;
  label: string;
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'end',
  side = 'bottom',
  width = 260,
  label,
}: PopoverProps) {
  const ref = useDialogBehaviour(open, onClose);

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = align === 'end' ? rect.right - width : rect.left;
  left = Math.max(8, Math.min(left, vw - width - 8));

  // Flip upwards when there isn't room below.
  const flipUp = side === 'bottom' && rect.bottom + 320 > vh - 12;
  const top = flipUp ? Math.max(8, rect.top - 8) : rect.bottom + 8;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className="glass glass-strong animate-pop-in fixed z-[71] overflow-hidden rounded-[18px] p-1.5"
        style={{ left, top, width, transform: flipUp ? 'translateY(-100%)' : undefined }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onSelect,
  tone = 'default',
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'pressable flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium',
        tone === 'danger'
          ? 'text-danger hover:bg-danger/14'
          : 'text-ink hover:bg-[rgb(var(--c-line)/0.1)]',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {icon ? <span className="shrink-0 opacity-80">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-2xs text-ink3">{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-[rgb(var(--c-line)/var(--line-alpha))]" role="separator" />;
}
