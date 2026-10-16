/**
 * Onboarding — four quick preferences, then straight into an empty calendar.
 *
 * Kept deliberately short: first day of week, time format, default reminder and
 * theme. Everything here can be changed later in Settings, and choosing nothing
 * is fine — each step has a sensible default already selected.
 */
import { useState } from 'react';
import { cx } from '../../lib/utils';
import { DEFAULT_SETTINGS, type ThemeMode, type UserProfile, type UserSettings, type Weekday } from '../../types';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar } from '../Sidebar';
import { useTheme } from '../../hooks/useTheme';

export interface OnboardingProps {
  user: UserProfile;
  settings: UserSettings;
  onComplete: (settings: UserSettings) => void;
  busy?: boolean;
}

const DAY_OPTIONS: Array<{ value: Weekday; label: string }> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
];

const TIME_OPTIONS: Array<{ value: UserSettings['timeFormat']; label: string; sample: string }> = [
  { value: '12h', label: '12-hour', sample: '2:30 PM' },
  { value: '24h', label: '24-hour', sample: '14:30' },
];

const REMINDER_OPTIONS = [
  { value: 0, label: 'No reminder' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
];

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: IconName; hint: string }> = [
  { value: 'dark', label: 'Dark', icon: 'moon', hint: 'Liquid Glass, deep charcoal' },
  { value: 'light', label: 'Light', icon: 'sun', hint: 'Bright glass on white' },
  { value: 'system', label: 'System', icon: 'monitor', hint: 'Follows your device' },
];

export function Onboarding({ user, settings, onComplete, busy = false }: OnboardingProps) {
  const { setMode } = useTheme();
  const [draft, setDraft] = useState<UserSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...settings,
  }));
  const [step, setStep] = useState(0);

  const patch = (p: Partial<UserSettings>) => setDraft((d) => ({ ...d, ...p }));

  // Reflect theme choice immediately so the user sees what they are picking.
  const chooseTheme = (mode: ThemeMode) => {
    patch({ themeMode: mode });
    setMode(mode);
  };

  const steps = [
    {
      key: 'week',
      title: 'How should your week start?',
      body: 'You can change this any time in Settings.',
      render: (
        <OptionRow>
          {DAY_OPTIONS.map((o) => (
            <OptionButton
              key={o.value}
              active={draft.firstDayOfWeek === o.value}
              onClick={() => patch({ firstDayOfWeek: o.value })}
              label={o.label}
            />
          ))}
        </OptionRow>
      ),
    },
    {
      key: 'time',
      title: 'Which time format?',
      body: 'Applies everywhere, including the assistant.',
      render: (
        <OptionRow>
          {TIME_OPTIONS.map((o) => (
            <OptionButton
              key={o.value}
              active={draft.timeFormat === o.value}
              onClick={() => patch({ timeFormat: o.value })}
              label={o.label}
              sub={o.sample}
            />
          ))}
        </OptionRow>
      ),
    },
    {
      key: 'reminder',
      title: 'Default reminder',
      body: 'Pre-selected when you create an event. You can override it per event.',
      render: (
        <OptionRow>
          {REMINDER_OPTIONS.map((o) => (
            <OptionButton
              key={o.value}
              active={draft.defaultReminderMinutes === o.value}
              onClick={() => patch({ defaultReminderMinutes: o.value })}
              label={o.label}
            />
          ))}
        </OptionRow>
      ),
    },
    {
      key: 'theme',
      title: 'Choose your look',
      body: 'Dark Liquid Glass is the default. System follows your device setting.',
      render: (
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((o) => {
            const active = draft.themeMode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => chooseTheme(o.value)}
                className={cx(
                  'pressable flex flex-col items-start gap-2 rounded-[16px] border p-3 text-left',
                  active
                    ? 'border-accent/50 bg-accent/12'
                    : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.7)] hover:border-[rgb(var(--c-line)/var(--line-strong-alpha))]',
                )}
              >
                <span
                  className={cx(
                    'grid h-9 w-9 place-items-center rounded-full',
                    active ? 'bg-accent/18 text-accent' : 'bg-[rgb(var(--c-line)/0.09)] text-ink2',
                  )}
                >
                  <Icon name={o.icon} size={17} weight={1.9} />
                </span>
                <span className={cx('text-[13.5px] font-semibold', active ? 'text-accent' : 'text-ink')}>
                  {o.label}
                </span>
                <span className="text-[11.5px] leading-snug text-ink3">{o.hint}</span>
              </button>
            );
          })}
        </div>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{ backgroundImage: 'var(--aurora)' }}
      />

      <div className="relative w-full max-w-[520px]">
        <div className="glass glass-strong animate-pop-in rounded-[26px] px-5 py-6 shadow-glass-lg sm:px-7 sm:py-7">
          {/* Welcome line */}
          <div className="mb-5 flex items-center gap-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-semibold text-ink">
                Welcome, {user.name.split(' ')[0] || 'there'}
              </p>
              <p className="truncate text-[12px] text-ink3">
                A few preferences, then your calendar — empty and ready.
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-5 flex gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.key}
                className={cx(
                  'h-1 flex-1 rounded-full transition-colors duration-300',
                  i <= step ? 'bg-accent' : 'bg-[rgb(var(--c-line)/0.16)]',
                )}
              />
            ))}
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink3" aria-live="polite">
            Step {step + 1} of {steps.length}
          </p>
          <h1 className="mt-1.5 font-display text-[21px] font-bold leading-tight tracking-[-0.025em] text-ink">
            {current.title}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">{current.body}</p>

          <div className="mt-5" key={current.key}>
            {current.render}
          </div>

          <div className="mt-7 flex items-center gap-2">
            {step > 0 ? (
              <Button variant="subtle" icon="chevronLeft" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => onComplete(draft)} disabled={busy}>
                Skip
              </Button>
            )}
            <Button
              variant="primary"
              className="ml-auto"
              iconRight={last ? 'check' : 'chevronRight'}
              loading={busy && last}
              onClick={() => (last ? onComplete(draft) : setStep((s) => s + 1))}
            >
              {last ? 'Open my calendar' : 'Continue'}
            </Button>
          </div>
        </div>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink3">
          Nothing has been added to your calendar yet. Every event you see from here on is one you
          created.
        </p>
      </div>
    </div>
  );
}

function OptionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function OptionButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'pressable rounded-[14px] border px-4 py-2.5 text-left',
        active
          ? 'border-accent/50 bg-accent/14'
          : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.7)] hover:border-[rgb(var(--c-line)/var(--line-strong-alpha))]',
      )}
    >
      <span className={cx('block text-[13.5px] font-semibold', active ? 'text-accent' : 'text-ink')}>
        {label}
      </span>
      {sub ? <span className="mt-0.5 block text-[11.5px] tnum text-ink3">{sub}</span> : null}
    </button>
  );
}
