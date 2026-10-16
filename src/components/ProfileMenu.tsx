/**
 * ProfileMenu — account identity, theme shortcut, settings and sign-out.
 *
 * Opens from either the top bar avatar or the sidebar account row, anchored to
 * whichever was clicked.
 */
import { memo } from 'react';
import { cx } from '../lib/utils';
import type { ThemeMode, UserProfile } from '../types';
import { MenuItem, MenuSeparator, Popover } from './ui/Sheet';
import { Icon, type IconName } from './ui/Icon';
import { Avatar } from './Sidebar';

export interface ProfileMenuProps {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  user: UserProfile | null;
  providerLabel: string;
  eventCount: number;
  onOpenSettings: () => void;
  onSignOut: () => Promise<void>;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
}

export const ProfileMenu = memo(function ProfileMenu({
  open,
  onClose,
  anchor,
  user,
  providerLabel,
  eventCount,
  onOpenSettings,
  onSignOut,
  themeMode,
  onThemeMode,
}: ProfileMenuProps) {
  const themes: Array<{ mode: ThemeMode; label: string; icon: IconName }> = [
    { mode: 'dark', label: 'Dark', icon: 'moon' },
    { mode: 'light', label: 'Light', icon: 'sun' },
    { mode: 'system', label: 'System', icon: 'monitor' },
  ];

  return (
    <Popover open={open} onClose={onClose} anchor={anchor} width={288} label="Account menu" align="end">
      {/* Identity */}
      <div className="flex items-center gap-3 rounded-[13px] px-2 py-2">
        <Avatar user={user} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold text-ink">{user?.name ?? 'Not signed in'}</p>
          <p className="truncate text-[11.5px] text-ink3">{user?.email ?? '—'}</p>
        </div>
      </div>

      <div className="mx-2 mb-1.5 flex items-center gap-1.5 rounded-[10px] bg-[rgb(var(--c-line)/0.06)] px-2 py-1.5">
        <Icon
          name={providerLabel.toLowerCase().includes('cloud') ? 'cloud' : 'device'}
          size={12}
          weight={2.1}
          className="shrink-0 text-ink3"
        />
        <span className="truncate text-[11px] font-medium text-ink3">{providerLabel}</span>
        <span className="ml-auto shrink-0 text-[11px] tnum text-ink3">
          {eventCount} event{eventCount === 1 ? '' : 's'}
        </span>
      </div>

      <MenuSeparator />

      {/* Theme shortcut */}
      <div className="px-2 py-1.5">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink3">Appearance</p>
        <div className="flex gap-1">
          {themes.map((t) => {
            const active = themeMode === t.mode;
            return (
              <button
                key={t.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => onThemeMode(t.mode)}
                className={cx(
                  'pressable flex flex-1 flex-col items-center gap-1 rounded-[10px] border py-1.5 text-[11px] font-semibold',
                  active
                    ? 'border-accent/45 bg-accent/14 text-accent'
                    : 'border-transparent bg-[rgb(var(--c-line)/0.06)] text-ink3 hover:text-ink',
                )}
              >
                <Icon name={t.icon} size={14} weight={active ? 2.1 : 1.8} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <MenuSeparator />

      <MenuItem
        icon={<Icon name="settings" size={15} weight={1.9} />}
        label="Settings"
        onSelect={onOpenSettings}
      />
      <MenuItem
        icon={<Icon name="logout" size={15} weight={1.9} />}
        label="Sign out"
        tone="danger"
        onSelect={() => void onSignOut()}
      />
    </Popover>
  );
});
