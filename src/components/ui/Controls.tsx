/**
 * Form controls styled for glass: labels, inputs, textareas, native selects
 * (with a custom chevron), a real switch, a segmented control, colour/category
 * swatches and a chip.
 *
 * Native `<input type="date">` / `type="time">` are used deliberately: on iOS
 * and Android they open the platform wheel pickers, which is both faster and
 * more accessible than a custom calendar-in-a-calendar.
 */
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../../lib/utils';
import { Icon, type IconName } from './Icon';

/* -------------------------------------------------------------------------- */
/* Field wrapper                                                               */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
  action,
}: FieldProps) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink3"
        >
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-danger" role="alert">
          <Icon name="alert" size={13} weight={2} />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink3">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared input surface                                                        */
/* -------------------------------------------------------------------------- */

const INPUT_BASE = cx(
  'w-full rounded-[13px] border bg-[rgb(var(--c-surface)/0.9)] px-3 text-[14.5px] text-ink',
  'placeholder:text-ink3/70 transition-[border-color,box-shadow,background-color] duration-150',
  'focus:border-accent/60 focus:bg-[rgb(var(--c-surface))] focus:outline-none',
  'focus-visible:shadow-focus',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

/* -------------------------------------------------------------------------- */
/* TextInput                                                                   */
/* -------------------------------------------------------------------------- */

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  iconLeft?: IconName;
  trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, invalid, iconLeft, trailing, ...rest },
  ref,
) {
  if (iconLeft || trailing) {
    return (
      <div className="relative">
        {iconLeft ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3">
            <Icon name={iconLeft} size={16} />
          </span>
        ) : null}
        <input
          ref={ref}
          className={cx(
            INPUT_BASE,
            'h-11',
            iconLeft && 'pl-9',
            trailing ? 'pr-10' : '',
            invalid ? 'border-danger/60' : 'border-[rgb(var(--c-line)/var(--line-alpha))]',
            className,
          )}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        {trailing ? (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>
        ) : null}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      className={cx(
        INPUT_BASE,
        'h-11',
        invalid ? 'border-danger/60' : 'border-[rgb(var(--c-line)/var(--line-alpha))]',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* TextArea                                                                    */
/* -------------------------------------------------------------------------- */

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, invalid, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(
        INPUT_BASE,
        'resize-y py-2.5 leading-relaxed',
        invalid ? 'border-danger/60' : 'border-[rgb(var(--c-line)/var(--line-alpha))]',
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* Select                                                                      */
/* -------------------------------------------------------------------------- */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, invalid, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cx(
          INPUT_BASE,
          'h-11 appearance-none pr-9',
          invalid ? 'border-danger/60' : 'border-[rgb(var(--c-line)/var(--line-alpha))]',
          className,
        )}
        {...rest}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink3">
        <Icon name="chevronDown" size={15} weight={2} />
      </span>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* Switch                                                                      */
/* -------------------------------------------------------------------------- */

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, description, disabled, id }: SwitchProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-[14px] font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink3">{description}</p>
        ) : null}
      </div>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'pressable relative h-[30px] w-[50px] shrink-0 rounded-full border transition-colors duration-200',
          checked
            ? 'border-transparent bg-accent'
            : 'border-[rgb(var(--c-line)/var(--line-strong-alpha))] bg-[rgb(var(--c-line)/0.12)]',
          disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.35)]',
            'transition-[left] duration-200 ease-spring',
            checked ? 'left-[25px]' : 'left-[3px]',
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  size?: 'sm' | 'md';
  ariaLabel: string;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        'glass inline-flex items-center gap-0.5 rounded-[14px] p-1',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'pressable relative inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
              active
                ? 'bg-[rgb(var(--c-raised))] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.28),inset_0_1px_0_rgb(255_255_255/0.09)]'
                : 'text-ink3 hover:text-ink2',
            )}
          >
            {o.icon ? <Icon name={o.icon} size={size === 'sm' ? 13 : 15} weight={1.9} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip / Tag                                                                  */
/* -------------------------------------------------------------------------- */

export function Chip({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger' | 'success' | 'warn';
  icon?: IconName;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[rgb(var(--c-line)/0.09)] text-ink2 border-transparent',
    accent: 'bg-accent/16 text-accent border-accent/28',
    danger: 'bg-danger/14 text-danger border-danger/26',
    success: 'bg-success/14 text-success border-success/26',
    warn: 'bg-warn/16 text-warn border-warn/28',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={12} weight={2.1} /> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Category swatch picker                                                      */
/* -------------------------------------------------------------------------- */

export interface SwatchPickerProps {
  value: string;
  onChange: (id: string) => void;
  categories: Array<{ id: string; name: string; solid: string; bg: string; fg: string }>;
  ariaLabel?: string;
}

export function SwatchPicker({ value, onChange, categories, ariaLabel = 'Category' }: SwatchPickerProps) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {categories.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.id)}
            className={cx(
              'pressable inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-[12.5px] font-semibold',
              active
                ? 'border-[rgb(var(--c-line)/var(--line-strong-alpha))] bg-[rgb(var(--c-line)/0.1)] text-ink'
                : 'border-transparent bg-[rgb(var(--c-line)/0.05)] text-ink2 hover:bg-[rgb(var(--c-line)/0.1)]',
            )}
          >
            <span
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full"
              style={{ backgroundColor: c.solid }}
              aria-hidden="true"
            >
              {active ? <Icon name="check" size={11} weight={3} className="text-white" /> : null}
            </span>
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / loading states                                                      */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon = 'calendar',
  title,
  body,
  action,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
      )}
    >
      <div
        className={cx(
          'glass grid place-items-center rounded-full text-ink3',
          compact ? 'h-10 w-10' : 'h-14 w-14',
        )}
        aria-hidden="true"
      >
        <Icon name={icon} size={compact ? 18 : 24} weight={1.6} />
      </div>
      <h3
        className={cx(
          'font-display font-semibold tracking-[-0.02em] text-ink',
          compact ? 'text-[14px]' : 'text-[17px]',
        )}
      >
        {title}
      </h3>
      {body ? (
        <p
          className={cx(
            'max-w-sm text-balance leading-relaxed text-ink2',
            compact ? 'text-[12.5px]' : 'text-[13.5px]',
          )}
        >
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2.5', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-3 w-14 shrink-0" />
          <div className="skeleton h-9 flex-1" style={{ opacity: 1 - i * 0.13 }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="glass flex flex-col gap-2 rounded-glass border-danger/25 p-4 sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/14 text-danger">
        <Icon name="alert" size={17} weight={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink2">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.07)] px-3 text-[12.5px] font-semibold text-ink"
        >
          <Icon name="refresh" size={14} weight={2} />
          Try again
        </button>
      ) : null}
    </div>
  );
}
