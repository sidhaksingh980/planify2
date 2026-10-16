/**
 * Buttons.
 *
 * Four visual weights:
 *   `primary`  — accent fill, white text (verified 5.9:1 dark / 5.4:1 light)
 *   `glass`    — translucent glass, the default for toolbars and nav
 *   `subtle`   — quiet, for tertiary actions
 *   `danger`   — destructive; always paired with a confirmation step
 *
 * Every button gets the `.pressable` micro-interaction and a visible
 * `:focus-visible` ring for keyboard users.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx, haptic } from '../../lib/utils';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'glass' | 'subtle' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: cx(
    'glass-none text-[rgb(var(--c-accent-ink))] border-transparent',
    'bg-accent hover:brightness-110 active:brightness-95',
    'shadow-[0_1px_2px_rgb(0_0_0/0.25),0_8px_20px_-6px_rgb(var(--c-accent)/0.55)]',
  ),
  glass: cx(
    'glass text-ink hover:bg-[var(--glass-bg-strong)]',
    'border-[var(--glass-border-soft)]',
  ),
  subtle: cx(
    'bg-[rgb(var(--c-line)/0.07)] text-ink2 border border-transparent',
    'hover:bg-[rgb(var(--c-line)/0.12)] hover:text-ink',
  ),
  danger: cx(
    'bg-danger/14 text-danger border border-danger/28',
    'hover:bg-danger/22 hover:border-danger/45',
  ),
  ghost: cx('bg-transparent text-ink2 border border-transparent hover:bg-[rgb(var(--c-line)/0.08)] hover:text-ink'),
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-sm gap-2 rounded-[14px]',
  lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'glass',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    block = false,
    className,
    children,
    disabled,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isGlass = variant === 'glass';
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 19 : 17;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        haptic(6);
        onClick?.(e);
      }}
      className={cx(
        'pressable relative inline-flex select-none items-center justify-center',
        'font-medium tracking-[-0.01em] whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-45',
        isGlass ? 'glass' : '',
        variant === 'primary' ? 'primary-fill' : '',
        SIZES[size],
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} weight={1.8} />
      ) : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} weight={1.8} /> : null}
    </button>
  );
});

/** Icon-only button — always carries an accessible label. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'glass', size = 'md', active = false, className, onClick, ...rest },
  ref,
) {
  const box =
    size === 'sm' ? 'h-8 w-8 rounded-xl' : size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-10 w-10 rounded-[14px]';
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 18;

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={(e) => {
        haptic(6);
        onClick?.(e);
      }}
      className={cx(
        'pressable relative inline-flex shrink-0 items-center justify-center',
        variant === 'glass' ? 'glass' : '',
        box,
        VARIANTS[variant],
        active && 'text-accent bg-accent/14 border-accent/30',
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize} weight={1.8} />
    </button>
  );
});

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cx('animate-spin', className)}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.4" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
