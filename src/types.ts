/**
 * Planify — domain types.
 *
 * These mirror the Postgres schema in `supabase/migrations/0001_init.sql`
 * one-to-one so the same objects travel between the local IndexedDB cache and
 * the cloud without translation.
 */

/** A signed-in account. Never contains a password or a raw OAuth token. */
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: AuthProvider;
  createdAt: string;
  lastSeenAt: string;
  onboardingComplete: boolean;
}

export type AuthProvider = 'google' | 'local';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

/** 0 = Sunday … 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TimeFormat = '12h' | '24h';

export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda';

export interface UserSettings {
  themeMode: ThemeMode;
  firstDayOfWeek: Weekday;
  timeFormat: TimeFormat;
  /** Minutes before an event; used as the default when creating. */
  defaultReminderMinutes: number;
  timezone: string;
  /** Where the day/week grid starts, in hours (0–23). */
  dayStartHour: number;
  weekViewDays: 5 | 7;
  defaultCategoryId: string;
  /** Play a subtle haptic-style transition when saving. */
  reduceMotion: boolean;
  notificationsEnabled: boolean;
  accentHue: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  themeMode: 'dark',
  firstDayOfWeek: 0,
  timeFormat: '12h',
  defaultReminderMinutes: 10,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  dayStartHour: 7,
  weekViewDays: 7,
  defaultCategoryId: 'personal',
  reduceMotion: false,
  notificationsEnabled: false,
  accentHue: 216,
};

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

export interface Category {
  id: string;
  name: string;
  /**
   * Three tokens per category so a chip is always legible:
   *   solid = the swatch / left rail,  bg = the chip fill,  fg = chip text.
   * Contrast of `fg` on `bg` is verified in scripts/check-contrast.mjs.
   */
  solid: string;
  bg: string;
  fg: string;
}

/** Fixed palette. Users may rename/toggle visibility but the tokens stay stable. */
export const CATEGORIES: Category[] = [
  { id: 'personal', name: 'Personal', solid: '#4091FF', bg: '#12314F', fg: '#A8CFFF' },
  { id: 'work', name: 'Work', solid: '#A874FF', bg: '#2C1F4D', fg: '#CFB6FF' },
  { id: 'health', name: 'Health', solid: '#42D68F', bg: '#0F3A2A', fg: '#93E9C2' },
  { id: 'social', name: 'Social', solid: '#FF7A9C', bg: '#4A1B2A', fg: '#FFB3C6' },
  { id: 'travel', name: 'Travel', solid: '#FFC454', bg: '#453313', fg: '#FFDDA0' },
  { id: 'focus', name: 'Focus', solid: '#4FD6E8', bg: '#0E3A42', fg: '#9EEAF5' },
  { id: 'family', name: 'Family', solid: '#FF9F6B', bg: '#4A2A16', fg: '#FFC9A8' },
  { id: 'other', name: 'Other', solid: '#9AA1AD', bg: '#2A2C31', fg: '#C6CBD4' },
];

/** Light-theme overrides for the same category ids. */
export const CATEGORIES_LIGHT: Record<string, { bg: string; fg: string }> = {
  personal: { bg: '#DCEAFF', fg: '#0A4A9E' },
  work: { bg: '#ECE0FF', fg: '#5A2BB0' },
  health: { bg: '#D6F5E5', fg: '#0A6A41' },
  social: { bg: '#FFDEE7', fg: '#A3224A' },
  travel: { bg: '#FFEDC9', fg: '#8A5A00' },
  focus: { bg: '#D6F2F7', fg: '#0A6272' },
  family: { bg: '#FFE4D2', fg: '#9E4A16' },
  other: { bg: '#E4E6EA', fg: '#3D424B' },
};

