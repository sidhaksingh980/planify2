/**
 * TopBar — the floating glass navigation bar.
 *
 * Desktop shows the brand, the range title, sync state and account. Mobile shows
 * a compact version: brand mark, the month/day title and the sync dot, with the
 * bottom nav owning navigation.
 */
import { memo } from 'react';
import { cx } from '../lib/utils';
import type { DataStatus, UserProfile } from '../types';
import { Icon } from './ui/Icon';
import { Avatar, BrandMark } from './Sidebar';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  user: UserProfile | null;
  status: DataStatus;
  pending: number;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenAi: () => void;
  onRetrySync: () => void;
  isMobile: boolean;
  profileAnchorRef?: React.RefObject<HTMLButtonElement | null>;
}

export const TopBar = memo(function TopBar({
  title,
  subtitle,
  user,
  status,
  pending,
  onOpenProfile,
  onOpenSettings,
  onOpenAi,
  onRetrySync,
  isMobile,
  profileAnchorRef,
}: TopBarProps) {
  const dot = dotFor(status, pending);

  return (
    <header
      className={cx(
        'glass sticky top-0 z-40 shrink-0 rounded-none border-x-0 border-t-0',
        'px-2 py-2 sm:px-4 safe-t',
      )}
    >
      <div className="flex items-center gap-2">
        {/* Brand — desktop only; the sidebar already carries it there too, so
            on mobile it doubles as the identity anchor. */}
        <div className={cx('flex items-center gap-2.5', isMobile ? '' : 'lg:hidden')}>
          <BrandMark size={isMobile ? 28 : 30} />
          {isMobile ? (
            <span className="font-display text-[14px] font-bold leading-none tracking-[-0.02em] text-ink">
              Planify
            </span>
          ) : null}
        </div>

        {/* Title */}
        <div className="min-w-0 flex-1 px-1">
          <h1
            className="truncate font-display text-[15px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[17px]"
            aria-live="polite"
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="hidden truncate text-[11px] leading-tight text-ink3 sm:block">{subtitle}</p>
          ) : null}
        </div>

        {/* Sync indicator */}
        <button
          type="button"
          onClick={status.state === 'error' || pending > 0 ? onRetrySync : onOpenSettings}
          aria-label={`${dot.label}. ${dot.detail}`}
          title={`${dot.label} — ${dot.detail}`}
          className={cx(
            'pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold',
            dot.className,
          )}
        >
          <span className={cx(dot.spin && 'animate-spin')}>
            <Icon name={dot.icon} size={13} weight={2.1} />
          </span>
          <span className="hidden sm:inline">{dot.short}</span>
          {pending > 0 ? <span className="tnum">{pending}</span> : null}
        </button>

        {/* Assistant */}
        <button
          type="button"
          onClick={onOpenAi}
          aria-label="Open the AI assistant"
          title="AI assistant"
          className={cx(
            'pressable glass grid h-8 w-8 shrink-0 place-items-center rounded-full text-accent',
            'ring-1 ring-inset ring-accent/30',
          )}
        >
          <Icon name="sparkles" size={15} weight={2} />
        </button>

        {/* Settings — mobile; desktop has it in the sidebar */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="pressable glass grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink2 lg:hidden"
        >
          <Icon name="settings" size={15} weight={1.9} />
        </button>

        {/* Account */}
        <button
          ref={profileAnchorRef}
          type="button"
          onClick={onOpenProfile}
          aria-label={`Account menu for ${user?.name ?? 'signed-out user'}`}
          aria-haspopup="menu"
          className="pressable ml-0.5 flex shrink-0 items-center gap-2 rounded-full py-0.5 pl-0.5 pr-1 hover:bg-[rgb(var(--c-line)/0.08)] sm:pr-2.5"
        >
          <Avatar user={user} size={28} />
          <span className="hidden max-w-[120px] truncate text-[12.5px] font-semibold text-ink sm:block">
            {user?.name?.split(' ')[0] ?? 'Account'}
          </span>
          <Icon name="chevronDown" size={12} weight={2.3} className="hidden text-ink3 sm:block" />
        </button>
      </div>
    </header>
  );
});

/* -------------------------------------------------------------------------- */

interface Dot {
  icon: 'cloud' | 'cloudOff' | 'refresh' | 'alert' | 'device';
  label: string;
  short: string;
  detail: string;
  className: string;
  spin?: boolean;
}

function dotFor(status: DataStatus, pending: number): Dot {
  if (status.mode === 'device') {
    return {
      icon: 'device',
      label: 'Stored on this device',
      short: 'This device',
      detail: 'Saved locally in this browser. Connect a cloud database in Settings to sync.',
      className: 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.06)] text-ink2',
    };
  }
  if (status.state === 'error') {
    return {
      icon: 'alert',
      label: 'Sync problem',
      short: 'Sync issue',
      detail: status.message ?? 'A change could not be saved. Tap to retry.',
      className: 'border-danger/30 bg-danger/12 text-danger',
    };
  }
  if (status.state === 'offline') {
    return {
      icon: 'cloudOff',
      label: pending > 0 ? `Offline, ${pending} change(s) queued` : 'Offline',
      short: 'Offline',
      detail: 'Changes are saved on this device and will sync automatically.',
      className: 'border-warn/30 bg-warn/12 text-warn',
    };
  }
  if (status.state === 'syncing') {
    return {
      icon: 'refresh',
      label: 'Syncing',
      short: 'Syncing',
      detail: pending > 0 ? `${pending} change(s) uploading` : 'Contacting the server',
      className: 'border-accent/30 bg-accent/12 text-accent',
      spin: true,
    };
  }
  return {
    icon: 'cloud',
    label: 'Synced',
    short: 'Synced',
    detail: status.lastSyncedAt
      ? `All changes saved at ${new Date(status.lastSyncedAt).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })}`
      : 'All changes saved to the cloud',
    className: 'border-success/28 bg-success/12 text-success',
  };
}
