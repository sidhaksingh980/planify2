/**
 * Supabase cloud provider.
 *
 * Activated when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are present.
 * Gives you:
 *   • Google OAuth (Supabase Auth → Google provider, PKCE flow)
 *   • Postgres storage with Row Level Security on every table
 *   • Realtime `postgres_changes` subscriptions → true cross-device sync
 *   • An IndexedDB mirror so the calendar still renders offline, with an
 *     outbox that replays writes when the connection returns.
 *
 * Security notes:
 *   – The anon key is a *publishable* key; authorisation is enforced by RLS
 *     (`supabase/migrations/0001_init.sql`), never by key secrecy.
 *   – Access/refresh tokens are handled by supabase-js and kept in memory +
 *     its own storage. We never write a Google password or raw OAuth token
 *     into our tables.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_SETTINGS,
  type CalEvent,
  type ChatMessage,
  type DataStatus,
  type GoogleCalendarLink,
  type PendingMutation,
  type UserProfile,
  type UserSettings,
} from '../../types';
import { newId } from '../utils';
import {
  idbDeleteOutbox,
  idbListEvents,
  idbListOutbox,
  idbPutEvent,
  idbPutEvents,
  idbPutOutbox,
  idbPutSettings,
  idbGetSettings,
  idbListChat,
  idbPutChat,
  idbClearChat,
} from './idb';
import type { AuthSession, DataProvider } from './types';
import { chatFromRow, chatToRow, eventFromRow, eventToRow, mergeEvent } from './types';

type Listener<T> = (v: T) => void;

function emit<T>(set: Set<Listener<T>>, value: T) {
  set.forEach((fn) => {
    try {
      fn(value);
    } catch (err) {
      console.error('[planify:cloud] listener threw', err);
    }
  });
}

export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  if (!/^https:\/\/.+/i.test(url)) return null;
  return { url, anonKey };
}

export function createCloudProvider(url: string, anonKey: string): DataProvider {
  const supabase: SupabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'planify:sb',
    },
    realtime: { params: { eventsPerSecond: 8 } },
  });

  let status: DataStatus = {
    state: 'idle',
    pending: 0,
    lastSyncedAt: null,
    message: null,
    mode: 'cloud',
  };

  const statusListeners = new Set<Listener<DataStatus>>();
  const authListeners = new Set<Listener<AuthSession | null>>();
  const eventListeners = new Map<string, Set<Listener<CalEvent[]>>>();
  const settingsListeners = new Map<string, Set<Listener<UserSettings>>>();
  const chatListeners = new Map<string, Set<Listener<ChatMessage[]>>>();
  const channels = new Map<string, RealtimeChannel>();

  function setStatus(patch: Partial<DataStatus>) {
    status = { ...status, ...patch };
    emit(statusListeners, status);
  }

  function online(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  async function profileFromSession(
    userId: string,
    email: string | undefined,
    meta: Record<string, unknown> | undefined,
  ): Promise<UserProfile> {
    const now = new Date().toISOString();
    // Upsert the profile row so account deletion and settings have a home.
    const name =
      ((meta?.full_name as string) ||
        (meta?.name as string) ||
        (email ? email.split('@')[0] : '') ||
        'Planify user').trim();
    const avatar =
      (meta?.avatar_url as string) ||
      (meta?.picture as string) ||
      null;

    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: userId,
          email: email ?? '',
          name,
          avatar_url: avatar,
          provider: 'google',
          last_seen_at: now,
        },
        { onConflict: 'id' },
      )
      .select('*')
      .single();

    if (error && error.code !== '23505') {
      console.warn('[planify:cloud] profile upsert failed', error.message);
    }

    const { data: row } = await supabase.from('profiles').select('*').eq('id', userId).single();

    return {
      id: userId,
      email: row?.email ?? email ?? '',
      name: row?.name ?? name,
      avatarUrl: row?.avatar_url ?? avatar,
      provider: (row?.provider as UserProfile['provider']) ?? 'google',
      createdAt: row?.created_at ?? now,
      lastSeenAt: row?.last_seen_at ?? now,
      onboardingComplete: !!row?.onboarding_complete,
    };
  }

  async function toSession(): Promise<AuthSession | null> {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s?.user) return null;
    const profile = await profileFromSession(
      s.user.id,
      s.user.email,
      (s.user.user_metadata ?? {}) as Record<string, unknown>,
    );
    return { user: profile, accessToken: s.access_token };
  }

  /** Queue a write for later when we are offline or the request failed. */
  async function enqueue(m: Omit<PendingMutation, 'id' | 'createdAt' | 'attempts'>) {
    const mutation: PendingMutation = {
      ...m,
      id: newId('mut'),
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await idbPutOutbox(mutation);
    setStatus({ state: 'offline', pending: (await idbListOutbox()).length });
  }

  function subscribeRealtime(userId: string) {
    const key = `events:${userId}`;
    if (channels.has(key)) return;
    const channel = supabase
      .channel(key, { config: { broadcast: { self: false } } })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${userId}` },
        async () => {
          const { data, error } = await supabase
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .order('start_time', { ascending: true });
          if (error) {
            setStatus({ state: 'error', message: error.message });
            return;
          }
          const events = (data ?? []).map(eventFromRow);
          // Mirror to IndexedDB so an offline reload still has the calendar.
          await idbPutEvents(events).catch(() => undefined);
          emit(eventListeners.get(userId) ?? new Set<Listener<CalEvent[]>>(), events);
          setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString(), message: null });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
        async (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined;
          if (!row) return;
          const s: UserSettings = {
            ...DEFAULT_SETTINGS,
            themeMode: (row.theme_mode as UserSettings['themeMode']) ?? DEFAULT_SETTINGS.themeMode,
            firstDayOfWeek: ((row.first_day_of_week as number) ?? DEFAULT_SETTINGS.firstDayOfWeek) as UserSettings['firstDayOfWeek'],
            timeFormat: (row.time_format as UserSettings['timeFormat']) ?? DEFAULT_SETTINGS.timeFormat,
            defaultReminderMinutes: (row.default_reminder_minutes as number) ?? DEFAULT_SETTINGS.defaultReminderMinutes,
            timezone: (row.timezone as string) ?? DEFAULT_SETTINGS.timezone,
            dayStartHour: (row.day_start_hour as number) ?? DEFAULT_SETTINGS.dayStartHour,
            weekViewDays: (row.week_view_days as 5 | 7) ?? DEFAULT_SETTINGS.weekViewDays,
            defaultCategoryId: (row.default_category_id as string) ?? DEFAULT_SETTINGS.defaultCategoryId,
            reduceMotion: !!row.reduce_motion,
            notificationsEnabled: !!row.notifications_enabled,
            accentHue: (row.accent_hue as number) ?? DEFAULT_SETTINGS.accentHue,
          };
          await idbPutSettings(userId, s).catch(() => undefined);
          emit(settingsListeners.get(userId) ?? new Set<Listener<UserSettings>>(), s);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${userId}` },
        async () => {
          const { data } = await supabase
            .from('chat_messages')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
          const msgs = (data ?? []).map(chatFromRow);
          emit(chatListeners.get(userId) ?? new Set<Listener<ChatMessage[]>>(), msgs);
        },
      )
      .subscribe();
    channels.set(key, channel);
  }

  async function flushOutbox(): Promise<number> {
    const queue = await idbListOutbox();
    if (!queue.length) {
      setStatus({ state: 'idle', pending: 0 });
      return 0;
    }
    if (!online()) {
      setStatus({ state: 'offline', pending: queue.length });
      return 0;
    }
    setStatus({ state: 'syncing', pending: queue.length });
    let applied = 0;

    for (const m of queue.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
      try {
        if (m.entity === 'event') {
          if (m.op === 'delete') {
            const { error } = await supabase
              .from('events')
              .update({ deleted: true, updated_at: new Date().toISOString(), version: 999_999 })
              .eq('id', (m.payload as CalEvent).id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('events')
              .upsert(eventToRow(m.payload as CalEvent), { onConflict: 'id' });
            if (error) throw error;
          }
        } else if (m.entity === 'settings') {
          const s = m.payload as UserSettings & { userId?: string };
          const userId = s.userId ?? m.userId;
          const { error } = await supabase
            .from('user_settings')
            .upsert(
              {
                user_id: userId,
                theme_mode: s.themeMode,
                first_day_of_week: s.firstDayOfWeek,
                time_format: s.timeFormat,
                default_reminder_minutes: s.defaultReminderMinutes,
                timezone: s.timezone,
                day_start_hour: s.dayStartHour,
                week_view_days: s.weekViewDays,
                default_category_id: s.defaultCategoryId,
                reduce_motion: s.reduceMotion,
                notifications_enabled: s.notificationsEnabled,
                accent_hue: s.accentHue,
              },
              { onConflict: 'user_id' },
            );
          if (error) throw error;
        } else if (m.entity === 'chat') {
          const { error } = await supabase
            .from('chat_messages')
            .upsert(chatToRow(m.payload as ChatMessage), { onConflict: 'id' });
          if (error) throw error;
        }
        await idbDeleteOutbox(m.id);
        applied += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus({ state: 'error', message: msg });
        // Stop at the first failure to preserve ordering.
        break;
      }
    }

    const remaining = await idbListOutbox();
    setStatus({
      state: remaining.length ? 'error' : 'idle',
      pending: remaining.length,
      lastSyncedAt: applied ? new Date().toISOString() : status.lastSyncedAt,
    });
    return applied;
  }

  window.addEventListener('online', () => {
    void flushOutbox();
  });
  window.addEventListener('offline', () => {
    setStatus({ state: 'offline', message: 'You are offline. Changes are saved on this device and will sync automatically.' });
  });

  return {
    id: 'cloud',
    label: 'Planify Cloud',
    description:
      'Your calendar is stored in your own Supabase Postgres database, protected by Row Level Security, and synced in realtime to every device you sign in on.',

    async init() {
      supabase.auth.onAuthStateChange((event, s) => {
        if (event === 'SIGNED_IN' && s?.user) {
          void toSession().then((sess) => {
            emit(authListeners, sess);
            if (sess?.user) subscribeRealtime(sess.user.id);
          });
        } else if (event === 'SIGNED_OUT') {
          channels.forEach((c) => void supabase.removeChannel(c));
          channels.clear();
          emit(authListeners, null);
        } else if (event === 'TOKEN_REFRESHED') {
          void toSession().then((sess) => emit(authListeners, sess));
        }
      });
      const sess = await toSession();
      if (sess?.user) subscribeRealtime(sess.user.id);
      await flushOutbox();
    },

    async getSession() {
      return toSession();
    },

    onAuthChange(cb) {
      authListeners.add(cb);
      return { unsubscribe: () => authListeners.delete(cb) };
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Minimum scope: identity only. Calendar scope is requested later and
          // separately, only if the user opts in to Google Calendar sync.
          scopes: 'openid email profile',
          redirectTo: `${window.location.origin}${window.location.pathname}`,
          skipBrowserRedirect: false,
        },
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },

    async signInLocally() {
      // Cloud mode authenticates through Google. Returning null is honest:
      // there is no local account concept once a cloud project is attached.
      console.warn(
        '[planify] cloud mode uses Google sign-in; remove the Supabase env vars to use an on-device account.',
      );
      return null;
    },

    async signOut() {
      await supabase.auth.signOut();
      channels.forEach((c) => void supabase.removeChannel(c));
      channels.clear();
      emit(authListeners, null);
    },

    async updateProfile(patch) {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return null;
      const columns: Record<string, unknown> = {};
      if (patch.name !== undefined) columns.name = patch.name;
      if (patch.avatarUrl !== undefined) columns.avatar_url = patch.avatarUrl;
      if (patch.onboardingComplete !== undefined) {
        columns.onboarding_complete = patch.onboardingComplete;
      }
      if (Object.keys(columns).length === 0) return toSession().then((s) => s?.user ?? null);
      const { error } = await supabase.from('profiles').update(columns).eq('id', userId);
      if (error) throw new Error(error.message);
      return toSession().then((s) => s?.user ?? null);
    },

    async deleteAccount() {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;
      // `delete_account()` is a SECURITY DEFINER function in the migration that
      // removes every row owned by the user and then the profile itself.
      const { error } = await supabase.rpc('delete_account');
      if (error) throw new Error(error.message);
      await supabase.auth.signOut();
      emit(authListeners, null);
    },

    async listEvents(userId) {
      if (!online()) return idbListEvents(userId);
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('user_id', userId)
        .eq('deleted', false)
        .order('start_time', { ascending: true });
      if (error) {
        setStatus({ state: 'error', message: error.message });
        return idbListEvents(userId);
      }
      const events = (data ?? []).map(eventFromRow);
      await idbPutEvents(events).catch(() => undefined);
      setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString(), message: null });
      return events;
    },

    async getEvent(userId, id) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('user_id', userId)
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return eventFromRow(data);
    },

    async upsertEvent(event) {
      const cached = (await idbListEvents(event.userId)).find((e) => e.id === event.id);
      const merged = cached ? mergeEvent(cached, event) : event;
      await idbPutEvent(merged).catch(() => undefined);
      if (!online()) {
        await enqueue({ userId: event.userId, entity: 'event', op: 'upsert', payload: merged });
        return merged;
      }
      const { error } = await supabase
        .from('events')
        .upsert(eventToRow(merged), { onConflict: 'id' });
      if (error) {
        setStatus({ state: 'error', message: error.message });
        await enqueue({ userId: event.userId, entity: 'event', op: 'upsert', payload: merged });
        return merged;
      }
      setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString(), message: null });
      return merged;
    },

    async deleteEvent(userId, id) {
      // Tombstone, not hard delete: other devices need to learn about removal.
      await supabase
        .from('events')
        .update({ deleted: true, updated_at: new Date().toISOString(), version: 999_999 })
        .eq('id', id)
        .eq('user_id', userId)
        .then(async ({ error }) => {
          if (error || !online()) {
            await enqueue({
              userId,
              entity: 'event',
              op: 'delete',
              payload: { id } as unknown as CalEvent,
            });
          }
        });
    },

    async upsertEvents(events) {
      if (!events.length) return [];
      await idbPutEvents(events).catch(() => undefined);
      if (!online()) {
        for (const e of events) {
          await enqueue({ userId: e.userId, entity: 'event', op: 'upsert', payload: e });
        }
        return events;
      }
      const { error } = await supabase
        .from('events')
        .upsert(events.map(eventToRow), { onConflict: 'id' });
      if (error) {
        setStatus({ state: 'error', message: error.message });
        for (const e of events) {
          await enqueue({ userId: e.userId, entity: 'event', op: 'upsert', payload: e });
        }
        return events;
      }
      setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString(), message: null });
      return events;
    },

    onEventsChange(userId, cb) {
      let set = eventListeners.get(userId);
      if (!set) {
        set = new Set();
        eventListeners.set(userId, set);
      }
      set.add(cb);
      subscribeRealtime(userId);
      return {
        unsubscribe: () => {
          set?.delete(cb);
        },
      };
    },

    async getSettings(userId) {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data) {
        const fallback = (await idbGetSettings(userId)) ?? DEFAULT_SETTINGS;
        return fallback;
      }
      const s: UserSettings = {
        themeMode: (data.theme_mode as UserSettings['themeMode']) ?? DEFAULT_SETTINGS.themeMode,
        firstDayOfWeek: ((data.first_day_of_week as number) ?? DEFAULT_SETTINGS.firstDayOfWeek) as UserSettings['firstDayOfWeek'],
        timeFormat: (data.time_format as UserSettings['timeFormat']) ?? DEFAULT_SETTINGS.timeFormat,
        defaultReminderMinutes:
          (data.default_reminder_minutes as number) ?? DEFAULT_SETTINGS.defaultReminderMinutes,
        timezone: (data.timezone as string) ?? DEFAULT_SETTINGS.timezone,
        dayStartHour: (data.day_start_hour as number) ?? DEFAULT_SETTINGS.dayStartHour,
        weekViewDays: (data.week_view_days as 5 | 7) ?? DEFAULT_SETTINGS.weekViewDays,
        defaultCategoryId:
          (data.default_category_id as string) ?? DEFAULT_SETTINGS.defaultCategoryId,
        reduceMotion: !!data.reduce_motion,
        notificationsEnabled: !!data.notifications_enabled,
        accentHue: (data.accent_hue as number) ?? DEFAULT_SETTINGS.accentHue,
      };
      await idbPutSettings(userId, s).catch(() => undefined);
      return s;
    },

    async saveSettings(userId, settings) {
      await idbPutSettings(userId, settings).catch(() => undefined);
      emit(settingsListeners.get(userId) ?? new Set<Listener<UserSettings>>(), settings);
      if (!online()) {
        await enqueue({ userId, entity: 'settings', op: 'upsert', payload: { ...settings, userId } });
        return settings;
      }
      const { error } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: userId,
            theme_mode: settings.themeMode,
            first_day_of_week: settings.firstDayOfWeek,
            time_format: settings.timeFormat,
            default_reminder_minutes: settings.defaultReminderMinutes,
            timezone: settings.timezone,
            day_start_hour: settings.dayStartHour,
            week_view_days: settings.weekViewDays,
            default_category_id: settings.defaultCategoryId,
            reduce_motion: settings.reduceMotion,
            notifications_enabled: settings.notificationsEnabled,
            accent_hue: settings.accentHue,
          },
          { onConflict: 'user_id' },
        );
      if (error) {
        setStatus({ state: 'error', message: error.message });
        await enqueue({ userId, entity: 'settings', op: 'upsert', payload: { ...settings, userId } });
      }
      return settings;
    },

    onSettingsChange(userId, cb) {
      let set = settingsListeners.get(userId);
      if (!set) {
        set = new Set();
        settingsListeners.set(userId, set);
      }
      set.add(cb);
      return {
        unsubscribe: () => {
          set?.delete(cb);
        },
      };
    },

    async listChat(userId) {
      if (!online()) return idbListChat(userId);
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(400);
      if (error || !data) return idbListChat(userId);
      return data.map(chatFromRow);
    },

    async addChatMessage(msg) {
      await idbPutChat(msg).catch(() => undefined);
      if (!online()) {
        await enqueue({ userId: msg.userId, entity: 'chat', op: 'upsert', payload: msg });
        return msg;
      }
      const { error } = await supabase
        .from('chat_messages')
        .upsert(chatToRow(msg), { onConflict: 'id' });
      if (error) await enqueue({ userId: msg.userId, entity: 'chat', op: 'upsert', payload: msg });
      return msg;
    },

    async updateChatMessage(msg) {
      await idbPutChat(msg).catch(() => undefined);
      if (!online()) {
        await enqueue({ userId: msg.userId, entity: 'chat', op: 'upsert', payload: msg });
        return;
      }
      const { error } = await supabase
        .from('chat_messages')
        .upsert(chatToRow(msg), { onConflict: 'id' });
      if (error) await enqueue({ userId: msg.userId, entity: 'chat', op: 'upsert', payload: msg });
    },

    async clearChat(userId) {
      await idbClearChat(userId).catch(() => undefined);
      if (!online()) return;
      await supabase.from('chat_messages').delete().eq('user_id', userId);
    },

    onChatChange(userId, cb) {
      let set = chatListeners.get(userId);
      if (!set) {
        set = new Set();
        chatListeners.set(userId, set);
      }
      set.add(cb);
      subscribeRealtime(userId);
      return {
        unsubscribe: () => {
          set?.delete(cb);
        },
      };
    },

    async listOutbox() {
      return idbListOutbox();
    },

    async pushOutbox(m) {
      await idbPutOutbox(m);
      setStatus({ pending: (await idbListOutbox()).length });
    },

    async removeOutbox(id) {
      await idbDeleteOutbox(id);
      setStatus({ pending: (await idbListOutbox()).length });
    },

    async getGoogleLink(userId) {
      const { data } = await supabase
        .from('google_calendar_links')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (!data) {
        return {
          connected: false,
          status: 'idle' as const,
          lastSyncAt: null,
          mode: 'two-way' as const,
          scopesGranted: [],
          message: null,
        };
      }
      return {
        connected: !!data.connected,
        email: data.email ?? undefined,
        calendarId: data.calendar_id ?? undefined,
        status: (data.status as GoogleCalendarLink['status']) ?? 'idle',
        lastSyncAt: data.last_sync_at ?? null,
        mode: (data.mode as GoogleCalendarLink['mode']) ?? 'two-way',
        scopesGranted: (data.scopes_granted as string[]) ?? [],
        message: data.message ?? null,
      };
    },

    async saveGoogleLink(userId, link) {
      await supabase.from('google_calendar_links').upsert(
        {
          user_id: userId,
          connected: link.connected,
          email: link.email ?? null,
          calendar_id: link.calendarId ?? null,
          status: link.status,
          last_sync_at: link.lastSyncAt,
          mode: link.mode,
          scopes_granted: link.scopesGranted,
          message: link.message ?? null,
        },
        { onConflict: 'user_id' },
      );
    },

    getStatus() {
      return status;
    },

    onStatusChange(cb) {
      statusListeners.add(cb);
      return { unsubscribe: () => statusListeners.delete(cb) };
    },

    async flush() {
      return flushOutbox();
    },
  };
}
