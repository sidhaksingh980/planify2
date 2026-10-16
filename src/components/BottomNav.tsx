/**
 * BottomNav — the floating glass tab bar for phones and small tablets.
 *
 * It floats above the content with a gap and safe-area padding so it never
 * collides with the iOS home indicator, and the calendar behind it blurs gently
 * as it passes underneath. Five destinations, thumb-reachable, each 44px tall
 * (Apple's minimum touch target).
 */
import { memo } from 'react';
import { cx } from '../lib/utils';
import type { CalendarViewMode } from '../types';
import { Icon, type IconName } from './ui/Icon';

export type MobileTab = 'calendar' | 'agenda' | 'add' | 'assistant' | 'settings';

export interface BottomNavProps {
  tab: MobileTab;
  view: CalendarViewMode;
  onTab: (t: MobileTab) => void;
  onViewChange: (v: CalendarViewMode) => void;
  pendingSync: number;
  syncError: boolean;
}

interface TabDef {
  id: MobileTab;
  label: string;
  icon: IconName;
}

export const BottomNav = memo(function BottomNav({
  tab,
  view,
  onTab,
  onViewChange,
  pendingSync,
  syncError,
}: BottomNavProps) {
  const tabs: TabDef[] = [
    { id: 'calendar', label: 'Calendar', icon: view === 'month' ? 'grid' : view === 'week' ? 'columns' : 'today' },
    { id: 'agenda', label: 'Agenda', icon: 'list' },
    { id: 'add', label: 'Add', icon: 'plus' },
    { id: 'assistant', label: 'Assistant', icon: 'sparkles' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 safe-b lg:hidden"
    >
      <div className="glass glass-strong pointer-events-auto flex w-full max-w-[440px] items-stretch gap-0.5 rounded-[22px] p-1.5 shadow-float">
        {tabs.map((t) => {
          const isAdd = t.id === 'add';
          const active =
            t.id === 'calendar'
              ? tab === 'calendar'
              : t.id === 'agenda'
                ? tab === 'agenda'
                : tab === t.id;

          if (isAdd) {
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTab('add')}
                aria-label="Add event"
                className={cx(
                  'pressable relative mx-0.5 -my-3 grid h-12 w-12 shrink-0 place-items-center rounded-full',
                  'bg-accent text-[rgb(var(--c-accent-ink))] fab',
                )}
              >
                <Icon name="plus" size={22} weight={2.4} />
                {syncError ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[rgb(var(--c-base))] bg-danger"
                  />
                ) : null}
              </button>
            );
          }

          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (t.id === 'calendar') onViewChange(view === 'agenda' ? 'month' : view);
                onTab(t.id);
              }}
              className={cx(
                'pressable relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[15px] px-1 py-1.5',
                'transition-colors duration-150',
                active ? 'text-accent' : 'text-ink3 hover:text-ink2',
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[15px] bg-accent/12"
                />
              ) : null}
              <span className="relative">
                <Icon name={t.icon} size={19} weight={active ? 2.2 : 1.8} />
                {t.id === 'settings' && pendingSync > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-warn px-0.5 text-[8.5px] font-bold text-[rgb(var(--c-base))] tnum"
                    aria-hidden="true"
                  >
                    {pendingSync > 9 ? '9+' : pendingSync}
                  </span>
                ) : null}
              </span>
              <span
                className={cx(
                  'relative text-[9.5px] font-semibold leading-none tracking-[0.01em]',
                  active && 'font-bold',
                )}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
