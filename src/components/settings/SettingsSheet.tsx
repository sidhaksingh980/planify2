/**
 * SettingsSheet — appearance, calendar defaults, data & sync, Google Calendar,
 * account and the destructive actions (sign out, delete account and data).
 *
 * Every control writes through immediately: there is no "Save" button and no
 * unsaved state, which matches how people expect settings to behave and keeps
 * the cloud copy in step with what is on screen.
 */
import { useCallback, useState } from 'react';
import { cx } from '../../lib/utils';
import {
  COMMON_TIMEZONES,
  LOCAL_TZ,
  tzAbbrev,
  WEEKDAY_LABELS_LONG,
} from '../../lib/dates';
import {
  CATEGORIES,
  GOOGLE_CALENDAR_SCOPE,
  type GoogleCalendarLink,
  type ThemeMode,
  type UserProfile,
  type UserSettings,
  type Weekday,
} from '../../types';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Field, Segmented, Select, Switch } from '../ui/Controls';
import { Icon, type IconName } from '../ui/Icon';
import { SyncBadge } from '../SyncBadge';
import { Avatar } from '../Sidebar';
import { useTheme } from '../../hooks/useTheme';

export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  user: UserProfile | null;
  providerLabel: string;
  providerDescription: string;
  providerMode: 'cloud' | 'device';
  status: import('../../types').DataStatus;
  pending: number;
  onRetrySync: () => void;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onExport: () => void;
  eventCount: number;
  googleLink: GoogleCalendarLink;
  onConnectGoogleCalendar: () => Promise<void>;
  onDisconnectGoogleCalendar: () => Promise<void>;
  onGoogleSyncModeChange: (mode: GoogleCalendarLink['mode']) => Promise<void>;
  hiddenCategoryIds: string[];
  onToggleCategory: (id: string) => void;
}

type SectionId = 'appearance' | 'calendar' | 'data' | 'google' | 'account';

const SECTIONS: Array<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'appearance', label: 'Appearance', icon: 'moon' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'data', label: 'Data & sync', icon: 'cloud' },
  { id: 'google', label: 'Google Calendar', icon: 'link' },
  { id: 'account', label: 'Account', icon: 'user' },
];

