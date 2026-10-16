/**
 * EventSheet — create / edit / duplicate an event.
 *
 * Covers every field in the brief: title, date, start & end time, all-day,
 * location, notes, category colour, reminder(s) and repeat (none / daily /
 * weekly / monthly / yearly / custom).
 *
 * Behaviour worth calling out:
 *   • Saves on submit, immediately and optimistically — the grid updates in the
 *     same frame and the write goes to the cloud behind it.
 *   • Conflicts are detected live and shown as a warning *before* saving, with
 *     a one-tap "find a free slot" escape hatch. The user is never blocked.
 *   • Editing a recurring occurrence offers "this occurrence" vs "whole series",
 *     because silently rewriting a series is destructive.
 *   • End time auto-advances when start passes it, which is what people expect.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cx } from '../../lib/utils';
import {
  addDays,
  addMinutes,
  atTime,
  COMMON_TIMEZONES as COMMON_TZ,
  dayKey,
  differenceInCalendarDays,
  differenceInMinutes,
  fmtMinutes,
  fromDayKey,
  parseTimeInput,
  toDayInput,
  toTimeInput,
  tzAbbrev,
  WEEKDAY_LABELS_LONG,
} from '../../lib/dates';
import { describeRecurrence, toRRule } from '../../lib/recurrence';
import { findConflicts, suggestReminder } from '../../nlp/suggest';
import { CATEGORIES, type CalEvent, type Recurrence, type UserSettings, type Weekday } from '../../types';
import { Sheet } from '../ui/Sheet';
import { Button, IconButton } from '../ui/Button';
import { Field, Select, SwatchPicker, Switch, TextArea, TextInput } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { useAppStore } from '../../store/AppStore';
import { useTheme } from '../../hooks/useTheme';

export interface EventSheetProps {
  open: boolean;
  onClose: () => void;
  /** Existing event to edit; null creates a new one. */
  event: CalEvent | null;
  /** Values pre-filled for a new event (tapped slot, AI proposal). */
  draft?: Partial<CalEvent>;
  settings: UserSettings;
  /** Which occurrence was tapped, for series editing. */
  occurrenceId?: string | null;
}

type RepeatChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type SeriesScope = 'this' | 'series';

interface FormState {
  title: string;
  allDay: boolean;
  day: string;
  endTimeDay: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  categoryId: string;
  reminders: number[];
  repeat: RepeatChoice;
  recurrence: Recurrence | null;
  timezone: string;
}

