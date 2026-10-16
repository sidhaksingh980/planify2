/**
 * Sidebar — desktop navigation rail.
 *
 * Glass, pinned left, and it carries the things that belong at arm's length:
 * a mini month for jumping between dates, the view list, calendar/category
 * visibility toggles, the sync status, and the account block.
 */
import { memo, useMemo, useState } from 'react';
import { cx } from '../lib/utils';
import {
  addMonths,
  dayKey,
  isSameDay,
  isSameMonth,
  isToday,
  monthGridDays,
  weekdayLabels,
} from '../lib/dates';
import { bucketByDay } from '../lib/recurrence';
import { expandAll } from '../lib/recurrence';
import {
  CATEGORIES,
  getCategory,
  type CalEvent,
  type CalendarViewMode,
  type DataStatus,
  type ResolvedTheme,
  type UserProfile,
  type UserSettings,
  type Weekday,
} from '../types';
import { Icon, type IconName } from './ui/Icon';
import { IconButton } from './ui/Button';
import { SyncBadge } from './SyncBadge';

export interface SidebarProps {
  anchor: Date;
  selectedDay: Date;
  view: CalendarViewMode;
  events: CalEvent[];
  settings: UserSettings;
  theme: ResolvedTheme;
  user: UserProfile | null;
  status: DataStatus;
  hiddenCategoryIds: string[];
  onToggleCategory: (id: string) => void;
  onSelectDay: (d: Date) => void;
  onViewChange: (v: CalendarViewMode) => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onOpenAi: () => void;
  onRetrySync: () => void;
  pendingCount: number;
}

const VIEWS: Array<{ value: CalendarViewMode; label: string; icon: IconName; hint: string }> = [
  { value: 'month', label: 'Month', icon: 'grid', hint: 'M' },
  { value: 'week', label: 'Week', icon: 'columns', hint: 'W' },
  { value: 'day', label: 'Day', icon: 'square', hint: 'D' },
  { value: 'agenda', label: 'Agenda', icon: 'list', hint: 'A' },
];

