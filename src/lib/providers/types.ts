/**
 * DataProvider — the single seam between the UI and persistence.
 *
 * Two implementations satisfy this interface:
 *
 *   • `localProvider`  — IndexedDB on this device. Always available, works
 *                        offline, and is what runs until cloud credentials are
 *                        supplied. Data is real (user-created only) and
 *                        durable across reloads and sign-out/sign-in.
 *
 *   • `cloudProvider`  — Supabase Postgres with Row Level Security + Realtime.
 *                        Activated automatically when `VITE_SUPABASE_URL` and
 *                        `VITE_SUPABASE_ANON_KEY` are present. This is what
 *                        gives you Google OAuth and true cross-device sync.
 *
 * Neither implementation ever seeds, generates or fabricates an event. A brand
 * new account starts with zero rows; the UI's empty state is the honest one.
 */
import type {
  CalEvent,
  ChatMessage,
  DataStatus,
  GoogleCalendarLink,
  PendingMutation,
  UserProfile,
  UserSettings,
} from '../../types';

export interface AuthSession {
  user: UserProfile | null;
  /** Opaque access token, only present in cloud mode. Never persisted to disk. */
  accessToken: string | null;
}

export interface Subscription {
  unsubscribe(): void;
}

export interface DataProvider {
  readonly id: 'cloud' | 'device';
  readonly label: string;
  /** Human-readable explanation shown in Settings → Data. */
  readonly description: string;

  init(): Promise<void>;

  /* --- auth ------------------------------------------------------------- */
  getSession(): Promise<AuthSession | null>;
  onAuthChange(cb: (session: AuthSession | null) => void): Subscription;
  signInWithGoogle(): Promise<{ ok: boolean; error?: string }>;
  /** Local (device) sign-in — creates or resumes a real on-device account. */
  /** Local (device) sign-in. Resolves null when this provider has no local accounts. */
  signInLocally(input: { name: string; email: string }): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  /**
   * Patch the stored profile. `onboardingComplete` is included because the
   * provider owns the session object it emits: without it, a profile write
   * re-broadcasts a stale `onboardingComplete: false` and the app falls back
   * into onboarding forever.
   */
  updateProfile(
    patch: Partial<Pick<UserProfile, 'name' | 'avatarUrl' | 'onboardingComplete'>>,
  ): Promise<UserProfile | null>;
  /** Permanently deletes the account and every row it owns. Irreversible. */
  deleteAccount(): Promise<void>;

  /* --- events ----------------------------------------------------------- */
  listEvents(userId: string): Promise<CalEvent[]>;
  getEvent(userId: string, id: string): Promise<CalEvent | null>;
  upsertEvent(event: CalEvent): Promise<CalEvent>;
  deleteEvent(userId: string, id: string): Promise<void>;
  /** Bulk write used by drag-and-drop, AI batch actions and sync. */
  upsertEvents(events: CalEvent[]): Promise<CalEvent[]>;
  onEventsChange(userId: string, cb: (events: CalEvent[]) => void): Subscription;

  /* --- settings --------------------------------------------------------- */
  getSettings(userId: string): Promise<UserSettings | null>;
  saveSettings(userId: string, settings: UserSettings): Promise<UserSettings>;
  onSettingsChange(userId: string, cb: (s: UserSettings) => void): Subscription;

  /* --- AI chat history -------------------------------------------------- */
  listChat(userId: string): Promise<ChatMessage[]>;
  addChatMessage(msg: ChatMessage): Promise<ChatMessage>;
  updateChatMessage(msg: ChatMessage): Promise<void>;
  clearChat(userId: string): Promise<void>;
  onChatChange(userId: string, cb: (msgs: ChatMessage[]) => void): Subscription;

  /* --- offline outbox --------------------------------------------------- */
  listOutbox(): Promise<PendingMutation[]>;
  pushOutbox(m: PendingMutation): Promise<void>;
  removeOutbox(id: string): Promise<void>;

  /* --- Google Calendar link (optional feature) -------------------------- */
  getGoogleLink(userId: string): Promise<GoogleCalendarLink>;
  saveGoogleLink(userId: string, link: GoogleCalendarLink): Promise<void>;

  /* --- status ----------------------------------------------------------- */
  getStatus(): DataStatus;
  onStatusChange(cb: (s: DataStatus) => void): Subscription;
  /** Flush the outbox now. Resolves with the number of mutations applied. */
  flush(): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Row mapping (camelCase in TS ⇄ snake_case in Postgres)                      */
/* -------------------------------------------------------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function eventFromRow(row: any): CalEvent {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? '',
    description: row.description ?? '',
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: !!row.all_day,
    timezone: row.timezone ?? 'UTC',
    location: row.location ?? '',
    categoryId: row.category_id ?? 'personal',
    reminders: Array.isArray(row.reminders) ? row.reminders.map(Number) : [],
    recurrence: row.recurrence ?? null,
    exceptions: Array.isArray(row.exceptions) ? row.exceptions : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: !!row.deleted,
    googleEventId: row.google_event_id ?? null,
    googleCalendarId: row.google_calendar_id ?? null,
    version: Number(row.version ?? 1),
  };
}

export function eventToRow(e: CalEvent): Record<string, unknown> {
  return {
    id: e.id,
    user_id: e.userId,
    title: e.title,
    description: e.description,
    start_time: e.startTime,
    end_time: e.endTime,
    all_day: e.allDay,
    timezone: e.timezone,
    location: e.location,
    category_id: e.categoryId,
    reminders: e.reminders,
    recurrence: e.recurrence,
    exceptions: e.exceptions,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    deleted: e.deleted,
    google_event_id: e.googleEventId ?? null,
    google_calendar_id: e.googleCalendarId ?? null,
    version: e.version,
  };
}

export function chatFromRow(row: any): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    content: row.content ?? '',
    createdAt: row.created_at,
    action: row.action ?? null,
    resolved: !!row.resolved,
    error: row.error ?? null,
  };
}

export function chatToRow(m: ChatMessage): Record<string, unknown> {
  return {
    id: m.id,
    user_id: m.userId,
    role: m.role,
    content: m.content,
    created_at: m.createdAt,
    action: m.action ?? null,
    resolved: !!m.resolved,
    error: m.error ?? null,
  };
}

/**
 * Last-Write-Wins merge keyed on `updated_at`, with `version` as the tiebreak.
 * Used whenever two devices edited the same event while one was offline.
 */
export function mergeEvent(local: CalEvent, remote: CalEvent): CalEvent {
  const lt = Date.parse(local.updatedAt);
  const rt = Date.parse(remote.updatedAt);
  if (rt > lt) return remote;
  if (lt > rt) return local;
  return remote.version >= local.version ? remote : local;
}
