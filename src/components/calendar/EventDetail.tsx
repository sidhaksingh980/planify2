/**
 * EventDetail — what opens when you tap an event.
 *
 * The brief asks for "options to view, edit, duplicate, or delete". This sheet
 * shows the event in full, then offers exactly those four actions plus the
 * recurring-series choices. Delete asks for confirmation inline rather than in a
 * second dialog — one less modal, same protection.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  addDays,
  differenceInMinutes,
  fmtMinutes,
  formatTime,
  fromDayKey,
  tzAbbrev,
} from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { findConflicts, suggestFollowUps } from '../../nlp/suggest';
import { reminderPhrase } from '../../nlp/parseEvent';
import { CATEGORIES, getCategory, type CalEvent, type Occurrence, type ResolvedTheme, type TimeFormat } from '../../types';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { useAppStore } from '../../store/AppStore';
import { chipStyle } from './EventChip';

export interface EventDetailProps {
  open: boolean;
  occurrence: Occurrence | null;
  theme: ResolvedTheme;
  timeFormat: TimeFormat;
  onClose: () => void;
  onEdit: (event: CalEvent, occurrence: Occurrence) => void;
  onAskAi: (prompt: string, event: CalEvent) => void;
}

export function EventDetail({
  open,
  occurrence,
  theme,
  timeFormat,
  onClose,
  onEdit,
  onAskAi,
}: EventDetailProps) {
  const { deleteEvent, duplicateEvent, events, updateEvent } = useAppStore();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const event = occurrence?.event ?? null;

  // Reset the confirm state each time a different event opens.
  const key = occurrence?.id ?? 'none';
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setConfirmDelete(false);
    setError(null);
  }

  const details = useMemo(() => {
    if (!occurrence) return null;
    const { start, end, allDay } = occurrence;
    const cat = getCategory(event?.categoryId);
    const tz = tzAbbrev(allDay ? fromDayKey(start.toISOString().slice(0, 10)) : start, event?.timezone);

    const dateLine = allDay
      ? start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const timeLine = allDay
      ? (() => {
          const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
          return days === 1 ? 'All day' : `All day · ${days} days`;
        })()
      : `${formatTime(start, timeFormat)} – ${formatTime(end, timeFormat)}`;

    const duration = allDay ? null : fmtMinutes(Math.max(0, differenceInMinutes(end, start)));

    return { cat, dateLine, timeLine, duration, tz };
  }, [occurrence, event, timeFormat]);

  const conflicts = useMemo(() => {
    if (!occurrence || occurrence.allDay || !event) return [];
    return findConflicts(events, occurrence.start, occurrence.end, event.id).filter(
      (c) => c.occurrence.seriesId !== event.id,
    );
  }, [occurrence, events, event]);

  const followUps = useMemo(() => (event ? suggestFollowUps(event) : []), [event]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      await deleteEvent(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event.');
      setBusy(false);
    }
  }, [event, deleteEvent, onClose]);

  const handleDuplicate = useCallback(async () => {
    if (!event) return;
    setBusy(true);
    try {
      const copy = await duplicateEvent(event.id);
      onClose();
      return copy;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not duplicate the event.');
    } finally {
      setBusy(false);
    }
  }, [event, duplicateEvent, onClose]);

  /** Move just this occurrence out of a series, leaving the rest intact. */
  const handleDeleteOccurrence = useCallback(async () => {
    if (!event || !occurrence) return;
    setBusy(true);
    setError(null);
    try {
      const exceptionKey = occurrence.start.toISOString().slice(0, 10);
      await updateEvent(event.id, {
        exceptions: [...new Set([...event.exceptions, exceptionKey])],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that occurrence.');
    } finally {
      setBusy(false);
    }
  }, [event, occurrence, updateEvent, onClose]);

  if (!open || !occurrence || !event || !details) return null;

  const { cat, dateLine, timeLine, duration, tz } = details;
  const colors = chipStyle(event.categoryId, theme);
  const relative = occurrence.allDay ? null : relativeLabel(occurrence.start);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      maxWidth={520}
      title={undefined}
      hideClose={false}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {confirmDelete ? (
            <>
              <span className="text-[12.5px] font-medium text-ink2">
                Delete {event.recurrence ? 'the whole series' : 'this event'}?
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" icon="trash" onClick={() => void handleDelete()} loading={busy}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              <Button variant="glass" icon="copy" onClick={() => void handleDuplicate()} disabled={busy}>
                Duplicate
              </Button>
              <Button variant="primary" icon="pencil" className="ml-auto" onClick={() => onEdit(event, occurrence)}>
                Edit
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 h-11 w-[5px] shrink-0 rounded-full"
            style={{ backgroundColor: colors.solid }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {event.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ backgroundColor: colors.bg, color: colors.fg }}
              >
                {cat.name}
              </span>
              {relative ? (
                <span className="inline-flex items-center rounded-full bg-[rgb(var(--c-line)/0.1)] px-2 py-0.5 text-[11px] font-semibold text-ink2">
                  {relative}
                </span>
              ) : null}
              {event.recurrence ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/14 px-2 py-0.5 text-[11px] font-semibold text-accent">
                  <Icon name="repeat" size={10} weight={2.3} />
                  Repeats
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/12 px-3 py-2 text-[13px] font-medium text-danger">
            <Icon name="alert" size={15} weight={2} className="mt-px shrink-0" />
            {error}
          </p>
        ) : null}

        {/* Facts */}
        <dl className="divide-y divide-[rgb(var(--c-line)/var(--line-alpha))] overflow-hidden rounded-[14px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.72)]">
          <Row icon="calendar" label="Date">
            {dateLine}
          </Row>
          <Row icon="clock" label={event.allDay ? 'Time' : 'Time'}>
            {timeLine}
            {duration ? <span className="ml-1.5 text-ink3">· {duration}</span> : null}
          </Row>
          {event.location ? (
            <Row icon="pin" label="Location">
              {isUrl(event.location) ? (
                <a
                  href={event.location}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="t-accent underline decoration-[rgb(var(--c-accent-text)/0.4)] underline-offset-2 hover:decoration-current"
                >
                  {event.location}
                </a>
              ) : (
                event.location
              )}
            </Row>
          ) : null}
          {event.reminders.length ? (
            <Row icon="bell" label={event.reminders.length > 1 ? 'Reminders' : 'Reminder'}>
              {event.reminders.map((m) => reminderPhrase(m)).join(', ')}
            </Row>
          ) : null}
          {event.recurrence ? (
            <Row icon="repeat" label="Repeats">
              {describeRecurrence(event.recurrence, occurrence.start)}
            </Row>
          ) : null}
          <Row icon="clock" label="Time zone">
            {event.timezone} <span className="text-ink3">({tz} here)</span>
          </Row>
        </dl>

        {/* Notes */}
        {event.description ? (
          <div className="rounded-[14px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.72)] p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3">
              <Icon name="notes" size={12} weight={2} />
              Notes
            </p>
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink2">{event.description}</p>
          </div>
        ) : null}

        {/* Conflicts */}
        {conflicts.length ? (
          <div className="rounded-[14px] border border-warn/30 bg-warn/10 p-3">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-warn">
              <Icon name="alert" size={14} weight={2.1} />
              Clashes with {conflicts.length} event{conflicts.length > 1 ? 's' : ''}
            </p>
            <ul className="mt-2 space-y-1.5">
              {conflicts.slice(0, 3).map((c) => (
                <li key={c.occurrence.id} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getCategory(c.occurrence.event.categoryId).solid }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {c.occurrence.event.title}
                  </span>
                  <span className="shrink-0 tnum text-ink3">
                    {formatTime(c.occurrence.start, timeFormat)} · {fmtMinutes(c.overlapMinutes)} overlap
                  </span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="glass"
              icon="sparkles"
              className="mt-2.5"
              onClick={() =>
                onAskAi(
                  `“${event.title}” clashes with ${conflicts
                    .map((c) => `“${c.occurrence.event.title}”`)
                    .join(' and ')}. Help me reschedule it.`,
                  event,
                )
              }
            >
              Ask the assistant to fix it
            </Button>
          </div>
        ) : null}

        {/* Follow-ups */}
        {followUps.length ? (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3">
              You might also want to
            </p>
            <div className="flex flex-wrap gap-1.5">
              {followUps.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() =>
                    onAskAi(`Add “${f}” for the day after “${event.title}”.`, event)
                  }
                  className="pressable inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.05)] px-2.5 py-1 text-[12px] font-medium text-ink2 hover:bg-[rgb(var(--c-line)/0.11)] hover:text-ink"
                >
                  <Icon name="plus" size={11} weight={2.4} />
                  {f}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Series actions */}
        {event.recurrence && occurrence.isRecurring ? (
          <div className="rounded-[14px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.72)] p-3">
            <p className="text-[12.5px] font-semibold text-ink">This is one occurrence of a series</p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink3">
              Deleting from the footer removes the whole series. To drop only{' '}
              {occurrence.start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, use
              this instead.
            </p>
            <Button
              size="sm"
              variant="subtle"
              icon="trash"
              className="mt-2.5"
              onClick={() => void handleDeleteOccurrence()}
              loading={busy}
            >
              Remove this occurrence only
            </Button>
          </div>
        ) : null}

        {/* Metadata */}
        <p className="pt-1 text-[11px] leading-relaxed text-ink3">
          Created {new Date(event.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          {event.updatedAt !== event.createdAt
            ? ` · updated ${new Date(event.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
            : ''}
          {event.googleEventId ? ' · linked to Google Calendar' : ''}
        </p>
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function Row({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 shrink-0 text-ink3">
        <Icon name={icon} size={15} weight={1.9} />
      </span>
      <dt className="w-[74px] shrink-0 text-[12px] font-medium text-ink3">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">{children}</dd>
    </div>
  );
}

function isUrl(s: string): boolean {
  return /^(https?:\/\/|mailto:|tel:)/i.test(s.trim());
}

function relativeLabel(start: Date): string | null {
  const now = new Date();
  const diffDays = Math.round((startOfDayLocal(start).getTime() - startOfDayLocal(now).getTime()) / 86_400_000);
  if (diffDays === 0) {
    const mins = differenceInMinutes(start, now);
    if (mins > 0) return `in ${fmtMinutes(mins)}`;
    if (mins < 0) return `${fmtMinutes(-mins)} ago`;
    return 'now';
  }
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1 && diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < -1 && diffDays > -7) return `${-diffDays} days ago`;
  return null;
}

function startOfDayLocal(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

/** Not currently used by the sheet but exported for the AI panel's context line. */
export function nextSeriesDate(event: CalEvent, from: Date): Date | null {
  if (!event.recurrence) return null;
  const start = event.allDay ? fromDayKey(event.startTime.slice(0, 10)) : new Date(event.startTime);
  return start.getTime() > from.getTime() ? start : addDays(start, 1);
}

export { CATEGORIES };