export function getCategory(id: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/* -------------------------------------------------------------------------- */
/* Recurrence                                                                  */
/* -------------------------------------------------------------------------- */

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Every N units. 1 = every day/week/month/year. */
  interval: number;
  /** For weekly: which weekdays. For monthly: ignored (byMonthDay used). */
  byWeekday?: Weekday[];
  /** For monthly: day-of-month numbers (1–31). */
  byMonthDay?: number[];
  /** For yearly: month numbers (1–12). */
  byMonth?: number[];
  /** Stop after N occurrences (inclusive of the first). */
  count?: number;
  /** Stop on/after this ISO date. */
  until?: string;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export interface CalEvent {
  id: string;
  userId: string;
  title: string;
  description: string;
  /**
   * Timed events: absolute UTC instants (ISO 8601 with `Z`).
   * All-day events: date-only strings `YYYY-MM-DD`, interpreted in `timezone`.
   * Keeping both in one column matches Google Calendar's `date` vs `dateTime`.
   */
  startTime: string;
  endTime: string;
  allDay: boolean;
  timezone: string;
  location: string;
  categoryId: string;
  /** Minutes before start. May hold several, e.g. [1440, 10]. */
  reminders: number[];
  recurrence: Recurrence | null;
  /** ISO dates of individual cancelled occurrences of a recurring series. */
  exceptions: string[];
  createdAt: string;
  updatedAt: string;
  /** Soft delete — required so removals propagate to other devices. */
  deleted: boolean;
  /** Set when this row originated from a Google Calendar sync. */
  googleEventId?: string | null;
  googleCalendarId?: string | null;
  /** Monotonic-ish version for conflict resolution; bumps on every write. */
  version: number;
}

/**
 * A single *occurrence* of an event, ready to render. `seriesId` points back
 * at the stored `CalEvent`; `id` is unique per occurrence so React keys and
 * drag-and-drop targets stay stable.
 */
export interface Occurrence {
  id: string;
  seriesId: string;
  event: CalEvent;
  /** For timed events these are Dates; all-day uses date-only strings. */
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  allDay: boolean;
  /** 1-based index within the series (used by "this and following"). */
  index: number;
  isRecurring: boolean;
}

export type EventDraft = Omit<
  CalEvent,
  'id' | 'userId' | 'createdAt' | 'updatedAt' | 'deleted' | 'version'
> & { id?: string };

/* -------------------------------------------------------------------------- */
/* AI                                                                          */
/* -------------------------------------------------------------------------- */

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  userId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** A pending action the user must confirm before anything is written. */
  action?: ProposedAction | null;
  /** True once the user confirmed and the action was applied. */
  resolved?: boolean;
  /** True if applying the action failed. */
  error?: string | null;
}

export type ProposedActionKind =
  | 'create_event'
  | 'update_event'
  | 'delete_event'
  | 'reschedule_event'
  | 'suggest_slots'
  | 'summary'
  | 'none';

export interface ProposedEvent {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  timezone: string;
  location: string;
  categoryId: string;
  reminders: number[];
  recurrence: Recurrence | null;
  exceptions: string[];
}

export interface ProposedAction {
  kind: ProposedActionKind;
  /** Human-readable statement of exactly what will happen. Shown pre-confirm. */
  summary: string;
  /** Present for create/update/reschedule. */
  event?: ProposedEvent;
  /** Present for update/delete/reschedule. */
  eventId?: string;
  /** Patch applied on top of the stored event for update/reschedule. */
  patch?: Partial<CalEvent>;
  /** Free slots offered back to the user. */
  slots?: TimeSlot[];
  /** Fields the parser could not resolve — surfaced as questions, not guesses. */
  missing?: string[];
  /** Anything the parser noticed that the user should double-check. */
  warnings?: string[];
  /** 0–1 confidence from the local parser; below 0.55 we ask rather than act. */
  confidence?: number;
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  /** Why this slot was chosen, in plain words. */
  reason: string;
  score: number;
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                        */
/* -------------------------------------------------------------------------- */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface PendingMutation {
  id: string;
  userId: string;
  entity: 'event' | 'settings' | 'chat';
  op: 'upsert' | 'delete';
  payload: unknown;
  createdAt: string;
  attempts: number;
}

export interface DataStatus {
  state: SyncState;
  /** Number of writes waiting to reach the cloud. */
  pending: number;
  lastSyncedAt: string | null;
  message: string | null;
  /** 'cloud' = Supabase, 'device' = this browser only. */
  mode: 'cloud' | 'device';
}

/* -------------------------------------------------------------------------- */
/* Google Calendar integration                                                 */
/* -------------------------------------------------------------------------- */

export interface GoogleCalendarLink {
  connected: boolean;
  email?: string;
  calendarId?: string;
  /** 'idle' | 'syncing' | 'error' */
  status: 'idle' | 'syncing' | 'error' | 'paused';
  lastSyncAt: string | null;
  /** Direction chosen by the user. */
  mode: 'two-way' | 'import' | 'export';
  scopesGranted: string[];
  message?: string | null;
}

export const GOOGLE_PROFILE_SCOPE = 'openid email profile';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
