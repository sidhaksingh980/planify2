/**
 * IndexedDB store for the on-device provider and the offline cache.
 *
 * Uses `idb` for promise ergonomics. The schema is versioned; bump `DB_VERSION`
 * and add a migration step whenever an object store changes.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CalEvent, ChatMessage, PendingMutation, UserProfile, UserSettings } from '../../types';

const DB_NAME = 'planify';
const DB_VERSION = 1;

interface PlanifyDB extends DBSchema {
  events: {
    key: string;
    value: CalEvent & { _userId: string };
    indexes: { 'by-user': string; 'by-user-updated': [string, string] };
  };
  settings: { key: string; value: UserSettings & { _userId: string } };
  chat: {
    key: string;
    value: ChatMessage;
    indexes: { 'by-user': string };
  };
  account: { key: string; value: UserProfile };
  outbox: {
    key: string;
    value: PendingMutation;
    indexes: { 'by-created': string };
  };
  meta: { key: string; value: { key: string; value: unknown } };
}

let dbPromise: Promise<IDBPDatabase<PlanifyDB>> | null = null;

export function db(): Promise<IDBPDatabase<PlanifyDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PlanifyDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const events = database.createObjectStore('events', { keyPath: 'id' });
          events.createIndex('by-user', '_userId');
          events.createIndex('by-user-updated', ['_userId', 'updatedAt']);

          database.createObjectStore('settings', { keyPath: '_userId' });

          const chat = database.createObjectStore('chat', { keyPath: 'id' });
          chat.createIndex('by-user', 'userId');

          database.createObjectStore('account', { keyPath: 'id' });

          const outbox = database.createObjectStore('outbox', { keyPath: 'id' });
          outbox.createIndex('by-created', 'createdAt');

          database.createObjectStore('meta', { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('[planify] IndexedDB upgrade blocked by another open tab.');
      },
      blocking() {
        console.warn('[planify] Another tab is waiting on an IndexedDB upgrade.');
      },
    });
  }
  return dbPromise;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export async function idbListEvents(userId: string): Promise<CalEvent[]> {
  const d = await db();
  const rows = await d.getAllFromIndex('events', 'by-user', userId);
  return rows.map(strip);
}

export async function idbGetEvent(id: string): Promise<CalEvent | null> {
  const d = await db();
  const row = await d.get('events', id);
  return row ? strip(row) : null;
}

export async function idbPutEvent(e: CalEvent): Promise<void> {
  const d = await db();
  await d.put('events', { ...e, _userId: e.userId });
}

export async function idbPutEvents(events: CalEvent[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('events', 'readwrite');
  await Promise.all([
    ...events.map((e) => tx.store.put({ ...e, _userId: e.userId })),
    tx.done,
  ]);
}

export async function idbDeleteEvent(id: string): Promise<void> {
  const d = await db();
  await d.delete('events', id);
}

export async function idbClearEvents(userId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('events', 'readwrite');
  const keys = await tx.store.index('by-user').getAllKeys(userId);
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

function strip<T extends { _userId?: string }>(row: T): CalEvent {
  const { _userId: _drop, ...rest } = row as { _userId?: string } & Record<string, unknown>;
  void _drop;
  return rest as unknown as CalEvent;
}

/* -------------------------------------------------------------------------- */
/* Settings / account / chat / outbox                                          */
/* -------------------------------------------------------------------------- */

export async function idbGetSettings(userId: string): Promise<UserSettings | null> {
  const d = await db();
  const row = await d.get('settings', userId);
  if (!row) return null;
  const { _userId: _drop, ...rest } = row;
  void _drop;
  return rest as UserSettings;
}

export async function idbPutSettings(userId: string, s: UserSettings): Promise<void> {
  const d = await db();
  await d.put('settings', { ...s, _userId: userId });
}

export async function idbGetAccount(): Promise<UserProfile | null> {
  const d = await db();
  const all = await d.getAll('account');
  if (!all.length) return null;
  // Most recently seen account wins.
  return all.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))[0];
}

export async function idbGetAccountById(id: string): Promise<UserProfile | null> {
  const d = await db();
  return (await d.get('account', id)) ?? null;
}

export async function idbPutAccount(p: UserProfile): Promise<void> {
  const d = await db();
  await d.put('account', p);
}

export async function idbDeleteAccount(id: string): Promise<void> {
  const d = await db();
  await d.delete('account', id);
}

export async function idbListChat(userId: string): Promise<ChatMessage[]> {
  const d = await db();
  const rows = await d.getAllFromIndex('chat', 'by-user', userId);
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function idbPutChat(m: ChatMessage): Promise<void> {
  const d = await db();
  await d.put('chat', m);
}

export async function idbClearChat(userId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('chat', 'readwrite');
  const keys = await tx.store.index('by-user').getAllKeys(userId);
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

export async function idbListOutbox(): Promise<PendingMutation[]> {
  const d = await db();
  return d.getAll('outbox');
}

export async function idbPutOutbox(m: PendingMutation): Promise<void> {
  const d = await db();
  await d.put('outbox', m);
}

export async function idbDeleteOutbox(id: string): Promise<void> {
  const d = await db();
  await d.delete('outbox', id);
}

export async function idbGetMeta<T>(key: string): Promise<T | null> {
  const d = await db();
  const row = await d.get('meta', key);
  return row ? (row.value as T) : null;
}

export async function idbPutMeta(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put('meta', { key, value });
}

export async function idbDeleteMeta(key: string): Promise<void> {
  const d = await db();
  await d.delete('meta', key);
}

/** Full wipe — used by "Delete account and data". */
export async function idbWipeUserData(userId: string): Promise<void> {
  await Promise.all([idbClearEvents(userId), idbClearChat(userId), idbDeleteAccount(userId)]);
  const d = await db();
  await d.delete('settings', userId);
}
