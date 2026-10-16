/**
 * Local (on-device) provider.
 *
 * This is a real, durable store — IndexedDB — not an in-memory stub. Events
 * created here survive reloads, tab restarts, sign-out/sign-in, and browser
 * restarts. It is the default until Supabase credentials are supplied, and it
 * also serves as the offline cache for cloud mode.
 *
 * What it is NOT: a cross-device store, and not a Google account. The UI is
 * explicit about that with a persistent "On this device" badge plus a
 * one-tap path to connect Supabase. Nothing here fabricates calendar data —
 * a new account begins with zero events.
 */
import {
  DEFAULT_SETTINGS,
  type AuthProvider,
  type CalEvent,
  type ChatMessage,
  type DataStatus,
  type GoogleCalendarLink,
  type UserProfile,
  type UserSettings,
} from '../../types';
import { newId } from '../utils';
import {
  idbClearChat,
  idbDeleteEvent,
  idbDeleteMeta,
  idbDeleteOutbox,
  idbGetAccount,
  idbGetMeta,
  idbGetSettings,
  idbListChat,
  idbListEvents,
  idbListOutbox,
  idbPutAccount,
  idbPutChat,
  idbPutEvent,
  idbPutEvents,
  idbPutMeta,
  idbPutOutbox,
  idbPutSettings,
  idbWipeUserData,
} from './idb';
import type { AuthSession, DataProvider } from './types';
import { mergeEvent } from './types';

const SESSION_KEY = 'planify:local:session';
const LINK_KEY = 'planify:local:gcal';

type Listener<T> = (v: T) => void;

function emit<T>(set: Set<Listener<T>>, value: T) {
  set.forEach((fn) => {
    try {
      fn(value);
    } catch (err) {
      console.error('[planify:local] listener threw', err);
    }
  });
}

