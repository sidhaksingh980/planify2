/**
 * AppStore — the single source of truth for session, settings, events, chat and
 * sync status.
 *
 * Write path (this is what makes "every event appears on both devices" true):
 *
 *   1. Optimistically update local state so the UI responds in the same frame.
 *   2. Mirror to IndexedDB so a reload — even offline — shows the truth.
 *   3. Push to the provider. In cloud mode that's a Postgres upsert; the
 *      Realtime subscription then delivers the row to every other signed-in
 *      device. Offline, the write is queued in the outbox and replayed on
 *      reconnect, ordered by timestamp.
 *
 * Read path: the provider emits the full event list on every change (Realtime
 * in cloud mode, an IndexedDB observer locally). Remote writes therefore land
 * in the UI without a refresh.
 *
 * Nothing here creates an event that the user did not ask for.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { initProvider, type AuthSession, type DataProvider, type Subscription } from '../lib/providers';
import {
  DEFAULT_SETTINGS,
  type CalEvent,
  type ChatMessage,
  type DataStatus,
  type GoogleCalendarLink,
  type UserProfile,
  type UserSettings,
} from '../types';
import { announce } from '../lib/utils';
import { idbListEvents, idbPutEvents } from '../lib/providers/idb';

export interface AppStoreValue {
  /** True once the provider has resolved and the session has been read. */
  ready: boolean;
  /** Null only before `ready`; every screen is gated on `ready`. */
  provider: DataProvider | null;

  user: UserProfile | null;
  authLoading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<{ ok: boolean; error?: string }>;
  signInLocally: (input: { name: string; email: string }) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  completeOnboarding: () => Promise<void>;

  settings: UserSettings;
  settingsLoaded: boolean;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;

  events: CalEvent[];
  eventsLoading: boolean;
  eventsError: string | null;
  createEvent: (draft: Partial<CalEvent>) => Promise<CalEvent>;
  updateEvent: (id: string, patch: Partial<CalEvent>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  duplicateEvent: (id: string) => Promise<CalEvent | null>;
  bulkUpdate: (patches: Array<{ id: string; patch: Partial<CalEvent> }>) => Promise<void>;

  status: DataStatus;
  retrySync: () => Promise<void>;

  chat: ChatMessage[];
  addChatMessage: (m: ChatMessage) => Promise<void>;
  updateChatMessage: (m: ChatMessage) => Promise<void>;
  clearChat: () => Promise<void>;

  googleLink: GoogleCalendarLink;
  setGoogleLink: (link: GoogleCalendarLink) => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error('useAppStore must be used inside <AppStoreProvider>');
  return ctx;
}

/** Stamp the fields the UI never sets by hand. */
function finalize(draft: Partial<CalEvent>, userId: string, existing?: CalEvent): CalEvent {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? draft.id ?? cryptoId(),
    userId,
    title: (draft.title ?? existing?.title ?? '').trim() || 'Untitled event',
    description: draft.description ?? existing?.description ?? '',
    startTime: draft.startTime ?? existing?.startTime ?? now,
    endTime: draft.endTime ?? existing?.endTime ?? now,
    allDay: draft.allDay ?? existing?.allDay ?? false,
    timezone: draft.timezone ?? existing?.timezone ?? DEFAULT_SETTINGS.timezone,
    location: draft.location ?? existing?.location ?? '',
    categoryId: draft.categoryId ?? existing?.categoryId ?? DEFAULT_SETTINGS.defaultCategoryId,
    reminders: draft.reminders ?? existing?.reminders ?? [],
    recurrence: draft.recurrence !== undefined ? draft.recurrence : (existing?.recurrence ?? null),
    exceptions: draft.exceptions ?? existing?.exceptions ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deleted: false,
    googleEventId: draft.googleEventId ?? existing?.googleEventId ?? null,
    googleCalendarId: draft.googleCalendarId ?? existing?.googleCalendarId ?? null,
    version: (existing?.version ?? 0) + 1,
  };
}