export const Sidebar = memo(function Sidebar({
  anchor,
  selectedDay,
  view,
  events,
  settings,
  theme,
  user,
  status,
  hiddenCategoryIds,
  onToggleCategory,
  onSelectDay,
  onViewChange,
  onOpenSettings,
  onOpenProfile,
  onOpenAi,
  onRetrySync,
  pendingCount,
}: SidebarProps) {
  const [miniAnchor, setMiniAnchor] = useState<Date>(() => new Date(anchor));

  // Keep the mini month following the main anchor when the user navigates.
  const miniKey = `${miniAnchor.getFullYear()}-${miniAnchor.getMonth()}`;
  const anchorKey = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  if (miniKey !== anchorKey) setMiniAnchor(new Date(anchor));

  const counts = useMemo(() => {
    const occ = expandAll(
      events.filter((e) => !e.deleted && !hiddenCategoryIds.includes(e.categoryId)),
      miniAnchor,
      addMonths(miniAnchor, 1),
    );
    const buckets = bucketByDay(occ);
    const map = new Map<string, number>();
    for (const [k, list] of buckets) map.set(k, list.length);
    return map;
  }, [events, miniAnchor, hiddenCategoryIds]);

  const perCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.deleted) continue;
      map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1);
    }
    return map;
  }, [events]);

  return (
    <aside
      aria-label="Calendar navigation"
      className="glass hidden h-full w-[268px] shrink-0 flex-col overflow-y-auto rounded-none border-y-0 border-l-0 lg:flex"
    >
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-3 pt-4">
        <BrandMark />
        <div className="min-w-0">
          <p className="font-display text-[15px] font-bold leading-none tracking-[-0.02em] text-ink">
            Planify
          </p>
          <p className="mt-1 truncate text-[11px] leading-none text-ink3">
            {status.mode === 'cloud' ? 'Synced to your devices' : 'On this device'}
          </p>
        </div>
        <IconButton
          icon="sparkles"
          label="Open the AI assistant"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onOpenAi}
        />
      </div>

      {/* Mini month */}
      <MiniMonth
        anchor={miniAnchor}
        selectedDay={selectedDay}
        firstDayOfWeek={settings.firstDayOfWeek as Weekday}
        counts={counts}
        theme={theme}
        onPrev={() => setMiniAnchor((m) => addMonths(m, -1))}
        onNext={() => setMiniAnchor((m) => addMonths(m, 1))}
        onSelectDay={onSelectDay}
      />

      {/* Views */}
      <nav className="mt-2 shrink-0 px-2" aria-label="Calendar views">
        <ul className="space-y-0.5">
          {VIEWS.map((v) => {
            const active = view === v.value;
            return (
              <li key={v.value}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onViewChange(v.value)}
                  className={cx(
                    'pressable flex w-full items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left text-[13.5px] font-medium',
                    active
                      ? 'bg-accent/16 text-accent'
                      : 'text-ink2 hover:bg-[rgb(var(--c-line)/0.08)] hover:text-ink',
                  )}
                >
                  <Icon name={v.icon} size={16} weight={active ? 2.1 : 1.8} />
                  {v.label}
                  <kbd
                    className={cx(
                      'ml-auto rounded-md border px-1.5 py-px font-mono text-[10px] font-semibold',
                      active
                        ? 'border-accent/30 text-accent/80'
                        : 'border-[rgb(var(--c-line)/var(--line-alpha))] text-ink3',
                    )}
                  >
                    {v.hint}
                  </kbd>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Calendars / categories */}
      <div className="mt-4 min-h-0 shrink-0 px-4">
        <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink3">Calendars</p>
        <ul className="space-y-0.5">
          {CATEGORIES.map((c) => {
            const hidden = hiddenCategoryIds.includes(c.id);
            const n = perCategory.get(c.id) ?? 0;
            return (
              <li key={c.id}>
                <label
                  className={cx(
                    'pressable flex cursor-pointer items-center gap-2.5 rounded-[11px] px-2 py-1.5',
                    'hover:bg-[rgb(var(--c-line)/0.07)]',
                    hidden && 'opacity-45',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={!hidden}
                    onChange={() => onToggleCategory(c.id)}
                    className="sr-only"
                    aria-label={`${hidden ? 'Show' : 'Hide'} ${c.name} events`}
                  />
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[5px] border transition-colors',
                      hidden
                        ? 'border-[rgb(var(--c-line)/var(--line-strong-alpha))] bg-transparent'
                        : 'border-transparent',
                    )}
                    style={hidden ? undefined : { backgroundColor: c.solid }}
                  >
                    {!hidden ? <Icon name="check" size={11} weight={3} className="text-white" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink2">{c.name}</span>
                  {n > 0 ? <span className="shrink-0 text-[11px] tnum text-ink3">{n}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1" />

      {/* Sync status */}
      <div className="shrink-0 px-3 pb-2">
        <SyncBadge status={status} pending={pendingCount} onRetry={onRetrySync} compact />
      </div>

      {/* Account */}
      <div className="shrink-0 border-t border-[rgb(var(--c-line)/var(--line-alpha))] p-2.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenProfile}
            className="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-[12px] px-1.5 py-1.5 text-left hover:bg-[rgb(var(--c-line)/0.08)]"
            aria-label={`Account: ${user?.name ?? 'Signed out'}. Open profile menu.`}
          >
            <Avatar user={user} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">
                {user?.name ?? 'Not signed in'}
              </span>
              <span className="block truncate text-[11px] text-ink3">{user?.email ?? '—'}</span>
            </span>
          </button>
          <IconButton icon="settings" label="Settings" size="sm" variant="ghost" onClick={onOpenSettings} />
        </div>
      </div>
    </aside>
  );
});

/* -------------------------------------------------------------------------- */

export function BrandMark({ size = 30 }: { size?: number }) {
  const today = new Date().getDate();
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[9px] bg-accent text-[rgb(var(--c-accent-ink))]"
      style={{ width: size, height: size, boxShadow: '0 2px 8px rgb(var(--c-accent) / 0.4)' }}
      aria-hidden="true"
    >
      <span className="absolute inset-x-0 top-0 h-[26%] bg-[rgb(255_255_255/0.28)]" />
      <span className="relative font-display text-[13px] font-bold leading-none tnum">{today}</span>
    </span>
  );
}

export function Avatar({ user, size = 32 }: { user: UserProfile | null; size?: number }) {
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (user?.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-accent/22 text-[12px] font-bold text-accent"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {initials || <Icon name="user" size={size * 0.55} weight={2} />}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini month                                                                  */
/* -------------------------------------------------------------------------- */

function MiniMonth({
  anchor,
  selectedDay,
  firstDayOfWeek,
  counts,
  onPrev,
  onNext,
  onSelectDay,
}: {
  anchor: Date;
  selectedDay: Date;
  firstDayOfWeek: Weekday;
  counts: Map<string, number>;
  theme: ResolvedTheme;
  onPrev: () => void;
  onNext: () => void;
  onSelectDay: (d: Date) => void;
}) {
  const days = useMemo(() => monthGridDays(anchor, firstDayOfWeek), [anchor, firstDayOfWeek]);
  const labels = useMemo(() => weekdayLabels(firstDayOfWeek, false), [firstDayOfWeek]);

  return (
    <div className="shrink-0 px-3 pt-1">
      <div className="mb-1.5 flex items-center">
        <p className="px-1 font-display text-[13px] font-semibold tracking-[-0.01em] text-ink">
          {anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <div className="ml-auto flex gap-0.5">
          <IconButton icon="chevronLeft" label="Previous month" size="sm" variant="ghost" onClick={onPrev} />
          <IconButton icon="chevronRight" label="Next month" size="sm" variant="ghost" onClick={onNext} />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5" role="grid" aria-label="Mini month calendar">
        {labels.map((l, i) => (
          <span
            key={`${l}${i}`}
            className="pb-1 text-center text-[9.5px] font-bold uppercase tracking-[0.05em] text-ink3"
            aria-hidden="true"
          >
            {l[0]}
          </span>
        ))}
        {days.map((d) => {
          const key = dayKey(d);
          const today = isToday(d);
          const selected = isSameDay(d, selectedDay);
          const outside = !isSameMonth(d, anchor);
          const n = counts.get(key) ?? 0;
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={`${d.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}${n ? `, ${n} events` : ', no events'}`}
              onClick={() => onSelectDay(d)}
              className={cx(
                'pressable relative mx-auto grid h-[26px] w-[26px] place-items-center rounded-full text-[11.5px] font-medium tnum',
                today
                  ? 'bg-accent font-bold text-[rgb(var(--c-accent-ink))]'
                  : selected
                    ? 'bg-[rgb(var(--c-line)/0.16)] font-semibold text-ink'
                    : outside
                      ? 'text-ink3/55 hover:text-ink2'
                      : 'text-ink2 hover:bg-[rgb(var(--c-line)/0.09)] hover:text-ink',
              )}
            >
              {d.getDate()}
              {n > 0 && !today ? (
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute bottom-[2px] h-[3px] rounded-full',
                    n > 1 ? 'w-[9px]' : 'w-[4px]',
                    selected ? 'bg-ink' : 'bg-accent',
                  )}
                  style={{ opacity: selected ? 0.85 : 0.7 }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { getCategory };