export function createLocalProvider(): DataProvider {
  let session: AuthSession | null = null;
  const authListeners = new Set<Listener<AuthSession | null>>();
  const eventListeners = new Map<string, Set<Listener<CalEvent[]>>>();
  const settingsListeners = new Map<string, Set<Listener<UserSettings>>>();
  const chatListeners = new Map<string, Set<Listener<ChatMessage[]>>>();
  const statusListeners = new Set<Listener<DataStatus>>();

  let status: DataStatus = {
    state: 'idle',
    pending: 0,
    lastSyncedAt: null,
    message: null,
    mode: 'device',
  };

  function setStatus(patch: Partial<DataStatus>) {
    status = { ...status, ...patch };
    emit(statusListeners, status);
  }

  async function refreshOutboxCount() {
    const out = await idbListOutbox();
    if (out.length !== status.pending) setStatus({ pending: out.length });
  }

  async function notifyEvents(userId: string) {
    const set = eventListeners.get(userId);
    if (!set?.size) return;
    emit(set, await idbListEvents(userId));
  }

  async function notifyChat(userId: string) {
    const set = chatListeners.get(userId);
    if (!set?.size) return;
    emit(set, await idbListChat(userId));
  }

  return {
    id: 'device',
    label: 'On this device',
    description:
      'Your calendar is stored securely in this browser (IndexedDB). It works fully offline and survives reloads, but it will not appear on your other devices until you connect a cloud database.',

    async init() {
      const stored = await idbGetMeta<AuthSession>(SESSION_KEY);
      if (stored?.user) {
        const fresh = await idbGetAccount().catch(() => null);
        session = fresh ? { user: fresh, accessToken: null } : stored;
      }
      await refreshOutboxCount();
      setStatus({ state: 'idle', mode: 'device' });
    },

    async getSession() {
      return session;
    },

    onAuthChange(cb) {
      authListeners.add(cb);
      return {
        unsubscribe: () => authListeners.delete(cb),
      };
    },

    async signInWithGoogle() {
      // Google OAuth requires a configured OAuth client and a cloud backend to
      // exchange the code. We refuse rather than pretending it worked.
      return {
        ok: false,
        error:
          'Google sign-in needs a cloud backend. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see README → “Going live”), then reload. Until then you can continue with an on-device account.',
      };
    },

    async signInLocally({ name, email }) {
      const existing = await idbGetAccount();
      const now = new Date().toISOString();
      const provider: AuthProvider = 'local';

      let user: UserProfile;
      if (existing && existing.provider === 'local') {
        user = {
          ...existing,
          name: name.trim() || existing.name,
          email: email.trim().toLowerCase() || existing.email,
          lastSeenAt: now,
        };
      } else {
        user = {
          id: newId('usr'),
          email: email.trim().toLowerCase(),
          name: name.trim(),
          avatarUrl: null,
          provider,
          createdAt: now,
          lastSeenAt: now,
          onboardingComplete: false,
        };
      }

      await idbPutAccount(user);
      // Every new account starts with an empty calendar. No seeding, ever.
      const existingSettings = await idbGetSettings(user.id);
      if (!existingSettings) {
        await idbPutSettings(user.id, {
          ...DEFAULT_SETTINGS,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
      }
      session = { user, accessToken: null };
      await idbPutMeta(SESSION_KEY, session);
      emit(authListeners, session);
      return session;
    },

    async signOut() {
      session = null;
      await idbDeleteMeta(SESSION_KEY);
      emit(authListeners, null);
    },

    async updateProfile(patch) {
      if (!session?.user) return null;
      const user: UserProfile = { ...session.user, ...patch };
      await idbPutAccount(user);
      session = { user, accessToken: null };
      await idbPutMeta(SESSION_KEY, session);
      emit(authListeners, session);
      return user;
    },

    async deleteAccount() {
      const userId = session?.user?.id;
      if (userId) {
        // idbWipeUserData removes the events, chat, settings and profile row.
        await idbWipeUserData(userId);
      }
      await idbDeleteMeta(SESSION_KEY);
      await idbDeleteMeta(LINK_KEY);
      session = null;
      emit(authListeners, null);
    },

    async listEvents(userId) {
      return idbListEvents(userId);
    },

    async getEvent(_userId, id) {
      const rows = await idbListEvents(_userId);
      return rows.find((r) => r.id === id) ?? null;
    },

    async upsertEvent(event) {
      const existing = (await idbListEvents(event.userId)).find((e) => e.id === event.id);
      const merged = existing ? mergeEvent(existing, event) : event;
      await idbPutEvent(merged);
      await notifyEvents(merged.userId);
      return merged;
    },

    async deleteEvent(userId, id) {
      // Hard delete locally; the tombstone path is used by cloud mode so that
      // removals propagate to other signed-in devices.
      await idbDeleteEvent(id);
      await notifyEvents(userId);
    },

    async upsertEvents(events) {
      if (!events.length) return [];
      await idbPutEvents(events);
      const userIds = [...new Set(events.map((e) => e.userId))];
      await Promise.all(userIds.map(notifyEvents));
      return events;
    },

    onEventsChange(userId, cb) {
      let set = eventListeners.get(userId);
      if (!set) {
        set = new Set();
        eventListeners.set(userId, set);
      }
      set.add(cb);
      return {
        unsubscribe: () => {
          set?.delete(cb);
        },
      };
    },

    async getSettings(userId) {
      return idbGetSettings(userId);
    },

    async saveSettings(userId, settings) {
      await idbPutSettings(userId, settings);
      emit(settingsListeners.get(userId) ?? new Set<Listener<UserSettings>>(), settings);
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
      return idbListChat(userId);
    },

    async addChatMessage(msg) {
      await idbPutChat(msg);
      await notifyChat(msg.userId);
      return msg;
    },

    async updateChatMessage(msg) {
      await idbPutChat(msg);
      await notifyChat(msg.userId);
    },

    async clearChat(userId) {
      await idbClearChat(userId);
      await notifyChat(userId);
    },

    onChatChange(userId, cb) {
      let set = chatListeners.get(userId);
      if (!set) {
        set = new Set();
        chatListeners.set(userId, set);
      }
      set.add(cb);
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
      await refreshOutboxCount();
    },

    async removeOutbox(id) {
      await idbDeleteOutbox(id);
      await refreshOutboxCount();
    },

    async getGoogleLink() {
      return (
        (await idbGetMeta<GoogleCalendarLink>(LINK_KEY)) ?? {
          connected: false,
          status: 'idle',
          lastSyncAt: null,
          mode: 'two-way',
          scopesGranted: [],
          message: 'Google Calendar sync requires a cloud backend.',
        }
      );
    },

    async saveGoogleLink(_userId, link) {
      await idbPutMeta(LINK_KEY, link);
    },

    getStatus() {
      return status;
    },

    onStatusChange(cb) {
      statusListeners.add(cb);
      return { unsubscribe: () => statusListeners.delete(cb) };
    },

    async flush() {
      // Everything already lives on-device; nothing to push.
      setStatus({ state: 'idle', pending: 0, lastSyncedAt: new Date().toISOString() });
      return 0;
    },
  };
}