const REMINDER_CHOICES = [
  { value: '0', label: 'At start' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
  { value: '2880', label: '2 days before' },
  { value: '10080', label: '1 week before' },
];

function eventToForm(event: CalEvent | null, draft: Partial<CalEvent> | undefined, settings: UserSettings): FormState {
  const source = event ?? null;
  const allDay = source?.allDay ?? draft?.allDay ?? false;

  let day: string;
  let endTimeDay: string;
  let startTime: string;
  let endTime: string;

  if (source) {
    if (source.allDay) {
      day = source.startTime.slice(0, 10);
      endTimeDay = dayKey(addDays(fromDayKey(source.endTime.slice(0, 10)), -1));
      startTime = '09:00';
      endTime = '10:00';
    } else {
      const s = new Date(source.startTime);
      const e = new Date(source.endTime);
      day = toDayInput(s);
      endTimeDay = toDayInput(e);
      startTime = toTimeInput(s);
      endTime = toTimeInput(e);
    }
  } else if (draft?.startTime) {
    if (draft.allDay) {
      day = draft.startTime.slice(0, 10);
      endTimeDay = dayKey(
        addDays(fromDayKey(draft.endTime?.slice(0, 10) ?? draft.startTime.slice(0, 10)), -1),
      );
      startTime = '09:00';
      endTime = '10:00';
    } else {
      const s = new Date(draft.startTime);
      const e = new Date(draft.endTime ?? addMinutes(s, 60).toISOString());
      day = toDayInput(s);
      endTimeDay = toDayInput(e);
      startTime = toTimeInput(s);
      endTime = toTimeInput(e);
    }
  } else {
    // New event with no context: next round half-hour, one hour long.
    const base = new Date();
    base.setMinutes(base.getMinutes() < 30 ? 30 : 60, 0, 0);
    day = toDayInput(base);
    endTimeDay = toDayInput(base);
    startTime = toTimeInput(base);
    endTime = toTimeInput(addMinutes(base, 60));
  }

  const recurrence = source?.recurrence ?? draft?.recurrence ?? null;
  const repeat: RepeatChoice = !recurrence
    ? 'none'
    : recurrence.interval > 1 || recurrence.byWeekday?.length || recurrence.byMonthDay?.length || recurrence.count || recurrence.until
      ? 'custom'
      : recurrence.freq;

  return {
    title: source?.title ?? draft?.title ?? '',
    allDay,
    day,
    endTimeDay,
    startTime,
    endTime,
    location: source?.location ?? draft?.location ?? '',
    description: source?.description ?? draft?.description ?? '',
    categoryId: source?.categoryId ?? draft?.categoryId ?? settings.defaultCategoryId,
    reminders: source?.reminders ?? draft?.reminders ?? (allDay ? [] : [settings.defaultReminderMinutes].filter((m) => m > 0)),
    repeat,
    recurrence,
    timezone: source?.timezone ?? draft?.timezone ?? settings.timezone,
  };
}

/** Compose the absolute start/end ISO strings the store expects. */
function formToTimes(form: FormState): { startTime: string; endTime: string; allDay: boolean } {
  if (form.allDay) {
    const startDay = form.day;
    // All-day end is stored exclusive; the picker shows the last included day.
    const endDay = addDays(fromDayKey(form.endTimeDay || form.day), 1);
    return { startTime: startDay, endTime: dayKey(endDay), allDay: true };
  }
  const s = parseTimeInput(form.startTime);
  const e = parseTimeInput(form.endTime);
  const start = atTime(fromDayKey(form.day), s.hours, s.minutes);
  let end = atTime(fromDayKey(form.endTimeDay || form.day), e.hours, e.minutes);
  // An end at or before the start means the user crossed midnight.
  if (end.getTime() <= start.getTime()) end = addDays(end, 1);
  return { startTime: start.toISOString(), endTime: end.toISOString(), allDay: false };
}

function buildRecurrence(form: FormState, defaultWeekday: Weekday, defaultMonthDay: number): Recurrence | null {
  switch (form.repeat) {
    case 'none':
      return null;
    case 'daily':
      return { freq: 'daily', interval: 1 };
    case 'weekly':
      return { freq: 'weekly', interval: 1, byWeekday: [defaultWeekday] };
    case 'monthly':
      return { freq: 'monthly', interval: 1, byMonthDay: [defaultMonthDay] };
    case 'yearly':
      return {
        freq: 'yearly',
        interval: 1,
        byMonthDay: [defaultMonthDay],
        byMonth: [fromDayKey(form.day).getMonth() + 1],
      };
    case 'custom':
      return (
        form.recurrence ?? { freq: 'weekly', interval: 1, byWeekday: [defaultWeekday] }
      );
    default:
      return null;
  }
}

export function EventSheet({ open, onClose, event, draft, settings, occurrenceId }: EventSheetProps) {
  const { createEvent, updateEvent, deleteEvent, duplicateEvent, events } = useAppStore();
  const { resolved } = useTheme();
  const [form, setForm] = useState<FormState>(() => eventToForm(event, draft, settings));
  const [scope, setScope] = useState<SeriesScope>('series');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Reset the form whenever a different event (or a new blank one) opens.
  useEffect(() => {
    if (!open) return;
    setForm(eventToForm(event, draft, settings));
    setScope(event?.recurrence ? 'this' : 'series');
    setError(null);
    setShowAdvanced(false);
  }, [open, event, draft, settings, occurrenceId]);

  const patch = useCallback((p: Partial<FormState>) => setForm((f) => ({ ...f, ...p })), []);

  const times = useMemo(() => formToTimes(form), [form]);
  const startDate = useMemo(
    () => (form.allDay ? fromDayKey(form.day) : new Date(times.startTime)),
    [form.allDay, form.day, times.startTime],
  );

  /* --- live validation ---------------------------------------------------- */
  const titleError = form.title.trim().length === 0 ? 'Give the event a name.' : null;

  const conflicts = useMemo(() => {
    if (form.allDay) return [];
    return findConflicts(events, new Date(times.startTime), new Date(times.endTime), event?.id);
  }, [events, times, form.allDay, event?.id]);

  const durationMinutes = form.allDay ? 0 : differenceInMinutes(new Date(times.endTime), new Date(times.startTime));

  /* --- keep end >= start as the user edits -------------------------------- */
  const handleStartChange = (value: string) => {
    setForm((f) => {
      const s = parseTimeInput(value);
      const currentEnd = parseTimeInput(f.endTime);
      const startMinutes = s.hours * 60 + s.minutes;
      const endMinutes = currentEnd.hours * 60 + currentEnd.minutes;
      const nextEnd =
        endMinutes <= startMinutes
          ? `${String(Math.floor((startMinutes + 60) / 60) % 24).padStart(2, '0')}:${String(
              (startMinutes + 60) % 60,
            ).padStart(2, '0')}`
          : f.endTime;
      return { ...f, startTime: value, endTime: nextEnd };
    });
  };

  const toggleAllDay = (next: boolean) => {
    setForm((f) => ({ ...f, allDay: next }));
  };

  const recurrencePreview = useMemo(
    () =>
      describeRecurrence(
        buildRecurrence(form, startDate.getDay() as Weekday, startDate.getDate()),
        startDate,
      ),
    [form, startDate],
  );

  /* --- submit ------------------------------------------------------------- */
  const handleSave = useCallback(async () => {
    if (titleError) {
      setError(titleError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const recurrence = buildRecurrence(form, startDate.getDay() as Weekday, startDate.getDate());
      const payload = {
        title: form.title.trim(),
        description: form.description,
        startTime: times.startTime,
        endTime: times.endTime,
        allDay: form.allDay,
        timezone: form.timezone,
        location: form.location.trim(),
        categoryId: form.categoryId,
        reminders: form.reminders,
        recurrence,
      };

      if (event) {
        if (event.recurrence && scope === 'this') {
          // Split this one occurrence out of the series: exclude it from the
          // parent and create a standalone event carrying the edited values.
          const exceptionKey = dayKey(startDate);
          await updateEvent(event.id, {
            exceptions: [...new Set([...event.exceptions, exceptionKey])],
          });
          await createEvent({ ...payload, recurrence: null, exceptions: [] });
        } else {
          await updateEvent(event.id, payload);
        }
      } else {
        await createEvent(payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event.');
    } finally {
      setSaving(false);
    }
  }, [titleError, form, times, startDate, event, scope, updateEvent, createEvent, onClose]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    setSaving(true);
    try {
      await deleteEvent(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the event.');
      setSaving(false);
    }
  }, [event, deleteEvent, onClose]);

  const handleDuplicate = useCallback(async () => {
    if (!event) return;
    const copy = await duplicateEvent(event.id);
    onClose();
    return copy;
  }, [event, duplicateEvent, onClose]);

  const isEdit = !!event;
  const tzLabel = tzAbbrev(startDate, form.timezone);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      maxWidth={640}
      tall
      title={isEdit ? 'Edit event' : 'New event'}
      subtitle={
        isEdit
          ? undefined
          : `${startDate.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })} · ${tzLabel}`
      }
      footer={
        <div className="flex items-center gap-2">
          {isEdit ? (
            <>
              <IconButton icon="trash" label="Delete event" variant="danger" onClick={handleDelete} disabled={saving} />
              <IconButton icon="copy" label="Duplicate event" variant="glass" onClick={() => void handleDuplicate()} disabled={saving} />
            </>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink3">
              <Icon name="cloud" size={13} weight={2} className="shrink-0" />
              <span className="truncate">Saves immediately and syncs to your devices</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="subtle" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={() => void handleSave()} loading={saving}>
              {isEdit ? 'Save changes' : 'Add event'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 pb-1">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/12 px-3 py-2 text-[13px] font-medium text-danger">
            <Icon name="alert" size={15} weight={2} className="mt-px shrink-0" />
            {error}
          </p>
        ) : null}

        {/* Title */}
        <Field label="Title" htmlFor="evt-title" required error={titleError && form.title.length > 0 ? titleError : null}>
          <TextInput
            id="evt-title"
            data-autofocus
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={isEdit ? 'Event title' : 'Add a title'}
            invalid={!!titleError}
            maxLength={160}
            autoComplete="off"
            aria-required="true"
          />
        </Field>

        {/* All-day */}
        <div className="rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.6)] px-3 py-2">
          <Switch
            checked={form.allDay}
            onChange={toggleAllDay}
            label="All day"
            description={form.allDay ? 'Spans the whole day, no clock time' : 'Has a specific start and end time'}
          />
        </div>

        {/* Date & time */}
        <div className={cx('grid gap-3', form.allDay ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
          <Field label={form.allDay ? 'Date' : 'Starts'} htmlFor="evt-day">
            <div className={cx('grid gap-2', form.allDay ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
              <TextInput
                id="evt-day"
                type="date"
                value={form.day}
                max="2999-12-31"
                onChange={(e) => {
                  const v = e.target.value;
                  patch({ day: v, endTimeDay: form.allDay ? form.endTimeDay : v });
                }}
              />
              {!form.allDay ? (
                <TextInput
                  type="time"
                  step={300}
                  value={form.startTime}
                  onChange={(e) => handleStartChange(e.target.value)}
                  aria-label="Start time"
                />
              ) : null}
            </div>
          </Field>

          <Field
            label={form.allDay ? 'Ends' : 'Ends'}
            htmlFor="evt-end-day"
            hint={
              !form.allDay && durationMinutes > 0
                ? `${fmtMinutes(durationMinutes)} long`
                : form.allDay
                  ? (() => {
                      const days =
                        differenceInCalendarDays(
                          fromDayKey(form.endTimeDay || form.day),
                          fromDayKey(form.day),
                        ) + 1;
                      return days > 1 ? `${days} days` : 'Single day';
                    })()
                  : undefined
            }
          >
            <div className={cx('grid gap-2', form.allDay ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
              <TextInput
                id="evt-end-day"
                type="date"
                value={form.endTimeDay || form.day}
                min={form.day}
                max="2999-12-31"
                onChange={(e) => patch({ endTimeDay: e.target.value })}
              />
              {!form.allDay ? (
                <TextInput
                  type="time"
                  step={300}
                  value={form.endTime}
                  onChange={(e) => patch({ endTime: e.target.value })}
                  aria-label="End time"
                />
              ) : null}
            </div>
          </Field>
        </div>

        {/* Conflict warning — shown before saving, never blocking */}
        {conflicts.length > 0 ? (
          <div
            role="status"
            className="rounded-[13px] border border-warn/30 bg-warn/12 px-3 py-2.5"
          >
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-warn">
              <Icon name="alert" size={14} weight={2.1} />
              Overlaps {conflicts.length} existing event{conflicts.length > 1 ? 's' : ''}
            </p>
            <ul className="mt-1.5 space-y-1 pl-6 text-[12.5px] text-ink2">
              {conflicts.slice(0, 3).map((c) => (
                <li key={c.occurrence.id} className="list-disc">
                  <span className="font-medium text-ink">{c.occurrence.event.title}</span> —{' '}
                  {fmtMinutes(c.overlapMinutes)} overlap
                </li>
              ))}
            </ul>
            <p className="mt-1.5 pl-6 text-[11.5px] text-ink3">
              You can still save it — or ask the assistant to find a free slot.
            </p>
          </div>
        ) : null}

        {/* Location */}
        <Field label="Location" htmlFor="evt-location">
          <TextInput
            id="evt-location"
            iconLeft="pin"
            value={form.location}
            onChange={(e) => patch({ location: e.target.value })}
            placeholder="Add a place or a link"
            maxLength={240}
            autoComplete="off"
          />
        </Field>

        {/* Category */}
        <Field label="Category" hint="Sets the colour used across every view.">
          <SwatchPicker
            value={form.categoryId}
            onChange={(id) => patch({ categoryId: id })}
            categories={CATEGORIES.map((c) => ({
              ...c,
              ...(resolved === 'light'
                ? { bg: '#FFFFFF', fg: c.solid }
                : {}),
            }))}
          />
        </Field>

        {/* Reminder */}
        <Field
          label="Reminder"
          hint={
            form.reminders.length === 0
              ? 'No reminder will be sent.'
              : form.reminders.length === 1
                ? `Fires ${describeReminder(form.reminders[0])}.`
                : `${form.reminders.length} reminders set.`
          }
          action={
            form.reminders.length > 0 ? (
              <button
                type="button"
                onClick={() => patch({ reminders: [] })}
                className="pressable rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-ink3 hover:bg-[rgb(var(--c-line)/0.1)] hover:text-ink"
              >
                Clear
              </button>
            ) : null
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {REMINDER_CHOICES.map((r) => {
              const mins = Number(r.value);
              const active = form.reminders.includes(mins);
              return (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    patch({
                      reminders: active
                        ? form.reminders.filter((m) => m !== mins)
                        : [...form.reminders, mins].sort((a, b) => a - b),
                    })
                  }
                  className={cx(
                    'pressable inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold',
                    active
                      ? 'border-accent/45 bg-accent/16 text-accent'
                      : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.04)] text-ink2 hover:bg-[rgb(var(--c-line)/0.1)] hover:text-ink',
                  )}
                >
                  {active ? <Icon name="bell" size={11} weight={2.2} /> : null}
                  {r.label}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Repeat */}
        <Field label="Repeat" htmlFor="evt-repeat" hint={recurrencePreview}>
          <Select
            id="evt-repeat"
            value={form.repeat}
            onChange={(e) => {
              const next = e.target.value as RepeatChoice;
              patch({ repeat: next });
              if (next === 'custom') setShowAdvanced(true);
            }}
            options={[
              { value: 'none', label: 'Does not repeat' },
              { value: 'daily', label: 'Every day' },
              { value: 'weekly', label: `Every week on ${WEEKDAY_LABELS_LONG[startDate.getDay()]}` },
              { value: 'monthly', label: `Every month on day ${startDate.getDate()}` },
              { value: 'yearly', label: `Every year on ${startDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` },
              { value: 'custom', label: 'Custom…' },
            ]}
          />
        </Field>

        {form.repeat === 'custom' ? (
          <CustomRecurrence
            recurrence={
              form.recurrence ?? {
                freq: 'weekly',
                interval: 1,
                byWeekday: [startDate.getDay() as Weekday],
              }
            }
            anchor={startDate}
            onChange={(r) => patch({ recurrence: r })}
            rrule={toRRule(buildRecurrence({ ...form, repeat: 'custom' }, startDate.getDay() as Weekday, startDate.getDate()))}
            open={showAdvanced}
            onToggle={() => setShowAdvanced((v) => !v)}
          />
        ) : null}

        {/* Series scope */}
        {event?.recurrence ? (
          <div className="rounded-[13px] border border-accent/28 bg-accent/10 px-3 py-2.5">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-accent">
              <Icon name="repeat" size={14} weight={2.1} />
              This event repeats
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'this', label: 'This occurrence', hint: 'Splits just this one out of the series' },
                  { value: 'series', label: 'Whole series', hint: 'Changes every future occurrence' },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={scope === o.value}
                  onClick={() => setScope(o.value)}
                  className={cx(
                    'pressable rounded-xl border px-3 py-2 text-left',
                    scope === o.value
                      ? 'border-accent/50 bg-accent/16'
                      : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.6)]',
                  )}
                >
                  <span className={cx('block text-[12.5px] font-semibold', scope === o.value ? 'text-accent' : 'text-ink')}>
                    {o.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink3">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Notes */}
        <Field label="Notes" htmlFor="evt-notes">
          <TextArea
            id="evt-notes"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Agenda, links, anything worth remembering"
            rows={3}
            maxLength={4000}
          />
        </Field>

        {/* Timezone */}
        <Field
          label="Time zone"
          htmlFor="evt-tz"
          hint={
            form.timezone === settings.timezone
              ? `Same as your device (${tzLabel}). Events always display in each device's local time.`
              : `Stored as ${form.timezone}; shown as ${tzLabel} on this device.`
          }
        >
          <Select
            id="evt-tz"
            value={form.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
            options={[
              ...(settings.timezone !== form.timezone
                ? [{ value: form.timezone, label: `${form.timezone} (event)` }]
                : []),
              { value: settings.timezone, label: `${settings.timezone} — your device` },
              ...COMMON_TZ.filter((t) => t !== settings.timezone && t !== form.timezone).map((t) => ({
                value: t,
                label: t,
              })),
            ]}
          />
        </Field>

        {!isEdit ? (
          <SuggestedReminder
            onApply={(mins) => patch({ reminders: [mins] })}
            current={form.reminders}
            title={form.title}
            start={startDate}
            allDay={form.allDay}
            location={form.location}
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function describeReminder(mins: number): string {
  if (mins === 0) return 'at the start';
  if (mins < 60) return `${mins} minutes before`;
  if (mins < 1440) return `${mins / 60} hour${mins / 60 > 1 ? 's' : ''} before`;
  if (mins < 10080) return `${mins / 1440} day${mins / 1440 > 1 ? 's' : ''} before`;
  return `${mins / 10080} week${mins / 10080 > 1 ? 's' : ''} before`;
}

/** Offers a reminder based on what the event looks like — opt-in, never applied. */
function SuggestedReminder({
  onApply,
  current,
  title,
  start,
  allDay,
  location,
}: {
  onApply: (mins: number) => void;
  current: number[];
  title: string;
  start: Date;
  allDay: boolean;
  location: string;
}) {
  if (!title.trim()) return null;
  const suggestion = suggestReminder(
    {
      title,
      location,
      allDay,
      startTime: allDay ? dayKey(start) : start.toISOString(),
    } as CalEvent,
    new Date(),
  );
  if (current.includes(suggestion)) return null;

  return (
    <div className="glass flex items-center gap-2.5 rounded-[13px] px-3 py-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/16 text-accent">
        <Icon name="sparkles" size={14} weight={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink">
          Remind me {describeReminder(suggestion)}?
        </p>
        <p className="text-[11px] text-ink3">Based on what this event looks like.</p>
      </div>
      <Button size="sm" variant="subtle" onClick={() => onApply(suggestion)}>
        Use it
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom recurrence                                                           */
/* -------------------------------------------------------------------------- */

function CustomRecurrence({
  recurrence,
  anchor,
  onChange,
  rrule,
  open,
  onToggle,
}: {
  recurrence: Recurrence;
  anchor: Date;
  onChange: (r: Recurrence) => void;
  rrule: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const weekdays = useMemo(() => {
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return labels.map((l, i) => ({ label: l, value: i as Weekday, full: WEEKDAY_LABELS_LONG[i] }));
  }, []);

  const toggleWeekday = (d: Weekday) => {
    const current = recurrence.byWeekday ?? [];
    const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d].sort((a, b) => a - b);
    onChange({ ...recurrence, byWeekday: next.length ? next : undefined });
  };

  return (
    <div className="space-y-3 rounded-[13px] border border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-surface)/0.6)] p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeat every" htmlFor="rec-interval">
          <div className="flex gap-2">
            <TextInput
              id="rec-interval"
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              value={recurrence.interval}
              onChange={(e) => onChange({ ...recurrence, interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              className="w-20 text-center"
            />
            <Select
              value={recurrence.freq}
              onChange={(e) => onChange({ ...recurrence, freq: e.target.value as Recurrence['freq'] })}
              options={[
                { value: 'daily', label: recurrence.interval > 1 ? 'days' : 'day' },
                { value: 'weekly', label: recurrence.interval > 1 ? 'weeks' : 'week' },
                { value: 'monthly', label: recurrence.interval > 1 ? 'months' : 'month' },
                { value: 'yearly', label: recurrence.interval > 1 ? 'years' : 'year' },
              ]}
              aria-label="Repeat frequency"
              className="flex-1"
            />
          </div>
        </Field>

        <Field label="Ends" htmlFor="rec-end">
          <Select
            id="rec-end"
            value={recurrence.count ? 'count' : recurrence.until ? 'until' : 'never'}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...recurrence,
                count: v === 'count' ? (recurrence.count ?? 10) : undefined,
                until: v === 'until' ? (recurrence.until ?? dayKey(addDays(anchor, 90))) : undefined,
              });
            }}
            options={[
              { value: 'never', label: 'Never' },
              { value: 'count', label: 'After N occurrences' },
              { value: 'until', label: 'On a date' },
            ]}
          />
        </Field>
      </div>

      {recurrence.count ? (
        <Field label="Occurrences" htmlFor="rec-count">
          <TextInput
            id="rec-count"
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            value={recurrence.count}
            onChange={(e) => onChange({ ...recurrence, count: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
            className="w-28"
          />
        </Field>
      ) : null}

      {recurrence.until ? (
        <Field label="Until" htmlFor="rec-until">
          <TextInput
            id="rec-until"
            type="date"
            value={recurrence.until.slice(0, 10)}
            min={dayKey(anchor)}
            onChange={(e) => onChange({ ...recurrence, until: e.target.value })}
            className="w-44"
          />
        </Field>
      ) : null}

      {recurrence.freq === 'weekly' ? (
        <Field label="On days" hint={recurrence.byWeekday?.length ? undefined : 'Falls back to the start date’s weekday.'}>
          <div className="flex flex-wrap gap-1.5">
            {weekdays.map((d) => {
              const active = (recurrence.byWeekday ?? [anchor.getDay() as Weekday]).includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={d.full}
                  title={d.full}
                  onClick={() => toggleWeekday(d.value)}
                  className={cx(
                    'pressable h-9 w-9 rounded-full border text-[12.5px] font-bold',
                    active
                      ? 'border-accent/50 bg-accent/18 text-accent'
                      : 'border-[rgb(var(--c-line)/var(--line-alpha))] bg-[rgb(var(--c-line)/0.04)] text-ink3 hover:text-ink',
                  )}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}

      {recurrence.freq === 'monthly' ? (
        <Field label="On day of month" htmlFor="rec-dom">
          <TextInput
            id="rec-dom"
            type="number"
            min={1}
            max={31}
            inputMode="numeric"
            value={(recurrence.byMonthDay ?? [anchor.getDate()])[0]}
            onChange={(e) => {
              const n = Math.max(1, Math.min(31, Number(e.target.value) || 1));
              onChange({ ...recurrence, byMonthDay: [n] });
            }}
            className="w-24"
          />
        </Field>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        className="pressable inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[11.5px] font-semibold text-ink3 hover:text-ink"
        aria-expanded={open}
      >
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} weight={2.2} />
        {open ? 'Hide' : 'Show'} RRULE
      </button>
      {open ? (
        <code className="block overflow-x-auto rounded-lg bg-[rgb(var(--c-sunken)/0.8)] px-2.5 py-2 font-mono text-[11px] text-ink2">
          {rrule ?? 'RRULE:FREQ=WEEKLY;INTERVAL=1'}
        </code>
      ) : null}

      <p className="text-[11.5px] leading-snug text-ink3">
        {describeRecurrence(recurrence, anchor)} · starts{' '}
        {anchor.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
    </div>
  );
}