function cryptoId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID
    ? c.randomUUID()
    : `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<DataProvider | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [status, setStatus] = useState<DataStatus>({
    state: 'idle',
    pending: 0,
    lastSyncedAt: null,
    message: null,
    mode: 'device',
  });
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [googleLink, setGoogleLinkState] = useState<GoogleCalendarLink>({
    connected: false,
    status: 'idle',
    lastSyncAt: null,
    mode: 'two-way',
    scopesGranted: [],
  });

  const subsRef = useRef<Subscription[]>([]);
  const userIdRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    subsRef.current.forEach((s) => s.unsubscribe());
    subsRef.current = [];
  }, []);

  /* ---- boot ------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    const own: Subscription[] = [];

    (async () => {
      let resolved: DataProvider;
      try {
        resolved = await initProvider();
      } catch (err) {
        console.error('[planify] provider boot failed', err);
        if (!cancelled) {
          setAuthLoading(false);
          setReady(true);
        }
        return;
      }
      if (cancelled) return;

      setProvider(resolved);
      setStatus(resolved.getStatus());

      own.push(
        resolved.onAuthChange((session: AuthSession | null) => {
          if (cancelled) return;
          setUser((prev) => {
            const next = session?.user ?? null;
            if (!prev || !next) return next;
            if (prev.id !== next.id) return next;
            // Onboarding only ever moves forward. A provider that broadcasts a
            // profile row it has not yet re-read must not reopen onboarding.
            if (prev.onboardingComplete && !next.onboardingComplete) {
              return { ...next, onboardingComplete: true };
            }
            return next;
          });
          setAuthLoading(false);
          if (!session?.user) {
            setEvents([]);
            setChat([]);
            setSettingsLoaded(false);
          }
        }),
      );
      own.push(resolved.onStatusChange((next) => {
        if (!cancelled) setStatus(next);
      }));
      subsRef.current.push(...own);

      const session = await resolved.getSession().catch((err) => {
        console.error('[planify] getSession failed', err);
        return null;
      });
      if (cancelled) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      own.forEach((sub) => sub.unsubscribe());
      subsRef.current = subsRef.current.filter((sub) => !own.includes(sub));
      teardown();
    };
  }, [teardown]);

  /* ---- per-user subscriptions ------------------------------------------- */
  useEffect(() => {
    if (!provider || !user?.id) {
      userIdRef.current = null;
      return;
    }
    if (userIdRef.current === user.id && settingsLoaded) return;
    userIdRef.current = user.id;

    let active = true;
    const subs: Subscription[] = [];

    (async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        // Cache first (instant paint, works offline), then network.
        const cached = await idbListEvents(user.id).catch(() => [] as CalEvent[]);
        if (active && cached.length) setEvents(cached.filter((e) => !e.deleted));

        const fresh = await provider.listEvents(user.id);
        if (!active) return;
        setEvents(fresh.filter((e) => !e.deleted));
        await idbPutEvents(fresh).catch(() => undefined);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not load your events.';
        console.error('[planify] listEvents failed', err);
        if (active) setEventsError(msg);
      } finally {
        if (active) setEventsLoading(false);
      }

      if (!active) return;
      try {
        const s = await provider.getSettings(user.id);
        if (active && s) {
          setSettings(s);
          setSettingsLoaded(true);
        } else if (active) {
          setSettings({
            ...DEFAULT_SETTINGS,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          });
          setSettingsLoaded(true);
        }
      } catch (err) {
        console.error('[planify] getSettings failed', err);
        if (active) setSettingsLoaded(true);
      }

      if (!active) return;
      try {
        const msgs = await provider.listChat(user.id);
        if (active) setChat(msgs);
      } catch (err) {
        console.error('[planify] listChat failed', err);
      }

      if (!active) return;
      try {
        const link = await provider.getGoogleLink(user.id);
        if (active) setGoogleLinkState(link);
      } catch (err) {
        console.error('[planify] getGoogleLink failed', err);
      }
    })();

    subs.push(
      provider.onEventsChange(user.id, (next) => {
        if (!active) return;
        setEvents(next.filter((e) => !e.deleted));
        setEventsError(null);
      }),
    );
    subs.push(
      provider.onSettingsChange(user.id, (s) => {
        if (active) setSettings(s);
      }),
    );
    subs.push(
      provider.onChatChange(user.id, (msgs) => {
        if (active) setChat(msgs);
      }),
    );
    subsRef.current.push(...subs);

    return () => {
      active = false;
      subs.forEach((s) => s.unsubscribe());
      subsRef.current = subsRef.current.filter((s) => !subs.includes(s));
    };
    // settingsLoaded intentionally excluded: re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, provider]);

  /* ---- re-sync when the tab regains focus or the network returns --------- */
  useEffect(() => {
    if (!provider || !user?.id) return;
    const sync = async () => {
      try {
        await provider.flush();
        const fresh = await provider.listEvents(user.id);
        setEvents(fresh.filter((e) => !e.deleted));
      } catch (err) {
        console.warn('[planify] background sync failed', err);
      }
    };
    const onOnline = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id, provider]);

  /* ---- actions ----------------------------------------------------------- */

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!provider) {
      setAuthLoading(false);
      return { ok: false, error: 'Planify is still starting up. Try again in a moment.' };
    }
    setAuthLoading(true);
    const res = await provider.signInWithGoogle().catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : 'Sign-in failed',
    }));
    if (!res.ok) {
      setAuthError(res.error ?? 'Sign-in failed');
      setAuthLoading(false);
    }
    return res;
  }, [provider]);

  const signInLocally = useCallback(
    async (input: { name: string; email: string }) => {
      if (!provider) return;
      setAuthError(null);
      setAuthLoading(true);
      try {
        const session = await provider.signInLocally(input);
        if (!session?.user) {
          const msg =
            'Cloud mode uses Google sign-in. Remove the Supabase environment variables to use an on-device account.';
          setAuthError(msg);
          throw new Error(msg);
        }
        setUser(session.user);
        announce(`Signed in as ${session.user.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not start a device session';
        setAuthError(msg);
        throw err;
      } finally {
        setAuthLoading(false);
      }
    },
    [provider],
  );

  const signOut = useCallback(async () => {
    teardown();
    await provider?.signOut();
    setUser(null);
    setEvents([]);
    setChat([]);
    setSettings(DEFAULT_SETTINGS);
    setSettingsLoaded(false);
    announce('Signed out');
  }, [provider, teardown]);

  const deleteAccount = useCallback(async () => {
    teardown();
    await provider?.deleteAccount();
    setUser(null);
    setEvents([]);
    setChat([]);
    setSettings(DEFAULT_SETTINGS);
    setSettingsLoaded(false);
    announce('Account and all data deleted');
  }, [provider, teardown]);

  const completeOnboarding = useCallback(async () => {
    if (!provider || !user) return;
    const next: UserProfile = { ...user, onboardingComplete: true };
    setUser(next);
    try {
      // The flag must be written through the provider, because the provider
      // re-emits its own session object on write. Passing only name/avatarUrl
      // made that broadcast carry the stale `false` and bounce the user back to
      // step 1 of onboarding.
      await provider.updateProfile({ onboardingComplete: true });
    } catch (err) {
      console.warn('[planify] could not persist onboarding flag', err);
    }
  }, [user, provider]);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!provider || !user) return;
      const next = { ...settings, ...patch };
      setSettings(next); // optimistic
      try {
        await provider.saveSettings(user.id, next);
      } catch (err) {
        console.error('[planify] saveSettings failed', err);
        setEventsError(err instanceof Error ? err.message : 'Could not save settings');
      }
    },
    [settings, user, provider],
  );

  const createEvent = useCallback(
    async (draft: Partial<CalEvent>) => {
      if (!provider) throw new Error('Planify is still starting up. Try again in a moment.');
      if (!user) throw new Error('You must be signed in to create an event.');
      const event = finalize(draft, user.id);
      setEvents((prev) => [...prev.filter((e) => e.id !== event.id), event]);
      announce(`Saved “${event.title}”`);
      try {
        const saved = await provider.upsertEvent(event);
        setEvents((prev) => prev.map((e) => (e.id === saved.id ? saved : e)));
        return saved;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not save the event';
        setEventsError(msg);
        // The optimistic row stays: it is queued in the outbox and will sync.
        return event;
      }
    },
    [user, provider],
  );

  const updateEvent = useCallback(
    async (id: string, patch: Partial<CalEvent>) => {
      if (!provider || !user) return;
      const current = events.find((e) => e.id === id);
      if (!current) return;
      const next = finalize({ ...current, ...patch }, user.id, current);
      setEvents((prev) => prev.map((e) => (e.id === id ? next : e)));
      try {
        await provider.upsertEvent(next);
      } catch (err) {
        setEventsError(err instanceof Error ? err.message : 'Could not save changes');
      }
    },
    [events, user, provider],
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      if (!provider || !user) return;
      const target = events.find((e) => e.id === id);
      setEvents((prev) => prev.filter((e) => e.id !== id));
      announce(`Deleted “${target?.title ?? 'event'}”`);
      try {
        await provider.deleteEvent(user.id, id);
      } catch (err) {
        // Restore on failure rather than silently losing data.
        if (target) setEvents((prev) => [...prev, target]);
        setEventsError(err instanceof Error ? err.message : 'Could not delete the event');
      }
    },
    [events, user, provider],
  );

  const duplicateEvent = useCallback(
    async (id: string) => {
      if (!provider || !user) return null;
      const source = events.find((e) => e.id === id);
      if (!source) return null;
      const copy = finalize(
        {
          ...source,
          id: undefined,
          title: source.title ? `${source.title} (copy)` : source.title,
          // A recurring copy keeps its rule but restarts from its own start.
          exceptions: [],
          googleEventId: null,
          googleCalendarId: null,
        },
        user.id,
      );
      copy.createdAt = new Date().toISOString();
      setEvents((prev) => [...prev, copy]);
      announce(`Duplicated “${source.title}”`);
      try {
        return await provider.upsertEvent(copy);
      } catch (err) {
        setEventsError(err instanceof Error ? err.message : 'Could not duplicate the event');
        return copy;
      }
    },
    [events, user, provider],
  );

  const bulkUpdate = useCallback(
    async (patches: Array<{ id: string; patch: Partial<CalEvent> }>) => {
      if (!provider || !user || !patches.length) return;
      const rows: CalEvent[] = [];
      setEvents((prev) =>
        prev.map((e) => {
          const p = patches.find((x) => x.id === e.id);
          if (!p) return e;
          const next = finalize({ ...e, ...p.patch }, user.id, e);
          rows.push(next);
          return next;
        }),
      );
      try {
        await provider.upsertEvents(rows);
      } catch (err) {
        setEventsError(err instanceof Error ? err.message : 'Could not save changes');
      }
    },
    [user, provider],
  );

  const retrySync = useCallback(async () => {
    if (!provider) return;
    setEventsError(null);
    try {
      const applied = await provider.flush();
      if (user) {
        const fresh = await provider.listEvents(user.id);
        setEvents(fresh.filter((e) => !e.deleted));
      }
      announce(applied ? `Synced ${applied} change${applied > 1 ? 's' : ''}` : 'Up to date');
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : 'Sync failed');
    }
  }, [provider, user]);

  const addChatMessage = useCallback(
    async (m: ChatMessage) => {
      setChat((prev) => [...prev.filter((x) => x.id !== m.id), m]);
      if (!provider) return;
      try {
        await provider.addChatMessage(m);
      } catch (err) {
        console.warn('[planify] chat persist failed', err);
      }
    },
    [provider],
  );

  const updateChatMessage = useCallback(
    async (m: ChatMessage) => {
      setChat((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      if (!provider) return;
      try {
        await provider.updateChatMessage(m);
      } catch (err) {
        console.warn('[planify] chat persist failed', err);
      }
    },
    [provider],
  );

  const clearChat = useCallback(async () => {
    if (!provider || !user) return;
    setChat([]);
    try {
      await provider.clearChat(user.id);
    } catch (err) {
      console.warn('[planify] clearChat failed', err);
    }
  }, [user, provider]);

  const setGoogleLink = useCallback(
    async (link: GoogleCalendarLink) => {
      setGoogleLinkState(link);
      if (!provider || !user) return;
      try {
        await provider.saveGoogleLink(user.id, link);
      } catch (err) {
        console.warn('[planify] could not persist Google Calendar link', err);
      }
    },
    [user, provider],
  );

  const value = useMemo<AppStoreValue>(
    () => ({
      ready,
      provider,
      user,
      authLoading,
      authError,
      signInWithGoogle,
      signInLocally,
      signOut,
      deleteAccount,
      completeOnboarding,
      settings,
      settingsLoaded,
      updateSettings,
      events,
      eventsLoading,
      eventsError,
      createEvent,
      updateEvent,
      deleteEvent,
      duplicateEvent,
      bulkUpdate,
      status,
      retrySync,
      chat,
      addChatMessage,
      updateChatMessage,
      clearChat,
      googleLink,
      setGoogleLink,
    }),
    [
      ready,
      provider,
      user,
      authLoading,
      authError,
      signInWithGoogle,
      signInLocally,
      signOut,
      deleteAccount,
      completeOnboarding,
      settings,
      settingsLoaded,
      updateSettings,
      events,
      eventsLoading,
      eventsError,
      createEvent,
      updateEvent,
      deleteEvent,
      duplicateEvent,
      bulkUpdate,
      status,
      retrySync,
      chat,
      addChatMessage,
      updateChatMessage,
      clearChat,
      googleLink,
      setGoogleLink,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}
