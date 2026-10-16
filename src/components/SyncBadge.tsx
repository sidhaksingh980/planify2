/**
 * SyncBadge — an honest, always-visible answer to "is my data safe and where?".
 *
 * States:
 *   synced   — cloud mode, nothing pending
 *   syncing  — a write is in flight or the outbox is draining
 *   offline  — no network; changes are queued and will replay
 *   pending  — queued writes waiting (with a Retry affordance)
 *   error    — the last write failed; Retry is offered
 *   device   — local mode; data lives on this device only
 *
 * It never claims cross-device sync while running in device mode — that would be
 * a false promise, so the badge names the limitation and links to Settings.
 */
import { memo } from 'react';
import { cx } from '../lib/utils';
import type { DataStatus } from '../types';
import { Icon, type IconName } from './ui/Icon';

export interface SyncBadgeProps {
  status: DataStatus;
  pending: number;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  compact?: boolean;
}

interface BadgeTone {
  icon: IconName;
  label: string;
  detail: string;
  className: string;
  spin?: boolean;
}

function toneFor(status: DataStatus, pending: number): BadgeTone {
  const { state, mode, lastSyncedAt } = status;

  if (mode === 'device') {
    return {
      icon: 'device',
      label: 'On this device',
      detail: 'Saved locally. Connect a cloud database to sync across devices.',
      className: 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.06)] text-ink2',
    };
  }

  if (state === 'error') {
    return {
      icon: 'alert',
      label: 'Sync problem',
      detail: status.message ?? 'A change could not be saved. Retry when ready.',
      className: 'border-danger/30 bg-danger/12 text-danger',
    };
  }

  if (state === 'offline') {
    return {
      icon: 'cloudOff',
      label: pending > 0 ? `Offline · ${pending} queued` : 'Offline',
      detail: 'Changes are saved on this device and will sync automatically.',
      className: 'border-warn/30 bg-warn/12 text-warn',
    };
  }

  if (state === 'syncing') {
    return {
      icon: 'refresh',
      label: 'Syncing…',
      detail: pending > 0 ? `${pending} change${pending > 1 ? 's' : ''} uploading` : 'Contacting the server',
      className: 'border-accent/30 bg-accent/12 text-accent',
      spin: true,
    };
  }

  return {
    icon: 'cloud',
    label: 'Synced',
    detail: lastSyncedAt
      ? `All changes saved · ${new Date(lastSyncedAt).toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })}`
      : 'All changes saved to the cloud',
    className: 'border-success/28 bg-success/12 text-success',
  };
}

export const SyncBadge = memo(function SyncBadge({
  status,
  pending,
  onRetry,
  onOpenSettings,
  compact = false,
}: SyncBadgeProps) {
  const tone = toneFor(status, pending);
  const actionable = (status.state === 'error' || (status.state === 'offline' && pending > 0)) && onRetry;

  return (
    <div
      className={cx(
        'flex items-center gap-2 rounded-[13px] border px-2.5',
        compact ? 'py-1.5' : 'py-2.5',
        tone.className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className={cx('shrink-0', tone.spin && 'animate-spin')}>
        <Icon name={tone.icon} size={compact ? 14 : 16} weight={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate font-semibold', compact ? 'text-[11.5px]' : 'text-[13px]')}>
          {tone.label}
        </span>
        {!compact ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug opacity-85">{tone.detail}</span>
        ) : null}
      </span>

      {actionable ? (
        <button
          type="button"
          onClick={onRetry}
          className="pressable shrink-0 inline-flex items-center gap-1 rounded-lg border border-current/30 px-2 py-1 text-[11px] font-bold hover:bg-current/10"
        >
          <Icon name="refresh" size={11} weight={2.4} />
          Retry
        </button>
      ) : null}

      {!compact && status.mode === 'device' && onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="pressable shrink-0 inline-flex items-center gap-1 rounded-lg border border-current/30 px-2 py-1 text-[11px] font-bold hover:bg-current/10"
        >
          Set up
          <Icon name="arrowRight" size={11} weight={2.4} />
        </button>
      ) : null}
    </div>
  );
});