export function SettingsSheet(props: SettingsSheetProps) {
  const { open, onClose, settings, onChange, user } = props;
  const { setMode } = useTheme();
  const [section, setSection] = useState<SectionId>('appearance');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setConfirmDelete(false);
    setDeleteText('');
    setError(null);
    onClose();
  }, [onClose]);

  const handleTheme = (mode: ThemeMode) => {
    onChange({ themeMode: mode });
    setMode(mode);
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onDeleteAccount();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSignOut();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Settings"
      maxWidth={720}
      tall
      footer={
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink3">
            <Icon name="shield" size={13} weight={2} className="shrink-0" />
            <span className="truncate">Changes save immediately</span>
          </span>
          <Button variant="primary" className="ml-auto" onClick={close}>
            Done
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Section nav */}
        <nav aria-label="Settings sections" className="shrink-0 sm:w-[168px]">
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0">
            {SECTIONS.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSection(s.id)}
                  className={cx(
                    'pressable flex shrink-0 items-center gap-2 rounded-[11px] px-2.5 py-2 text-left text-[13px] font-medium sm:w-full',
                    active
                      ? 'bg-accent/16 text-accent'
                      : 'text-ink2 hover:bg-[rgb(var(--c-line)/0.08)] hover:text-ink',
                  )}
                >
                  <Icon name={s.icon} size={15} weight={active ? 2.1 : 1.8} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-4">
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/12 px-3 py-2 text-[12.5px] font-medium text-danger">
              <Icon name="alert" size={14} weight={2} className="mt-px shrink-0" />
              {error}
            </p>
          ) : null}

          {section === 'appearance' ? (
            <AppearanceSection settings={settings} onChange={onChange} onTheme={handleTheme} />
          ) : null}
          {section === 'calendar' ? (
            <CalendarSection
              settings={settings}
              onChange={onChange}
              hiddenCategoryIds={props.hiddenCategoryIds}
              onToggleCategory={props.onToggleCategory}
            />
          ) : null}
          {section === 'data' ? (
            <DataSection
              {...props}
              onExport={props.onExport}
            />
          ) : null}
          {section === 'google' ? (
            <GoogleSection
              link={props.googleLink}
              onConnect={props.onConnectGoogleCalendar}
              onDisconnect={props.onDisconnectGoogleCalendar}
              onModeChange={props.onGoogleSyncModeChange}
              cloud={props.providerMode === 'cloud'}
            />
          ) : null}
          {section === 'account' ? (
            <AccountSection
              user={user}
              eventCount={props.eventCount}
              busy={busy}
              confirmDelete={confirmDelete}
              deleteText={deleteText}
              setDeleteText={setDeleteText}
              setConfirmDelete={setConfirmDelete}
              onSignOut={() => void handleSignOut()}
              onDelete={() => void handleDelete()}
            />
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h3 className="font-display text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
        {description ? <p className="mt-0.5 text-[12.5px] leading-snug text-ink3">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'rounded-[15px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.72)] p-3.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AppearanceSection({
  settings,
  onChange,
  onTheme,
}: {
  settings: UserSettings;
  onChange: (p: Partial<UserSettings>) => void;
  onTheme: (m: ThemeMode) => void;
}) {
  return (
    <Section title="Appearance" description="Dark Liquid Glass is the default. System follows your device setting live.">
      <Card className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: 'dark', label: 'Dark', icon: 'moon' as IconName },
              { value: 'light', label: 'Light', icon: 'sun' as IconName },
              { value: 'system', label: 'System', icon: 'monitor' as IconName },
            ] as const
          ).map((o) => {
            const active = settings.themeMode === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => onTheme(o.value)}
                className={cx(
                  'pressable flex flex-col items-center gap-1.5 rounded-[13px] border py-3',
                  active
                    ? 'border-accent/50 bg-accent/12 text-accent'
                    : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.03)] text-ink2 hover:text-ink',
                )}
              >
                <Icon name={o.icon} size={18} weight={active ? 2.1 : 1.8} />
                <span className="text-[12.5px] font-semibold">{o.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] leading-snug text-ink3">
          {settings.themeMode === 'system'
            ? 'Following your device appearance setting right now.'
            : 'Theme changes cross-fade smoothly and apply instantly.'}
        </p>
      </Card>

      <Card className="space-y-3">
        <Switch
          checked={settings.reduceMotion}
          onChange={(v) => onChange({ reduceMotion: v })}
          label="Reduce motion"
          description="Minimises transitions and animations."
        />
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function CalendarSection({
  settings,
  onChange,
  hiddenCategoryIds,
  onToggleCategory,
}: {
  settings: UserSettings;
  onChange: (p: Partial<UserSettings>) => void;
  hiddenCategoryIds: string[];
  onToggleCategory: (id: string) => void;
}) {
  return (
    <>
      <Section title="Calendar" description="These defaults apply to every new event you create.">
        <Card className="space-y-3.5">
          <Field label="First day of week" htmlFor="set-fdw">
            <Select
              id="set-fdw"
              value={String(settings.firstDayOfWeek)}
              onChange={(e) => onChange({ firstDayOfWeek: Number(e.target.value) as Weekday })}
              options={WEEKDAY_LABELS_LONG.map((d, i) => ({ value: String(i), label: d }))}
            />
          </Field>

          <Field label="Time format">
            <Segmented
              value={settings.timeFormat}
              onChange={(v) => onChange({ timeFormat: v })}
              ariaLabel="Time format"
              options={[
                { value: '12h', label: '12-hour · 2:30 PM' },
                { value: '24h', label: '24-hour · 14:30' },
              ]}
            />
          </Field>

          <Field label="Default reminder" htmlFor="set-rem">
            <Select
              id="set-rem"
              value={String(settings.defaultReminderMinutes)}
              onChange={(e) => onChange({ defaultReminderMinutes: Number(e.target.value) })}
              options={[
                { value: '0', label: 'No reminder' },
                { value: '5', label: '5 minutes before' },
                { value: '10', label: '10 minutes before' },
                { value: '15', label: '15 minutes before' },
                { value: '30', label: '30 minutes before' },
                { value: '60', label: '1 hour before' },
                { value: '1440', label: '1 day before' },
              ]}
            />
          </Field>

          <Field label="Default category" htmlFor="set-cat">
            <Select
              id="set-cat"
              value={settings.defaultCategoryId}
              onChange={(e) => onChange({ defaultCategoryId: e.target.value })}
              options={CATEGORIES.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        </Card>
      </Section>

      <Section title="Time zone" description="Events are stored as absolute instants and always displayed in each device's local time.">
        <Card className="space-y-3">
          <Field label="Display time zone" htmlFor="set-tz" hint={`Your device is currently ${LOCAL_TZ} (${tzAbbrev()}).`}>
            <Select
              id="set-tz"
              value={settings.timezone}
              onChange={(e) => onChange({ timezone: e.target.value })}
              options={COMMON_TIMEZONES.map((t) => ({
                value: t,
                label: t === LOCAL_TZ ? `${t} — this device` : t,
              }))}
            />
          </Field>
        </Card>
      </Section>

      <Section title="Day and week views" description="Controls how much of the day the time grid shows.">
        <Card className="space-y-3.5">
          <Field label="Day starts at" htmlFor="set-start" hint="Hours before this are scrolled out of the way.">
            <Select
              id="set-start"
              value={String(settings.dayStartHour)}
              onChange={(e) => onChange({ dayStartHour: Number(e.target.value) })}
              options={Array.from({ length: 13 }, (_, i) => ({
                value: String(i),
                label: `${String(i).padStart(2, '0')}:00`,
              }))}
            />
          </Field>

          <Field label="Week view shows">
            <Segmented
              value={String(settings.weekViewDays) as '5' | '7'}
              onChange={(v) => onChange({ weekViewDays: Number(v) as 5 | 7 })}
              ariaLabel="Week view length"
              options={[
                { value: '7', label: '7 days' },
                { value: '5', label: '5 weekdays' },
              ]}
            />
          </Field>
        </Card>
      </Section>

      <Section title="Visible calendars" description="Hidden categories are excluded from every view and from the assistant's free-slot search.">
        <Card>
          <ul className="space-y-2">
            {CATEGORIES.map((c) => {
              const hidden = hiddenCategoryIds.includes(c.id);
              return (
                <li key={c.id}>
                  <Switch
                    checked={!hidden}
                    onChange={() => onToggleCategory(c.id)}
                    label={c.name}
                    description={hidden ? 'Hidden from your calendar' : 'Visible'}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      </Section>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function DataSection({
  providerLabel,
  providerDescription,
  providerMode,
  status,
  pending,
  onRetrySync,
  onExport,
  eventCount,
  settings,
  onChange,
}: {
  providerLabel: string;
  providerDescription: string;
  providerMode: 'cloud' | 'device';
  status: import('../../types').DataStatus;
  pending: number;
  onRetrySync: () => void;
  onExport: () => void;
  eventCount: number;
  settings: UserSettings;
  onChange: (p: Partial<UserSettings>) => void;
}) {
  return (
    <Section title="Data & sync" description="Where your calendar lives, and whether it is up to date.">
      <SyncBadge status={status} pending={pending} onRetry={onRetrySync} />

      <Card className="space-y-2.5">
        <div className="flex items-start gap-2.5">
          <span
            className={cx(
              'grid h-8 w-8 shrink-0 place-items-center rounded-full',
              providerMode === 'cloud' ? 'bg-success/14 text-success' : 'bg-[rgb(var(--c-line)/0.1)] text-ink2',
            )}
          >
            <Icon name={providerMode === 'cloud' ? 'cloud' : 'device'} size={16} weight={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-ink">{providerLabel}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink2">{providerDescription}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-2 border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-2.5 text-[12px]">
          <div>
            <dt className="text-ink3">Events stored</dt>
            <dd className="mt-0.5 font-semibold text-ink tnum">{eventCount}</dd>
          </div>
          <div>
            <dt className="text-ink3">Last synced</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {status.lastSyncedAt
                ? new Date(status.lastSyncedAt).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-ink3">Pending writes</dt>
            <dd className="mt-0.5 font-semibold text-ink tnum">{pending}</dd>
          </div>
          <div>
            <dt className="text-ink3">Chat history</dt>
            <dd className="mt-0.5 font-semibold text-ink">{providerMode === 'cloud' ? 'Synced' : 'On device'}</dd>
          </div>
        </dl>
      </Card>

      {providerMode === 'device' ? (
        <Card className="border-accent/28 bg-accent/8">
          <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink2">
            <Icon name="info" size={14} weight={2} className="mt-px shrink-0 text-accent" />
            <span>
              To sync across your phone and computer, add your Supabase project credentials to{' '}
              <code className="rounded bg-[rgb(var(--c-line)/0.12)] px-1 py-px font-mono text-[11.5px] text-ink">.env.local</code>{' '}
              as <code className="rounded bg-[rgb(var(--c-line)/0.12)] px-1 py-px font-mono text-[11.5px] text-ink">VITE_SUPABASE_URL</code> and{' '}
              <code className="rounded bg-[rgb(var(--c-line)/0.12)] px-1 py-px font-mono text-[11.5px] text-ink">VITE_SUPABASE_ANON_KEY</code>,
              run the migration in <code className="rounded bg-[rgb(var(--c-line)/0.12)] px-1 py-px font-mono text-[11.5px] text-ink">supabase/migrations</code>,
              then reload. Google sign-in switches on automatically. The README walks through it.
            </span>
          </p>
        </Card>
      ) : null}

      <Card className="space-y-3">
        <Switch
          checked={settings.notificationsEnabled}
          onChange={(v) => onChange({ notificationsEnabled: v })}
          label="Browser notifications for reminders"
          description="Asks for permission the first time you switch it on."
        />
        <div className="border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-3">
          <p className="text-[13px] font-medium text-ink">Export your data</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink3">
            Downloads every event you created as JSON. Nothing is sent anywhere.
          </p>
          <Button size="sm" variant="glass" icon="download" className="mt-2" onClick={onExport} disabled={eventCount === 0}>
            Export {eventCount} event{eventCount === 1 ? '' : 's'}
          </Button>
        </div>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function GoogleSection({
  link,
  onConnect,
  onDisconnect,
  onModeChange,
  cloud,
}: {
  link: GoogleCalendarLink;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onModeChange: (mode: GoogleCalendarLink['mode']) => Promise<void>;
  cloud: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the Google Calendar connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Google Calendar"
      description="Optional. Calendar access is requested separately from sign-in, and only when you turn this on."
    >
      <Card className="space-y-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cx(
              'grid h-9 w-9 shrink-0 place-items-center rounded-full',
              link.connected ? 'bg-success/14 text-success' : 'bg-[rgb(var(--c-line)/0.1)] text-ink2',
            )}
          >
            <Icon name={link.connected ? 'link' : 'unlink'} size={17} weight={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold text-ink">
              {link.connected ? `Connected${link.email ? ` as ${link.email}` : ''}` : 'Not connected'}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink2">
              {link.connected
                ? link.mode === 'two-way'
                  ? 'Two-way sync with your primary calendar.'
                  : link.mode === 'import'
                    ? 'Importing from Google Calendar.'
                    : 'Exporting to Google Calendar.'
                : 'Your Planify events stay inside Planify until you connect.'}
            </p>
          </div>
        </div>

        {link.connected ? (
          <Field label="Sync direction">
            <Segmented
              value={link.mode}
              onChange={(v) => void run(() => onModeChange(v))}
              ariaLabel="Sync direction"
              options={[
                { value: 'two-way', label: 'Two-way' },
                { value: 'import', label: 'Import' },
                { value: 'export', label: 'Export' },
              ]}
            />
          </Field>
        ) : null}

        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-[12px] font-medium text-danger">
            <Icon name="alert" size={13} weight={2} className="mt-px shrink-0" />
            {error}
          </p>
        ) : null}

        {link.message ? (
          <p className="flex items-start gap-1.5 rounded-[11px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.04)] px-2.5 py-2 text-[11.5px] leading-snug text-ink2">
            <Icon name="info" size={13} weight={2} className="mt-px shrink-0 text-accent" />
            {link.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-3">
          {link.connected ? (
            <>
              <span className="text-[11.5px] text-ink3">
                Last sync:{' '}
                {link.lastSyncAt
                  ? new Date(link.lastSyncAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'never'}
              </span>
              <Button size="sm" variant="danger" icon="unlink" className="ml-auto" loading={busy} onClick={() => void run(onDisconnect)}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon="link" loading={busy} disabled={!cloud} onClick={() => void run(onConnect)}>
              Connect Google Calendar
            </Button>
          )}
        </div>

        {!cloud ? (
          <p className="text-[11.5px] leading-snug text-ink3">
            Requires a cloud backend with Google OAuth client credentials configured on the server.
          </p>
        ) : null}

        <ul className="space-y-1 border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-3 text-[11.5px] leading-snug text-ink3">
          <li>· Scope requested: <code className="font-mono text-[11px] text-ink2">{GOOGLE_CALENDAR_SCOPE}</code></li>
          <li>· Events are matched by their Google id, so reconnecting never creates duplicates.</li>
          <li>· Conflicts resolve by most-recent edit; the losing side is kept as a note, not overwritten silently.</li>
          <li>· Refresh tokens stay on the server. They are never stored in your browser.</li>
        </ul>
      </Card>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

function AccountSection({
  user,
  eventCount,
  busy,
  confirmDelete,
  deleteText,
  setDeleteText,
  setConfirmDelete,
  onSignOut,
  onDelete,
}: {
  user: UserProfile | null;
  eventCount: number;
  busy: boolean;
  confirmDelete: boolean;
  deleteText: string;
  setDeleteText: (v: string) => void;
  setConfirmDelete: (v: boolean) => void;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  return (
    <Section title="Account" description="Your profile, and what happens to your data.">
      <Card>
        <div className="flex items-center gap-3">
          <Avatar user={user} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{user?.name ?? 'Not signed in'}</p>
            <p className="truncate text-[12.5px] text-ink3">{user?.email ?? '—'}</p>
          </div>
          <IconButton icon="logout" label="Sign out" variant="glass" onClick={onSignOut} disabled={busy} />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[rgb(var(--c-line)/var(--line-alpha))] pt-3 text-[12px]">
          <div>
            <dt className="text-ink3">Signed in with</dt>
            <dd className="mt-0.5 font-semibold capitalize text-ink">{user?.provider ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink3">Member since</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
                : '—'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="border-danger/25">
        <p className="text-[13.5px] font-semibold text-danger">Delete account and data</p>
        <p className="mt-1 text-[12px] leading-snug text-ink2">
          Permanently removes your profile, all {eventCount} event{eventCount === 1 ? '' : 's'}, your
          settings and your assistant history. This cannot be undone, and it applies on every device.
        </p>

        {!confirmDelete ? (
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            className="mt-3"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            Delete my account…
          </Button>
        ) : (
          <div className="mt-3 space-y-2.5">
            <label htmlFor="confirm-delete" className="block text-[12px] font-medium text-ink2">
              Type <span className="font-mono font-bold text-danger">DELETE</span> to confirm
            </label>
            <input
              id="confirm-delete"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              className={cx(
                'h-10 w-full rounded-[12px] border bg-[rgb(var(--c-surface)/0.9)] px-3 font-mono text-[13.5px] text-ink',
                'border-danger/40 focus:border-danger focus:outline-none focus-visible:shadow-focus',
              )}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="subtle" onClick={() => { setConfirmDelete(false); setDeleteText(''); }} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="trash"
                className="ml-auto"
                loading={busy}
                disabled={deleteText.trim() !== 'DELETE'}
                onClick={onDelete}
              >
                Delete everything
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <p className="text-[12.5px] font-semibold text-ink">How your data is protected</p>
        <ul className="mt-2 space-y-1.5 text-[12px] leading-snug text-ink2">
          <li className="flex gap-2">
            <Icon name="shield" size={13} weight={2} className="mt-px shrink-0 text-success" />
            OAuth only — your Google password is never seen or stored by Planify.
          </li>
          <li className="flex gap-2">
            <Icon name="shield" size={13} weight={2} className="mt-px shrink-0 text-success" />
            Row Level Security: every query is filtered to your own user id at the database.
          </li>
          <li className="flex gap-2">
            <Icon name="shield" size={13} weight={2} className="mt-px shrink-0 text-success" />
            Sign-in asks for identity only. Calendar access is a separate, optional grant.
          </li>
        </ul>
      </Card>
    </Section>
  );
}
